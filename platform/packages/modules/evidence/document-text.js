import {spawn} from 'node:child_process';
import {access, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {dirname, extname, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {getObjectReadStream} from '../../storage/objectStorage.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const pythonExtractor = resolve(moduleDir, 'extract_document_text.py');
const maxInputBytes = 12 * 1024 * 1024;

function cleanText(value = '', maxChars = 8000) {
    return String(value || '')
        .replace(/\u0000/g, ' ')
        .replace(/[\u0001-\u0008\u000b\f\u000e-\u001f\u007f-\u009f]/g, ' ')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, maxChars);
}

function looksReadableText(value = '') {
    const text = cleanText(value, 4000);
    const chars = text.replace(/\s/g, '');
    if (chars.length < 20) return false;
    const cjk = (chars.match(/[\u4e00-\u9fff]/g) || []).length;
    const ascii = (chars.match(/[A-Za-z0-9]/g) || []).length;
    const commonPunctuation = (chars.match(/[，。；：、,.!?/()（）\-+%#&@]/g) || []).length;
    const highLatin = (chars.match(/[\u00c0-\u00ff]/g) || []).length;
    const readableRatio = (cjk + ascii + commonPunctuation) / chars.length;
    const highLatinRatio = highLatin / chars.length;
    const hasReadableSignal = cjk >= 8 || (chars.match(/[A-Za-z]{3,}/g) || []).length >= 3;
    return hasReadableSignal && readableRatio >= 0.65 && !(highLatinRatio > 0.08 && cjk < 8);
}

function extensionFor(item = {}) {
    const explicit = extname(item.fileName || item.name || item.title || item.storageKey || '').toLowerCase();
    if (explicit) return explicit;
    const mime = String(item.mimeType || '').toLowerCase();
    if (mime.includes('pdf')) return '.pdf';
    if (mime.includes('wordprocessingml')) return '.docx';
    if (mime.includes('spreadsheetml')) return '.xlsx';
    if (mime.includes('markdown')) return '.md';
    if (mime.includes('csv')) return '.csv';
    if (mime.includes('text')) return '.txt';
    return '';
}

function isPlainText(item = {}) {
    const ext = extensionFor(item);
    const mime = String(item.mimeType || '').toLowerCase();
    return ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json'].includes(ext)
        || mime.startsWith('text/')
        || mime.includes('csv')
        || mime.includes('json');
}

async function streamToBufferLimited(stream, limit = maxInputBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > limit) {
            throw new Error(`文件超过 ${Math.round(limit / 1024 / 1024)}MB，未进入文本抽取`);
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

async function fileExists(path) {
    try {
        await access(path, fsConstants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}

async function pythonCandidates() {
    const candidates = [];
    if (process.env.DOCUMENT_TEXT_PYTHON) candidates.push(process.env.DOCUMENT_TEXT_PYTHON);
    const bundled = resolve(dirname(dirname(dirname(process.execPath))), 'python/bin/python3');
    candidates.push(bundled, 'python3');
    const seen = new Set();
    const existing = [];
    for (const candidate of candidates) {
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        if (candidate === 'python3' || await fileExists(candidate)) {
            existing.push(candidate);
        }
    }
    return existing;
}

function runPythonExtractor(python, filePath, ext, maxChars) {
    return new Promise((resolvePromise) => {
        const child = spawn(python, [pythonExtractor, filePath, ext, String(maxChars)], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolvePromise({ok: false, error: '文档文本抽取超时'});
        }, 20000);
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            resolvePromise({ok: false, error: error.message});
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                resolvePromise({ok: false, error: stderr.trim() || `文档抽取进程退出：${code}`});
                return;
            }
            try {
                const parsed = JSON.parse(stdout || '{}');
                resolvePromise({ok: true, ...parsed});
            }
            catch (error) {
                resolvePromise({ok: false, error: `文档抽取输出无法解析：${error.message}`});
            }
        });
    });
}

async function extractWithPython(buffer, ext, maxChars) {
    const dir = await mkdtemp(resolve(tmpdir(), 'recruit-doc-'));
    const filePath = resolve(dir, `source${ext || '.bin'}`);
    try {
        await writeFile(filePath, buffer);
        const warnings = [];
        for (const python of await pythonCandidates()) {
            const result = await runPythonExtractor(python, filePath, ext, maxChars);
            if (result.ok && cleanText(result.text, maxChars)) {
                return {
                    text: cleanText(result.text, maxChars),
                    method: result.method || `python:${python}`,
                    warnings: result.warnings || [],
                };
            }
            if (result.error) warnings.push(`${python}: ${result.error}`);
            warnings.push(...(result.warnings || []).map((warning) => `${python}: ${warning}`));
        }
        return {
            text: '',
            method: 'python_unavailable',
            warnings: warnings.length ? warnings : ['没有可用的文档抽取器或未抽取到文本'],
        };
    }
    finally {
        await rm(dir, {recursive: true, force: true}).catch(() => null);
    }
}

function roughPdfText(buffer, maxChars) {
    const source = buffer.toString('latin1');
    const strings = [];
    const literalPattern = /\(([^()]{2,300})\)/g;
    let match;
    while ((match = literalPattern.exec(source))) {
        const text = match[1].replace(/\\([nrtbf()\\])/g, ' ').trim();
        if (looksReadableText(text)) strings.push(text);
        if (strings.join('\n').length > maxChars) break;
    }
    const text = cleanText(strings.join('\n'), maxChars);
    return looksReadableText(text) ? text : '';
}

export async function extractMaterialDocumentText(item = {}, {maxChars = 8000} = {}) {
    if (!item?.storageKey) {
        return {text: '', status: 'missing_storage_key', method: 'metadata_only', warnings: ['材料没有 storageKey']};
    }
    const ext = extensionFor(item);
    try {
        const buffer = await streamToBufferLimited(await getObjectReadStream(item.storageKey));
        if (isPlainText(item)) {
            const text = cleanText(buffer.toString('utf8'), maxChars);
            return {text, status: text ? 'read' : 'empty', method: 'plain_text', warnings: []};
        }
        if (['.pdf', '.docx', '.xlsx', '.pptx'].includes(ext)) {
            const result = await extractWithPython(buffer, ext, maxChars);
            const fallback = ext === '.pdf' && !result.text ? roughPdfText(buffer, maxChars) : '';
            const text = result.text || fallback;
            const fallbackWarnings = fallback ? ['PDF 正文抽取器未返回文本，已使用粗略文本抽取。'] : [];
            return {
                text,
                status: text ? 'read' : 'empty',
                method: text === fallback && fallback ? 'rough_pdf_text' : result.method,
                warnings: [...(result.warnings || []), ...fallbackWarnings],
            };
        }
        const text = cleanText(buffer.toString('utf8'), maxChars);
        return {text, status: text ? 'read' : 'unsupported', method: 'utf8_fallback', warnings: ext ? [`未专门支持 ${ext}，已尝试按文本读取`] : ['未知文件类型，已尝试按文本读取']};
    }
    catch (error) {
        return {text: '', status: 'failed', method: 'object_storage_read', warnings: [error.message || String(error)]};
    }
}

function runPythonModuleCheck(python) {
    return new Promise((resolvePromise) => {
        const code = 'import importlib.util, json; '
            + 'print(json.dumps({'
            + '"pypdf": importlib.util.find_spec("pypdf") is not None, '
            + '"pdfplumber": importlib.util.find_spec("pdfplumber") is not None'
            + '}))';
        const child = spawn(python, ['-c', code], {stdio: ['ignore', 'pipe', 'pipe']});
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolvePromise({ok: false, python, error: 'python module check timeout'});
        }, 5000);
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            resolvePromise({ok: false, python, error: error.message});
        });
        child.on('close', () => {
            clearTimeout(timer);
            try {
                const parsed = JSON.parse(stdout || '{}');
                resolvePromise({
                    ok: Boolean(parsed.pypdf || parsed.pdfplumber),
                    python,
                    pypdf: Boolean(parsed.pypdf),
                    pdfplumber: Boolean(parsed.pdfplumber),
                    error: stderr.trim(),
                });
            }
            catch (error) {
                resolvePromise({ok: false, python, error: stderr.trim() || error.message});
            }
        });
    });
}

export async function checkDocumentTextHealth() {
    const results = [];
    for (const python of await pythonCandidates()) {
        const result = await runPythonModuleCheck(python);
        results.push(result);
        if (result.ok) {
            return {
                python: result.python,
                pdf: {pypdf: result.pypdf, pdfplumber: result.pdfplumber},
            };
        }
    }
    throw new Error(`PDF 文本抽取依赖不可用：${JSON.stringify(results)}`);
}

export function compactDocumentForPrompt(item = {}, extracted = {}, {maxChars = 4000} = {}) {
    const text = cleanText(extracted.text || '', maxChars);
    return {
        id: item.id || item.uploadId || '',
        fileName: item.fileName || item.name || item.title || '',
        mimeType: item.mimeType || '',
        storageKey: item.storageKey || '',
        storageRef: item.storageRef || '',
        status: extracted.status || 'unknown',
        extractionMethod: extracted.method || '',
        warnings: extracted.warnings || [],
        text,
    };
}
