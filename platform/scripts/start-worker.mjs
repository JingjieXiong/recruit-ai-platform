import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {appConfig} from '../packages/storage/config.js';

const runtimeDir = resolve('.runtime');
const pidFile = resolve(runtimeDir, 'worker.pid');
const logFile = resolve(runtimeDir, 'worker.log');

async function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}

if (existsSync(pidFile)) {
    const pid = Number(await readFile(pidFile, 'utf8'));
    if (pid && await isAlive(pid)) {
        console.log(`Worker already running, pid ${pid}`);
        process.exit(0);
    }
}

await mkdir(runtimeDir, {recursive: true});

const child = spawn(process.execPath, ['apps/worker/index.js'], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env,
});

child.unref();
await writeFile(pidFile, String(child.pid), 'utf8');
await writeFile(logFile, `Started ${new Date().toISOString()} pid=${child.pid}\n`, 'utf8');

console.log(`Started Recruit AI worker, pid ${child.pid}`);
console.log(`Queue: ${appConfig.queue.provider}`);
console.log(`Stop:  node scripts/stop-worker.mjs`);
