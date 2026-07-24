import dotenv from 'dotenv';
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, resolve} from 'node:path';

for (const file of ['.env.local', '.env']) {
    const path = resolve(file);
    if (existsSync(path)) {
        dotenv.config({path});
    }
}

function readLocalConfig() {
    const path = resolve('config', 'local.json');
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8'));
}

const local = readLocalConfig();
export const DEFAULT_DATA_ROOT = '~/.recruit-ai-platform/local';

function env(name, fallback = '') {
    return process.env[name] || fallback;
}

function normalizePath(value) {
    const raw = value || DEFAULT_DATA_ROOT;
    const expanded = raw.startsWith('~/') ? raw.replace('~', homedir()) : raw;
    return isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);
}

const dataRoot = normalizePath(env('RECRUIT_DATA_ROOT', local.storage?.dataRoot || DEFAULT_DATA_ROOT));

export const appConfig = {
    port: Number(env('PORT', '5173')),
    runtime: {
        mode: env('RUNTIME_MODE', local.runtime?.mode || 'docker'),
    },
    storage: {
        dataRoot,
        provider: env('STORAGE_PROVIDER', local.storage?.provider || 's3'),
    },
    queue: {
        provider: env('QUEUE_PROVIDER', local.queue?.provider || 'redis'),
        maxAttempts: Number(env('QUEUE_MAX_ATTEMPTS', String(local.queue?.maxAttempts || 2))),
        retryDelayMs: Number(env('QUEUE_RETRY_DELAY_MS', String(local.queue?.retryDelayMs || 1000))),
        retryMaxDelayMs: Number(env('QUEUE_RETRY_MAX_DELAY_MS', String(local.queue?.retryMaxDelayMs || 30000))),
    },
    vector: {
        provider: env('VECTOR_PROVIDER', local.vector?.provider || 'pgvector'),
    },
    databaseUrl: env('DATABASE_URL', local.database?.url || 'postgres://recruit:recruit@localhost:5432/recruit_ai'),
    redisUrl: env('REDIS_URL', local.redis?.url || 'redis://localhost:6379'),
    idHashSalt: env('ID_HASH_SALT', local.identity?.salt || 'local-dev-salt-change-before-public'),
    objectStorage: {
        endPoint: env('OBJECT_STORAGE_ENDPOINT', local.objectStorage?.endPoint || 'localhost'),
        port: Number(env('OBJECT_STORAGE_PORT', String(local.objectStorage?.port || 9000))),
        useSSL: env('OBJECT_STORAGE_USE_SSL', String(local.objectStorage?.useSSL ?? false)) === 'true',
        accessKey: env('OBJECT_STORAGE_ACCESS_KEY', local.objectStorage?.accessKey || 'recruit'),
        secretKey: env('OBJECT_STORAGE_SECRET_KEY', local.objectStorage?.secretKey || 'recruit-password'),
        bucket: env('OBJECT_STORAGE_BUCKET', local.objectStorage?.bucket || 'recruit-ai'),
    },
    ai: {
        mode: env('AI_MODE', local.ai?.mode || 'fixture'),
        apiKey: env('AI_API_KEY', local.ai?.apiKey || ''),
        baseUrl: env('AI_BASE_URL', local.ai?.baseUrl || 'https://api.openai.com/v1'),
        model: env('AI_MODEL', local.ai?.model || 'gpt-4.1-mini'),
        visionModel: env('AI_VISION_MODEL', local.ai?.visionModel || local.ai?.model || 'gpt-4.1-mini'),
        consultationModel: env('AI_CONSULTATION_MODEL', local.ai?.consultationModel || local.ai?.model || 'gpt-4.1-mini'),
        resumeModel: env('AI_RESUME_MODEL', local.ai?.resumeModel || local.ai?.model || 'gpt-4.1-mini'),
        knowledgeModel: env('AI_KNOWLEDGE_MODEL', local.ai?.knowledgeModel || local.ai?.model || 'gpt-4.1-mini'),
        portfolioTextModel: env('AI_PORTFOLIO_TEXT_MODEL', local.ai?.portfolioTextModel || local.ai?.model || 'gpt-4.1-mini'),
        prescreenModel: env('AI_PRESCREEN_MODEL', local.ai?.prescreenModel || local.ai?.model || 'gpt-4.1-mini'),
        interviewModel: env('AI_INTERVIEW_MODEL', local.ai?.interviewModel || local.ai?.model || 'gpt-4.1-mini'),
        timeoutMs: Number(env('AI_TIMEOUT_MS', String(local.ai?.timeoutMs || 120000))),
        visionMode: env('AI_VISION_MODE', local.ai?.visionMode || 'off'),
    },
    interviewBridge: {
        baseUrl: env('INTERVIEW_BRIDGE_BASE_URL', local.interviewBridge?.baseUrl || ''),
        publicBaseUrl: env('INTERVIEW_BRIDGE_PUBLIC_BASE_URL', local.interviewBridge?.publicBaseUrl || local.interviewBridge?.baseUrl || ''),
        callbackSecret: env('INTERVIEW_BRIDGE_CALLBACK_SECRET', local.interviewBridge?.callbackSecret || 'local-interview-bridge-secret'),
        entryTtlMinutes: Number(env('INTERVIEW_BRIDGE_ENTRY_TTL_MINUTES', String(local.interviewBridge?.entryTtlMinutes || 120))),
    },
    interviewDemo: {
        runtime: env('INTERVIEW_RUNTIME', local.interviewDemo?.runtime || 'browser-demo'),
        baseUrl: env('INTERVIEW_BASE_URL', local.interviewDemo?.baseUrl || 'http://127.0.0.1:5174'),
        publicBaseUrl: env('INTERVIEW_PUBLIC_BASE_URL', local.interviewDemo?.publicBaseUrl || local.interviewDemo?.baseUrl || 'http://127.0.0.1:5174'),
        defaultQuestionCount: Number(env('INTERVIEW_DEFAULT_QUESTION_COUNT', String(local.interviewDemo?.defaultQuestionCount || 6))),
        maxFollowUpsPerQuestion: Number(env('INTERVIEW_MAX_FOLLOW_UPS_PER_QUESTION', String(local.interviewDemo?.maxFollowUpsPerQuestion || 2))),
        timeoutMs: Number(env('INTERVIEW_TIMEOUT_MS', String(local.interviewDemo?.timeoutMs || 15000))),
    },
};
