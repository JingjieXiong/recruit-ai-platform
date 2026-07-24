import {newId} from '../../domain/contracts.js';
import {query} from '../../storage/db.js';

export async function writeAuditLog({
    actorType = 'system',
    actorId = 'system',
    action,
    aggregateType,
    aggregateId,
    detail = {},
}) {
    const id = newId('audit');
    await query(
        `INSERT INTO audit_logs (id, actor_type, actor_id, action, aggregate_type, aggregate_id, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, actorType, actorId, action, aggregateType, aggregateId, detail]
    );
    return id;
}

export async function writeModelCallLog({
    callType,
    provider,
    model,
    promptVersion,
    schemaVersion,
    inputDigest,
    output = {},
    rawOutput = {},
    errorKind = '',
    errorMessage = '',
    latencyMs = 0,
}) {
    const id = newId('model');
    await query(
        `INSERT INTO model_call_logs
            (id, call_type, provider, model, prompt_version, schema_version, input_digest, output, raw_output, error_kind, error_message, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, callType, provider, model, promptVersion, schemaVersion, inputDigest, output, rawOutput, errorKind, errorMessage, latencyMs]
    );
    return id;
}

export async function recordJobRun({id, queueName, jobName, status, payload = {}, result = {}, errorMessage = ''}) {
    await query(
        `INSERT INTO job_runs (id, queue_name, job_name, status, payload, result, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            result = EXCLUDED.result,
            error_message = EXCLUDED.error_message,
            updated_at = now()`,
        [id, queueName, jobName, status, payload || {}, result || {}, errorMessage]
    );
}
