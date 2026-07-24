import {setTimeout as sleep} from 'node:timers/promises';
import {loadRootEnv} from './env.mjs';
import {run} from './process.mjs';

const env = loadRootEnv();
const skipInfra = process.argv.includes('--skip-infra');

if (!skipInfra) {
    run('docker', ['compose', 'up', '-d'], {env});
}

let lastError;
for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
        run(process.execPath, ['scripts/migrate.mjs'], {
            cwd: 'platform',
            env,
            stdio: attempt < 29 ? 'ignore' : 'inherit',
        });
        lastError = null;
        break;
    }
    catch (error) {
        lastError = error;
        await sleep(1000);
    }
}
if (lastError) throw lastError;

run(process.execPath, ['scripts/init-data-root.mjs'], {cwd: 'platform', env});
run(process.execPath, ['scripts/seed.mjs', '--reset'], {cwd: 'platform', env});
run(process.execPath, ['scripts/seed-demo.mjs', '--reset-demo'], {cwd: 'platform', env});
process.stdout.write('Fixture workspace is ready.\n');
