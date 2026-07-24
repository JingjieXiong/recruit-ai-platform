import {loadRootEnv} from './env.mjs';
import {run} from './process.mjs';

const env = loadRootEnv();
run(process.execPath, ['scripts/seed-demo.mjs', '--reset-demo'], {
    cwd: 'platform',
    env,
});
