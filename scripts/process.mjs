import {spawn, spawnSync} from 'node:child_process';

export function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        ...options,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
    }
}

export function spawnService(label, command, args, options = {}) {
    const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options,
    });
    child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
    child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
    return child;
}
