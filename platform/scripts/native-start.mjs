import {spawnSync} from 'node:child_process';

const env = {
    ...process.env,
    RUNTIME_MODE: 'native',
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER || 'filesystem',
    QUEUE_PROVIDER: process.env.QUEUE_PROVIDER || 'db',
    VECTOR_PROVIDER: process.env.VECTOR_PROVIDER || 'text',
};

console.log('Starting Native local API with controlled local providers:');
console.log(`- storage: ${env.STORAGE_PROVIDER}`);
console.log(`- queue:   ${env.QUEUE_PROVIDER}`);
console.log(`- vector:  ${env.VECTOR_PROVIDER}`);

const result = spawnSync(process.execPath, ['scripts/start-local.mjs', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env,
});

process.exit(result.status || 0);
