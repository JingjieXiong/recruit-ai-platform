import {mkdir, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Queue} from 'bullmq';
import {appConfig} from '../packages/storage/config.js';
import {closePool, query} from '../packages/storage/db.js';
import {ensureBucket, getObjectStorageClient, isFilesystemStorage} from '../packages/storage/objectStorage.js';
import {queueNames, redisConnection} from '../packages/storage/queue.js';

const allowNonLocal = process.argv.includes('--allow-non-local');
const confirmed = process.argv.includes('--yes');

function isLocalUrl(value = '') {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(value);
}

function assertLocalOnly() {
    if (!confirmed) {
        throw new Error('Refusing to reset data without --yes');
    }
    if (allowNonLocal) return;
    if (!isLocalUrl(appConfig.databaseUrl)) {
        throw new Error(`Refusing to reset non-local database: ${appConfig.databaseUrl}`);
    }
    if (appConfig.queue.provider === 'redis' && !isLocalUrl(appConfig.redisUrl)) {
        throw new Error(`Refusing to reset non-local Redis: ${appConfig.redisUrl}`);
    }
    if (appConfig.storage.provider === 's3' && !isLocalUrl(appConfig.objectStorage.endPoint)) {
        throw new Error(`Refusing to reset non-local object storage: ${appConfig.objectStorage.endPoint}`);
    }
}

async function resetDatabase() {
    const tables = [
        'audit_logs',
        'model_call_logs',
        'job_runs',
        'uploads',
        'job_knowledge_chunks',
        'interview_attempts',
        'interview_plans',
        'consultation_sessions',
        'applications',
        'portfolio_submissions',
        'candidate_material_files',
        'candidates',
        'jobs',
    ];
    await query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
    const counts = {};
    for (const table of tables) {
        const result = await query(`SELECT COUNT(*)::int AS count FROM ${table}`);
        counts[table] = result.rows[0].count;
    }
    return counts;
}

async function resetQueues() {
    if (appConfig.queue.provider !== 'redis') {
        return {provider: appConfig.queue.provider, cleared: []};
    }
    const cleared = [];
    for (const name of Object.values(queueNames)) {
        const queue = new Queue(name, {connection: redisConnection()});
        try {
            await queue.obliterate({force: true});
            cleared.push(name);
        }
        finally {
            await queue.close();
        }
    }
    return {provider: 'redis', cleared};
}

async function listObjectNames(storage, bucket) {
    const names = [];
    await new Promise((resolveList, rejectList) => {
        const stream = storage.listObjects(bucket, '', true);
        stream.on('data', (item) => {
            if (item?.name) names.push(item.name);
        });
        stream.on('error', rejectList);
        stream.on('end', resolveList);
    });
    return names;
}

async function resetObjects() {
    if (isFilesystemStorage()) {
        const root = resolve(appConfig.storage.dataRoot, 'object-storage');
        await rm(root, {recursive: true, force: true});
        await mkdir(root, {recursive: true});
        return {provider: 'filesystem', cleared: 'all'};
    }
    await ensureBucket();
    const storage = getObjectStorageClient();
    const bucket = appConfig.objectStorage.bucket;
    const names = await listObjectNames(storage, bucket);
    if (names.length) {
        await storage.removeObjects(bucket, names);
    }
    return {provider: 's3', bucket, cleared: names.length};
}

try {
    assertLocalOnly();
    const [databaseCounts, queueResult, objectResult] = await Promise.all([
        resetDatabase(),
        resetQueues(),
        resetObjects(),
    ]);
    console.log('local business data reset complete');
    console.log(JSON.stringify({
        databaseCounts,
        queue: queueResult,
        objectStorage: objectResult,
    }, null, 2));
}
finally {
    await closePool();
}
