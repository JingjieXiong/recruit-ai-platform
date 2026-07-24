import {spawnSync} from 'node:child_process';

const result = spawnSync(process.execPath, ['scripts/stop-local.mjs', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: {
        ...process.env,
        RUNTIME_MODE: 'native',
    },
});

process.exit(result.status || 0);
