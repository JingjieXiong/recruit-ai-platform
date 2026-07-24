import {Queue, Worker} from 'bullmq';
import {appConfig} from './config.js';
import {newId} from '../domain/contracts.js';
import {query} from './db.js';

export const queueNames = {
    evidence: 'evidence',
    knowledge: 'knowledge',
    prescreen: 'prescreen',
    interviewSession: 'interview-session',
};

export function redisConnection() {
    return {
        url: appConfig.redisUrl,
        maxRetriesPerRequest: null,
    };
}

export function isDbQueue() {
    return appConfig.queue.provider === 'db';
}

function queueRetryConfig() {
    return {
        maxAttempts: Math.max(1, Number(appConfig.queue.maxAttempts || 2)),
        retryDelayMs: Math.max(250, Number(appConfig.queue.retryDelayMs || 1000)),
        retryMaxDelayMs: Math.max(1000, Number(appConfig.queue.retryMaxDelayMs || 30000)),
    };
}

function nextRetryDelayMs(attemptsMade) {
    const {retryDelayMs, retryMaxDelayMs} = queueRetryConfig();
    return Math.min(retryDelayMs * (2 ** Math.max(0, attemptsMade - 1)), retryMaxDelayMs);
}

function retryState(row = {}) {
    return row.result?.queueRetry || {};
}

export function createQueue(name) {
    if (isDbQueue()) {
        return {
            async add(jobName, payload) {
                const id = newId('job');
                await query(
                    `INSERT INTO job_runs (id, queue_name, job_name, status, payload)
                     VALUES ($1, $2, $3, 'queued', $4)`,
                    [id, name, jobName, payload]
                );
                return {id, name: jobName, data: payload};
            },
            async close() {},
        };
    }
    return new Queue(name, {connection: redisConnection()});
}

export function createWorker(name, processor) {
    if (isDbQueue()) {
        let closed = false;
        const listeners = {completed: [], failed: []};
        async function poll() {
            if (closed) return;
            try {
                const result = await query(
                    `UPDATE job_runs
                     SET status = 'reserved', updated_at = now()
                     WHERE id = (
                        SELECT id FROM job_runs
                        WHERE queue_name = $1
                          AND status = 'queued'
                          AND COALESCE(NULLIF(result->'queueRetry'->>'runAfter', '')::timestamptz, '-infinity'::timestamptz) <= now()
                        ORDER BY created_at ASC
                        LIMIT 1
                     )
                     RETURNING *`,
                    [name]
                );
                const row = result.rows[0];
                if (row) {
                    const retry = retryState(row);
                    const maxAttempts = Number(retry.maxAttempts || queueRetryConfig().maxAttempts);
                    const attemptsMade = Number(retry.attempts || 0);
                    const job = {
                        id: row.id,
                        name: row.job_name,
                        data: row.payload,
                        attemptsMade,
                        opts: {attempts: maxAttempts},
                    };
                    try {
                        await processor(job);
                        await query(
                            `UPDATE job_runs
                             SET status = 'completed',
                                 result = $2,
                                 error_message = '',
                                 updated_at = now()
                             WHERE id = $1`,
                            [row.id, {...(row.result || {}), queueRetry: {attempts: attemptsMade, maxAttempts}}]
                        );
                        for (const listener of listeners.completed) listener(job);
                    }
                    catch (error) {
                        const attempts = attemptsMade + 1;
                        const finalAttempt = attempts >= maxAttempts;
                        const runAfter = finalAttempt ? '' : new Date(Date.now() + nextRetryDelayMs(attempts)).toISOString();
                        const queueRetry = {
                            attempts,
                            maxAttempts,
                            runAfter,
                            lastError: error.message || String(error),
                        };
                        await query(
                            `UPDATE job_runs
                             SET status = $2,
                                 result = $3,
                                 error_message = $4,
                                 updated_at = now()
                             WHERE id = $1`,
                            [row.id, finalAttempt ? 'failed' : 'queued', {...(row.result || {}), queueRetry}, error.message || String(error)]
                        );
                        if (finalAttempt) {
                            for (const listener of listeners.failed) listener(job, error);
                        }
                        else {
                            console.warn(`[worker] ${name} retry ${job.name}:${job.id} in ${runAfter}`, error.message || error);
                        }
                    }
                }
            }
            catch (error) {
                console.error(`[worker] ${name} db queue polling failed`, error);
            }
            setTimeout(poll, 1000);
        }
        setTimeout(poll, 0);
        return {
            name,
            on(event, listener) {
                if (listeners[event]) listeners[event].push(listener);
            },
            async close() {
                closed = true;
            },
        };
    }
    return new Worker(name, processor, {connection: redisConnection()});
}

export async function addJob(queueName, jobName, payload) {
    const queue = createQueue(queueName);
    const {maxAttempts, retryDelayMs} = queueRetryConfig();
    try {
        return await queue.add(jobName, payload, {
            attempts: maxAttempts,
            backoff: {type: 'exponential', delay: retryDelayMs},
            removeOnComplete: 100,
            removeOnFail: 100,
        });
    }
    finally {
        await queue.close();
    }
}
