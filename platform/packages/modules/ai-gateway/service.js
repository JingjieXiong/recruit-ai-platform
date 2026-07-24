import {createHash} from 'node:crypto';
import {
    consultationAnswerSchema,
    interviewPlanSchema,
    portfolioEvaluationSchema,
    prescreenResultSchema,
} from '../../domain/contracts.js';
import {appConfig} from '../../storage/config.js';
import {getObjectReadStream} from '../../storage/objectStorage.js';
import {writeModelCallLog} from '../audit/service.js';
import {compactDocumentForPrompt, extractMaterialDocumentText} from '../evidence/document-text.js';

export class AiGatewayError extends Error {
    constructor(message, {callType, errorKind, cause} = {}) {
        super(message);
        this.name = 'AiGatewayError';
        this.callType = callType;
        this.errorKind = errorKind;
        this.cause = cause;
    }
}

function digest(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function extractJson(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    }
    catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        }
        catch {
            return null;
        }
    }
}

function fileExtensionFromName(name = '') {
    return String(name).split('.').pop()?.toLowerCase() || '';
}

function imageMimeType(item = {}) {
    const explicit = String(item.mimeType || '').toLowerCase();
    if (explicit.startsWith('image/')) return explicit;
    const ext = fileExtensionFromName(item.name || item.fileName || item.storageKey || '');
    return {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
    }[ext] || '';
}

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

function withTimeout(promise, label, timeoutMs = appConfig.ai.timeoutMs) {
    const ms = Number(timeoutMs || 0);
    if (!ms) return promise;
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            const error = new Error(`${label} timed out after ${ms}ms`);
            error.name = 'TimeoutError';
            reject(error);
        }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function compactContentPartMeta(part = {}) {
    if (part.type === 'image_url') {
        return {
            type: part.type,
            image: true,
            detail: part.image_url?.detail || '',
            bytes: part._bytes || 0,
            fileName: part._fileName || '',
            screenshotId: part._screenshotId || '',
        };
    }
    return {type: part.type || 'text', textLength: String(part.text || '').length};
}

function validateOutput({schema, output, callType, normalizeOutput = (value) => value}) {
    const normalized = normalizeOutput(output);
    const result = schema.safeParse(normalized);
    if (!result.success) {
        throw new AiGatewayError(`AI output schema validation failed for ${callType}`, {
            callType,
            errorKind: 'schema_validation_failed',
            cause: result.error,
        });
    }
    return result.data;
}

async function logModelCall({
    callType,
    provider,
    model,
    promptVersion,
    schemaVersion,
    input,
    output = {},
    rawOutput = {},
    errorKind = '',
    errorMessage = '',
    latencyMs,
}) {
    await writeModelCallLog({
        callType,
        provider,
        model,
        promptVersion,
        schemaVersion,
        inputDigest: digest(input),
        output,
        rawOutput,
        errorKind,
        errorMessage,
        latencyMs,
    });
}

function aiTimeoutSignal() {
    const timeoutMs = Number(appConfig.ai.timeoutMs || 0);
    if (!timeoutMs || !globalThis.AbortSignal?.timeout) return undefined;
    return AbortSignal.timeout(timeoutMs);
}

async function callOpenAiCompatible({
    callType,
    promptVersion,
    schemaVersion,
    schema,
    system,
    user,
    userContentParts = [],
    model = appConfig.ai.model,
    fallback,
    normalizeOutput,
}) {
    const started = Date.now();
    const input = {
        system,
        user,
        userContentParts: userContentParts.map(compactContentPartMeta),
    };
    if (appConfig.ai.mode === 'fixture') {
        if (typeof fallback !== 'function') {
            throw new AiGatewayError(`Fixture output is not implemented for ${callType}`, {
                callType,
                errorKind: 'fixture_not_implemented',
            });
        }
        const output = validateOutput({schema, output: fallback(), callType, normalizeOutput});
        await logModelCall({
            callType,
            provider: 'fixture',
            model: 'fixture-v1',
            promptVersion,
            schemaVersion,
            input,
            output,
            latencyMs: Date.now() - started,
        });
        return output;
    }
    if (appConfig.ai.mode !== 'openai-compatible') {
        throw new AiGatewayError(`Unsupported AI_MODE: ${appConfig.ai.mode}`, {
            callType,
            errorKind: 'unsupported_ai_mode',
        });
    }
    if (!appConfig.ai.apiKey) {
        throw new AiGatewayError(`AI_API_KEY is required for ${callType} in openai-compatible mode`, {
            callType,
            errorKind: 'missing_api_key',
        });
    }
    let rawOutput = {};
    try {
        const userMessageContent = userContentParts.length
            ? [
                {type: 'text', text: JSON.stringify(user)},
                ...userContentParts.map(({_bytes, _fileName, _screenshotId, ...part}) => part),
            ]
            : JSON.stringify(user);
        let lastValidationError = null;
        for (const retryMode of [false, true]) {
            const effectiveSystem = retryMode
                ? [
                    system,
                    '上一次输出无法被系统解析。请只输出一个合法 JSON object。',
                    '不要 Markdown，不要代码块，不要解释，不要思考过程；字符串数组里只放字符串。',
                ].join('\n')
                : system;
            const response = await withTimeout(fetch(`${appConfig.ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
                method: 'POST',
                signal: aiTimeoutSignal(),
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${appConfig.ai.apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        {role: 'system', content: effectiveSystem},
                        {role: 'user', content: userMessageContent},
                    ],
                    temperature: retryMode ? 0 : 0.2,
                    response_format: {type: 'json_object'},
                }),
            }), `${callType} fetch`);
            if (!response.ok) {
                throw new Error(`AI provider ${response.status}: ${await withTimeout(response.text(), `${callType} error body`)}`);
            }
            const body = await withTimeout(response.json(), `${callType} response body`);
            const content = body?.choices?.[0]?.message?.content || '';
            rawOutput = {body, content, retryMode};
            const parsed = extractJson(content);
            if (!parsed) {
                lastValidationError = new AiGatewayError(`AI output is not valid JSON for ${callType}`, {
                    callType,
                    errorKind: 'json_parse_failed',
                });
                if (!retryMode) continue;
                throw lastValidationError;
            }
            try {
                const output = validateOutput({schema, output: parsed, callType, normalizeOutput});
                await logModelCall({
                    callType,
                    provider: 'openai_compatible',
                    model,
                    promptVersion,
                    schemaVersion,
                    input: {...input, retryMode},
                    output,
                    rawOutput,
                    latencyMs: Date.now() - started,
                });
                return output;
            }
            catch (error) {
                lastValidationError = error;
                if (!retryMode) continue;
                throw error;
            }
        }
        throw lastValidationError;
    }
    catch (error) {
        const isTimeout = ['AbortError', 'TimeoutError'].includes(error.name);
        const errorKind = isTimeout ? 'timeout' : error.errorKind || 'provider_error';
        await logModelCall({
            callType,
            provider: 'openai_compatible',
            model,
            promptVersion,
            schemaVersion,
            input,
            output: {},
            rawOutput,
            errorKind,
            errorMessage: error.message,
            latencyMs: Date.now() - started,
        });
        throw error instanceof AiGatewayError
            ? error
            : new AiGatewayError(error.message, {callType, errorKind, cause: error});
    }
}

function evidenceRef(sourceType, sourceId, label, text, extra = {}) {
    return {
        sourceType,
        sourceId,
        label,
        text,
        materialId: extra.materialId || '',
        sourceField: extra.sourceField || '',
        storageKey: extra.storageKey || '',
        fileName: extra.fileName || '',
        screenshotId: extra.screenshotId || '',
        modality: extra.modality || 'text',
        extractionMethod: extra.extractionMethod || 'model_text',
        confidence: Number(extra.confidence || 0),
    };
}

function compactValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(compactValue).filter(Boolean).join('，');
    if (typeof value === 'object') {
        if (value.requirement || value.result) {
            return [value.requirement, value.result].map(compactValue).filter(Boolean).join('：');
        }
        const preferred = [
            value.name,
            value.title,
            value.degree,
            value.school,
            value.major,
            value.company,
            value.position,
            value.role,
            value.description,
            value.reason,
            value.summary,
            value.type,
            value.severity,
        ].filter(Boolean).map(compactValue);
        if (preferred.length) return preferred.join(' / ');
        return JSON.stringify(value);
    }
    return String(value);
}

function cleanPromptText(value = '', max = 20000) {
    return String(value || '')
        .replace(/\u0000/g, ' ')
        .replace(/[\u0001-\u0008\u000b\f\u000e-\u001f\u007f-\u009f]/g, ' ')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{4,}/g, '\n\n')
        .trim()
        .slice(0, max);
}

function materialTextFallback(item = {}, max = 12000) {
    return cleanPromptText([
        item.summary,
        item.evidence,
        item.usage,
        item.note,
        item.description,
        item.content,
        item.text,
    ].filter(Boolean).join('\n\n'), max);
}

async function materialDocumentContext(item = {}, existingContext = {}, {maxChars = 20000} = {}) {
    if (existingContext?.text || existingContext?.status) {
        return {
            id: existingContext.id || item.id || item.uploadId || '',
            fileName: existingContext.fileName || item.fileName || item.name || item.title || '',
            mimeType: existingContext.mimeType || item.mimeType || '',
            storageKey: existingContext.storageKey || item.storageKey || '',
            storageRef: existingContext.storageRef || item.storageRef || '',
            status: existingContext.status || 'read',
            extractionMethod: existingContext.extractionMethod || existingContext.method || 'document_text',
            warnings: existingContext.warnings || [],
            text: cleanPromptText(existingContext.text, maxChars),
        };
    }
    if (!item?.storageKey) {
        return {
            id: item.id || item.uploadId || '',
            fileName: item.fileName || item.name || item.title || '',
            mimeType: item.mimeType || '',
            storageKey: item.storageKey || '',
            storageRef: item.storageRef || '',
            status: 'metadata_only',
            extractionMethod: 'metadata_only',
            warnings: ['材料没有可读取的原始文件，仅使用表单字段。'],
            text: materialTextFallback(item, maxChars),
        };
    }
    const extracted = await extractMaterialDocumentText(item, {maxChars});
    const context = compactDocumentForPrompt(item, extracted, {maxChars});
    return {
        ...context,
        text: context.text || materialTextFallback(item, maxChars),
    };
}

function selectedResumeForPrescreen(candidate = {}, snapshot = {}) {
    if (snapshot.resumeItem) return snapshot.resumeItem;
    return (candidate.resumes || []).find((resume) => resume.id === snapshot.resumeId)
        || (candidate.resumes || []).find((resume) => resume.isDefault)
        || (candidate.resumes || [])[0]
        || {id: '', name: snapshot.resumeName || candidate.resume || '未选择简历', summary: candidate.resume || ''};
}

function selectedPortfoliosForPrescreen(candidate = {}, snapshot = {}) {
    if (snapshot.portfolioItems?.length) return snapshot.portfolioItems;
    const ids = snapshot.portfolioIds || [];
    return (candidate.portfolios || []).filter((item) => ids.includes(item.id));
}

function selectedKnowledgeForPrescreen(candidate = {}, snapshot = {}) {
    if (snapshot.knowledgeItems?.length) return snapshot.knowledgeItems;
    const ids = snapshot.knowledgeIds || [];
    return (candidate.knowledge || []).filter((item) => ids.includes(item.id));
}

function portfolioFieldsForPrompt(portfolio = {}) {
    return {
        id: portfolio.id || '',
        title: portfolio.title || portfolio.name || '',
        jobDirection: portfolio.jobDirection || '',
        oneLineValue: portfolio.oneLineValue || portfolio.summary || '',
        problem: portfolio.problem || '',
        scenario: portfolio.scenario || '',
        currentSolutionGap: portfolio.currentSolutionGap || '',
        solution: portfolio.solution || '',
        coreFeatures: portfolio.coreFeatures || '',
        demoFlow: portfolio.demoFlow || '',
        aiUsage: portfolio.aiUsage || '',
        differentiation: portfolio.differentiation || '',
        role: portfolio.role || '',
        contribution: portfolio.contribution || '',
        evidenceUrl: portfolio.evidenceUrl || '',
        outcome: portfolio.outcome || '',
        challenge: portfolio.challenge || '',
        reflection: portfolio.reflection || '',
        screenshotCaption: portfolio.screenshotCaption || '',
        screenshots: (portfolio.screenshots || []).map((shot, index) => ({
            id: shot.id || `screenshot_${index + 1}`,
            name: shot.name || `截图 ${index + 1}`,
            caption: shot.caption || '',
            tech: shot.tech || '',
            contribution: shot.contribution || '',
            validation: shot.validation || '',
            storageKey: shot.storageKey || '',
        })),
    };
}

function portfolioEvaluationForPrompt(evaluation = {}) {
    return {
        score: evaluation.score ?? 0,
        highlights: evaluation.highlights || [],
        risks: evaluation.risks || [],
        verificationNeeds: evaluation.verificationNeeds || [],
        visualReadStatus: evaluation.visualReadStatus || 'not_requested',
        visualFindings: evaluation.visualFindings || [],
        dimensions: evaluation.dimensions || [],
        modelRouting: evaluation.modelRouting || {},
        attachmentTexts: (evaluation.attachmentContexts || []).map((context) => ({
            id: context.id || '',
            fileName: context.fileName || '',
            status: context.status || '',
            extractionMethod: context.extractionMethod || '',
            warnings: context.warnings || [],
            text: cleanPromptText(context.text || '', 12000),
        })),
    };
}

async function portfolioRawEntry({job, portfolio, evaluation}) {
    let finalEvaluation = evaluation;
    if (!finalEvaluation) {
        try {
            finalEvaluation = await evaluatePortfolio({job, portfolio});
        }
        catch (error) {
            finalEvaluation = {
                score: 0,
                highlights: [],
                risks: [`作品辅助评价未完成：${error.message || String(error)}`],
                verificationNeeds: ['作品字段仍会进入初筛，但截图、附件或辅助评分未形成可靠结论。'],
                visualReadStatus: 'not_read',
                visualFindings: [],
                dimensions: [],
                modelRouting: {
                    textModel: appConfig.ai.portfolioTextModel,
                    visionModel: appConfig.ai.visionModel,
                    visionRequired: appConfig.ai.visionMode === 'required',
                },
                attachmentContexts: [],
            };
        }
    }
    return {
        fields: portfolioFieldsForPrompt(portfolio),
        evaluation: portfolioEvaluationForPrompt(finalEvaluation),
    };
}

async function buildPrescreenMaterialPackage({job, candidate, application = {}, evidencePack = {}}) {
    const snapshot = application.materialSnapshot || evidencePack?.snapshot || {};
    const resume = selectedResumeForPrescreen(candidate, snapshot);
    const resumeContext = await materialDocumentContext(
        resume,
        evidencePack?.resumeEvidence?.documentContext,
        {maxChars: 40000}
    );
    const portfolioEvaluations = new Map((evidencePack?.portfolioEvaluations || []).map((item) => [
        item.portfolioId || item.id || item.title,
        item,
    ]));
    const portfolios = [];
    for (const portfolio of selectedPortfoliosForPrescreen(candidate, snapshot)) {
        const evaluation = portfolioEvaluations.get(portfolio.id)
            || portfolioEvaluations.get(portfolio.title || portfolio.name);
        portfolios.push(await portfolioRawEntry({job, portfolio, evaluation}));
    }
    const knowledgeById = new Map((evidencePack?.knowledgeEvidence || []).map((item) => [
        item.sourceId || item.id || item.name,
        item,
    ]));
    const knowledgeSources = [];
    for (const source of selectedKnowledgeForPrescreen(candidate, snapshot)) {
        const cached = knowledgeById.get(source.id) || knowledgeById.get(source.name);
        const documentContext = await materialDocumentContext(
            source,
            cached?.documentContext,
            {maxChars: 30000}
        );
        knowledgeSources.push({
            id: source.id || '',
            name: source.name || source.title || source.fileName || '',
            summary: source.summary || '',
            usage: source.usage || '',
            evidence: source.evidence || '',
            claims: cached?.claims || [],
            risks: cached?.risks || [],
            documentContext,
        });
    }
    return {
        principle: [
            'rawMaterials 是本次初筛的主判断输入。',
            'evidencePack 只作为辅助缓存；如果抽取字段与原文冲突，以原文、作品字段和视觉观察为准。',
        ],
        snapshotSummary: {
            resumeName: snapshot.resumeName || resume.name || '',
            portfolioTitles: snapshot.portfolioTitles || portfolios.map((item) => item.fields.title).filter(Boolean),
            knowledgeNames: snapshot.knowledgeNames || knowledgeSources.map((item) => item.name).filter(Boolean),
            lockedAt: snapshot.lockedAt || '',
        },
        resume: {
            id: resume.id || '',
            name: resume.name || resume.fileName || '',
            summary: resume.summary || '',
            documentContext: resumeContext,
        },
        portfolios,
        knowledgeSources,
        evidencePackStatus: evidencePack?.status || 'not_ready',
        auxiliaryEvidence: {
            resumeEvidence: evidencePack?.resumeEvidence || {},
            knowledgeEvidence: evidencePack?.knowledgeEvidence || [],
            evidenceRefs: (evidencePack?.evidenceRefs || []).slice(0, 20),
        },
    };
}

function candidateInterviewQuestion(value, fallback = '', max = 160) {
    const raw = compactValue(value || fallback).replace(/[`*_#>]/g, '');
    if (!raw) return '';
    const tooBusy = raw.length > 180 || (raw.match(/[？?]/g) || []).length > 1;
    const asksForArtifacts = /上传|展示|截图|图中|截图里|画图|架构图|数据流图|文件路径|代码路径|提供链接|提供文件/.test(raw);
    let text = raw
        .replace(/JD/g, '岗位')
        .replace(/jd/g, '岗位')
        .replace(/截图里显示了|截图中显示了|图中显示了/g, '材料中提到了')
        .replace(/请给出具体的架构图或数据流说明/g, '请口头说明核心流程')
        .replace(/请提供可访问的链接、代码仓库或其他文件/g, '请口头补充关键证据');
    if (tooBusy || asksForArtifacts) {
        if (/面试题|岗位.*知识库|知识库.*岗位|定制.*题/.test(raw)) {
            text = '你提到做过面试题生成，请口头说明从岗位资料到题目生成的核心流程，以及你负责哪一段。';
        } else if (/RAG|知识库|问答|检索/.test(raw)) {
            text = '请讲一个你在知识库或 RAG 问答中实际负责的环节：问题是什么，你怎么验证效果？';
        } else if (/作品|项目|Demo|demo/.test(raw)) {
            text = '请选一个最相关的项目，说明它解决了什么问题、你负责什么、结果如何。';
        } else {
            text = fallback || '请讲一个最能体现岗位能力的经历：当时的问题是什么，你负责什么，结果如何。';
        }
    }
    return compactValue(text).slice(0, max);
}

function conciseRule(rule = {}) {
    return {
        type: compactValue(rule.type),
        label: compactValue(rule.label),
        value: compactValue(rule.value),
    };
}

function ruleText(rule = {}) {
    return compactValue([rule.type, rule.label, rule.value]).toLowerCase();
}

function screeningRuleGroups(job = {}) {
    const groups = {
        hardRequirements: [],
        evaluationDimensions: [],
        riskChecks: [],
    };
    for (const rule of job.screeningRules || []) {
        const text = ruleText(rule);
        const row = conciseRule(rule);
        if (/硬性|门槛|必须|必填|required|无.{0,8}不通过|没有.{0,8}不通过|不满足.{0,8}不建议|淘汰/.test(text)) {
            groups.hardRequirements.push(row);
        }
        else if (/风险|核验|真实性|存疑|缺口|不清|待确认|模糊/.test(text)) {
            groups.riskChecks.push(row);
        }
        else {
            groups.evaluationDimensions.push(row);
        }
    }
    return groups;
}

function compactReportValue(value, max = 90) {
    const text = compactValue(value)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#>*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return '';
    const labeled = text.match(/(?:结论|核心结论|关键判断|下一步|建议|原因)[：:]\s*([^。！？；]{4,120})/);
    const parts = text.split(/[。！？；]/)
        .map((item) => item.trim())
        .filter(Boolean);
    const selected = labeled?.[1]
        || parts.find((item) => /推荐|不建议|风险|核验|证据|不足|匹配/.test(item))
        || parts[0]
        || text;
    return compactValue(selected).slice(0, max);
}

function compactReportParagraph(value, max = 280) {
    return compactValue(value)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#>*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function normalizeStringList(value) {
    if (!value) return [];
    const source = Array.isArray(value) ? value : [value];
    return source.map(compactValue).filter(Boolean);
}

function normalizeVerificationNeedText(value) {
    let text = compactValue(value)
        .replace(/^请(候选人|其)?/u, '')
        .replace(/^(说明|提供|解释|谈谈|确认|给出|补充)/u, '')
        .replace(/[？?]+$/u, '')
        .trim();
    text = text.replace(/^是否/u, '需确认是否');
    text = text.replace(/^能否/u, '需确认能否');
    text = text.replace(/^为什么/u, '需补充原因：');
    text = text.replace(/^如何/u, '需补充方式：');
    if (!text) return '';
    if (/portfolio_field|interview_plan|model_text|sourceType|sourceField/i.test(text)) return '';
    return /[。；.!]$/.test(text) ? text : `${text}。`;
}

function normalizeVerificationNeeds(...values) {
    const seen = new Set();
    const rows = [];
    for (const value of values) {
        for (const item of normalizeStringList(value)) {
            const text = normalizeVerificationNeedText(item);
            const key = text.replace(/\s+/g, '');
            if (!key || seen.has(key)) continue;
            seen.add(key);
            rows.push(text);
        }
    }
    return rows;
}

function normalizeEvidenceRefs(refs, {sourceType, sourceId, label}) {
    const source = Array.isArray(refs) ? refs : refs ? [refs] : [];
    return source.map((ref, index) => {
        if (typeof ref === 'string') {
            return evidenceRef(sourceType, sourceId, ref || label, ref);
        }
        if (ref && typeof ref === 'object') {
            return evidenceRef(
                ref.sourceType || sourceType,
                ref.sourceId || sourceId,
                ref.label || ref.id || ref.name || `${label}${index + 1}`,
                ref.text || ref.description || compactValue(ref),
                {
                    materialId: ref.materialId || ref.portfolioId || '',
                    sourceField: ref.sourceField || ref.field || '',
                    storageKey: ref.storageKey || '',
                    fileName: ref.fileName || ref.name || '',
                    screenshotId: ref.screenshotId || '',
                    modality: ref.modality || 'text',
                    extractionMethod: ref.extractionMethod || ref.method || 'model_text',
                    confidence: ref.confidence || 0,
                }
            );
        }
        return null;
    }).filter(Boolean);
}

function normalizeResumeEvidence(output, resume) {
    const resumeId = resume?.id || 'resume';
    const documentContext = resume?.documentContext || {};
    const fallbackRefs = documentContext.text ? [
        evidenceRef('resume_document', resumeId, '简历原文', documentContext.text.slice(0, 500), {
            materialId: resumeId,
            storageKey: resume?.storageKey || '',
            fileName: resume?.name || resume?.fileName || '',
            sourceField: 'documentText',
            modality: 'text',
            extractionMethod: documentContext.extractionMethod || 'document_text',
            confidence: 0.9,
        }),
    ] : [];
    const refs = normalizeEvidenceRefs(output?.evidenceRefs, {
        sourceType: 'resume_span',
        sourceId: resumeId,
        label: '简历证据',
    });
    return {
        education: compactValue(output?.education),
        experiences: normalizeStringList(output?.experiences),
        projects: normalizeStringList(output?.projects),
        skills: normalizeStringList(output?.skills),
        risks: [
            ...normalizeStringList(output?.risks),
            ...(documentContext.status && documentContext.status !== 'read' ? [`简历原文抽取状态：${documentContext.status}`] : []),
        ],
        documentContext,
        evidenceRefs: [...refs, ...fallbackRefs].slice(0, 8),
    };
}

function normalizeScore(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric > 10) return Number(Math.min(10, numeric / 10).toFixed(1));
    return Number(Math.max(0, Math.min(10, numeric)).toFixed(1));
}

function normalizeMarkdownReport(value = '') {
    return String(value || '')
        .replace(/^```(?:markdown|md)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
}

function normalizeDimensions(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.map((item, index) => ({
            key: String(item?.key || item?.name || `dimension_${index + 1}`),
            label: String(item?.label || item?.name || item?.key || `维度 ${index + 1}`),
            score: normalizeScore(item?.score ?? item?.value ?? item?.points),
            reason: compactValue(item?.reason || item?.comment || item?.description),
        }));
    }
    if (typeof value === 'object') {
        return Object.entries(value).map(([key, item]) => ({
            key,
            label: key,
            score: normalizeScore(typeof item === 'object' ? item.score ?? item.value ?? item.points : item),
            reason: compactValue(typeof item === 'object' ? item.reason || item.comment || item.description : ''),
        }));
    }
    return [];
}

function normalizeVisualFindings(value, portfolio) {
    const source = Array.isArray(value) ? value : value ? [value] : [];
    return source.map((item, index) => {
        const screenshot = (portfolio?.screenshots || [])[index] || {};
        const screenshotId = compactValue(item?.screenshotId || screenshot.id || `screenshot_${index + 1}`);
        const fileName = compactValue(item?.fileName || screenshot.name || `截图 ${index + 1}`);
        const refs = normalizeEvidenceRefs(item?.evidenceRefs, {
            sourceType: 'portfolio_screenshot',
            sourceId: screenshotId,
            label: fileName,
        });
        return {
            screenshotId,
            fileName,
            status: compactValue(item?.status || 'read'),
            finding: compactValue(item?.finding || item?.summary || item?.description),
            supportedClaims: normalizeStringList(item?.supportedClaims || item?.supports),
            unverifiedClaims: normalizeStringList(item?.unverifiedClaims || item?.unknowns),
            risks: normalizeStringList(item?.risks),
            evidenceRefs: refs.length ? refs : [
                evidenceRef('portfolio_screenshot', screenshotId, fileName, compactValue(item?.finding || screenshot.caption || ''), {
                    materialId: portfolio?.id || '',
                    screenshotId,
                    storageKey: screenshot.storageKey || '',
                    fileName,
                    modality: 'image',
                    extractionMethod: 'model_vision',
                    confidence: item?.confidence || 0,
                }),
            ],
        };
    });
}

function normalizePortfolioEvaluation(output, portfolio) {
    const attachmentContexts = Array.isArray(portfolio?.attachmentContexts)
        ? portfolio.attachmentContexts
        : [];
    const attachmentRefs = attachmentContexts
        .filter((context) => context?.text)
        .map((context, index) => evidenceRef(
            'portfolio_attachment_document',
            context.id || `${portfolio?.id || 'portfolio'}-attachment-${index + 1}`,
            context.fileName || `作品附件 ${index + 1}`,
            context.text.slice(0, 500),
            {
                materialId: portfolio?.id || '',
                sourceField: 'attachmentText',
                storageKey: context.storageKey || '',
                fileName: context.fileName || '',
                modality: 'text',
                extractionMethod: context.extractionMethod || 'document_text',
                confidence: 0.85,
            }
        ));
    const refs = normalizeEvidenceRefs(output?.evidenceRefs, {
        sourceType: 'portfolio_field',
        sourceId: portfolio?.id || 'portfolio',
        label: portfolio?.title || portfolio?.name || '作品证据',
    });
    return {
        score: normalizeScore(output?.score),
        highlights: normalizeStringList(output?.highlights),
        risks: normalizeStringList(output?.risks),
        verificationNeeds: normalizeVerificationNeeds(
            output?.verificationNeeds,
            output?.evidenceNeeds,
            output?.followUps
        ),
        followUps: normalizeStringList(output?.followUps),
        evidenceRefs: [...refs, ...attachmentRefs].slice(0, 8),
        visualReadStatus: compactValue(output?.visualReadStatus || 'not_requested'),
        attachmentContexts,
        modelRouting: {
            textModel: compactValue(output?.modelRouting?.textModel),
            visionModel: compactValue(output?.modelRouting?.visionModel),
            visionRequired: output?.modelRouting?.visionRequired === true,
            reviewerModel: compactValue(output?.modelRouting?.reviewerModel),
        },
        visualFindings: normalizeVisualFindings(output?.visualFindings, portfolio),
        dimensions: normalizeDimensions(output?.dimensions),
    };
}

function normalizeRecommendation(value) {
    const text = compactValue(value);
    if (text === '推荐AI面试') return '推荐 AI 面试';
    if (text === '推荐 AI 面试' || text === '不建议继续') return text;
    throw new AiGatewayError(`Invalid prescreen recommendation: ${text || 'empty'}`, {
        callType: 'prescreen_application',
        errorKind: 'schema_validation_failed',
    });
}

function normalizeMatchedRequirements(value, evidenceRefs) {
    const items = Array.isArray(value) ? value : value ? [value] : [];
    return items.map((item) => {
        if (typeof item === 'string') {
            return {
                requirement: item,
                result: '命中/待确认',
                evidenceRefs: evidenceRefs.slice(0, 2),
            };
        }
        return {
            requirement: compactReportValue(item?.requirement || item?.label || item?.name || item, 160),
            result: compactReportValue(item?.result || item?.status || '待确认', 320),
            evidenceRefs: normalizeEvidenceRefs(item?.evidenceRefs, {
                sourceType: 'prescreen',
                sourceId: 'prescreen',
                label: '预筛证据',
            }),
        };
    }).filter((item) => item.requirement);
}

function normalizePrescreenResult(output) {
    const evidenceRefs = normalizeEvidenceRefs(output?.evidenceRefs, {
        sourceType: 'prescreen',
        sourceId: 'prescreen',
        label: '预筛证据',
    });
    const reportList = (values) => normalizeStringList(values)
        .map((item) => compactReportParagraph(item, 320))
        .filter(Boolean);
    const score = normalizeScore(output?.score);
    const summary = compactReportParagraph(output?.summary || '评价报告已生成。', 300);
    return {
        recommendation: normalizeRecommendation(output?.recommendation),
        score,
        summary,
        matchedRequirements: normalizeMatchedRequirements(output?.matchedRequirements, evidenceRefs),
        gaps: reportList(output?.gaps),
        risks: reportList(output?.risks),
        markdownReport: normalizeMarkdownReport(output?.markdownReport || output?.reportMarkdown || output?.markdown),
        adminSuggestion: compactReportParagraph(output?.adminSuggestion, 120),
        evidenceRefs,
    };
}

function normalizeCandidateKnowledgeEvidence(output, source) {
    const documentContext = source?.documentContext || {};
    const refs = normalizeEvidenceRefs(output?.evidenceRefs, {
        sourceType: 'candidate_knowledge',
        sourceId: source?.id || 'candidate-knowledge',
        label: source?.name || '候选人补充资料',
    });
    const fallbackRefs = documentContext.text ? [
        evidenceRef('candidate_knowledge_document', source?.id || 'candidate-knowledge', source?.name || '候选人补充资料原文', documentContext.text.slice(0, 500), {
            materialId: source?.id || '',
            storageKey: source?.storageKey || '',
            fileName: source?.name || source?.fileName || '',
            sourceField: 'documentText',
            modality: 'text',
            extractionMethod: documentContext.extractionMethod || 'document_text',
            confidence: 0.9,
        }),
    ] : [];
    return {
        claims: normalizeStringList(output?.claims || output?.summary || output?.keyPoints),
        risks: [
            ...normalizeStringList(output?.risks),
            ...(documentContext.status && documentContext.status !== 'read' ? [`补充资料原文抽取状态：${documentContext.status}`] : []),
        ],
        documentContext,
        evidenceRefs: [...refs, ...fallbackRefs].slice(0, 8),
    };
}

function jobKnowledgeChunkRefs(job = {}) {
    return (job.knowledgeChunks || []).slice(0, 4).map((chunk) => evidenceRef(
        'job_knowledge_chunk',
        chunk.id || chunk.sourceId || 'job-knowledge',
        chunk.sourceName || chunk.fileName || '岗位知识库',
        chunk.content || '',
        {
            sourceField: 'job_knowledge_chunks.content',
            fileName: chunk.fileName || chunk.sourceName || '',
            extractionMethod: chunk.extractionMethod || 'document_text',
            confidence: 0.8,
        }
    ));
}

function evidenceRefKey(ref = {}) {
    return [ref.sourceType, ref.sourceId, ref.label, ref.text].join('|');
}

function isConcreteEvidenceRef(ref = {}) {
    return Boolean(
        ref.sourceType && ref.sourceType !== 'interview_plan'
        || ref.storageKey
        || ref.fileName
        || ref.sourceField
        || ref.materialId
    );
}

function questionEvidenceText(item = {}) {
    return compactValue([
        item.prompt,
        item.question,
        item.text,
        item.competency,
        item.expectedEvidence,
        ...(Array.isArray(item.followUps) ? item.followUps : []),
    ]);
}

function evidenceMatchScore(questionText, ref = {}) {
    const haystack = compactValue([ref.label, ref.fileName, ref.text]).toLowerCase();
    const needle = String(questionText || '').toLowerCase();
    let score = 0;
    for (const keyword of ['rag', 'agent', '知识库', '问答', '评测', '日志', '证据', 'web', 'demo', '前端', '后端', 'sql', 'node', '部署', '研究生', '学历', '贡献', '作品', '创意', '业务']) {
        if (needle.includes(keyword.toLowerCase()) && haystack.includes(keyword.toLowerCase())) score += 2;
    }
    if (/简历|经历|学历|项目/.test(needle) && /resume|简历/.test(`${ref.sourceType}${ref.label}${ref.fileName}`)) score += 2;
    if (/知识库|rag|问答|评测|补充/.test(needle) && /knowledge|知识库|补充/.test(`${ref.sourceType}${ref.label}${ref.fileName}`)) score += 2;
    if (/岗位|jd|业务|边界|管理员|咨询/.test(needle) && /job_knowledge|岗位/.test(`${ref.sourceType}${ref.label}${ref.fileName}`)) score += 2;
    return score;
}

function pickFallbackEvidenceRefs(item, fallbackRefs = []) {
    const questionText = questionEvidenceText(item);
    const scored = fallbackRefs
        .map((ref, index) => ({ref, index, score: evidenceMatchScore(questionText, ref)}))
        .sort((a, b) => b.score - a.score || a.index - b.index);
    const picked = scored.filter((item) => item.score > 0).map((item) => item.ref);
    const source = picked.length ? picked : fallbackRefs;
    return source.slice(0, 3);
}

function normalizeInterviewQuestions(value, fallbackRefs) {
    const source = Array.isArray(value)
        ? value
        : value && typeof value === 'object'
            ? Object.entries(value).map(([key, item]) => ({id: key, ...(typeof item === 'object' ? item : {prompt: item})}))
            : [];
    return source.slice(0, 10).map((item, index) => {
        const prompt = candidateInterviewQuestion(
            item?.prompt || item?.question || item?.text || item?.title,
            '请讲一个最能体现岗位能力的经历：当时的问题是什么，你负责什么，结果如何。'
        );
        const refs = normalizeEvidenceRefs(item?.sourceRefs || item?.evidenceRefs, {
            sourceType: 'interview_plan',
            sourceId: 'interview_plan',
            label: '面试题依据',
        });
        const fallback = pickFallbackEvidenceRefs(item, fallbackRefs);
        const sourceRefs = [
            ...refs.filter(isConcreteEvidenceRef),
            ...fallback,
        ].filter((ref, index, rows) => rows.findIndex((item) => evidenceRefKey(item) === evidenceRefKey(ref)) === index).slice(0, 4);
        return {
            id: compactValue(item?.id || `q${index + 1}`),
            type: compactValue(item?.type || item?.category || 'custom'),
            competency: compactValue(item?.competency || item?.dimension || item?.focus || `问题 ${index + 1}`),
            prompt,
            sourceRefs,
            expectedEvidence: compactValue(item?.expectedEvidence || item?.expectedAnswer || '结合简历、作品或补充资料给出可追溯事实。'),
            followUps: normalizeStringList(item?.followUps || item?.followup || item?.追问)
                .map((text) => candidateInterviewQuestion(text, '请再补充一个能验证你本人贡献的具体细节。'))
                .filter(Boolean),
            scoringHints: normalizeStringList(item?.scoringHints || item?.rubric || item?.评分提示),
            timeLimitSec: Number(item?.timeLimitSec || item?.durationSec || 180),
            required: item?.required === false ? false : true,
        };
    }).filter((item) => item.prompt);
}

function normalizeInterviewPlan(output, evidencePack, prescreen, job) {
    const fallbackRefs = [
        ...(evidencePack?.evidenceRefs || []),
        ...(prescreen?.evidenceRefs || []),
        ...jobKnowledgeChunkRefs(job),
    ];
    const questionCount = interviewQuestionCount(job);
    return {
        title: compactValue(output?.title || `${job?.title || '岗位'} AI 面试计划`),
        durationMinutes: Number(output?.durationMinutes || output?.duration || job?.interviewSettings?.durationMinutes || 25),
        focusAreas: normalizeStringList(output?.focusAreas || output?.focus || output?.dimensions),
        questions: normalizeInterviewQuestions(output?.questions, fallbackRefs).slice(0, questionCount),
        closingPrompt: compactValue(output?.closingPrompt || output?.closing || '今天的 AI 面试问题已经完成，感谢你的回答。招聘团队会结合材料和面试记录继续判断。'),
        riskNotes: normalizeStringList(output?.riskNotes || output?.risks),
    };
}

function interviewQuestionCount(job = {}) {
    const count = Number(job.interviewSettings?.questionCount || 6);
    if (!Number.isFinite(count)) return 6;
    return Math.min(10, Math.max(3, Math.round(count)));
}

export async function generateConsultationAnswer({job, question, chunks = []}) {
    return callOpenAiCompatible({
        callType: 'jd_consultation',
        promptVersion: 'jd-consultation-v1',
        schemaVersion: 'answer-v1',
        schema: consultationAnswerSchema,
        model: appConfig.ai.consultationModel,
        system: '你是招聘岗位咨询助手。只基于当前岗位 JD 和岗位知识库回答，输出 JSON：answer, citations, confidenceNote。',
        user: {jobTitle: job.title, jd: job.jd, chunks, question},
        fallback: () => {
            const compact = String(question || '').replace(/\s+/g, '');
            let answer = `按这个岗位资料看，重点是 ${job.jd?.[0] || job.title}。你可以继续问工作内容、准备材料或面试可能追问。`;
            if (/算法|研究|工程|落地|技术/.test(compact)) {
                answer = `${job.title} 更看重工程落地，会关注你是否能把方案做成可演示、可协作、能上线验证的产品。`;
            }
            if (/投递|申请|能投|简历|材料/.test(compact)) {
                answer = '可以投递。建议选择最贴近岗位的一版简历，并按统一作品模板补充能验证的项目证据。';
            }
            return {
                answer,
                citations: chunks.slice(0, 2).map((chunk) => evidenceRef('job_knowledge_chunk', chunk.id, chunk.name || '岗位资料', chunk.content)),
                confidenceNote: chunks.length ? '已参考当前岗位知识库。' : '当前岗位知识库较少，主要基于 JD 回答。',
            };
        },
    });
}

function streamingParts(text) {
    const value = String(text || '');
    return value.match(/.{1,14}/gu) || [];
}

async function emitDeterministicStream(output, onDelta) {
    for (const part of streamingParts(output.answer)) {
        onDelta?.(part);
        await new Promise((resolve) => setTimeout(resolve, 8));
    }
}

export async function generateConsultationAnswerStream({job, question, chunks = [], onDelta}) {
    const callType = 'jd_consultation_stream';
    const promptVersion = 'jd-consultation-stream-v1';
    const schemaVersion = 'answer-stream-v1';
    const started = Date.now();
    const input = {
        system: '你是招聘岗位咨询助手。只基于当前岗位 JD 和岗位知识库回答候选人。',
        user: {jobTitle: job.title, jd: job.jd, chunks, question},
    };

    if (appConfig.ai.mode === 'fixture') {
        const output = await generateConsultationAnswer({job, question, chunks});
        await emitDeterministicStream(output, onDelta);
        return output;
    }
    if (appConfig.ai.mode !== 'openai-compatible' || !appConfig.ai.apiKey) {
        throw new AiGatewayError('AI_API_KEY is required for streaming consultation in openai-compatible mode', {
            callType,
            errorKind: 'missing_api_key',
        });
    }

    let rawOutput = {};
    try {
        const response = await fetch(`${appConfig.ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${appConfig.ai.apiKey}`,
            },
            body: JSON.stringify({
                model: appConfig.ai.consultationModel,
                messages: [
                    {role: 'system', content: input.system},
                    {role: 'user', content: JSON.stringify(input.user)},
                ],
                temperature: 0.2,
                stream: true,
            }),
        });
        if (!response.ok) {
            throw new Error(`AI provider ${response.status}: ${await response.text()}`);
        }
        if (!response.body) throw new Error('AI provider stream body is empty');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let answer = '';
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, {stream: true});
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const data = trimmed.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(data);
                    rawOutput = parsed;
                    const delta = parsed?.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        answer += delta;
                        onDelta?.(delta);
                    }
                }
                catch {
                    // Ignore provider keepalive / non-json stream fragments.
                }
            }
        }

        const output = validateOutput({
            schema: consultationAnswerSchema,
            callType,
            output: {
                answer: answer.trim() || '暂时没有生成回答，请稍后重试。',
                citations: chunks.slice(0, 2).map((chunk) => (
                    evidenceRef('job_knowledge_chunk', chunk.id, chunk.name || '岗位资料', chunk.content)
                )),
                confidenceNote: chunks.length ? '已参考当前岗位知识库。' : '当前岗位知识库较少，主要基于 JD 回答。',
            },
        });
        await logModelCall({
            callType,
            provider: 'openai_compatible',
            model: appConfig.ai.consultationModel,
            promptVersion,
            schemaVersion,
            input,
            output,
            rawOutput,
            latencyMs: Date.now() - started,
        });
        return output;
    }
    catch (error) {
        const errorKind = error.errorKind || 'provider_error';
        await logModelCall({
            callType,
            provider: 'openai_compatible',
            model: appConfig.ai.consultationModel,
            promptVersion,
            schemaVersion,
            input,
            output: {},
            rawOutput,
            errorKind,
            errorMessage: error.message,
            latencyMs: Date.now() - started,
        });
        throw error instanceof AiGatewayError
            ? error
            : new AiGatewayError(error.message, {callType, errorKind, cause: error});
    }
}

export async function extractResumeEvidence({candidate, resume}) {
    const extracted = await extractMaterialDocumentText(resume, {maxChars: 12000});
    const documentContext = compactDocumentForPrompt(resume, extracted, {maxChars: 8000});
    const resumeForModel = {...resume, documentContext};
    return normalizeResumeEvidence({
        education: '',
        experiences: [documentContext.text || materialTextFallback(resume) || candidate?.resume || resume?.name]
            .filter(Boolean),
        projects: [],
        skills: [],
        risks: documentContext.status === 'read'
            ? []
            : [`简历原文抽取状态：${documentContext.status}`],
        evidenceRefs: [
            evidenceRef(documentContext.text ? 'resume_document' : 'resume_metadata', resume?.id || 'resume', '简历原文', documentContext.text || materialTextFallback(resume) || resume?.name || '', {
                materialId: resume?.id || '',
                storageKey: resume?.storageKey || '',
                fileName: resume?.name || resume?.fileName || '',
                sourceField: documentContext.text ? 'documentText' : 'metadata',
                extractionMethod: documentContext.extractionMethod || 'document_text',
                confidence: documentContext.text ? 0.9 : 0.35,
            }),
        ],
    }, resumeForModel);
}

export async function extractCandidateKnowledge({source}) {
    const extracted = await extractMaterialDocumentText(source, {maxChars: 12000});
    const documentContext = compactDocumentForPrompt(source, extracted, {maxChars: 8000});
    const sourceForModel = {...source, documentContext};
    return normalizeCandidateKnowledgeEvidence({
        claims: [documentContext.text || materialTextFallback(source) || source?.name].filter(Boolean),
        risks: documentContext.status === 'read'
            ? []
            : [`补充资料原文抽取状态：${documentContext.status}`],
        evidenceRefs: [
            evidenceRef(documentContext.text ? 'candidate_knowledge_document' : 'candidate_knowledge_metadata', source?.id || 'candidate-knowledge', source?.name || '补充资料', documentContext.text || materialTextFallback(source) || '', {
                materialId: source?.id || '',
                storageKey: source?.storageKey || '',
                fileName: source?.name || source?.fileName || '',
                sourceField: documentContext.text ? 'documentText' : 'metadata',
                extractionMethod: documentContext.extractionMethod || 'document_text',
                confidence: documentContext.text ? 0.9 : 0.35,
            }),
        ],
    }, sourceForModel);
}
async function portfolioVisualInput(portfolio = {}) {
    const screenshots = (portfolio.screenshots || [])
        .filter((item) => item?.storageKey)
        .slice(0, 5);
    const parts = [];
    const findings = [];
    for (const [index, screenshot] of screenshots.entries()) {
        const mimeType = imageMimeType(screenshot);
        if (!mimeType) {
            findings.push({
                screenshotId: screenshot.id || `screenshot_${index + 1}`,
                fileName: screenshot.name || `截图 ${index + 1}`,
                status: 'not_read',
                finding: '截图文件类型不是可直接识别的图片。',
                supportedClaims: [],
                unverifiedClaims: [screenshot.caption, screenshot.tech, screenshot.contribution].filter(Boolean),
                risks: ['截图未进入视觉模型识别。'],
            });
            continue;
        }
        try {
            const stream = await withTimeout(getObjectReadStream(screenshot.storageKey), 'portfolio screenshot stream');
            const buffer = await withTimeout(streamToBuffer(stream), 'portfolio screenshot read');
            if (buffer.length > 4 * 1024 * 1024) {
                findings.push({
                    screenshotId: screenshot.id || `screenshot_${index + 1}`,
                    fileName: screenshot.name || `截图 ${index + 1}`,
                    status: 'not_read',
                    finding: '截图超过 4MB，本次未送入视觉模型。',
                    supportedClaims: [],
                    unverifiedClaims: [screenshot.caption, screenshot.tech, screenshot.contribution].filter(Boolean),
                    risks: ['截图过大，需人工查看原图。'],
                });
                continue;
            }
            parts.push({
                type: 'image_url',
                image_url: {
                    url: `data:${mimeType};base64,${buffer.toString('base64')}`,
                    detail: 'high',
                },
                _bytes: buffer.length,
                _fileName: screenshot.name || `截图 ${index + 1}`,
                _screenshotId: screenshot.id || `screenshot_${index + 1}`,
            });
        }
        catch (error) {
            findings.push({
                screenshotId: screenshot.id || `screenshot_${index + 1}`,
                fileName: screenshot.name || `截图 ${index + 1}`,
                status: 'not_read',
                finding: `截图读取失败：${error.message || '无法读取对象存储文件'}`,
                supportedClaims: [],
                unverifiedClaims: [screenshot.caption, screenshot.tech, screenshot.contribution].filter(Boolean),
                risks: ['截图未进入视觉模型识别。'],
            });
        }
    }
    return {
        parts,
        skippedFindings: findings,
        requestedCount: screenshots.length,
    };
}

function fallbackPortfolioEvaluation({job, portfolio, visualReadStatus = 'not_read', skippedFindings = []}) {
    const evidence = portfolio.evidenceUrl || portfolio.evidence || portfolio.summary || portfolio.oneLineValue || portfolio.title;
    const textEvidence = [
        portfolio.title,
        portfolio.oneLineValue,
        portfolio.problem,
        portfolio.solution,
        portfolio.demoFlow,
        portfolio.contribution,
        portfolio.evidenceUrl,
    ].filter(Boolean).join('；');
    const visualFindings = skippedFindings.length
        ? skippedFindings
        : (portfolio.screenshots || []).slice(0, 5).map((screenshot, index) => ({
            screenshotId: screenshot.id || `screenshot_${index + 1}`,
            fileName: screenshot.name || `截图 ${index + 1}`,
            status: visualReadStatus === 'read' ? 'read' : 'not_read',
            finding: visualReadStatus === 'read'
                ? '视觉模型已读取图片，具体发现以模型返回为准。'
                : '未读取图片，只基于候选人填写的截图说明和作品字段。',
            supportedClaims: [],
            unverifiedClaims: [screenshot.caption, screenshot.tech, screenshot.contribution, screenshot.validation].filter(Boolean),
            risks: visualReadStatus === 'read' ? [] : ['截图像素未被模型识别，需要管理员查看原图或在 AI 面试中核验。'],
            evidenceRefs: [
                evidenceRef('portfolio_screenshot', screenshot.id || `screenshot_${index + 1}`, screenshot.name || '作品截图', screenshot.caption || '', {
                    materialId: portfolio.id || '',
                    screenshotId: screenshot.id || '',
                    storageKey: screenshot.storageKey || '',
                    fileName: screenshot.name || '',
                    modality: 'image',
                    extractionMethod: visualReadStatus === 'read' ? 'model_vision' : 'candidate_caption',
                }),
            ],
        }));
    return {
        score: evidence ? 7.6 : 4.8,
        highlights: evidence ? [`${portfolio.title} 提供了可验证作品线索`] : ['作品信息不足'],
        risks: [
            ...(evidence ? ['仍需确认本人贡献比例'] : ['缺少链接、录屏或代码片段']),
            ...(visualReadStatus === 'read' ? [] : ['作品截图未被模型读取，不能把截图说明等同于视觉证据。']),
        ],
        verificationNeeds: ['本人贡献、关键模块、关键问题和结果指标仍需补证。'],
        followUps: [],
        evidenceRefs: [
            evidenceRef('portfolio_field', portfolio.id, '作品证据', evidence || textEvidence || '', {
                materialId: portfolio.id || '',
                sourceField: evidence ? 'evidenceUrl/summary' : 'portfolio_text',
                modality: 'text',
                extractionMethod: 'candidate_form',
            }),
        ],
        visualReadStatus,
        visualFindings,
        dimensions: [
            {key: 'authenticity', label: '真实性证据', score: evidence ? 7.4 : 4.4, reason: evidence ? '有链接或截图线索，仍需面试核验本人贡献' : '缺少可验证证据'},
            {key: 'creativity', label: '创意性', score: portfolio.problem && portfolio.solution ? 7.2 : 5.2, reason: portfolio.problem && portfolio.solution ? '能说明问题和方案' : '创意背景或方案不完整'},
            {key: 'businessValue', label: '业务实用性', score: portfolio.outcome || portfolio.oneLineValue ? 7 : 4.8, reason: portfolio.outcome || portfolio.oneLineValue ? '已描述价值或结果' : '业务收益不清晰'},
            {key: 'cloudInternalValue', label: '智能云/内部价值', score: /云|内部|业务|效率|知识库|RAG|Agent/i.test(JSON.stringify({job, portfolio})) ? 7.2 : 5, reason: '根据作品描述判断是否贴近智能云或内部提效场景'},
            {key: 'demo', label: '可演示程度', score: evidence ? 7.6 : 4.8, reason: evidence ? '有可验证线索' : '缺少可演示证据'},
            {key: 'engineering', label: '工程落地', score: portfolio.solution ? 7.2 : 5, reason: portfolio.solution ? '已描述方案' : '方案信息不足'},
            {key: 'reflection', label: '复盘能力', score: portfolio.reflection ? 7 : 5, reason: portfolio.reflection ? '有复盘改进' : '复盘信息不足'},
        ],
    };
}

function visionRequiredFailureEvaluation({job, portfolio, reason, skippedFindings = []}) {
    const fallback = fallbackPortfolioEvaluation({job, portfolio, visualReadStatus: 'not_read', skippedFindings});
    return {
        ...fallback,
        score: Math.min(fallback.score, 4.8),
        highlights: [],
        risks: [
            `作品截图未完成视觉模型读取：${reason || '视觉模型不可用'}`,
            '作品真实性、界面完成度和本人贡献不能仅凭截图说明确认。',
            ...fallback.risks,
        ],
        verificationNeeds: [
            '候选人需补充可访问 Demo、录屏、代码片段或重新上传可读截图。',
            '截图对应功能的真实性和本人完成比例仍需在后续环节核验。',
            ...(fallback.verificationNeeds || []),
        ],
        followUps: [],
        visualReadStatus: 'not_read',
        visualFindings: fallback.visualFindings.length ? fallback.visualFindings : [{
            screenshotId: '',
            fileName: '作品截图',
            status: 'not_read',
            finding: reason || '视觉模型未完成读取。',
            supportedClaims: [],
            unverifiedClaims: [portfolio.oneLineValue, portfolio.demoFlow, portfolio.contribution].filter(Boolean),
            risks: ['视觉证据缺失，不能作为强作品证据。'],
            evidenceRefs: [],
        }],
    };
}

function withPortfolioModelRouting(result) {
    return {
        ...result,
        modelRouting: {
            ...(result.modelRouting || {}),
            textModel: appConfig.ai.portfolioTextModel,
            visionModel: appConfig.ai.visionModel,
            visionRequired: appConfig.ai.visionMode === 'required',
        },
    };
}

async function portfolioAttachmentInputs(portfolio = {}) {
    const refs = [
        ...(portfolio.attachmentRefs || []),
        ...(portfolio.storageKey ? [portfolio] : []),
    ].filter((item) => item?.storageKey).slice(0, 4);
    const contexts = [];
    for (const [index, ref] of refs.entries()) {
        const extracted = await extractMaterialDocumentText(ref, {maxChars: 8000});
        const context = compactDocumentForPrompt(ref, extracted, {maxChars: 4000});
        contexts.push({
            id: ref.id || ref.uploadId || `${portfolio.id || 'portfolio'}-attachment-${index + 1}`,
            storageKey: ref.storageKey || '',
            ...context,
        });
    }
    return contexts;
}

export async function evaluatePortfolio({job, portfolio}) {
    const hasScreenshots = (portfolio.screenshots || []).some((item) => item?.storageKey || item?.storageRef || item?.name);
    const attachmentContexts = await portfolioAttachmentInputs(portfolio);
    const portfolioForModel = {...portfolio, attachmentContexts};
    const shouldPrepareVision = Boolean(
        appConfig.ai.visionMode !== 'off'
        && appConfig.ai.mode === 'openai-compatible'
        && appConfig.ai.apiKey
    );
    const visualInput = shouldPrepareVision
        ? await portfolioVisualInput(portfolio)
        : {parts: [], skippedFindings: [], requestedCount: 0};
    const canSendVision = Boolean(visualInput.parts.length);
    const visualReadStatus = canSendVision ? 'read' : (
        (portfolio.screenshots || []).length ? 'not_read' : 'not_requested'
    );
    const baseUser = {
        jobTitle: job.title,
        weights: job.portfolioWeights,
        portfolio: portfolioForModel,
        attachmentTexts: attachmentContexts.map((context) => ({
            id: context.id,
            fileName: context.fileName,
            status: context.status,
            extractionMethod: context.extractionMethod,
            text: context.text,
        })),
        visualReadStatus,
        visualInstruction: visualInput.parts.length
            ? '你会同时收到作品截图图片。请只基于真实可见内容写 visualFindings；看不到的内容必须写入 unverifiedClaims 或 risks。'
            : '本次没有图片像素输入。不得写“截图显示”“我看到”等视觉结论，只能基于候选人表单文字和截图说明评价。',
    };
    const request = (extra = {}) => callOpenAiCompatible({
        callType: 'portfolio_evaluate',
        promptVersion: 'portfolio-evaluate-v2',
        schemaVersion: 'portfolio-evaluation-v2',
        schema: portfolioEvaluationSchema,
        system: [
            '作品评价助手，只输出 JSON object。',
            '评价创意/产品 demo：真实性、AI/自动化是否进入流程、业务价值、工程落地、产品表达、可演示和复盘。',
            '创意性必须结合业务价值；本人贡献、证据链接、附件原文或截图说明不足时写入 risks/verificationNeeds。',
            '有 attachmentContexts/attachmentTexts 时必须基于附件原文，不只按文件名评价。',
            'score 0-10；dimensions 每个维度也按 10 分满分输出；highlights/risks/verificationNeeds 为字符串数组；verificationNeeds 只写补证/核验点，不写面试题。',
            'evidenceRefs 含 sourceType, sourceId, label, text；dimensions 为数组，项含 key, label, score, reason。',
            'visualReadStatus 只能 read/not_read/not_requested；无图片不得声称识别截图；visualFindings 逐张说明看到什么、支持什么、不能确认什么。',
        ].join('\n'),
        user: {...baseUser, ...extra.user},
        userContentParts: extra.userContentParts || [],
        model: extra.model || appConfig.ai.portfolioTextModel,
        normalizeOutput: (output) => normalizePortfolioEvaluation(output, portfolioForModel),
        fallback: () => fallbackPortfolioEvaluation({job, portfolio: portfolioForModel, visualReadStatus, skippedFindings: visualInput.skippedFindings}),
    });
    if (!canSendVision) {
        if (hasScreenshots && appConfig.ai.visionMode === 'required') {
            return withPortfolioModelRouting(visionRequiredFailureEvaluation({
                job,
                portfolio,
                reason: shouldPrepareVision
                    ? '截图文件无法读取或不是可识别图片格式。'
                    : '视觉模型未配置或当前处于本地 deterministic 兜底。',
                skippedFindings: visualInput.skippedFindings,
            }));
        }
        return withPortfolioModelRouting(await request());
    }
    try {
        return withPortfolioModelRouting(await request({
            userContentParts: visualInput.parts,
            model: appConfig.ai.visionModel || appConfig.ai.model,
        }));
    }
    catch (error) {
        try {
            return withPortfolioModelRouting(await request({
                userContentParts: visualInput.parts,
                model: appConfig.ai.visionModel || appConfig.ai.model,
                user: {
                    retryMode: 'strict_short_json',
                    visualInstruction: [
                        '上一次视觉评价没有返回可解析 JSON。',
                        '请只输出一个短 JSON object，不要输出 Markdown，不要解释。',
                        'visualFindings 每张图最多 1 句话；highlights/risks/verificationNeeds 各最多 4 条。',
                    ].join(' '),
                },
            }));
        }
        catch (retryError) {
            error = retryError;
        }
        if (hasScreenshots && appConfig.ai.visionMode === 'required') {
            return withPortfolioModelRouting(visionRequiredFailureEvaluation({
                job,
                portfolio,
                reason: error.message,
                skippedFindings: visualInput.skippedFindings,
            }));
        }
        const degraded = await request({
            user: {
                visualReadStatus: 'not_read',
                visualInstruction: `视觉输入调用失败，已降级为文本评价：${error.message}`,
            },
        });
        return withPortfolioModelRouting({
            ...degraded,
            visualReadStatus: 'not_read',
            risks: [
                ...(degraded.risks || []),
                '视觉模型调用失败，作品截图未被模型读取。',
            ],
        });
    }
}

function fixturePrescreenResult({job, candidate, evidencePack}) {
    const refs = normalizeEvidenceRefs(evidencePack?.evidenceRefs || [], {
        sourceType: 'fixture',
        sourceId: 'fixture-prescreen',
        label: '合成材料证据',
    });
    const requirements = (job.requirements || []).slice(0, 3);
    const matchedRequirements = (requirements.length ? requirements : ['岗位相关项目经验']).map((requirement, index) => ({
        requirement,
        result: index === 0
            ? '合成材料中包含一个与岗位方向相关、可继续追问本人贡献的项目。'
            : '合成材料提供了初步线索，仍需要在 AI 面试中核验细节。',
        evidenceRefs: refs.slice(0, 2),
    }));
    const candidateLabel = candidate?.name || '演示候选人';
    return {
        recommendation: '推荐 AI 面试',
        score: 7.8,
        summary: '合成材料显示候选人具备岗位相关项目经验和基本工程表达，证据足以进入 AI 面试继续核验；量化结果与本人贡献仍需追问。',
        matchedRequirements,
        gaps: ['项目效果指标和长期运行数据尚未完整体现。'],
        risks: ['当前结论来自 fixture 合成数据，只用于演示产品流程。'],
        adminSuggestion: '建议进入 AI 面试，重点核验本人贡献、关键取舍和结果指标。',
        evidenceRefs: refs,
        markdownReport: [
            `# 🧾 初筛面评：${candidateLabel} / ${job.title || '演示岗位'}`,
            '',
            '## 📊 评分总览',
            '',
            '| 维度 | 分数 | 依据 |',
            '| --- | ---: | --- |',
            '| 作品 | 8.0 | 有与岗位相关的合成项目说明和可演示线索 |',
            '| 学历学业 | 6.5 | 演示材料仅提供基础信息，不作为自动淘汰条件 |',
            '| 实习经历 | 7.0 | 有相关场景经验，具体职责仍需核验 |',
            '| 项目/比赛经历 | 8.0 | 能说明问题、方案和阶段性结果 |',
            '| 课外生活/综合素质 | 7.0 | 材料体现主动复盘和协作意识 |',
            '',
            '## 🧭 综合评价',
            '',
            '建议进入 AI 面试。现有合成证据足以支持继续核验，但不能替代人工判断。',
            '',
            '## ✅ 优势',
            '',
            '- 项目方向与岗位要求存在明确关联。',
            '- 能描述问题、方案和个人行动。',
            '',
            '## ⚠️ 风险与缺口',
            '',
            '- 本人贡献边界与量化结果仍需通过问答确认。',
            '- fixture 数据不代表真实候选人结论。',
            '',
            '## 🎯 后续核验建议',
            '',
            '- 追问一个关键技术或产品取舍。',
            '- 核验候选人本人负责范围和结果指标。',
        ].join('\n'),
    };
}

export async function generatePrescreenResult({job, candidate, application, evidencePack}) {
    const ruleGroups = screeningRuleGroups(job);
    const rawMaterials = await buildPrescreenMaterialPackage({job, candidate, application, evidencePack});
    return callOpenAiCompatible({
        callType: 'prescreen_application',
        promptVersion: 'prescreen-v6-raw-gpt',
        schemaVersion: 'prescreen-result-v2',
        schema: prescreenResultSchema,
        model: appConfig.ai.prescreenModel,
        system: [
            '你是招聘预筛助手。目标不是机械淘汰，而是帮招聘者判断：候选人是否值得进入下一步 AI 面试核验。只输出 JSON object。',
            'JSON 顶层字段必须包含：recommendation, score, summary, matchedRequirements, gaps, risks, adminSuggestion, evidenceRefs, markdownReport。',
            'recommendation 是唯一初筛结论，必须由你根据岗位与材料整体判断直接给出，只允许：推荐 AI 面试、不建议继续；score 输出 0-10 数字。',
            'summary、matchedRequirements、gaps、risks、adminSuggestion 是给系统卡片和流程判断使用的短字段；完整面评必须写在 markdownReport。',
            '判断时综合考虑：岗位关键要求、候选人材料证据强度、材料完整度、缺口是否能通过 AI 面试有效核验。',
            '本次输入的 rawMaterials 是主判断材料，包含简历原文、作品字段、作品附件原文、候选人知识库/补充资料原文和作品视觉观察；必须优先读 rawMaterials 后再判断。',
            'evidencePack 或 auxiliaryEvidence 只是辅助缓存，不能替代原文；如果缓存字段为空、失败或与原文冲突，以 rawMaterials 的原文、作品字段和视觉观察为准。',
            '文档抽取状态、视觉读取状态和 warnings 都是证据可信度的一部分：看不到原文或没有读图时，必须降低相应证据强度，不要假装已经看过。',
            'summary 写匹配判断：这个人为什么匹配或不匹配、匹配在哪里、核心缺口在哪里；按双方信息量自适应，像招聘面评一样给出“优势、短板、整体判断”。',
            '重点挖掘候选人过往经历和岗位之间的关联：做过什么、解决什么问题、本人负责什么、产出如何、为什么对这个岗位有价值；不要只复述规则命中。',
            '学校、公司、项目、产品、技术栈等实体如果材料中能识别，必须点出具体名称，不要笼统改写成“211院校”“大厂”“相关项目”等泛称。',
            'matchedRequirements 表示“匹配证据”，不要逐项套评价维度；优先写岗位需求与候选人材料之间的真实对应关系，例如项目方向、职责动作、产出、工具链、业务场景。',
            'matchedRequirements.result 必须是一句证据性人话，不要只写“命中/符合/待确认”，不要输出 sourceType、extractionMethod、education/projects、文本抽取等内部字段。',
            'gaps 表示“匹配缺口”，risks 表示“风险与核验”；数量按双方信息量决定，只保留会影响匹配度判断的信息，不写泛泛的人工确认、兜底话术或 JSON 字符串。',
            '预筛是证据判断，不是关键词命中；不要用单一分数硬阈值决定结论。',
            '推荐 AI 面试代表：材料中已经有足够岗位相关证据，值得消耗一次 AI 面试机会继续核验。',
            '不建议继续代表：当前材料不足以支撑继续，或关键证据缺失到面试也难以有效判断。',
            '决策参考：8-10 分为证据充分、岗位相关性强，通常推荐 AI 面试；6.5-7.9 分如果有明确项目、作品、实习或能力证据，可以推荐 AI 面试，但必须写清待核验点；5-6.4 分通常不建议继续，除非材料虽然不完整但存在非常明确的高潜力证据；5 分以下通常不建议继续。',
            '语气要平衡：先说明匹配价值，再说明影响匹配度的缺口；信息多可以写丰满，信息少不要凑条目，不要把关键缺证淡化成“后续可面试核验”。',
            'recommendation、summary、adminSuggestion 必须互相一致：如果 recommendation 是“不建议继续”，summary 必须说明关键阻断；如果是“推荐 AI 面试”，summary 必须说明足以继续核验的匹配基础。',
            'hardRequirements 是硬性门槛；evaluationDimensions 只是辅助观察，不是报告主线；riskChecks 是负面信号和追问来源。',
            '学校、学历、证书只在岗位明确设为硬性门槛时才作为阻断项；如果岗位没有硬性学历要求，学校缺失应写入风险或待核验，不要自动淘汰。',
            '学历/院校/学校层次/必须证书如果是岗位硬性门槛，必须基于材料证据判断；材料明示缺失、PDF 未抽取到文本或无相关证据时，不要写成命中。',
            '作品、项目、实习经历要看本人贡献、过程、结果和岗位相关性；只有标题、截图、关键词，但没有本人角色和产出时，不能高分。',
            '实习时长、本人贡献、项目边界、技术深度属于可核验问题；未写清时写入 gaps/risks，除非岗位明确写成资格硬门槛，否则不要直接等同淘汰。',
            '候选人可选知识库/补充资料只能作为辅助事实证据，不能替代简历、作品或项目经历；低质、测试、占位、虚假或明显不用心的知识库，应降低可信度并写入风险；只有在它是主要证据来源，或与其他材料一起显示候选人明显不匹配时，才作为不建议继续的重要依据。',
            '候选人材料中的“目标岗位”“推荐 AI 面试”“测试结论”等自我声明不能作为筛选依据；必须回到真实教育、项目、实习、作品和可验证产出。',
            'matchedRequirements、gaps、risks 按双方信息量输出；信息充分时写足关键匹配点，信息少时少写，不凑固定条数；每条尽量一句话，不重复 summary。',
            'matchedRequirements 项含 requirement, result, evidenceRefs；evidenceRefs 项含 sourceType, sourceId, label, text；文件名不能当能力证据。',
            'markdownReport 是给招聘者直接看的中文 Markdown 面评，不要包代码块。可以使用 Markdown 表格、自然段、列表、引用、少量图标/emoji 和符号提升可读性；不要整段或整条列表加粗，只加粗关键词。',
            '图标/emoji 只用作阅读锚点，建议放在一级/二级/三级标题前，例如 📊 评分总览、🧭 综合评价、🧩 维度评价、✅ 优势、⚠️ 风险与缺口、🎯 后续核验建议；不要每句话都加表情。',
            'markdownReport 建议按以下结构组织，允许在不丢维度、不丢结论的前提下写得更自然、更像招聘者能读的完整面评：',
            '# 🧾 初筛面评：候选人 / 岗位',
            '## 📊 评分总览：用 Markdown 表格，维度固定且顺序必须为 作品、学历学业、实习经历、项目/比赛经历、课外生活/综合素质；每项 10 分满分，给分和一句依据。没有材料就写“材料未体现”，不要编造。',
            '## 🧭 综合评价：说明是否建议进入 AI 面试及核心原因；按材料复杂度决定篇幅，不要为了格式限制信息量。',
            '## 🧩 维度评价：必须按以下三级标题逐项展开：### 作品、### 学历学业、### 实习经历、### 项目/比赛经历、### 课外生活/综合素质。每个维度都要说明有效证据、岗位匹配价值、缺口或待核验点；材料未体现就明确写“材料未体现”，不要编造。',
            '## ✅ 优势：按材料信息量自适应列出，必须来自材料证据；信息少时少写，信息充分时写足关键亮点。',
            '## ⚠️ 风险与缺口：按材料信息量自适应列出，区分缺证、待核验和明确不足；不要凑固定条数。',
            '## 🎯 后续核验建议：按材料信息量自适应列出，写给招聘者/面试官，不要写给候选人。',
        ].join('\n'),
        normalizeOutput: normalizePrescreenResult,
        user: {
            job: {title: job.title, jd: job.jd, requirements: job.requirements, screeningRules: job.screeningRules, ruleGroups},
            candidate: {name: candidate.name},
            rawMaterials,
            evidencePack,
        },
        fallback: () => fixturePrescreenResult({job, candidate, application, evidencePack}),
    });
}

export async function generateInterviewPlan({job, candidate, application, evidencePack, prescreen}) {
    const questionCount = interviewQuestionCount(job);
    const durationMinutes = Number(job?.interviewSettings?.durationMinutes || 25);
    const ruleGroups = screeningRuleGroups(job);
    return callOpenAiCompatible({
        callType: 'interview_plan_generate',
        promptVersion: 'interview-plan-v1',
        schemaVersion: 'interview-plan-v1',
        schema: interviewPlanSchema,
        model: appConfig.ai.interviewModel,
        system: [
            '招聘方 AI 面试官代理，只输出 JSON：title, durationMinutes, focusAreas, questions, closingPrompt, riskNotes；不做录用结论。',
            `questions 必须控制为 ${questionCount} 个，每题包含 id, type, competency, prompt, sourceRefs, expectedEvidence, followUps, scoringHints, timeLimitSec, required。`,
            '面试维度参考：自我介绍、实习/项目经历、产品职能问题、开放性业务问题。正式题优先覆盖后 3 类；自我介绍由 introPolicy 和开场承担，不要重复生成“请自我介绍”。',
            '每题基于 evidencePack、prescreen.gaps/risks、job.knowledgeChunks 或材料原文，追问本人贡献、项目细节、关键决策、数据/工具链、结果指标和风险缺口。',
            'prompt 是候选人听到的自然口头题面：一题一问，1-2句，≤90字；不暴露 JD/评分/预筛/风险/sourceRefs/报告结论。',
            '不得要求上传、展示、画图、给链接/代码路径/现场打开文件；涉及截图或文件名时抽象成口头说明主题。',
            'sourceRefs 引具体片段或知识库 chunk；closingPrompt 只放结束语，不放进 questions。',
        ].join('\n'),
        normalizeOutput: (output) => normalizeInterviewPlan(output, evidencePack, prescreen, job),
        user: {
            job: {
                title: job.title,
                jd: job.jd,
                requirements: job.requirements,
                screeningRules: job.screeningRules,
                ruleGroups,
                portfolioWeights: job.portfolioWeights,
                knowledge: (job.knowledge || []).filter((item) => item.status === 'ready').slice(0, 5),
                knowledgeChunks: (job.knowledgeChunks || []).slice(0, 12),
            },
            candidate: {name: candidate.name},
            application: {
                id: application.id,
                materialSnapshot: application.materialSnapshot,
            },
            interviewSettings: {
                questionCount,
                maxFollowUpsPerQuestion: job?.interviewSettings?.maxFollowUpsPerQuestion ?? 2,
                durationMinutes,
            },
            interviewDimensionGuide: [
                {label: '自我介绍', target: '背景、岗位动机、表达结构；由开场和 introPolicy 覆盖'},
                {label: '实习/项目经历', target: '项目背景、本人职责、关键动作、结果数据、复盘'},
                {label: '产品职能问题', target: '岗位相关的产品判断、用户/业务理解、功能取舍'},
                {label: '开放性业务问题', target: '异常指标、业务变化、策略判断、沟通推进'},
            ],
            evidencePack,
            prescreen,
        },
        fallback: () => {
            const refs = [
                ...(evidencePack?.evidenceRefs || []),
                ...(prescreen?.evidenceRefs || []),
                ...jobKnowledgeChunkRefs(job),
            ];
            const baseQuestions = [
                ['material_confirmation', '材料确认', '请讲一个最能代表你岗位能力的经历：你负责什么，结果如何？'],
                ['demo_walkthrough', '作品说明', '请选择一个最相关的项目，说明它解决了什么问题、你负责什么、结果如何。'],
                ['jd_fit', '岗位匹配', `这个岗位关注 ${job.screeningRules?.[0]?.label || '相关项目能力'}，请讲一个对应经历。`],
                ['technical_depth', '技术深度', '请讲一个你处理过的关键技术问题：难点是什么，你怎么解决？'],
                ['evidence_gap', '证据核验', '请补充一个能验证你本人贡献的具体细节。'],
                ['reflection', '复盘表达', '如果重做这个项目，你最想改进哪一点，为什么？'],
                ['collaboration', '协作推进', '请讲一次你推动协作的经历，重点说你的判断和行动。'],
                ['tradeoff', '取舍判断', '请说明一个你在项目里做过的关键取舍，以及它带来的影响。'],
                ['learning', '学习迁移', '面对一个不熟悉的业务场景，你会如何快速产出可验证结果？'],
                ['risk_response', '风险处理', '请举例说明你遇到质量或上线风险时是如何定位和处理的。'],
            ];
            return {
                title: `${job.title} AI 面试计划`,
                durationMinutes,
                focusAreas: ['实习/项目经历', '产品职能问题', '开放性业务问题', '表达与复盘'],
                questions: baseQuestions.slice(0, questionCount).map(([id, competency, prompt], index) => ({
                    id: `q${index + 1}-${id}`,
                    type: id,
                    competency,
                    prompt,
                    sourceRefs: refs.slice(0, 2),
                    expectedEvidence: '候选人需要结合简历、作品或补充资料给出可追溯事实。',
                    followUps: ['请给一个具体例子。', '这部分你本人负责到什么程度？'],
                    scoringHints: ['能讲清背景、行动、结果更好。', '无法给出证据时标记为待核验。'],
                    timeLimitSec: index === 1 ? 300 : 180,
                    required: true,
                })),
                closingPrompt: '今天的 AI 面试问题已经完成，感谢你的回答。招聘团队会结合材料和面试记录继续判断。',
                riskNotes: prescreen?.risks || ['AI 面试计划只用于追问，不直接形成录用结论。'],
            };
        },
    });
}
