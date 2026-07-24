import {applicationStatus, prescreenStatus} from '../../domain/contracts.js';
import {query} from '../../storage/db.js';
import {addJob} from '../../storage/queue.js';
import {getCandidate} from '../candidates/service.js';
import {getJob} from '../jobs/service.js';
import {extractCandidateKnowledge, extractResumeEvidence, generatePrescreenResult} from '../ai-gateway/service.js';
import {evaluatePortfolios} from '../portfolio/service.js';
import {writeAuditLog} from '../audit/service.js';
import {createInterviewInvitation} from '../interview-bridge/service.js';

function selectedResume(candidate, snapshot) {
    if (snapshot.resumeItem) return snapshot.resumeItem;
    return (candidate.resumes || []).find((resume) => resume.id === snapshot.resumeId)
        || (candidate.resumes || []).find((resume) => resume.isDefault)
        || (candidate.resumes || [])[0]
        || {id: '', name: snapshot.resumeName || '未选择简历', summary: ''};
}

async function updateApplicationData(applicationId, updater) {
    const result = await query('SELECT * FROM applications WHERE id = $1', [applicationId]);
    const current = result.rows[0]?.data;
    if (!current) return null;
    const next = updater(current);
    await query(
        'UPDATE applications SET status = $2, data = $3, updated_at = now() WHERE id = $1',
        [applicationId, next.status, next]
    );
    return next;
}

export async function buildEvidencePack({job, candidate, application}) {
    const snapshot = application.materialSnapshot || {};
    const resume = selectedResume(candidate, snapshot);
    const resumeEvidence = await extractResumeEvidence({candidate, resume});
    const portfolioEvaluations = await evaluatePortfolios({job, candidate, snapshot});
    const selectedKnowledge = snapshot.knowledgeItems?.length
        ? snapshot.knowledgeItems
        : (candidate.knowledge || []).filter((source) => (
            snapshot.knowledgeIds || []
        ).includes(source.id));
    const knowledgeEvidence = [];
    for (const source of selectedKnowledge) {
        knowledgeEvidence.push({sourceId: source.id, ...(await extractCandidateKnowledge({source}))});
    }
    return {
        applicationId: application.id,
        candidateId: candidate.id,
        jobId: job.id,
        snapshot,
        resumeEvidence,
        portfolioEvaluations,
        knowledgeEvidence,
        evidenceRefs: [
            ...(resumeEvidence.evidenceRefs || []),
            ...portfolioEvaluations.flatMap((item) => item.evidenceRefs || []),
            ...knowledgeEvidence.flatMap((item) => item.evidenceRefs || []),
        ],
        generatedAt: new Date().toISOString(),
    };
}

export async function prepareEvidencePack(applicationId) {
    const appResult = await query('SELECT * FROM applications WHERE id = $1', [applicationId]);
    const application = appResult.rows[0]?.data;
    if (!application) return null;
    await updateApplicationData(applicationId, (current) => ({
        ...current,
        status: applicationStatus.materialProcessing,
        screen: '材料处理中',
        evidencePack: {
            ...(current.evidencePack || {}),
            status: 'processing',
            summary: '正在读取简历原文、作品视觉观察和候选人可选资料，作为初筛辅助缓存。',
            updatedAt: new Date().toISOString(),
        },
        prescreen: {
            ...(current.prescreen || {}),
            status: prescreenStatus.pending,
            recommendation: '等待初筛',
            summary: '辅助证据准备后会进入评价 worker；如失败也会直接读取原始材料生成报告。',
            generatedAt: '',
        },
    }));
    const [job, candidate] = await Promise.all([
        getJob(application.jobId),
        getCandidate(application.candidateId),
    ]);
    const evidencePack = await buildEvidencePack({job, candidate, application});
    const next = await updateApplicationData(applicationId, (current) => ({
        ...current,
        status: applicationStatus.evidenceReady,
        screen: '证据已生成',
        evidencePack: {
            ...evidencePack,
            status: 'ready',
            summary: '简历原文、作品视觉观察和补充资料已形成初筛辅助缓存。',
        },
    }));
    await writeAuditLog({
        actorType: 'worker',
        actorId: 'evidence',
        action: 'evidence.ready',
        aggregateType: 'Application',
        aggregateId: applicationId,
        detail: {evidenceRefs: evidencePack.evidenceRefs?.length || 0},
    });
    await addJob('prescreen', 'prescreen_application', {applicationId});
    return next;
}

export async function runPrescreen(applicationId) {
    const appResult = await query('SELECT * FROM applications WHERE id = $1', [applicationId]);
    const application = appResult.rows[0]?.data;
    if (!application) return null;
    await markPrescreenProcessing(applicationId);
    const [job, candidate] = await Promise.all([
        getJob(application.jobId),
        getCandidate(application.candidateId),
    ]);
    const evidencePack = application.evidencePack?.status === 'ready'
        ? application.evidencePack
        : {
            ...(application.evidencePack || {}),
            status: application.evidencePack?.status || 'not_ready',
            snapshot: application.evidencePack?.snapshot || application.materialSnapshot || {},
            evidenceRefs: application.evidencePack?.evidenceRefs || [],
            summary: application.evidencePack?.summary || '证据包未完成，初筛将直接基于原始材料生成。',
        };
    const result = await generatePrescreenResult({job, candidate, application, evidencePack});
    const fallbackEvidenceRefs = evidencePack.evidenceRefs || [];
    const prescreenEvidenceRefs = result.evidenceRefs?.length
        ? result.evidenceRefs
        : fallbackEvidenceRefs;
    const prescreen = {
        status: prescreenStatus.completed,
        recommendation: result.recommendation,
        score: result.score,
        summary: result.summary,
        generatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rules: (result.matchedRequirements || []).map((item) => ({
            label: item.requirement,
            result: item.result,
            tone: item.result?.includes('命中') ? 'success' : 'warning',
            reason: item.result || '',
            evidenceRefs: item.evidenceRefs?.length ? item.evidenceRefs : fallbackEvidenceRefs.slice(0, 2),
        })),
        gaps: result.gaps || [],
        risks: result.risks || [],
        markdownReport: result.markdownReport || '',
        adminSuggestion: result.adminSuggestion || '',
        evidenceRefs: prescreenEvidenceRefs,
        evidenceNote: result.evidenceRefs?.length ? '评价结论引用模型返回证据。' : '',
    };
    const nextStatus = prescreen.recommendation === '不建议继续'
        ? applicationStatus.prescreened
        : applicationStatus.needInterview;
    const next = await updateApplicationData(applicationId, (current) => ({
        ...current,
        status: nextStatus,
        screen: prescreen.recommendation,
        score: prescreen.score,
        prescreen,
        evidencePack,
    }));
    await writeAuditLog({
        actorType: 'worker',
        actorId: 'prescreen',
        action: 'prescreen.completed',
        aggregateType: 'Application',
        aggregateId: applicationId,
        detail: {recommendation: prescreen.recommendation, score: prescreen.score},
    });
    if (next && nextStatus === applicationStatus.needInterview) {
        try {
            const invitation = await createInterviewInvitation(applicationId, {
                actorType: 'system',
                actorId: 'prescreen-worker',
            });
            return invitation?.application || next;
        }
        catch (error) {
            await writeAuditLog({
                actorType: 'worker',
                actorId: 'prescreen',
                action: 'ai_interview.auto_invite_failed',
                aggregateType: 'Application',
                aggregateId: applicationId,
                detail: {message: error.message || String(error)},
            });
        }
    }
    return next;
}

export async function markPrescreenProcessing(applicationId, reason = '等待 worker 生成评价报告') {
    return updateApplicationData(applicationId, (current) => ({
        ...current,
        status: applicationStatus.prescreening,
        screen: '初筛生成中',
        prescreen: {
            status: prescreenStatus.processing,
            recommendation: '初筛生成中',
            summary: reason,
            generatedAt: '',
            updatedAt: new Date().toISOString(),
            rules: [],
            gaps: [],
            risks: [],
            adminSuggestion: '',
            evidenceRefs: [],
        },
    }));
}

export async function markEvidenceFailed(applicationId, error) {
    await updateApplicationData(applicationId, (current) => ({
        ...current,
        status: applicationStatus.prescreening,
        screen: '初筛生成中',
        evidencePack: {
            ...(current.evidencePack || {}),
            status: 'failed',
            summary: error.message || '辅助证据包生成失败，初筛将直接读取原始材料。',
            updatedAt: new Date().toISOString(),
        },
        prescreen: {
            ...(current.prescreen || {}),
            status: prescreenStatus.pending,
            recommendation: '等待初筛',
            summary: '辅助证据包失败，不阻塞 GPT 直接基于原始材料生成初筛。',
            updatedAt: new Date().toISOString(),
        },
    }));
    await addJob('prescreen', 'prescreen_application', {applicationId});
}

export async function markPrescreenFailed(applicationId, error) {
    await updateApplicationData(applicationId, (current) => ({
        ...current,
        status: applicationStatus.prescreenFailed,
        screen: '初筛失败',
        prescreen: {
            status: prescreenStatus.failed,
            recommendation: '评价失败',
            summary: error.message || '模型输出或 worker 处理失败，可重跑评价。',
            generatedAt: '',
            updatedAt: new Date().toISOString(),
            rules: [],
            gaps: [],
            risks: [],
            adminSuggestion: '',
            evidenceRefs: [],
        },
    }));
}
