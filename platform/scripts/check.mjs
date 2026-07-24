import {existsSync} from 'node:fs';
import {readdir, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const roots = ['server.mjs', 'apps', 'packages', 'scripts'];
const files = [];
const forbiddenFiles = [
    'docker-compose.yml',
    'apps/api/mockPreviewServer.js',
    'apps/api/mockRepository.js',
    'apps/api/routes.js',
    'packages/mock/seed.js',
    'scripts/verify_candidate_admin.mjs',
];
const forbiddenRuntimePatterns = [
    'BACKEND_MODE',
    'mockPreviewServer',
    'mockRepository',
    'packages/mock/seed',
];

async function collect(path) {
    const info = await stat(path);
    if (info.isFile() && (path.endsWith('.js') || path.endsWith('.mjs'))) {
        files.push(path);
        return;
    }
    if (!info.isDirectory()) return;
    for (const entry of await readdir(path)) {
        if (['node_modules', '.git', 'dist', 'build'].includes(entry)) continue;
        await collect(join(path, entry));
    }
}

for (const file of forbiddenFiles) {
    if (existsSync(file)) {
        console.error(`forbidden runtime mock/docker file exists: ${file}`);
        process.exit(1);
    }
}

for (const root of roots) {
    await collect(root);
}

for (const file of [...files, 'package.json']) {
    if (file === 'scripts/check.mjs') continue;
    const text = await readFile(file, 'utf8');
    for (const pattern of forbiddenRuntimePatterns) {
        if (text.includes(pattern)) {
            console.error(`forbidden runtime pattern "${pattern}" found in ${file}`);
            process.exit(1);
        }
    }
}

for (const file of files.sort()) {
    const result = spawnSync(process.execPath, ['--check', file], {stdio: 'inherit'});
    if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`checked ${files.length} files`);
