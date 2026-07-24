import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadRootEnv} from './env.mjs';
import {run, spawnService} from './process.mjs';

const env = loadRootEnv();
const runtimeDir = resolve('.runtime');
const pidFile = resolve(runtimeDir, 'demo-processes.json');

run(process.execPath, ['scripts/setup.mjs'], {env});

const services = [
    spawnService('interview', process.execPath, ['server.mjs'], {cwd: 'interview-room', env}),
    spawnService('worker', process.execPath, ['apps/worker/index.js'], {cwd: 'platform', env}),
    spawnService('platform', process.execPath, ['server.mjs'], {cwd: 'platform', env}),
];

await mkdir(runtimeDir, {recursive: true});
await writeFile(pidFile, JSON.stringify({
    startedAt: new Date().toISOString(),
    pids: services.map((service) => service.pid),
}, null, 2));

process.stdout.write('\nRecruit AI fixture demo is starting:\n');
process.stdout.write('  Candidate: http://127.0.0.1:5173/candidate\n');
process.stdout.write('  Recruiter: http://127.0.0.1:5173/admin\n');
process.stdout.write('  Interview: http://127.0.0.1:5174/?preview=1\n');
process.stdout.write('Press Ctrl+C to stop application processes.\n\n');

function shutdown() {
    for (const service of services) {
        service.kill('SIGTERM');
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await Promise.race(services.map((service) => new Promise((resolvePromise, reject) => {
    service.once('exit', (code, signal) => {
        shutdown();
        if (code === 0 || signal === 'SIGTERM') resolvePromise();
        else reject(new Error(`A demo service exited with code ${code}`));
    });
})));
