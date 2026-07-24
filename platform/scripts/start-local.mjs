import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {appConfig} from '../packages/storage/config.js';

const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const port = Number(portArg?.split('=')[1] || process.env.PORT || 5173);
const skipWorker = process.argv.includes('--skip-worker');
const skipDeps = process.argv.includes('--skip-deps');
const runtimeDir = resolve('.runtime');
const pidFile = resolve(runtimeDir, `server-${port}.pid`);
const logFile = resolve(runtimeDir, `server-${port}.log`);

async function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}

function runScript(script, args = []) {
    const result = spawnSync(process.execPath, [script, ...args], {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: process.env,
    });
    if (result.status) {
        process.exit(result.status);
    }
}

if (!skipDeps) {
    runScript('scripts/check-runtime-deps.mjs');
}

let runningPid = 0;
if (existsSync(pidFile)) {
    const pid = Number(await readFile(pidFile, 'utf8'));
    if (pid && await isAlive(pid)) {
        runningPid = pid;
        console.log(`Service already running on port ${port}, pid ${pid}`);
    }
}

if (!runningPid) {
    await mkdir(runtimeDir, {recursive: true});

    const child = spawn(process.execPath, ['server.mjs'], {
        cwd: process.cwd(),
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: {
            ...process.env,
            PORT: String(port),
        },
    });

    child.unref();
    runningPid = child.pid;
    await writeFile(pidFile, String(child.pid), 'utf8');
    await writeFile(logFile, `Started ${new Date().toISOString()} pid=${child.pid} mode=real port=${port}\n`, 'utf8');
    console.log(`Started Recruit AI Platform service, pid ${child.pid}`);
}

console.log(`Runtime:  ${appConfig.runtime.mode}`);
console.log(`Database: ${appConfig.databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
console.log(`Queue:    ${appConfig.queue.provider}${appConfig.queue.provider === 'redis' ? ` (${appConfig.redisUrl.replace(/:[^:@/]+@/, ':***@')})` : ''}`);
console.log(`Storage:  ${appConfig.storage.provider}${appConfig.storage.provider === 's3' ? ` (${appConfig.objectStorage.endPoint}:${appConfig.objectStorage.port}/${appConfig.objectStorage.bucket})` : ` (${appConfig.storage.dataRoot}/object-storage)`}`);
console.log(`Vector:   ${appConfig.vector.provider}`);
console.log(`Candidate: http://localhost:${port}/candidate`);
console.log(`Admin:     http://localhost:${port}/admin`);
console.log(`Health:    http://localhost:${port}/api/health`);
console.log(`Stop:      node scripts/stop-local.mjs --port=${port}`);

if (!skipWorker) {
    runScript('scripts/start-worker.mjs');
}
