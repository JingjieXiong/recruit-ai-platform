import {readdir, readFile, stat} from 'node:fs/promises';
import {relative, resolve} from 'node:path';

const root = resolve('.');
const self = 'scripts/check-public-tree.mjs';
const ignoredDirectories = new Set(['.git', '.runtime', 'node_modules']);
const textExtensions = new Set([
    '.css', '.env', '.example', '.html', '.js', '.json', '.md', '.mjs',
    '.py', '.sql', '.svg', '.txt', '.yaml', '.yml',
]);
const forbiddenFiles = [
    /(^|\/)config\/local\.json$/i,
    /(^|\/)\.env$/i,
    /^(?:platform\/)?ci\.yml$/i,
];
const forbiddenPatterns = [
    {label: 'internal domain', expression: new RegExp(['baidu', 'int\\.com'].join('-'), 'i')},
    {label: 'personal absolute path', expression: /\/Users\/[A-Za-z0-9._-]+/},
    {label: 'private machine hostname', expression: /\.bcc-szzj\./i},
    {label: 'internal registry', expression: new RegExp(['iregistry', 'internal'].join('.'), 'i')},
    {label: 'credential-like OpenAI key', expression: /\bsk-[A-Za-z0-9_-]{20,}\b/},
    {label: 'credential-like bearer token', expression: /Bearer\s+[A-Za-z0-9._-]{24,}/i},
    {label: 'private key', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/},
];

async function filesUnder(directory) {
    const entries = await readdir(directory, {withFileTypes: true});
    const files = [];
    for (const entry of entries) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) files.push(...await filesUnder(path));
        else if (entry.isFile()) files.push(path);
    }
    return files;
}

const failures = [];
for (const file of await filesUnder(root)) {
    const path = relative(root, file);
    if (forbiddenFiles.some((pattern) => pattern.test(path))) {
        failures.push(`${path}: forbidden file`);
        continue;
    }
    if (path === self || !textExtensions.has(path.slice(path.lastIndexOf('.')))) continue;
    if ((await stat(file)).size > 2 * 1024 * 1024) continue;
    const content = await readFile(file, 'utf8');
    for (const pattern of forbiddenPatterns) {
        if (pattern.expression.test(content)) failures.push(`${path}: ${pattern.label}`);
    }
}

if (failures.length) {
    process.stderr.write(`Public tree check failed:\n${failures.map((item) => `- ${item}`).join('\n')}\n`);
    process.exit(1);
}
process.stdout.write('Public tree check passed: no tracked local config, internal hosts, personal paths, or credential-shaped values.\n');
