import {appConfig} from '../packages/storage/config.js';
import {query, closePool} from '../packages/storage/db.js';
import {ensureBucket} from '../packages/storage/objectStorage.js';
import {checkDocumentTextHealth} from '../packages/modules/evidence/document-text.js';
import {connect} from 'node:net';

function redact(value) {
    return String(value || '').replace(/:[^:@/]+@/, ':***@');
}

async function check(name, detail, checker) {
    try {
        await checker();
        console.log(`[ok] ${name}: ${detail}`);
        return true;
    }
    catch (error) {
        console.error(`[failed] ${name}: ${detail}`);
        console.error(`         ${error.message || error.code || String(error)}`);
        return false;
    }
}

function checkTcpUrl(url, defaultPort) {
    const parsed = new URL(url);
    const host = parsed.hostname || 'localhost';
    const port = Number(parsed.port || defaultPort);
    return new Promise((resolvePromise, reject) => {
        const socket = connect({host, port});
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`connection timeout: ${host}:${port}`));
        }, 1000);
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.end();
            resolvePromise();
        });
        socket.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

const results = [];

results.push(await check(
    'postgres',
    redact(appConfig.databaseUrl),
    async () => {
        await query('SELECT 1');
    }
));

results.push(await check(
    'redis',
    appConfig.queue.provider === 'db' ? 'db job table provider' : redact(appConfig.redisUrl),
    async () => {
        if (appConfig.queue.provider === 'db') return;
        await checkTcpUrl(appConfig.redisUrl, 6379);
    }
));

results.push(await check(
    'object-storage',
    appConfig.storage.provider === 'filesystem'
        ? `${appConfig.storage.dataRoot}/object-storage`
        : `${appConfig.objectStorage.endPoint}:${appConfig.objectStorage.port}/${appConfig.objectStorage.bucket}`,
    async () => {
        await ensureBucket();
    }
));

results.push(await check(
    'document-text',
    'python pypdf/pdfplumber for PDF resume parsing',
    async () => {
        await checkDocumentTextHealth();
    }
));

await closePool();
if (results.some((ok) => !ok)) {
    process.exitCode = 1;
}
