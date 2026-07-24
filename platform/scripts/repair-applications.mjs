import {applicationStatus, prescreenStatus} from '../packages/domain/contracts.js';
import {addJob} from '../packages/storage/queue.js';
import {closePool, query} from '../packages/storage/db.js';

const apply = process.argv.includes('--apply');
const demoOnly = process.argv.includes('--demo-only');
const applicationArg = process.argv.find((arg) => arg.startsWith('--application-id='));
const applicationId = applicationArg ? applicationArg.split('=').slice(1).join('=') : '';

function needsEvidence(application) {
    return application.evidencePack?.status !== 'ready';
}

function needsPrescreen(application) {
    return application.evidencePack?.status === 'ready'
        && application.prescreen?.status !== prescreenStatus.completed;
}

function hasFinalHumanDecision(application) {
    const decision = application.humanDecision?.status || application.decision || '';
    return ['通过', '拒绝', '暂缓'].includes(decision)
        || [
            applicationStatus.passed,
            applicationStatus.rejected,
            applicationStatus.held,
        ].includes(application.status);
}

function repairedForEvidence(application) {
    return {
        ...application,
        status: applicationStatus.materialProcessing,
        screen: '材料处理中',
        evidencePack: {
            ...(application.evidencePack || {}),
            status: 'queued',
            summary: '历史投递已重新提交 evidence worker，先生成材料证据包。',
            updatedAt: new Date().toISOString(),
        },
        prescreen: {
            ...(application.prescreen || {}),
            status: prescreenStatus.pending,
            recommendation: '等待证据包',
            summary: '证据包生成后会自动进入初筛 worker。',
            generatedAt: '',
            updatedAt: new Date().toISOString(),
        },
    };
}

function repairedForPrescreen(application) {
    return {
        ...application,
        status: applicationStatus.prescreening,
        screen: '初筛重新生成中',
        prescreen: {
            ...(application.prescreen || {}),
            status: prescreenStatus.processing,
            recommendation: '初筛重新生成中',
            summary: '历史投递已重新提交 prescreen worker，稍后回写新报告。',
            generatedAt: '',
            updatedAt: new Date().toISOString(),
        },
    };
}

async function updateApplication(application) {
    await query(
        'UPDATE applications SET status = $2, data = $3, updated_at = now() WHERE id = $1',
        [application.id, application.status, application]
    );
}

async function main() {
    const params = [];
    const where = [];
    if (applicationId) {
        params.push(applicationId);
        where.push(`id = $${params.length}`);
    }
    if (demoOnly) {
        where.push("(job_id LIKE 'demo-%' OR candidate_id LIKE 'demo-%')");
    }
    const result = await query(
        `SELECT * FROM applications ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`,
        params
    );
    const actions = [];
    for (const row of result.rows) {
        const application = row.data;
        if (!application) continue;
        if (hasFinalHumanDecision(application)) continue;
        if (needsEvidence(application)) {
            actions.push({action: 'enqueue_evidence', application: repairedForEvidence(application)});
        }
        else if (needsPrescreen(application)) {
            actions.push({action: 'enqueue_prescreen', application: repairedForPrescreen(application)});
        }
    }

    console.log(JSON.stringify({
        apply,
        demoOnly,
        applicationId,
        planned: actions.map((item) => ({
            action: item.action,
            applicationId: item.application.id,
            status: item.application.status,
            evidence: item.application.evidencePack?.status || '',
            prescreen: item.application.prescreen?.status || '',
        })),
    }, null, 2));

    if (!apply) {
        console.log('dry run only; pass --apply to repair and enqueue jobs');
        return;
    }

    for (const item of actions) {
        await updateApplication(item.application);
        if (item.action === 'enqueue_evidence') {
            await addJob('evidence', 'evidence_prepare', {applicationId: item.application.id});
        }
        if (item.action === 'enqueue_prescreen') {
            await addJob('prescreen', 'prescreen_application', {applicationId: item.application.id});
        }
    }
    console.log(`repaired ${actions.length} application(s)`);
}

try {
    await main();
}
finally {
    await closePool();
}
