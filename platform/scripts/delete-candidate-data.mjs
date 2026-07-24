import {appConfig} from '../packages/storage/config.js';
import {closePool, query, transaction} from '../packages/storage/db.js';
import {hashIdTail} from '../packages/modules/candidates/service.js';

const confirmed = process.argv.includes('--yes');
const allowNonLocal = process.argv.includes('--allow-non-local');
const allMatches = process.argv.includes('--all-matches');

function argValue(name) {
    const inline = process.argv.find((item) => item.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : '';
}

function isLocalUrl(value = '') {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(value);
}

function assertSafe() {
    if (!confirmed) {
        throw new Error('Refusing to delete candidate data without --yes');
    }
    if (!allowNonLocal && !isLocalUrl(appConfig.databaseUrl)) {
        throw new Error(`Refusing to delete from non-local database: ${appConfig.databaseUrl}`);
    }
}

async function findCandidates() {
    const candidateId = argValue('--candidate-id');
    const name = argValue('--name');
    const idTail = argValue('--id-tail');

    if (candidateId) {
        const result = await query('SELECT id, name, id_tail_hint FROM candidates WHERE id = $1', [candidateId]);
        return result.rows;
    }
    if (name && idTail) {
        const result = await query(
            'SELECT id, name, id_tail_hint FROM candidates WHERE name = $1 AND id_tail_hash = $2',
            [name, hashIdTail(idTail)]
        );
        return result.rows;
    }
    if (name) {
        const result = await query(
            'SELECT id, name, id_tail_hint FROM candidates WHERE name = $1 ORDER BY created_at ASC',
            [name]
        );
        if (result.rows.length > 1 && !allMatches) {
            throw new Error(`Found ${result.rows.length} candidates named "${name}". Pass --id-tail to select one, or --all-matches to delete all.`);
        }
        return result.rows;
    }

    throw new Error('Pass --candidate-id, or --name with optional --id-tail.');
}

async function deleteCount(client, sql, params) {
    const result = await client.query(sql, params);
    return result.rowCount || 0;
}

async function main() {
    assertSafe();
    const matched = await findCandidates();
    const candidateIds = matched.map((item) => item.id);
    if (!candidateIds.length) {
        console.log(JSON.stringify({matched: [], removed: {}}, null, 2));
        return;
    }

    const applicationResult = await query(
        'SELECT id FROM applications WHERE candidate_id = ANY($1::text[])',
        [candidateIds]
    );
    const applicationIds = applicationResult.rows.map((item) => item.id);
    const aggregateIds = [...new Set([...candidateIds, ...applicationIds])];

    const removed = await transaction(async (client) => ({
        auditLogs: await deleteCount(
            client,
            `DELETE FROM audit_logs
             WHERE actor_id = ANY($1::text[])
                OR aggregate_id = ANY($1::text[])`,
            [aggregateIds]
        ),
        jobRuns: await deleteCount(
            client,
            `DELETE FROM job_runs
             WHERE payload->>'candidateId' = ANY($1::text[])
                OR payload->>'applicationId' = ANY($2::text[])`,
            [candidateIds, applicationIds]
        ),
        uploads: await deleteCount(
            client,
            `DELETE FROM uploads
             WHERE owner_id = ANY($1::text[])
                OR owner_id = ANY($2::text[])`,
            [candidateIds, applicationIds]
        ),
        interviewAttempts: await deleteCount(
            client,
            'DELETE FROM interview_attempts WHERE application_id = ANY($1::text[])',
            [applicationIds]
        ),
        interviewPlans: await deleteCount(
            client,
            'DELETE FROM interview_plans WHERE application_id = ANY($1::text[])',
            [applicationIds]
        ),
        consultationSessions: await deleteCount(
            client,
            'DELETE FROM consultation_sessions WHERE candidate_id = ANY($1::text[])',
            [candidateIds]
        ),
        portfolioSubmissions: await deleteCount(
            client,
            'DELETE FROM portfolio_submissions WHERE candidate_id = ANY($1::text[])',
            [candidateIds]
        ),
        candidateMaterialFiles: await deleteCount(
            client,
            'DELETE FROM candidate_material_files WHERE candidate_id = ANY($1::text[])',
            [candidateIds]
        ),
        applications: await deleteCount(
            client,
            'DELETE FROM applications WHERE id = ANY($1::text[])',
            [applicationIds]
        ),
        candidates: await deleteCount(
            client,
            'DELETE FROM candidates WHERE id = ANY($1::text[])',
            [candidateIds]
        ),
    }));

    console.log(JSON.stringify({
        matched: matched.map((item) => ({
            id: item.id,
            name: item.name,
            idTailHint: item.id_tail_hint ? `**${item.id_tail_hint}` : '',
        })),
        removed,
    }, null, 2));
}

try {
    await main();
}
finally {
    await closePool();
}
