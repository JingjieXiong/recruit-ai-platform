import {createWorker, queueNames} from '../../packages/storage/queue.js';
import {indexKnowledgeSource} from '../../packages/modules/jobs/service.js';
import {markEvidenceFailed, markPrescreenFailed, prepareEvidencePack, runPrescreen} from '../../packages/modules/prescreen/service.js';
import {prepareInterviewSession} from '../../packages/modules/interview-bridge/service.js';
import {recordJobRun} from '../../packages/modules/audit/service.js';

function isFinalAttempt(job) {
    const maxAttempts = Number(job?.opts?.attempts || 1);
    const attemptsMade = Number(job?.attemptsMade || 0);
    return attemptsMade + 1 >= maxAttempts;
}

async function wrapProcessor(queueName, processor, onError = null) {
    return async (job) => {
        const runId = `${queueName}:${job.id}`;
        await recordJobRun({
            id: runId,
            queueName,
            jobName: job.name,
            status: 'processing',
            payload: job.data,
        });
        try {
            const result = await processor(job.data, job);
            await recordJobRun({
                id: runId,
                queueName,
                jobName: job.name,
                status: 'completed',
                payload: job.data,
                result,
            });
            return result;
        }
        catch (error) {
            const finalAttempt = isFinalAttempt(job);
            if (onError && finalAttempt) {
                await onError(job.data, error).catch((innerError) => {
                    console.error(`[worker] ${queueName} error handler failed`, innerError);
                });
            }
            await recordJobRun({
                id: runId,
                queueName,
                jobName: job.name,
                status: finalAttempt ? 'failed' : 'retrying',
                payload: job.data,
                result: {
                    attemptsMade: Number(job?.attemptsMade || 0) + 1,
                    maxAttempts: Number(job?.opts?.attempts || 1),
                },
                errorMessage: error.message,
            });
            throw error;
        }
    };
}

const workers = [
    createWorker(
        queueNames.evidence,
        await wrapProcessor(
            queueNames.evidence,
            ({applicationId}) => prepareEvidencePack(applicationId),
            ({applicationId}, error) => markEvidenceFailed(applicationId, error)
        )
    ),
    createWorker(queueNames.knowledge, await wrapProcessor(
        queueNames.knowledge,
        ({jobId, sourceId}) => indexKnowledgeSource(jobId, sourceId)
    )),
    createWorker(
        queueNames.prescreen,
        await wrapProcessor(
            queueNames.prescreen,
            ({applicationId}) => runPrescreen(applicationId),
            ({applicationId}, error) => markPrescreenFailed(applicationId, error)
        )
    ),
    createWorker(
        queueNames.interviewSession,
        await wrapProcessor(
            queueNames.interviewSession,
            ({applicationId, attemptId, token}) => prepareInterviewSession({applicationId, attemptId, token})
        )
    ),
];

for (const worker of workers) {
    worker.on('completed', (job) => {
        console.log(`[worker] ${worker.name} completed ${job.name}:${job.id}`);
    });
    worker.on('failed', (job, error) => {
        console.error(`[worker] ${worker.name} failed ${job?.name}:${job?.id}`, error);
    });
}

console.log('Recruit AI worker started.');

async function shutdown() {
    await Promise.all(workers.map((worker) => worker.close()));
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
