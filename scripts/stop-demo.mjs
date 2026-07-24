import {existsSync, readFileSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadRootEnv} from './env.mjs';
import {run} from './process.mjs';

const env = loadRootEnv({requireFile: false});
const pidFile = resolve('.runtime', 'demo-processes.json');
if (existsSync(pidFile)) {
    const state = JSON.parse(readFileSync(pidFile, 'utf8'));
    for (const pid of state.pids || []) {
        try {
            process.kill(pid, 'SIGTERM');
        }
        catch {
            // Already stopped.
        }
    }
    rmSync(pidFile, {force: true});
}

if (!process.argv.includes('--keep-infra')) {
    run('docker', ['compose', 'down'], {env});
}
process.stdout.write('Recruit AI demo stopped.\n');
