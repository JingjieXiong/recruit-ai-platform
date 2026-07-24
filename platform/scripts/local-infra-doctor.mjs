import {spawnSync} from 'node:child_process';
import {request} from 'node:https';
import {resolve} from 'node:path';

const images = {
    postgres: process.env.RECRUIT_POSTGRES_IMAGE || 'pgvector/pgvector:pg16',
    redis: process.env.RECRUIT_REDIS_IMAGE || 'valkey/valkey:8-alpine',
    minio: process.env.RECRUIT_MINIO_IMAGE || 'minio/minio:latest',
};

const containers = ['recruit-ai-postgres', 'recruit-ai-redis', 'recruit-ai-minio'];
const healthUrl = process.env.RECRUIT_API_HEALTH_URL || 'http://localhost:5173/api/health';
const registryUrl = 'https://registry-1.docker.io/v2/';
const results = [];

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: resolve('.'),
        encoding: 'utf8',
        ...options,
    });
    return {
        ok: result.status === 0,
        stdout: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim(),
        status: result.status,
    };
}

function record(level, title, detail = '') {
    results.push({level, title, detail});
    const prefix = level === 'ok' ? '[ok]' : level === 'warn' ? '[warn]' : '[fail]';
    console.log(`${prefix} ${title}${detail ? `: ${detail}` : ''}`);
}

function summarizeDockerInfo(text) {
    try {
        const info = JSON.parse(text);
        const mirrors = info.RegistryConfig?.Mirrors || [];
        return {
            serverVersion: info.ServerVersion || 'unknown',
            contextProxy: {
                http: info.HttpProxy || '',
                https: info.HttpsProxy || '',
                noProxy: info.NoProxy || '',
            },
            mirrors,
        };
    }
    catch {
        return {serverVersion: 'unknown', contextProxy: {}, mirrors: []};
    }
}

function checkUrl(url, timeoutMs = 5000) {
    return new Promise((resolvePromise) => {
        const req = request(url, {method: 'HEAD', timeout: timeoutMs}, (res) => {
            res.resume();
            resolvePromise({ok: true, statusCode: res.statusCode});
        });
        req.on('timeout', () => {
            req.destroy(new Error('timeout'));
        });
        req.on('error', (error) => {
            resolvePromise({ok: false, error: error.message});
        });
        req.end();
    });
}

async function checkApiHealth() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
        const response = await fetch(healthUrl, {signal: controller.signal});
        const body = await response.json().catch(() => ({}));
        if (response.ok) {
            record('ok', 'API health', `${healthUrl} -> ${body.status || response.status}`);
        }
        else {
            record('warn', 'API health not ready', `${healthUrl} -> ${body.status || response.status}`);
        }
    }
    catch (error) {
        record('warn', 'API health not reachable', `${healthUrl} (${error.message})`);
    }
    finally {
        clearTimeout(timer);
    }
}

function printMirrorHelp() {
    console.log('');
    console.log('如果镜像仓库不可达，可以临时切换到团队内网镜像源：');
    console.log('');
    console.log('RECRUIT_POSTGRES_IMAGE=your-mirror/pgvector:pg16 \\');
    console.log('RECRUIT_REDIS_IMAGE=your-mirror/valkey:8-alpine \\');
    console.log('RECRUIT_MINIO_IMAGE=your-mirror/minio:latest \\');
    console.log('pnpm local:infra:up');
}

const dockerInfo = run('docker', ['info', '--format', '{{json .}}']);
let dockerReady = false;
if (dockerInfo.ok) {
    dockerReady = true;
    const info = summarizeDockerInfo(dockerInfo.stdout);
    record('ok', 'Docker daemon', `running, server ${info.serverVersion}`);
    if (info.mirrors.length) {
        record('ok', 'Docker registry mirrors', info.mirrors.join(', '));
    }
    else {
        record('warn', 'Docker registry mirrors', 'none configured; Docker Hub will be used directly');
    }
    const proxy = [info.contextProxy.http, info.contextProxy.https].filter(Boolean).join(' / ');
    if (proxy) {
        record('ok', 'Docker proxy', proxy);
    }
    else {
        record('warn', 'Docker proxy', 'none configured');
    }
}
else {
    record('fail', 'Docker daemon', dockerInfo.stderr || 'Docker Desktop may not be running');
}

const compose = run('docker', ['compose', 'version']);
if (compose.ok) {
    record('ok', 'Docker Compose', compose.stdout);
}
else {
    record('fail', 'Docker Compose', compose.stderr || 'docker compose is unavailable');
}

if (dockerReady) {
    for (const [name, image] of Object.entries(images)) {
        const inspect = run('docker', ['image', 'inspect', image]);
        if (inspect.ok) {
            record('ok', `${name} image`, image);
        }
        else {
            record('warn', `${name} image missing`, image);
        }
    }

    const registry = await checkUrl(registryUrl);
    if (registry.ok) {
        record('ok', 'Docker Hub connectivity', `${registryUrl} -> HTTP ${registry.statusCode}`);
    }
    else {
        record('fail', 'Docker Hub connectivity', `${registryUrl} (${registry.error})`);
    }

    const ps = run('docker', [
        'ps',
        '-a',
        '--filter',
        'name=recruit-ai-',
        '--format',
        '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}',
    ]);
    const lines = ps.stdout.split('\n').filter(Boolean);
    if (!lines.length) {
        record('warn', 'local infra containers', 'not created; run pnpm local:infra:up after images are available');
    }
    else {
        const existing = new Set();
        for (const line of lines) {
            const [name, image, status, ports] = line.split('|');
            existing.add(name);
            record(status.startsWith('Up') ? 'ok' : 'warn', `container ${name}`, `${image}, ${status}${ports ? `, ${ports}` : ''}`);
        }
        for (const name of containers) {
            if (!existing.has(name)) record('warn', `container ${name}`, 'missing');
        }
    }
}

await checkApiHealth();

const hasFailure = results.some((item) => item.level === 'fail');
if (hasFailure) {
    printMirrorHelp();
    process.exitCode = 1;
}
else {
    console.log('');
    console.log('本地依赖诊断完成。若有 warn，按提示处理后再运行 pnpm local:infra:up / pnpm deps:check。');
}
