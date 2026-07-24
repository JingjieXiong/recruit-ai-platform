import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {appConfig} from '../packages/storage/config.js';
import {query, closePool} from '../packages/storage/db.js';
import {ensureBucket} from '../packages/storage/objectStorage.js';

const results = [];

function run(command, args = []) {
    const result = spawnSync(command, args, {encoding: 'utf8'});
    return {
        ok: result.status === 0,
        stdout: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim(),
    };
}

function commandExists(command) {
    return run('sh', ['-lc', `command -v ${command}`]);
}

function record(level, title, detail = '') {
    results.push({level, title, detail});
    const prefix = level === 'ok' ? '[ok]' : level === 'warn' ? '[warn]' : '[fail]';
    console.log(`${prefix} ${title}${detail ? `: ${detail}` : ''}`);
}

async function checkDatabase() {
    try {
        await query('SELECT 1');
        record('ok', 'Postgres connection', appConfig.databaseUrl.replace(/:[^:@/]+@/, ':***@'));
        if (appConfig.vector.provider === 'pgvector') {
            const result = await query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
            if (result.rows.length) {
                record('ok', 'pgvector extension', 'installed');
            }
            else {
                record('warn', 'pgvector extension', 'not installed; use VECTOR_PROVIDER=text for Native lite');
            }
        }
        else {
            record('ok', 'vector provider', 'text fallback; pgvector is not required locally');
        }
    }
    catch (error) {
        record('fail', 'Postgres connection', error.message || error.code || String(error));
        record('warn', 'Native local requirement', 'install/start local Postgres, or point DATABASE_URL to a reachable Postgres');
    }
}

async function main() {
    console.log(`Native mode target: runtime=${appConfig.runtime.mode}, storage=${appConfig.storage.provider}, queue=${appConfig.queue.provider}, vector=${appConfig.vector.provider}`);
    console.log(`Data root: ${appConfig.storage.dataRoot}`);

    for (const command of ['postgres', 'pg_ctl', 'createdb', 'psql']) {
        const found = commandExists(command);
        record(found.ok ? 'ok' : 'warn', `command ${command}`, found.ok ? found.stdout : 'not found in PATH');
    }
    for (const command of ['redis-server', 'redis-cli']) {
        const found = commandExists(command);
        record(found.ok ? 'ok' : 'warn', `command ${command}`, appConfig.queue.provider === 'db' ? 'not required in DB queue mode' : found.ok ? found.stdout : 'not found in PATH');
    }
    const minio = commandExists('minio');
    record(minio.ok ? 'ok' : 'warn', 'command minio', appConfig.storage.provider === 'filesystem' ? 'not required in filesystem storage mode' : minio.ok ? minio.stdout : 'not found in PATH');

    await mkdir(resolve(appConfig.storage.dataRoot, 'object-storage'), {recursive: true});
    record(existsSync(resolve(appConfig.storage.dataRoot, 'object-storage')) ? 'ok' : 'fail', 'filesystem storage directory', resolve(appConfig.storage.dataRoot, 'object-storage'));

    await checkDatabase();

    try {
        await ensureBucket();
        record('ok', 'object storage provider', appConfig.storage.provider);
    }
    catch (error) {
        record('fail', 'object storage provider', error.message);
    }

    if (appConfig.queue.provider === 'db') {
        record('ok', 'queue provider', 'db job table; Redis is not required locally');
    }
    else {
        record('warn', 'queue provider', 'redis mode; Redis must be running');
    }

    if (results.some((item) => item.level === 'fail')) {
        process.exitCode = 1;
    }
}

try {
    await main();
}
finally {
    await closePool().catch(() => null);
}
