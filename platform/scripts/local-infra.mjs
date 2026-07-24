import {mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {isAbsolute, relative, resolve} from 'node:path';
import {appConfig} from '../packages/storage/config.js';

const command = process.argv[2] || 'status';
const repoRoot = resolve('.');
const runtimeDir = resolve('.runtime');
const envFile = resolve(runtimeDir, 'local-infra.env');
const composeFile = resolve('infra', 'local', 'docker-compose.yml');
const dataRoot = resolve(expandPath(process.env.RECRUIT_DATA_ROOT || appConfig.storage.dataRoot));
const projectName = 'ai-recruiting-local';
const dataDirs = ['postgres', 'object-storage', 'redis', 'backups', 'logs', 'tmp'];

function expandPath(value) {
    if (value.startsWith('~/')) return value.replace('~', homedir());
    return value;
}

function isInside(parent, child) {
    const rel = relative(parent, child);
    return rel === '' || Boolean(rel && !rel.startsWith('..') && !isAbsolute(rel));
}

async function prepareLocalInfraEnv() {
    if (isInside(repoRoot, dataRoot)) {
        throw new Error(`Refuse to use data root inside code repo: ${dataRoot}`);
    }
    await mkdir(runtimeDir, {recursive: true});
    for (const dir of dataDirs) {
        await mkdir(resolve(dataRoot, dir), {recursive: true});
    }
    await writeFile(
        envFile,
        [
            `RECRUIT_DATA_ROOT=${dataRoot}`,
            `RECRUIT_POSTGRES_IMAGE=${process.env.RECRUIT_POSTGRES_IMAGE || 'pgvector/pgvector:pg16'}`,
            `RECRUIT_REDIS_IMAGE=${process.env.RECRUIT_REDIS_IMAGE || 'valkey/valkey:8-alpine'}`,
            `RECRUIT_MINIO_IMAGE=${process.env.RECRUIT_MINIO_IMAGE || 'minio/minio:latest'}`,
            `COMPOSE_PROJECT_NAME=${projectName}`,
            '',
        ].join('\n'),
        'utf8'
    );
}

function runDockerCompose(args) {
    if (!existsSync(composeFile)) {
        throw new Error(`Missing local compose file: ${composeFile}`);
    }
    const version = spawnSync('docker', ['compose', 'version'], {stdio: 'ignore'});
    if (version.status !== 0) {
        throw new Error('Docker Compose is unavailable. Please start Docker Desktop or install Docker Compose.');
    }
    const result = spawnSync(
        'docker',
        ['compose', '--env-file', envFile, '-f', composeFile, '-p', projectName, ...args],
        {stdio: 'inherit'}
    );
    if (result.status !== 0) {
        console.error('');
        console.error('Local Docker dependencies failed to start.');
        console.error('If the error mentions EOF, reset, denied, or failed to resolve reference, Docker Hub is likely unreachable from this network.');
        console.error('');
        console.error('Run diagnostics:');
        console.error('  pnpm local:infra:doctor');
        console.error('');
        console.error('Or retry with team/internal mirror images:');
        console.error('  RECRUIT_POSTGRES_IMAGE=your-mirror/pgvector:pg16 \\');
        console.error('  RECRUIT_REDIS_IMAGE=your-mirror/valkey:8-alpine \\');
        console.error('  RECRUIT_MINIO_IMAGE=your-mirror/minio:latest \\');
        console.error('  pnpm local:infra:up');
        process.exit(result.status || 1);
    }
}

try {
    await prepareLocalInfraEnv();
    if (command === 'up') {
        console.log(`Starting local dependencies with data root: ${dataRoot}`);
        runDockerCompose(['up', '-d']);
    }
    else if (command === 'down') {
        console.log('Stopping local dependencies. Data root is kept.');
        runDockerCompose(['down']);
    }
    else if (command === 'status') {
        console.log(`Local dependency data root: ${dataRoot}`);
        runDockerCompose(['ps']);
    }
    else {
        console.error(`Unknown local infra command: ${command}`);
        console.error('Usage: node scripts/local-infra.mjs up|down|status');
        process.exit(1);
    }
}
catch (error) {
    console.error(error.message);
    process.exit(1);
}
