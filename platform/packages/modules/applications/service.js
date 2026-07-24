import {
    applicationStatus,
    interviewStatus,
    newId,
    prescreenStatus,
    reinterviewStatus,
    reviewStatus,
} from '../../domain/contracts.js';
import {query} from '../../storage/db.js';
import {addJob} from '../../storage/queue.js';
import {buildMaterialSnapshot, snapshotSummary} from '../evidence/service.js';
import {getCandidate} from '../candidates/service.js';
import {getJob} from '../jobs/service.js';
import {writeAuditLog} from '../audit/service.js';

export function normalizeApplication(row) {
    return row?.data || null;
}

export async function listApplications() {
    const result = await query('SELECT * FROM applications ORDER BY created_at DESC');
    return result.rows.map(normalizeApplication);
}

export async function listApplicationsForJob(jobId) {
    const result = await query('SELECT * FROM applications WHERE job_id = $1 ORDER BY created_at DESC', [jobId]);
    return result.rows.map(normalizeApplication);
}

export async function listApplicationsForCandidate(candidateId) {
    const result = await query('SELECT * FROM applications WHERE candidate_id = $1 ORDER BY created_at DESC', [candidateId]);
    return result.rows.map(normalizeApplication);
}

export async function getApplication(applicationId) {
    const result = await query('SELECT * FROM applications WHERE id = $1', [applicationId]);
    return normalizeApplication(result.rows[0]);
}

export async function saveApplication(application) {
    await query(
        `INSERT INTO applications (id, job_id, candidate_id, status, data)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            data = EXCLUDED.data,
            updated_at = now()`,
        [application.id, application.jobId, application.candidateId, application.status, application]
    );
    return application;
}

async function enqueueJob(queueName, jobName, applicationId, action) {
    try {
        await addJob(queueName, jobName, {applicationId});
    }
    catch (error) {
        await writeAuditLog({
            actorType: 'system',
            actorId: 'api',
            action,
            aggregateType: 'Application',
            aggregateId: applicationId,
            detail: {message: error.message},
        });
    }
}

async function enqueueEvidence(applicationId) {
    return enqueueJob('evidence', 'evidence_prepare', applicationId, 'evidence.enqueue_failed');
}

async function enqueuePrescreen(applicationId) {
    return enqueueJob('prescreen', 'prescreen_application', applicationId, 'prescreen.enqueue_failed');
}

function flowError(message, statusCode, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function materialUpdateRequestId(update = {}) {
    return String(update.requestId || update.materialUpdateRequestId || update.messageId || '').trim();
}

function applicationMaterialUpdateUsed(application = {}, requestId = '') {
    const update = application.materialUpdate || {};
    if (update.status !== 'used') return false;
    const currentRequestId = materialUpdateRequestId(update);
    const usedRequestId = String(update.usedRequestId || currentRequestId || '').trim();
    const expectedRequestId = String(requestId || currentRequestId || '').trim();
    return !expectedRequestId || !usedRequestId || usedRequestId === expectedRequestId;
}

function freshAiInterviewState() {
    return {
        status: interviewStatus.notStarted,
        attempt: 0,
        sessionRef: '',
        reportRef: '',
        entryUrl: '',
        publicEntryUrl: '',
        invitedAt: '',
        expiresAt: '',
        startedAt: '',
        completedAt: '',
        lastError: '',
        forced: false,
        forceReason: '',
        candidateResponse: {status: 'none', respondedAt: '', note: ''},
        rescheduleRequest: {status: 'none', reason: ''},
        reportSummary: '',
        report: null,
        riskNotes: [],
        bonusNotes: [],
        recommendation: '',
        decisionReason: '',
        evidenceSummary: [],
        followUpQuestions: [],
        questionAssessments: [],
        fullTrace: null,
        demo: null,
    };
}

async function invalidateOpenInterviewAttempts(applicationId, now) {
    const reason = '候选人已更新投递材料，旧 AI 面试入口已失效。';
    const invalidatedPatch = {
        status: interviewStatus.failed,
        errorMessage: reason,
        completedAt: now,
        invalidatedByMaterialUpdate: {at: now, reason},
    };
    await query(
        `UPDATE interview_attempts
         SET status = $2,
             error_message = $3,
             completed_at = COALESCE(completed_at, now()),
             data = COALESCE(data, '{}'::jsonb) || $4::jsonb,
             updated_at = now()
         WHERE application_id = $1
           AND (
               status = ANY($5::text[])
               OR data->>'status' = ANY($5::text[])
           )`,
        [
            applicationId,
            interviewStatus.failed,
            reason,
            JSON.stringify(invalidatedPatch),
            [interviewStatus.notStarted, interviewStatus.pending, interviewStatus.inProgress],
        ]
    );
}

export async function createApplication({jobId, candidateId, materialSnapshot, ...body}) {
    const existing = await query(
        'SELECT * FROM applications WHERE job_id = $1 AND candidate_id = $2',
        [jobId, candidateId]
    );
    if (existing.rows[0]) {
        return {application: normalizeApplication(existing.rows[0]), alreadyApplied: true};
    }
    const [job, candidate] = await Promise.all([getJob(jobId), getCandidate(candidateId)]);
    if (!job) throw new Error(`Job not found: ${jobId || '(empty)'}`);
    if (!candidate) throw new Error('Candidate not found');
    const snapshot = materialSnapshot || buildMaterialSnapshot(candidate, body);
    const application = {
        id: newId('app'),
        jobId,
        candidateId,
        material: snapshotSummary(snapshot),
        status: applicationStatus.submitted,
        screen: '已投递',
        interview: '未开始',
        score: 0,
        decision: '未决策',
        materialSnapshot: snapshot,
        prescreen: {
            status: prescreenStatus.pending,
            recommendation: '等待初筛',
            summary: '后端 worker 会读取原始材料、作品视觉观察和岗位 JD 生成评价报告。',
            generatedAt: '',
        },
        evidencePack: {
            status: 'pending',
            summary: '等待材料解析和证据生成。',
            evidenceRefs: [],
        },
        interviewPlan: null,
        aiInterview: {
            status: interviewStatus.notStarted,
            attempt: 0,
            sessionRef: '',
            reportRef: '',
            entryUrl: '',
            invitedAt: '',
            expiresAt: '',
            startedAt: '',
            completedAt: '',
            lastError: '',
        },
        reinterviewRequest: {status: reinterviewStatus.none, reason: ''},
        humanDecision: {status: '未决策', note: '', updatedAt: ''},
        interviewStatus: interviewStatus.notStarted,
        reviewStatus: reviewStatus.none,
        interviewSessionRef: '',
        reviewReportRef: '',
        createdAt: new Date().toISOString(),
    };
    await saveApplication(application);
    await writeAuditLog({
        actorType: 'candidate',
        actorId: candidateId,
        action: 'application.submitted',
        aggregateType: 'Application',
        aggregateId: application.id,
        detail: {jobId, snapshot},
    });
    const queued = await saveApplication({
        ...application,
        status: applicationStatus.materialProcessing,
        screen: '材料处理中',
        evidencePack: {
            status: 'queued',
            summary: '已提交辅助证据 worker，成功后会把文档原文和视觉观察交给初筛。',
            evidenceRefs: [],
        },
    });
    await enqueueEvidence(application.id);
    return {application: queued, alreadyApplied: false};
}

export async function updateApplicationMaterials(applicationId, candidateId, body = {}) {
    const [application, candidate] = await Promise.all([
        getApplication(applicationId),
        getCandidate(candidateId),
    ]);
    if (!application || !candidate || application.candidateId !== candidate.id) return null;
    const requestId = String(body.materialUpdateRequestId || body.requestId || '').trim();
    const currentRequestId = materialUpdateRequestId(application.materialUpdate);
    if (currentRequestId && requestId && requestId !== currentRequestId) {
        throw flowError('这次补材料入口已不是最新，请从招聘者最新发送的补材料消息进入。', 409, 'material_update_request_stale');
    }
    if (applicationMaterialUpdateUsed(application, requestId || currentRequestId)) {
        throw flowError('本次投递的补材料机会已使用，等待招聘者处理新材料。', 409, 'material_update_already_used');
    }
    const now = new Date().toISOString();
    const snapshot = buildMaterialSnapshot(candidate, body);
    const next = {
        ...application,
        material: snapshotSummary(snapshot),
        status: applicationStatus.materialProcessing,
        screen: '材料重新处理中',
        decision: '未决策',
        materialSnapshot: snapshot,
        materialUpdate: {
            ...(application.materialUpdate || {}),
            status: 'used',
            requestId: currentRequestId || requestId || application.materialUpdate?.requestId || '',
            usedRequestId: currentRequestId || requestId || application.materialUpdate?.requestId || '',
            usedAt: now,
            updatedAt: now,
            source: 'candidate',
            previousMaterial: application.material || '',
        },
        materialUpdateCount: Number(application.materialUpdateCount || 0) + 1,
        evidencePack: {
            status: 'queued',
            summary: '候选人已更新本次投递材料，等待重新解析。',
            evidenceRefs: [],
            updatedAt: now,
        },
        prescreen: {
            status: prescreenStatus.pending,
            recommendation: '等待证据包',
            summary: '候选人已更新材料，证据包生成后会重新进入评价 worker。',
            generatedAt: '',
            updatedAt: now,
            rules: [],
            gaps: [],
            risks: [],
            adminSuggestion: '',
            evidenceRefs: [],
        },
        interviewPlan: null,
        interview: '未开始',
        aiInterview: freshAiInterviewState(),
        reinterviewRequest: {status: reinterviewStatus.none, reason: ''},
        humanDecision: {status: '未决策', note: '', updatedAt: ''},
        interviewStatus: interviewStatus.notStarted,
        reviewStatus: reviewStatus.none,
        interviewSessionRef: '',
        reviewReportRef: '',
    };
    await saveApplication(next);
    await invalidateOpenInterviewAttempts(applicationId, now);
    await writeAuditLog({
        actorType: 'candidate',
        actorId: candidate.id,
        action: 'application.materials_updated',
        aggregateType: 'Application',
        aggregateId: applicationId,
        detail: {snapshot},
    });
    await enqueueEvidence(applicationId);
    return next;
}

export async function updateApplication(applicationId, body = {}) {
    const application = await getApplication(applicationId);
    if (!application) return null;
    if (body.materialUpdateAction === 'request') {
        const now = new Date().toISOString();
        const requestId = String(body.materialUpdateRequestId || newId('mureq')).trim();
        const requestNo = Number(application.materialUpdateRequestCount || application.materialUpdate?.requestNo || 0) + 1;
        const next = await saveApplication({
            ...application,
            status: applicationStatus.needMaterials,
            screen: body.screen || '需要补材料',
            materialUpdate: {
                ...(application.materialUpdate || {}),
                status: 'requested',
                requestId,
                requestNo,
                materialKind: body.materialKind || application.materialUpdate?.materialKind || '',
                requestedAt: now,
                requestedBy: body.actorId || 'local-admin',
                updatedAt: now,
                note: body.note || '',
                previousStatus: application.status || '',
                previousMaterial: application.material || '',
            },
            materialUpdateRequestCount: requestNo,
        });
        await writeAuditLog({
            actorType: body.actorType || 'admin',
            actorId: body.actorId || 'local-admin',
            action: 'application.material_update_requested',
            aggregateType: 'Application',
            aggregateId: applicationId,
            detail: {requestId, requestNo, materialKind: body.materialKind || ''},
        });
        return next;
    }
    let next = {...application, ...body};
    if (body.prescreenAction === 'complete' || body.prescreenAction === 'rerun') {
        next = {
            ...next,
            status: applicationStatus.prescreening,
            screen: '初筛重新生成中',
            evidencePack: {
                ...(next.evidencePack || {}),
                summary: next.evidencePack?.status === 'ready'
                    ? next.evidencePack.summary
                    : '辅助证据包不是初筛前置；本次将直接基于原始材料生成报告。',
                updatedAt: new Date().toISOString(),
            },
            prescreen: {
                status: prescreenStatus.processing,
                recommendation: '初筛重新生成中',
                summary: '已重新提交 worker，稍后直接读取原始材料、作品视觉观察和岗位 JD 生成新报告。',
                generatedAt: '',
                updatedAt: new Date().toISOString(),
                rules: [],
                gaps: [],
                risks: [],
                adminSuggestion: '',
                evidenceRefs: [],
            },
            interviewPlan: null,
        };
        await saveApplication(next);
        await enqueuePrescreen(applicationId);
        return next;
    }
    if (body.evidenceAction === 'retry') {
        next = {
            ...next,
            status: applicationStatus.materialProcessing,
            screen: '材料重新处理中',
            evidencePack: {
                ...(next.evidencePack || {}),
                status: 'queued',
                summary: '已重新提交 evidence worker。',
                updatedAt: new Date().toISOString(),
            },
        };
        await saveApplication(next);
        await enqueueEvidence(applicationId);
    }
    if (body.overrideScreen) {
        const previousPrescreen = next.prescreen || {};
        next.prescreen = {
            ...previousPrescreen,
            status: prescreenStatus.overridden,
            recommendation: body.overrideScreen,
            summary: previousPrescreen.summary || '',
            manualOverride: {
                note: body.note || '招聘者已人工覆盖评价建议。',
                actorType: body.actorType || 'admin',
                updatedAt: new Date().toISOString(),
            },
            generatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        next.screen = body.overrideScreen;
        next.status = body.overrideScreen.includes('补材料')
            ? applicationStatus.needMaterials
            : applicationStatus.needInterview;
        await saveApplication(next);
    }
    if (body.interviewAction === 'invite') {
        next.interviewStatus = interviewStatus.pending;
        next.interview = '已邀请';
        next.status = applicationStatus.needInterview;
        next.interviewSessionRef = next.interviewSessionRef || `session://pending-ai-module/${applicationId}`;
        await saveApplication(next);
    }
    if (body.reviewAction === 'open') {
        next.reviewStatus = reviewStatus.pending;
        next.status = applicationStatus.needReview;
        next.reviewReportRef = next.reviewReportRef || `report://pending-ai-module/${applicationId}`;
        await saveApplication(next);
    }
    if (body.humanDecision) {
        next.humanDecision = {
            status: body.humanDecision,
            note: body.note || '',
            updatedAt: new Date().toISOString(),
        };
        next.decision = body.humanDecision;
        if (body.humanDecision === '通过') next.status = applicationStatus.passed;
        if (body.humanDecision === '拒绝') next.status = applicationStatus.rejected;
        if (body.humanDecision === '暂缓') next.status = applicationStatus.held;
        await saveApplication(next);
    }
    if (body.reinterviewDecision) {
        next.reinterviewRequest = {
            ...(next.reinterviewRequest || {}),
            status: body.reinterviewDecision,
            reviewedAt: new Date().toISOString(),
        };
        if (body.reinterviewDecision === reinterviewStatus.approved) {
            next.interviewStatus = interviewStatus.pending;
            next.interview = '待再次面试';
            next.interviewSessionRef = `session://pending-ai-module/retry-${applicationId}`;
        }
        await saveApplication(next);
    }
    await writeAuditLog({
        actorType: 'admin',
        actorId: 'local-admin',
        action: 'application.updated',
        aggregateType: 'Application',
        aggregateId: applicationId,
        detail: body,
    });
    return next;
}

export async function requestReinterview(applicationId, body = {}) {
    const application = await getApplication(applicationId);
    if (!application) return null;
    const next = {
        ...application,
        reinterviewRequest: {
            status: reinterviewStatus.requested,
            reason: body.reason || '候选人申请再次面试',
            requestedAt: new Date().toISOString(),
        },
    };
    await saveApplication(next);
    await writeAuditLog({
        actorType: 'candidate',
        actorId: application.candidateId,
        action: 'reinterview.requested',
        aggregateType: 'Application',
        aggregateId: applicationId,
        detail: next.reinterviewRequest,
    });
    return next;
}
