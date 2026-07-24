import {appConfig} from '../packages/storage/config.js';
import {closePool, query} from '../packages/storage/db.js';

const confirmed = process.argv.includes('--yes');
const allowNonLocal = process.argv.includes('--allow-non-local');

function argValue(name) {
    const inline = process.argv.find((item) => item.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : '';
}

function isLocalUrl(value = '') {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(value);
}

function assertSafe(prefix) {
    if (!confirmed) {
        throw new Error('Refusing to reset demo data without --yes');
    }
    if (!prefix || prefix.length < 3) {
        throw new Error('Please pass a specific prefix with at least 3 characters, for example --prefix 体验测试-20260624');
    }
    if (!allowNonLocal && !isLocalUrl(appConfig.databaseUrl)) {
        throw new Error(`Refusing to reset non-local database: ${appConfig.databaseUrl}`);
    }
}

async function idList(sql, params) {
    const result = await query(sql, params);
    return result.rows.map((row) => row.id);
}

async function deleteCount(sql, params) {
    const result = await query(sql, params);
    return result.rowCount || 0;
}

async function main() {
    const prefix = argValue('--prefix');
    assertSafe(prefix);
    const pattern = `${prefix}%`;
    const jobIds = await idList(
        `SELECT id FROM jobs
         WHERE id LIKE $1
            OR title LIKE $1
            OR data->>'title' LIKE $1`,
        [pattern]
    );
    const candidateIds = await idList(
        `SELECT id FROM candidates
         WHERE id LIKE $1
            OR name LIKE $1
            OR data->>'name' LIKE $1`,
        [pattern]
    );
    const applicationIds = await idList(
        `SELECT id FROM applications
         WHERE job_id = ANY($1::text[])
            OR candidate_id = ANY($2::text[])`,
        [jobIds, candidateIds]
    );
    const aggregateIds = [...new Set([...jobIds, ...candidateIds, ...applicationIds])];
    const removed = {
        auditLogs: await deleteCount(
            `DELETE FROM audit_logs
             WHERE aggregate_id = ANY($1::text[])
                OR actor_id = ANY($1::text[])`,
            [aggregateIds]
        ),
        jobRuns: await deleteCount(
            `DELETE FROM job_runs
             WHERE payload->>'jobId' = ANY($1::text[])
                OR payload->>'candidateId' = ANY($2::text[])
                OR payload->>'applicationId' = ANY($3::text[])`,
            [jobIds, candidateIds, applicationIds]
        ),
        uploads: await deleteCount(
            `DELETE FROM uploads
             WHERE owner_id = ANY($1::text[])
                OR owner_id = ANY($2::text[])
                OR owner_id = ANY($3::text[])`,
            [jobIds, candidateIds, applicationIds]
        ),
        jobKnowledgeChunks: await deleteCount(
            'DELETE FROM job_knowledge_chunks WHERE job_id = ANY($1::text[])',
            [jobIds]
        ),
        interviewAttempts: await deleteCount(
            'DELETE FROM interview_attempts WHERE application_id = ANY($1::text[])',
            [applicationIds]
        ),
        interviewPlans: await deleteCount(
            'DELETE FROM interview_plans WHERE application_id = ANY($1::text[])',
            [applicationIds]
        ),
        consultationSessions: await deleteCount(
            `DELETE FROM consultation_sessions
             WHERE job_id = ANY($1::text[])
                OR candidate_id = ANY($2::text[])`,
            [jobIds, candidateIds]
        ),
        applications: await deleteCount(
            'DELETE FROM applications WHERE id = ANY($1::text[])',
            [applicationIds]
        ),
        portfolioSubmissions: await deleteCount(
            'DELETE FROM portfolio_submissions WHERE candidate_id = ANY($1::text[])',
            [candidateIds]
        ),
        candidateMaterialFiles: await deleteCount(
            'DELETE FROM candidate_material_files WHERE candidate_id = ANY($1::text[])',
            [candidateIds]
        ),
        jobs: await deleteCount('DELETE FROM jobs WHERE id = ANY($1::text[])', [jobIds]),
        candidates: await deleteCount('DELETE FROM candidates WHERE id = ANY($1::text[])', [candidateIds]),
    };
    console.log(JSON.stringify({
        prefix,
        matched: {
            jobs: jobIds.length,
            candidates: candidateIds.length,
            applications: applicationIds.length,
        },
        removed,
    }, null, 2));
}

try {
    await main();
}
finally {
    await closePool();
}
