import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export function loadRootEnv({requireFile = true} = {}) {
    const path = resolve('.env');
    if (!existsSync(path)) {
        if (requireFile) {
            throw new Error('Missing .env. Run: cp .env.example .env');
        }
        return {...process.env};
    }
    const parsed = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const splitAt = trimmed.indexOf('=');
        if (splitAt < 1) continue;
        const key = trimmed.slice(0, splitAt).trim();
        const value = trimmed.slice(splitAt + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
        parsed[key] = value;
    }
    return {...process.env, ...parsed};
}
