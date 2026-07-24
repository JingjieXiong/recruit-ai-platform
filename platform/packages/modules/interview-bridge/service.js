import {createHash, randomBytes} from 'node:crypto';
import {applicationStatus, interviewStatus, newId, prescreenStatus, reviewStatus} from '../../domain/contracts.js';
import {appConfig} from '../../storage/config.js';
import {query} from '../../storage/db.js';
import {addJob, queueNames} from '../../storage/queue.js';
import {getApplication, saveApplication} from '../applications/service.js';
import {getCandidate} from '../candidates/service.js';
import {getJob, listJobKnowledgeChunks} from '../jobs/service.js';
import {generateInterviewPlan as generateInterviewPlanOutput} from '../ai-gateway/service.js';
import {writeAuditLog} from '../audit/service.js';

export class InterviewFlowError extends Error {
    constructor(message, statusCode = 409, code = 'interview_flow_error') {
        super(message);
        this.name = 'InterviewFlowError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

function normalizePlan(row) {
    return row?.data || null;
}

function normalizeAttempt(row) {
    return row?.data || null;
}

async function latestPlan(applicationId) {
    const result = await query(
        'SELECT * FROM interview_plans WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1',
        [applicationId]
    );
    return normalizePlan(result.rows[0]);
}

async function latestAttempt(applicationId) {
    const result = await query(
        'SELECT * FROM interview_attempts WHERE application_id = $1 ORDER BY attempt_no DESC LIMIT 1',
        [applicationId]
    );
    return normalizeAttempt(result.rows[0]);
}

async function attemptById(attemptId) {
    const result = await query('SELECT * FROM interview_attempts WHERE id = $1', [attemptId]);
    return normalizeAttempt(result.rows[0]);
}

async function planById(planId) {
    if (!planId) return null;
    const result = await query('SELECT * FROM interview_plans WHERE id = $1', [planId]);
    return normalizePlan(result.rows[0]);
}

async function savePlan(plan) {
    await query(
        `INSERT INTO interview_plans (id, application_id, status, version, data)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            version = EXCLUDED.version,
            data = EXCLUDED.data,
            updated_at = now()`,
        [plan.id, plan.applicationId, plan.status, plan.version, plan]
    );
    return plan;
}

async function saveAttempt(attempt) {
    await query(
        `INSERT INTO interview_attempts
            (id, application_id, plan_id, attempt_no, status, entry_token_hash, entry_url, session_ref, report_ref, error_message, data, expires_at, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            entry_url = EXCLUDED.entry_url,
            session_ref = EXCLUDED.session_ref,
            report_ref = EXCLUDED.report_ref,
            error_message = EXCLUDED.error_message,
            data = EXCLUDED.data,
            started_at = EXCLUDED.started_at,
            completed_at = EXCLUDED.completed_at,
            updated_at = now()`,
        [
            attempt.id,
            attempt.applicationId,
            attempt.planId || null,
            attempt.attemptNo,
            attempt.status,
            attempt.entryTokenHash || '',
            attempt.entryUrl || '',
            attempt.sessionRef || '',
            attempt.reportRef || '',
            attempt.errorMessage || '',
            attempt,
            attempt.expiresAt || null,
            attempt.startedAt || null,
            attempt.completedAt || null,
        ]
    );
    return attempt;
}

function planSummary(plan) {
    if (!plan) return null;
    const questions = executablePlanQuestions(plan);
    return {
        id: plan.id,
        status: plan.status,
        version: plan.version,
        title: plan.title,
        questionCount: questions.length,
        focusAreas: plan.focusAreas || [],
        questions: questions.slice(0, 8),
        generatedAt: plan.generatedAt,
        materialFingerprint: plan.materialFingerprint || '',
    };
}

function attemptSummary(attempt, token = '', publicUrls = {}) {
    if (!attempt) {
        return {
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
            forced: false,
            forceReason: '',
        };
    }
    const entryUrl = publicInterviewEntryUrl(attempt.id, publicUrls) || attempt.entryUrl || '';
    const tokenEntryUrl = token && entryUrl
        ? `${entryUrl}${entryUrl.includes('?') ? '&' : '?'}token=${token}`
        : '';
    const publicEntryUrl = tokenEntryUrl
        || attempt.publicEntryUrl
        || attempt.entryUrlPublic
        || attempt.entryUrlWithToken
        || attempt.invitationUrl
        || attempt.demo?.publicEntryUrl
        || '';
    return {
        status: attempt.status,
        attempt: attempt.attemptNo,
        sessionRef: attempt.sessionRef || '',
        reportRef: attempt.reportRef || '',
        entryUrl: publicEntryUrl || entryUrl,
        publicEntryUrl,
        invitedAt: attempt.invitedAt,
        expiresAt: attempt.expiresAt,
        startedAt: attempt.startedAt || '',
        completedAt: attempt.completedAt || '',
        lastError: attempt.errorMessage || '',
        forced: attempt.forced === true,
        forceReason: attempt.forceReason || '',
        reportSummary: attempt.reportSummary || attempt.demo?.reportSummary || '',
        report: attempt.report || attempt.demo?.report || null,
        riskNotes: attempt.riskNotes || attempt.demo?.riskNotes || [],
        bonusNotes: attempt.bonusNotes || attempt.demo?.bonusNotes || [],
        recommendation: attempt.recommendation || attempt.report?.recommendation || attempt.report?.structured?.recommendation || attempt.demo?.recommendation || '',
        decisionReason: attempt.decisionReason || attempt.report?.decisionReason || attempt.report?.structured?.decisionReason || attempt.demo?.decisionReason || '',
        interviewQuality: attempt.interviewQuality || attempt.report?.interviewQuality || attempt.report?.structured?.interviewQuality || null,
        evidenceSummary: attempt.evidenceSummary || attempt.report?.evidenceSummary || attempt.report?.structured?.evidenceSummary || [],
        followUpQuestions: attempt.followUpQuestions || attempt.report?.followUpQuestions || attempt.report?.structured?.followUpQuestions || [],
        questionAssessments: attempt.questionAssessments || attempt.report?.questionAssessments || attempt.report?.structured?.questionAssessments || [],
        fullTrace: attempt.fullTrace || attempt.demo?.fullTrace || null,
        demo: attempt.demo || null,
    };
}

function publicEntryUrlForAttempt(attempt, token = '', publicUrls = {}) {
    const summary = attemptSummary(attempt, token, publicUrls);
    return summary.publicEntryUrl || summary.entryUrl || '';
}

function assertCandidateOwnsApplication(application, candidateId) {
    if (application.candidateId !== candidateId) {
        throw new InterviewFlowError('无权操作该投递的 AI 面试', 403, 'candidate_application_forbidden');
    }
}

function assertPendingInvitation(application) {
    const status = application.aiInterview?.status || application.interviewStatus;
    if (status !== interviewStatus.pending) {
        throw new InterviewFlowError('当前没有待确认的 AI 面试邀请', 409, 'ai_interview_not_pending');
    }
    const expiresAt = application.aiInterview?.expiresAt;
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
        throw new InterviewFlowError('AI 面试邀请已过期，请联系招聘者重新邀请', 409, 'ai_interview_expired');
    }
}

function text(value = '') {
    return String(value || '').trim();
}

function executablePlanQuestions(plan = {}) {
    return (Array.isArray(plan?.questions) ? plan.questions : [])
        .filter((question) => text(question?.prompt || question?.text || question?.question || question?.title));
}

function interviewPlanReadiness(plan = null, job = null) {
    const actual = executablePlanQuestions(plan).length;
    const expected = job ? jobInterviewSettings(job, plan).questionCount : Math.max(1, Number(plan?.questionCount || actual || 0));
    return {
        ready: Boolean(plan && actual >= expected && expected > 0),
        actual,
        expected,
    };
}

function assertExecutableInterviewPlan(plan = null, job = null, message = '') {
    const readiness = interviewPlanReadiness(plan, job);
    if (readiness.ready) return readiness;
    throw new InterviewFlowError(
        message || `AI 面试计划尚未准备完整：当前 ${readiness.actual} 题，至少需要 ${readiness.expected} 题。`,
        409,
        'interview_plan_not_ready'
    );
}

function preferredSlotsFromBody(body = {}) {
    const raw = body.preferredSlots || body.preferredTimes || body.slots || [];
    if (Array.isArray(raw)) {
        return raw.map((item) => text(item)).filter(Boolean).slice(0, 5);
    }
    return text(raw)
        .split(/[\n,，]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 5);
}

function normalizeDecision(body = {}) {
    if (typeof body.approved === 'boolean') return body.approved ? 'approved' : 'rejected';
    const raw = text(body.decision || body.status).toLowerCase();
    if (['approved', 'approve', 'accepted', 'accept', 'pass', '同意', '通过'].includes(raw)) return 'approved';
    if (['rejected', 'reject', 'denied', 'deny', 'refuse', '拒绝', '驳回'].includes(raw)) return 'rejected';
    throw new InterviewFlowError('请提供有效的改期处理结果：approved 或 rejected', 400, 'invalid_reschedule_decision');
}

function compactText(value = '', max = 1200) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function candidateQuestionText(value = '', fallback = '', max = 180) {
    const raw = compactText(value || fallback, 1000).replace(/[`*_#>]/g, '');
    if (!raw) return '';
    const tooBusy = raw.length > 200 || (raw.match(/[？?]/g) || []).length > 1;
    const asksForArtifacts = /上传|展示|截图|图中|截图里|画图|架构图|数据流图|文件路径|代码路径|提供链接|提供文件/.test(raw);
    let text = raw
        .replace(/JD/g, '岗位')
        .replace(/jd/g, '岗位')
        .replace(/截图里显示了|截图中显示了|图中显示了/g, '材料中提到了')
        .replace(/请给出具体的架构图或数据流说明/g, '请口头说明核心流程')
        .replace(/请提供可访问的链接、代码仓库或其他文件/g, '请口头补充关键证据');
    if (tooBusy || asksForArtifacts) {
        if (/面试题|岗位.*知识库|知识库.*岗位|定制.*题/.test(raw)) {
            text = '你提到做过面试题生成，请口头说明从岗位资料到题目生成的核心流程，以及你负责哪一段。';
        } else if (/RAG|知识库|问答|检索/.test(raw)) {
            text = '请讲一个你在知识库或 RAG 问答中实际负责的环节：问题是什么，你怎么验证效果？';
        } else if (/作品|项目|Demo|demo/.test(raw)) {
            text = '请选一个最相关的项目，说明它解决了什么问题、你负责什么、结果如何。';
        } else {
            text = fallback || '请讲一个最能体现岗位能力的经历：当时的问题是什么，你负责什么，结果如何。';
        }
    }
    return compactText(text, max);
}

function compactReportText(value = '', fallback = '', max = 180) {
    const raw = compactText(value || fallback, 4000)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#>*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!raw) return '';
    const labeled = raw.match(/(?:结论|核心判定|核心结论|摘要|建议|原因|summary|decisionReason)[：:]\s*([^。！？；]{4,180})/i);
    const parts = raw.split(/[。！？；]/)
        .map((item) => item.trim())
        .filter(Boolean);
    const selected = labeled?.[1]
        || parts.find((item) => /推荐|不建议|暂缓|有效回答|无法|不足|风险|核验/.test(item))
        || parts[0]
        || raw;
    return compactText(selected, max);
}

function normalizeInterviewRecommendation(value = '', rawContext = '') {
    const source = compactText([value, rawContext].filter(Boolean).join(' '), 1200);
    if (/不建议|拒|淘汰|未通过|无有效|无法形成|有效回答不足|未提供任何有效|空白答案|暂缓|待观察|不足|未完成|异常|过短/.test(source)) {
        return '不建议进入人工面试';
    }
    if (/推荐人工|进入人工|继续人工/.test(source) && !/不建议|暂缓|不足|待确认|复核|待定/.test(source)) {
        return '推荐人工面试';
    }
    if (/确认|复核|待定|判断|无法判断|不确定|证据不闭环/.test(source) || source) {
        return '待人工确认';
    }
    return '待人工确认';
}

function reportList(maxItems = 4, ...candidates) {
    for (const candidate of candidates) {
        if (!Array.isArray(candidate) || !candidate.length) continue;
        return candidate.map((item) => compactReportText(item, '', 120)).filter(Boolean).slice(0, maxItems);
    }
    return [];
}

function listText(values = [], maxItems = 8) {
    return (Array.isArray(values) ? values : [values])
        .map((item) => {
            if (typeof item === 'string') return compactText(item, 500);
            return compactText(item?.label || item?.title || item?.name || item?.text || item?.value || '', 500);
        })
        .filter(Boolean)
        .slice(0, maxItems);
}

function joinText(values = [], empty = '') {
    const rows = listText(values, 20);
    return rows.length ? rows.join('\n') : empty;
}

function trimBaseUrl(value = '') {
    return String(value || '').replace(/\/+$/, '');
}

function isLoopbackPublicBaseUrl(value = '') {
    try {
        const hostname = new URL(value).hostname.toLowerCase();
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    }
    catch {
        return false;
    }
}

function rewriteLoopbackBaseUrl(configured = '', publicOrigin = '') {
    if (!/^https?:\/\//i.test(configured) || !/^https?:\/\//i.test(publicOrigin)) return configured;
    if (!isLoopbackPublicBaseUrl(configured) || isLoopbackPublicBaseUrl(publicOrigin)) return configured;
    try {
        const target = new URL(configured);
        const source = new URL(publicOrigin);
        target.hostname = source.hostname;
        if (source.protocol === 'https:' && target.protocol === 'http:' && !target.port) {
            target.protocol = source.protocol;
        }
        return trimBaseUrl(target.toString());
    }
    catch {
        return configured;
    }
}

function mainPublicBaseUrl(publicUrls = {}) {
    const runtimeBase = trimBaseUrl(publicUrls.mainPublicBaseUrl || publicUrls.publicBaseUrl || '');
    const configured = trimBaseUrl(appConfig.interviewBridge.publicBaseUrl || appConfig.interviewBridge.baseUrl);
    if (/^https?:\/\//i.test(runtimeBase) && !isLoopbackPublicBaseUrl(runtimeBase) && isLoopbackPublicBaseUrl(configured)) {
        return runtimeBase;
    }
    if (/^https?:\/\//i.test(configured)) {
        return configured;
    }
    if (/^https?:\/\//i.test(runtimeBase)) return runtimeBase;
    return `http://localhost:${appConfig.port}`;
}

function mainUrl(path, publicUrls = {}) {
    const pathname = path.startsWith('/') ? path : `/${path}`;
    const base = mainPublicBaseUrl(publicUrls);
    return /^https?:\/\//i.test(base) ? new URL(pathname, `${base}/`).toString() : pathname;
}

function publicInterviewEntryUrl(attemptId, publicUrls = {}) {
    const path = `/interview/${encodeURIComponent(attemptId)}`;
    const base = mainPublicBaseUrl(publicUrls);
    if (/^https?:\/\//i.test(base)) return new URL(path, `${base}/`).toString();
    return path;
}

function demoBaseUrl() {
    return trimBaseUrl(appConfig.interviewDemo.baseUrl);
}

function demoPublicBaseUrl(publicUrls = {}) {
    const runtimeMainBase = mainPublicBaseUrl(publicUrls);
    const configured = trimBaseUrl(publicUrls.demoPublicBaseUrl || appConfig.interviewDemo.publicBaseUrl || appConfig.interviewDemo.baseUrl);
    return rewriteLoopbackBaseUrl(configured, runtimeMainBase);
}

export function resolveInterviewPublicUrls(publicUrls = {}) {
    return {
        mainPublicBaseUrl: mainPublicBaseUrl(publicUrls),
        demoPublicBaseUrl: demoPublicBaseUrl(publicUrls),
    };
}

function demoUrl(path) {
    const base = demoBaseUrl();
    if (!base) {
        throw new InterviewFlowError('AI 面试 demo 服务未配置，请设置 INTERVIEW_DEMO_BASE_URL 或 config.local.json 的 interviewDemo.baseUrl。', 409, 'interview_demo_unconfigured');
    }
    return new URL(path, `${base}/`).toString();
}

async function postJson(url, payload, {timeoutMs = appConfig.interviewDemo.timeoutMs} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload || {}),
            signal: controller.signal,
        });
        const textBody = await response.text();
        let body = {};
        try {
            body = textBody ? JSON.parse(textBody) : {};
        }
        catch {
            body = {message: textBody};
        }
        if (!response.ok) {
            throw new InterviewFlowError(
                body?.error?.message || body?.message || `AI 面试 demo 请求失败：${response.status}`,
                response.status >= 500 ? 502 : response.status,
                'interview_demo_request_failed'
            );
        }
        return body;
    }
    catch (error) {
        if (error instanceof InterviewFlowError) throw error;
        const aborted = error.name === 'AbortError';
        throw new InterviewFlowError(
            aborted ? 'AI 面试 demo 服务响应超时，请确认服务已在开发机启动。' : `AI 面试 demo 服务不可用：${error.message || error}`,
            502,
            aborted ? 'interview_demo_timeout' : 'interview_demo_unavailable'
        );
    }
    finally {
        clearTimeout(timer);
    }
}

async function getJson(url, {timeoutMs = 2500} = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {signal: controller.signal});
        const textBody = await response.text();
        let body = {};
        try {
            body = textBody ? JSON.parse(textBody) : {};
        }
        catch {
            body = {message: textBody};
        }
        if (!response.ok) {
            throw new InterviewFlowError(
                body?.error?.message || body?.message || `AI 面试 demo 查询失败：${response.status}`,
                response.status >= 500 ? 502 : response.status,
                'interview_demo_query_failed'
            );
        }
        return body;
    }
    catch (error) {
        if (error instanceof InterviewFlowError) throw error;
        const aborted = error.name === 'AbortError';
        throw new InterviewFlowError(
            aborted ? 'AI 面试 demo 查询超时。' : `AI 面试 demo 查询不可用：${error.message || error}`,
            502,
            aborted ? 'interview_demo_query_timeout' : 'interview_demo_query_unavailable'
        );
    }
    finally {
        clearTimeout(timer);
    }
}

function sourceRefText(ref = {}) {
    return compactText([
        ref.label,
        ref.fileName,
        ref.text,
        ref.sourceType,
    ].filter(Boolean).join(' / '), 160);
}

function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

function jobInterviewSettings(job = {}, plan = {}) {
    const planQuestionCount = (plan?.questions || []).length || 0;
    return {
        questionCount: clampInteger(
            job?.interviewSettings?.questionCount,
            planQuestionCount || appConfig.interviewDemo.defaultQuestionCount || 6,
            3,
            10
        ),
        maxFollowUpsPerQuestion: clampInteger(
            job?.interviewSettings?.maxFollowUpsPerQuestion,
            appConfig.interviewDemo.maxFollowUpsPerQuestion || 2,
            0,
            5
        ),
        durationMinutes: clampInteger(job?.interviewSettings?.durationMinutes, 25, 10, 60),
        invitationValidDays: clampInteger(job?.interviewSettings?.invitationValidDays, 3, 1, 14),
        provider: {
            kind: appConfig.interviewDemo.runtime,
            speechSynthesis: appConfig.interviewDemo.runtime === 'browser-demo',
        },
    };
}

function invitationExpiryForJob(job = {}, body = {}) {
    const validDays = clampInteger(body.invitationValidDays, jobInterviewSettings(job).invitationValidDays, 1, 14);
    return {
        validDays,
        expiresAt: new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString(),
    };
}

function materialFingerprint(application = {}) {
    const snapshot = application.materialSnapshot || {};
    const rows = [
        snapshot.resumeItem?.id || snapshot.resumeId || '',
        snapshot.resumeItem?.storageKey || '',
        ...(snapshot.portfolioItems || []).map((item) => `${item.id || ''}:${item.updatedAt || ''}:${item.storageKey || ''}`),
        ...(snapshot.knowledgeItems || []).map((item) => `${item.id || ''}:${item.updatedAt || ''}:${item.storageKey || ''}`),
        snapshot.lockedAt || '',
    ];
    return createHash('sha1').update(rows.filter(Boolean).join('|')).digest('hex');
}

function newestSourceTime(application = {}) {
    const times = [
        application.materialSnapshot?.lockedAt,
        application.evidencePack?.updatedAt,
        application.prescreen?.generatedAt,
    ].map((value) => new Date(value || '').getTime()).filter(Number.isFinite);
    return times.length ? Math.max(...times) : 0;
}

function isInterviewPlanStale(application = {}, plan = null) {
    if (!plan) return true;
    if (!executablePlanQuestions(plan).length) return true;
    const currentFingerprint = materialFingerprint(application);
    if (plan.materialFingerprint && currentFingerprint && plan.materialFingerprint !== currentFingerprint) {
        return true;
    }
    const planTime = new Date(plan.generatedAt || '').getTime();
    const sourceTime = newestSourceTime(application);
    return Boolean(sourceTime && (!Number.isFinite(planTime) || planTime < sourceTime));
}

function demoInterviewPlan(plan, job, settings = jobInterviewSettings(job, plan)) {
    const questions = executablePlanQuestions(plan).slice(0, settings.questionCount);
    const title = compactText(plan?.title || `${job?.title || '岗位'} AI 面试`, 120);
    return {
        version: 'fixed-v1',
        source: 'main-bridge',
        title,
        openingText: `你好，欢迎参加${compactText(job?.title || '这个岗位', 40)}的 AI 面试。请你先做一个简短自我介绍。`,
        closingText: compactText(plan?.closingPrompt || '今天的 AI 面试问题已经完成，感谢你的回答。招聘团队会结合材料和面试记录继续判断。', 500),
        introPolicy: {
            goal: '了解候选人背景、最相关项目、岗位动机，以及材料中没有展开但会影响判断的线索。',
            followUpPolicy: '只追问候选人主动提到且与岗位判断相关、但固定主问题不会覆盖的信息。',
            advanceCriteria: '候选人介绍了背景、最相关项目或岗位动机；如果没有明显新增线索，直接进入第一道固定题。',
            maxFollowUps: 1,
        },
        questions: questions.map((question, index) => ({
            id: question.id || `q${index + 1}`,
            text: candidateQuestionText(question.prompt || question.text, `请讲一个最能体现岗位能力的经历：当时的问题是什么，你负责什么，结果如何。`),
            goal: compactText(question.expectedEvidence || question.competency || question.type || '验证当前题目标是否达标。', 300),
            rubric: compactText((question.scoringHints || []).join('；') || '强回答应包含具体背景、本人职责、关键动作、结果和可验证证据；弱回答通常停留在泛泛描述或团队成果。', 500),
            followUpPolicy: compactText((question.followUps || []).map((text) => candidateQuestionText(text, '请再补充一个能验证你本人贡献的具体细节。')).join('；') || '当回答空泛、偏题、个人贡献不清或缺少结果验证时追问；回答已覆盖目标则进入下一题。', 500),
            advanceCriteria: '候选人回答包含本人职责、关键动作、结果或清晰取舍后，可以进入下一题。',
            maxFollowUps: settings.maxFollowUpsPerQuestion,
            evidenceRefs: (question.sourceRefs || []).map(sourceRefText).filter(Boolean).slice(0, 6),
            timeLimitSec: Math.min(300, Math.max(45, Number(question.timeLimitSec || 120))),
        })),
        updatedAt: new Date().toISOString(),
    };
}

function resumeSnapshotText(application = {}, candidate = {}) {
    const snapshot = application.materialSnapshot || {};
    if (snapshot.resumeItem || snapshot.resumeName) {
        return `简历：${snapshot.resumeItem?.name || snapshot.resumeName || '已选择简历'}`;
    }
    return `${candidate?.name || '候选人'} 的本次投递未选择简历。`;
}

function knowledgeSnapshotText(application = {}) {
    const snapshot = application.materialSnapshot || {};
    const rows = (snapshot.knowledgeItems || []).map((item) => (
        `可选知识库：${item.name || item.fileName || item.usage || '已选择资料'}`
    ));
    return rows.length ? rows.join('\n') : '可选知识库：本次投递未选择候选人知识库。';
}

function portfolioSnapshotText(application = {}) {
    const snapshot = application.materialSnapshot || {};
    const rows = (snapshot.portfolioItems || []).map((item) => {
        const title = item.title || item.name || item.oneLineValue || '已选择作品';
        const value = item.oneLineValue ? ` - ${item.oneLineValue}` : '';
        const screenshotCount = Array.isArray(item.screenshots) ? item.screenshots.length : 0;
        const attachmentCount = Array.isArray(item.attachments) ? item.attachments.length : 0;
        return `作品：${title}${value}（附件 ${attachmentCount}，截图 ${screenshotCount}）`;
    });
    return rows.length ? rows.join('\n') : '作品：本次投递未选择作品。';
}

function evidenceRefsText(refs = [], fallback = '') {
    const rows = (Array.isArray(refs) ? refs : [])
        .map((ref) => compactText([
            ref.label,
            ref.fileName,
            ref.text,
        ].filter(Boolean).join(' / '), 260))
        .filter(Boolean)
        .slice(0, 10);
    return rows.length ? rows.join('\n') : fallback;
}

function jobKnowledgeText(job = {}) {
    const chunkText = joinText((job.knowledgeChunks || []).map((chunk) => {
        const name = chunk.sourceName || chunk.fileName || chunk.sourceId || '岗位知识库';
        return `${name}：${chunk.content}`;
    }), '');
    if (chunkText) return chunkText;
    return joinText((job?.knowledge || []).map((item) => item.documentContext?.text || item.usage || item.name || item.fileName), '岗位知识库待补充');
}

function ruleText(rule = {}) {
    return `${rule.type || ''} ${rule.label || ''} ${rule.value || ''}`.toLowerCase();
}

function groupedRules(rules = []) {
    const groups = {
        hard: [],
        positive: [],
        risk: [],
    };
    for (const rule of rules) {
        const text = ruleText(rule);
        const line = `${rule.label || rule.type || '规则'}：${rule.value || '待说明'}`;
        if (/硬性|门槛|必须|必填|required|无.{0,8}不通过|没有.{0,8}不通过|不满足.{0,8}不建议|淘汰/.test(text)) {
            groups.hard.push(line);
        }
        else if (/风险|核验|真实性|存疑|缺口|不清|待确认|模糊/.test(text)) {
            groups.risk.push(line);
        }
        else {
            groups.positive.push(line);
        }
    }
    return groups;
}

function buildDemoProjectSnapshot({application, job, candidate, plan, attempt}) {
    const rules = job?.screeningRules || [];
    const ruleGroups = groupedRules(rules);
    const settings = jobInterviewSettings(job, plan);
    const riskNotes = [
        ...(application.prescreen?.risks || []),
        ...(application.prescreen?.gaps || []),
        ...(plan?.riskNotes || []),
    ];
    return {
        mode: 'browser_demo',
        materials: {
            jobTitle: job?.title || '岗位',
            jobJd: joinText(job?.jd || [], '岗位 JD 待补充'),
            jobKnowledge: jobKnowledgeText(job),
            bonusPoints: joinText(ruleGroups.positive, '请结合岗位评价维度识别正向证据。'),
            riskPoints: joinText([
                ruleGroups.hard.length ? `硬性门槛：${ruleGroups.hard.join('；')}` : '',
                ruleGroups.risk.length ? `负面风险线索：${ruleGroups.risk.join('；')}` : '',
                riskNotes.length ? `初筛风险/缺口：${riskNotes.join('；')}` : '',
                '负面信号不等同于淘汰结论；能通过问答核验的再追问，不能问出的留给人工看证据。',
            ], '重点核验材料真实性、本人贡献和结果证据。'),
            screeningFindings: [
                application.prescreen?.summary,
                application.prescreen?.recommendation ? `初筛建议：${application.prescreen.recommendation}` : '',
                application.prescreen?.gaps?.length ? `缺口：${application.prescreen.gaps.join('；')}` : '',
                application.prescreen?.risks?.length ? `风险：${application.prescreen.risks.join('；')}` : '',
            ].filter(Boolean).join('\n'),
            resume: evidenceRefsText(
                application.evidencePack?.resumeEvidence?.evidenceRefs,
                resumeSnapshotText(application, candidate)
            ),
            candidateKnowledge: [
                evidenceRefsText(
                    (application.evidencePack?.knowledgeEvidence || []).flatMap((item) => item.evidenceRefs || []),
                    knowledgeSnapshotText(application)
                ),
                portfolioSnapshotText(application),
            ].filter(Boolean).join('\n'),
        },
        generation: {
            questionCount: settings.questionCount,
            durationMinutes: settings.durationMinutes,
            questionScope: '使用主系统已生成的面试计划执行，不向候选人展示筛选策略或报告结论。',
            reportStyle: '生成中文二阶段面评：以岗位匹配度为核心，结合初筛关注点和现场回答判断候选人为什么匹配或不匹配；重点写项目拆解、本人贡献、技术/业务理解、表达清晰度、复盘取舍和风险意识。不要复述初筛材料，不要只写“推荐/不推荐”，按有效回答的信息量展开优点、短板、继续核验点和结论。',
        },
        interviewPolicy: {
            maxFollowUpsPerQuestion: settings.maxFollowUpsPerQuestion,
        },
        interviewProvider: settings.provider,
        interviewPlan: demoInterviewPlan(plan, job, settings),
        source: {
            system: 'recruit-ai-platform',
            applicationId: application.id,
            attemptId: attempt?.id || '',
            jobId: application.jobId,
            candidateId: application.candidateId,
            candidateName: candidate?.name || '',
        },
    };
}

function demoCandidateEntryUrl({sessionId, token = '', returnUrl = ''}, publicUrls = {}) {
    const base = demoPublicBaseUrl(publicUrls);
    if (!base) return '';
    const url = new URL('/', `${base}/`);
    url.searchParams.set('sessionId', sessionId);
    if (token) url.searchParams.set('entryToken', token);
    if (returnUrl) url.searchParams.set('returnUrl', returnUrl);
    return url.toString();
}

function demoSessionIdFromRef(sessionRef = '') {
    const match = String(sessionRef || '').match(/^interview:\/\/browser-demo\/(.+)$/);
    return match?.[1] || '';
}

function demoSessionIdFromAttempt(attempt = {}) {
    return attempt.demo?.sessionId || demoSessionIdFromRef(attempt.sessionRef);
}

function hasDemoSessionEntry(attempt = {}) {
    return Boolean(attempt.demo?.sessionId && attempt.demo?.entryUrl);
}

async function isDemoSessionReady(application = {}, attempt = {}) {
    if (!application?.id || !hasDemoSessionEntry(attempt)) return false;
    const [plan, job] = await Promise.all([
        planById(attempt.planId).then((item) => item || latestPlan(application.id)),
        getJob(application.jobId),
    ]);
    return !isInterviewPlanStale(application, plan) && interviewPlanReadiness(plan, job).ready;
}

function needsDemoPullSync(application = {}) {
    const status = application.aiInterview?.status || application.interviewStatus;
    if (![interviewStatus.pending, interviewStatus.inProgress].includes(status)) return false;
    return Boolean(application.aiInterview?.demo?.sessionId || demoSessionIdFromRef(application.aiInterview?.sessionRef || application.interviewSessionRef));
}

function bridgePayloadFromDemoSession(session = {}, attempt = {}) {
    const report = session.report;
    if (!session.id || !report) return null;
    const reportRef = `interview://browser-demo/${session.id}/report`;
    const reportBody = typeof report === 'string'
        ? {ref: reportRef, title: 'AI 面试报告', text: report}
        : {
            ref: report.ref || reportRef,
            title: report.title || 'AI 面试报告',
            ...report,
        };
    return {
        status: interviewStatus.completed,
        applicationId: attempt.applicationId,
        attemptId: attempt.id,
        sessionId: session.id,
        sessionRef: `interview://browser-demo/${session.id}`,
        reportRef,
        reportSummary: reportBody.summary || reportBody.reportSummary || '',
        recommendation: reportBody.recommendation || '',
        report: reportBody,
        riskNotes: reportBody.riskNotes || [],
        bonusNotes: reportBody.bonusNotes || [],
        fullTrace: traceFromDemoSession(session),
        demo: {
            sessionId: session.id,
            mode: session.mode || 'browser_demo',
            updatedAt: session.updatedAt || '',
            pulledAt: new Date().toISOString(),
        },
    };
}

function demoSessionClosed(session = {}) {
    const status = String(session.status || '').toLowerCase();
    const phase = String(session.phase || '').toLowerCase();
    return ['closed', 'done', 'completed'].includes(status)
        || ['closed', 'done', 'completed'].includes(phase);
}

async function ensureDemoSessionReport(sessionId, session = {}) {
    if (!demoSessionClosed(session) || session.report) return session;
    const payload = await postJson(
        demoUrl('/api/report'),
        {sessionId, background: true},
        {timeoutMs: Math.min(Math.max(appConfig.interviewDemo.timeoutMs || 0, 2500), 5000)}
    );
    if (payload?.session) return payload.session;
    if (payload?.report) {
        return {
            ...session,
            report: payload.report,
            updatedAt: payload.report.at || payload.report.generatedAt || session.updatedAt,
        };
    }
    return session;
}

function traceFromDemoSession(session = {}) {
    const turns = Array.isArray(session.turns) ? session.turns : [];
    return {
        sessionId: session.id || '',
        status: session.status || '',
        startedAt: session.startedAt || session.createdAt || '',
        completedAt: session.endedAt || session.report?.createdAt || '',
        questionCount: Array.isArray(session.questionBank) ? session.questionBank.length : 0,
        turnCount: turns.length,
        turns: turns.map((turn) => ({
            questionId: turn.questionId || '',
            questionIndex: turn.questionIndex,
            questionText: turn.questionText || '',
            answerText: turn.answerText || '',
            decision: turn.decision || {},
            decisionSource: turn.decisionSource || '',
            isPlanQuestion: Boolean(turn.isPlanQuestion),
            turnType: turn.turnType || '',
            startedAt: turn.startedAt || '',
            endedAt: turn.endedAt || '',
        })),
    };
}

function normalizeFullTrace(value, body = {}) {
    if (Array.isArray(value)) {
        return {
            sessionId: body.sessionId || body.demo?.sessionId || '',
            status: body.status || '',
            completedAt: body.completedAt || body.demo?.updatedAt || '',
            turnCount: value.length,
            turns: value,
        };
    }
    return value || null;
}

export async function syncCompletedInterviewReportFromDemo(applicationOrId) {
    const application = typeof applicationOrId === 'string'
        ? await getApplication(applicationOrId)
        : applicationOrId;
    if (!application || !needsDemoPullSync(application)) {
        return {application, synced: false};
    }
    const attempt = await latestAttempt(application.id);
    if (!attempt || ![interviewStatus.pending, interviewStatus.inProgress].includes(attempt.status)) {
        return {application, attempt, synced: false};
    }
    const sessionId = demoSessionIdFromAttempt(attempt);
    if (!sessionId) {
        return {application, attempt, synced: false};
    }
    try {
        const payload = await getJson(demoUrl(`/api/agent-sessions/${encodeURIComponent(sessionId)}`));
        let session = payload.session || payload;
        if (!demoSessionClosed(session)) {
            return {application, attempt, synced: false};
        }
        session = await ensureDemoSessionReport(sessionId, session);
        if (!session.report) return {application, attempt, synced: false};
        const bridgePayload = bridgePayloadFromDemoSession(session, attempt);
        if (!bridgePayload) {
            return {application, attempt, synced: false};
        }
        const result = await updateInterviewFromBridge(bridgePayload);
        return {...result, synced: Boolean(result)};
    }
    catch (error) {
        return {application, attempt, synced: false, error};
    }
}

export async function syncCompletedInterviewReportsFromDemo(applications = []) {
    const syncedApplications = [];
    for (const application of applications) {
        if (!needsDemoPullSync(application)) {
            syncedApplications.push(application);
            continue;
        }
        const result = await syncCompletedInterviewReportFromDemo(application);
        syncedApplications.push(result.application || application);
    }
    return syncedApplications;
}

async function syncInProgressAttemptFromDemo(application, attempt) {
    if (!application || attempt?.status !== interviewStatus.inProgress) {
        return {application, attempt};
    }
    const result = await syncCompletedInterviewReportFromDemo(application);
    if (!result.synced) return {application, attempt};
    const nextApplication = result.application || await getApplication(application.id);
    return {
        application: nextApplication || application,
        attempt: await latestAttempt(application.id) || attempt,
    };
}

async function ensureDemoSession({application, attempt, token = '', markInProgress = false, publicUrls = {}}) {
    let currentApplication = application;
    let currentAttempt = attempt;
    const demo = currentAttempt.demo || {};
    let currentPlan = await planById(currentAttempt.planId).then((item) => item || latestPlan(currentApplication.id));
    let baseJob = await getJob(currentApplication.jobId);
    if (currentPlan && !isInterviewPlanStale(currentApplication, currentPlan)
        && currentApplication.interviewPlan?.id !== currentPlan.id) {
        currentApplication = await saveApplication({
            ...currentApplication,
            interviewPlan: planSummary(currentPlan),
        });
    }
    if (demo.sessionId && demo.entryUrl
        && !isInterviewPlanStale(currentApplication, currentPlan)
        && interviewPlanReadiness(currentPlan, baseJob).ready) {
        if (markInProgress && currentAttempt.status === interviewStatus.pending) {
            currentAttempt = await saveAttempt({
                ...currentAttempt,
                status: interviewStatus.inProgress,
                startedAt: currentAttempt.startedAt || new Date().toISOString(),
            });
        }
        const returnUrl = token
            ? mainUrl(`/interview/${encodeURIComponent(currentAttempt.id)}?token=${encodeURIComponent(token)}`, publicUrls)
            : mainUrl('/candidate', publicUrls);
        const demoEntryUrl = demoCandidateEntryUrl({sessionId: demo.sessionId, token, returnUrl}, publicUrls) || demo.entryUrl;
        return {application: currentApplication, attempt: currentAttempt, demoEntryUrl};
    }
    if (isInterviewPlanStale(currentApplication, currentPlan) || !interviewPlanReadiness(currentPlan, baseJob).ready) {
        const refreshed = await generateInterviewPlan(currentApplication.id, {
            force: true,
            actorType: 'system',
            actorId: 'material-refresh',
        });
        currentApplication = refreshed.application || currentApplication;
        currentPlan = refreshed.interviewPlan || currentPlan;
        baseJob = await getJob(currentApplication.jobId);
        assertExecutableInterviewPlan(currentPlan, baseJob);
        currentAttempt = await saveAttempt({
            ...currentAttempt,
            planId: currentPlan?.id || currentAttempt.planId,
            sessionRef: `session://pending-ai-module/${currentApplication.id}/attempt-${currentAttempt.attemptNo}`,
            reportRef: '',
            errorMessage: '',
            demo: {},
        });
    }
    const [candidate, plan] = await Promise.all([
        getCandidate(currentApplication.candidateId),
        Promise.resolve(currentPlan),
    ]);
    const knowledgeChunks = await listJobKnowledgeChunks(currentApplication.jobId, {limit: 12});
    const job = {...baseJob, knowledgeChunks};
    assertExecutableInterviewPlan(plan, job);
    const sessionId = `main-${currentAttempt.id}`;
    const projectSnapshot = buildDemoProjectSnapshot({application: currentApplication, job, candidate, plan, attempt: currentAttempt});
    const returnUrl = token
        ? mainUrl(`/interview/${encodeURIComponent(currentAttempt.id)}?token=${encodeURIComponent(token)}`, publicUrls)
        : mainUrl('/candidate', publicUrls);
    const callback = {
        statusCallbackUrl: mainUrl('/api/interview-bridge/status-callback', publicUrls),
        secret: appConfig.interviewBridge.callbackSecret,
        applicationId: currentApplication.id,
        attemptId: currentAttempt.id,
        returnUrl,
    };
    const payload = await postJson(demoUrl('/api/agent-sessions'), {
        sessionId,
        projectSnapshot,
        callback,
    });
    const resolvedSessionId = payload.session?.id || sessionId;
    const entryUrl = demoCandidateEntryUrl({sessionId: resolvedSessionId, token, returnUrl}, publicUrls);
    const nextStatus = markInProgress ? interviewStatus.inProgress : currentAttempt.status;
    const nextAttempt = await saveAttempt({
        ...currentAttempt,
        status: nextStatus,
        sessionRef: `interview://browser-demo/${resolvedSessionId}`,
        startedAt: markInProgress ? (currentAttempt.startedAt || new Date().toISOString()) : currentAttempt.startedAt,
        demo: {
            ...(currentAttempt.demo || {}),
            sessionId: resolvedSessionId,
            entryUrl,
            publicEntryUrl: currentAttempt.publicEntryUrl || currentAttempt.entryUrlPublic || '',
            llmUrl: payload.llmUrl || payload.session?.llmUrl || '',
            mode: 'browser_demo',
            createdAt: new Date().toISOString(),
            projectSnapshot: {
                source: projectSnapshot.source,
                generation: projectSnapshot.generation,
                interviewPolicy: projectSnapshot.interviewPolicy,
                interviewPlan: {
                    title: projectSnapshot.interviewPlan.title,
                    questionCount: projectSnapshot.interviewPlan.questions.length,
                },
            },
        },
    });
    return {application: currentApplication, attempt: nextAttempt, demoEntryUrl: entryUrl};
}

export async function getInterviewPlan(applicationId) {
    const [application, plan] = await Promise.all([
        getApplication(applicationId),
        latestPlan(applicationId),
    ]);
    if (!application || isInterviewPlanStale(application, plan)) return null;
    return plan;
}

export async function generateInterviewPlan(applicationId, {force = false, actorType = 'admin', actorId = 'local-admin'} = {}) {
    const application = await getApplication(applicationId);
    if (!application) return null;
    const existing = await latestPlan(applicationId);
    if (existing && !force && !isInterviewPlanStale(application, existing)) {
        const applicationWithPlan = application.interviewPlan?.id === existing.id
            ? application
            : await saveApplication({...application, interviewPlan: planSummary(existing)});
        return {application: applicationWithPlan, interviewPlan: existing};
    }
    const [baseJob, candidate, knowledgeChunks] = await Promise.all([
        getJob(application.jobId),
        getCandidate(application.candidateId),
        listJobKnowledgeChunks(application.jobId, {limit: 12}),
    ]);
    const job = {...baseJob, knowledgeChunks};
    const output = await generateInterviewPlanOutput({
        job,
        candidate,
        application,
        evidencePack: application.evidencePack || {},
        prescreen: application.prescreen || {},
    });
    const now = new Date().toISOString();
    assertExecutableInterviewPlan(output, job);
    const plan = await savePlan({
        id: newId('iplan'),
        applicationId,
        status: 'ready',
        version: 'interview-plan-v1',
        title: output.title,
        durationMinutes: output.durationMinutes,
        focusAreas: output.focusAreas,
        questions: output.questions.map((question, index) => ({
            ...question,
            id: question.id || `q${index + 1}`,
        })),
        closingPrompt: output.closingPrompt,
        riskNotes: output.riskNotes,
        materialFingerprint: materialFingerprint(application),
        generatedAt: now,
    });
    const next = await saveApplication({
        ...application,
        interviewPlan: planSummary(plan),
    });
    await writeAuditLog({
        actorType,
        actorId,
        action: 'interview_plan.generated',
        aggregateType: 'Application',
        aggregateId: applicationId,
        detail: {planId: plan.id, questionCount: plan.questions.length},
    });
    return {application: next, interviewPlan: plan};
}

export async function createInterviewInvitation(applicationId, body = {}, options = {}) {
    const application = await getApplication(applicationId);
    if (!application) return null;
    const job = await getJob(application.jobId);
    const publicUrls = options.publicUrls || {};
    const actorType = body.actorType || 'admin';
    const actorId = body.actorId || 'local-admin';
    const needsMoreMaterials = application.status === applicationStatus.needMaterials
        || /补材料|材料不足|信息不足/.test([
            application.screen,
            application.prescreen?.recommendation,
            application.prescreen?.summary,
        ].filter(Boolean).join(' '));
    const forced = body.force === true;
    const forceReason = String(body.forceReason || '人工强制邀请').trim();
    if (needsMoreMaterials && !forced) {
        throw new InterviewFlowError(
            '该候选人当前需要补材料，默认不发起 AI 面试；如需继续，请使用人工强制邀请并记录原因',
            409,
            'need_material_before_interview'
        );
    }
    const planResult = await generateInterviewPlan(applicationId, {
        force: body.forcePlan === true,
        actorType,
        actorId,
    });
    const plan = planResult.interviewPlan;
    assertExecutableInterviewPlan(plan, job);
    const currentAttempt = await latestAttempt(applicationId);
    const attemptNo = Number(currentAttempt?.attemptNo || 0) + 1;
    const token = randomBytes(24).toString('hex');
    const {validDays, expiresAt} = invitationExpiryForJob(job, body);
    const attemptId = newId('iattempt');
    const entryUrl = publicInterviewEntryUrl(attemptId, publicUrls);
    const publicEntryUrl = `${entryUrl}${entryUrl.includes('?') ? '&' : '?'}token=${token}`;
    const invitedAt = new Date().toISOString();
    let attempt = await saveAttempt({
        id: attemptId,
        applicationId,
        planId: plan.id,
        attemptNo,
        status: interviewStatus.pending,
        entryTokenHash: hashToken(token),
        entryUrl,
        publicEntryUrl,
        sessionRef: `session://pending-ai-module/${applicationId}/attempt-${attemptNo}`,
        reportRef: '',
        errorMessage: '',
        invitedAt,
        expiresAt,
        startedAt: '',
        completedAt: '',
        forced,
        forceReason: forced ? forceReason : '',
        invitationValidDays: validDays,
    });
    try {
        const prepared = await ensureDemoSession({
            application: planResult.application,
            attempt,
            token,
            publicUrls,
        });
        attempt = prepared.attempt || attempt;
    }
    catch (error) {
        await saveAttempt({
            ...attempt,
            status: interviewStatus.failed,
            errorMessage: error.message || 'AI 面试间准备失败',
        });
        throw error;
    }
    const isManualAdminInvite = forced
        || body.manualPrescreenPass === true
        || ['admin', 'local-admin'].includes(actorType);
    const existingPrescreen = planResult.application.prescreen || application.prescreen || {};
    const nextPrescreen = isManualAdminInvite
        ? {
            ...existingPrescreen,
            status: prescreenStatus.overridden,
            recommendation: existingPrescreen.recommendation || '推荐 AI 面试',
            adminSuggestion: existingPrescreen.adminSuggestion || '发起 AI 面试',
            generatedAt: existingPrescreen.generatedAt || invitedAt,
            updatedAt: invitedAt,
            manualInvite: {
                invitedAt,
                forced,
                reason: forced ? forceReason : '',
            },
        }
        : existingPrescreen;
    const next = await saveApplication({
        ...planResult.application,
        status: applicationStatus.needInterview,
        screen: '推荐 AI 面试',
        prescreen: nextPrescreen,
        interview: forced ? '已人工强制邀请' : (attemptNo > 1 ? '待再次面试' : '已邀请'),
        interviewStatus: interviewStatus.pending,
        reviewStatus: reviewStatus.none,
        interviewSessionRef: attempt.sessionRef,
        reviewReportRef: attempt.reportRef,
        interviewPlan: planSummary(plan),
        aiInterview: {
            ...attemptSummary(attempt, '', publicUrls),
            forced,
            forceReason: forced ? forceReason : '',
            candidateResponse: {
                status: 'pending',
                respondedAt: '',
                note: '',
            },
            rescheduleRequest: {
                status: 'none',
                reason: '',
            },
        },
    });
    await writeAuditLog({
        actorType,
        actorId,
        action: 'ai_interview.invited',
        aggregateType: 'Application',
        aggregateId: applicationId,
        detail: {attemptId: attempt.id, attemptNo, expiresAt, invitationValidDays: validDays, forced, forceReason: forced ? forceReason : '', prescreenOverridden: isManualAdminInvite},
    });
    if (!hasDemoSessionEntry(attempt)) {
        await addJob(queueNames.interviewSession, 'interview_session_prepare', {
            applicationId,
            attemptId: attempt.id,
            token,
        }).catch((error) => writeAuditLog({
            actorType: 'system',
            actorId: 'interview-bridge',
            action: 'interview_session.enqueue_failed',
            aggregateType: 'Application',
            aggregateId: applicationId,
            detail: {attemptId: attempt.id, message: error.message || String(error)},
        }));
    }
    return {application: next, interviewPlan: plan, attempt, entryToken: token, publicEntryUrl};
}

export async function prepareInterviewSession({applicationId, attemptId = '', token = ''} = {}) {
    const application = await getApplication(applicationId);
    if (!application) return null;
    const attempt = attemptId ? await attemptById(attemptId) : await latestAttempt(applicationId);
    if (!attempt || ![interviewStatus.pending, interviewStatus.inProgress].includes(attempt.status)) {
        return {applicationId, attemptId: attempt?.id || attemptId, prepared: false, reason: 'no_pending_attempt'};
    }
    if (attempt.expiresAt && new Date(attempt.expiresAt).getTime() < Date.now()) {
        return {applicationId, attemptId: attempt.id, prepared: false, reason: 'expired'};
    }
    const prepared = await ensureDemoSession({application, attempt, token});
    const preparedApplication = prepared.application || application;
    const next = await saveApplication({
        ...preparedApplication,
        status: applicationStatus.needInterview,
        interview: prepared.attempt.status === interviewStatus.inProgress ? '面试进行中' : preparedApplication.interview || '已邀请',
        interviewStatus: prepared.attempt.status,
        interviewSessionRef: prepared.attempt.sessionRef,
        aiInterview: {
            ...(preparedApplication.aiInterview || {}),
            ...attemptSummary(prepared.attempt),
            candidateResponse: preparedApplication.aiInterview?.candidateResponse,
            rescheduleRequest: preparedApplication.aiInterview?.rescheduleRequest,
        },
    });
    return {
        applicationId: next.id,
        attemptId: prepared.attempt.id,
        prepared: Boolean(prepared.demoEntryUrl),
        hasDemoEntryUrl: Boolean(prepared.demoEntryUrl),
    };
}

export async function acceptInterviewInvitation(applicationId, candidateId, body = {}) {
    const application = await getApplication(applicationId);
    if (!application) return null;
    assertCandidateOwnsApplication(application, candidateId);
    assertPendingInvitation(application);
    const now = new Date().toISOString();
    const previousReschedule = application.aiInterview?.rescheduleRequest || {status: 'none'};
    const rescheduleRequest = previousReschedule.status === 'requested'
        ? {
            ...previousReschedule,
            status: 'cancelled',
            cancelledAt: now,
            cancelReason: 'candidate_accepted_interview',
        }
        : previousReschedule;
    const candidateResponse = {
        status: 'accepted',
        respondedAt: now,
        acceptedAt: now,
        note: text(body.note),
    };
    const next = await saveApplication({
        ...application,
        interview: '候选人已确认',
        aiInterview: {
            ...(application.aiInterview || {}),
            candidateResponse,
            rescheduleRequest,
        },
    });
    await writeAuditLog({
        actorType: 'candidate',
        actorId: candidateId,
        action: 'ai_interview.accepted',
        aggregateType: 'Application',
        aggregateId: applicationId,
        detail: candidateResponse,
    });
    return {application: next, candidateResponse};
}

export async function requestInterviewReschedule(applicationId, candidateId, body = {}) {
    const application = await getApplication(applicationId);
    if (!application) return null;
    assertCandidateOwnsApplication(application, candidateId);
    assertPendingInvitation(application);
    const now = new Date().toISOString();
    const rescheduleRequest = {
        status: 'requested',
        reason: text(body.reason || body.note || '候选人申请调整 AI 面试时间'),
        preferredSlots: preferredSlotsFromBody(body),
        requestedAt: now,
        requestedBy: candidateId,
    };
    const candidateResponse = {
        status: 'reschedule_requested',
        respondedAt: now,
        reason: rescheduleRequest.reason,
    };
    const next = await saveApplication({
        ...application,
        interview: '候选人申请改期',
        aiInterview: {
            ...(application.aiInterview || {}),
            candidateResponse,
            rescheduleRequest,
        },
    });
    await writeAuditLog({
        actorType: 'candidate',
        actorId: candidateId,
        action: 'ai_interview.reschedule_requested',
        aggregateType: 'Application',
        aggregateId: applicationId,
        detail: rescheduleRequest,
    });
    return {application: next, rescheduleRequest};
}

export async function decideInterviewReschedule(applicationId, body = {}) {
    const application = await getApplication(applicationId);
    if (!application) return null;
    const currentRequest = application.aiInterview?.rescheduleRequest || {status: 'none'};
    if (currentRequest.status !== 'requested') {
        throw new InterviewFlowError('当前没有待处理的 AI 面试改期申请', 409, 'reschedule_request_not_pending');
    }
    const decision = normalizeDecision(body);
    const now = new Date().toISOString();
    const rescheduleRequest = {
        ...currentRequest,
        status: decision,
        decision,
        adminNote: text(body.note || body.adminNote),
        decidedAt: now,
        reviewedAt: now,
        reviewedBy: body.actorId || 'local-admin',
        scheduledAt: text(body.scheduledAt || body.newScheduledAt),
    };
    let nextAttempt = null;
    let aiInterview = {
        ...(application.aiInterview || {}),
        rescheduleRequest,
    };
    const nextExpiresAt = text(body.expiresAt || body.newExpiresAt);
    const nextEntryUrl = text(body.entryUrl);
    if (decision === 'approved' && (nextExpiresAt || nextEntryUrl)) {
        const attempt = await latestAttempt(applicationId);
        if (attempt) {
            nextAttempt = await saveAttempt({
                ...attempt,
                expiresAt: nextExpiresAt || attempt.expiresAt,
                entryUrl: nextEntryUrl || attempt.entryUrl,
            });
            aiInterview = {
                ...aiInterview,
                ...attemptSummary(nextAttempt),
                candidateResponse: aiInterview.candidateResponse,
                rescheduleRequest,
            };
        }
    }
    const next = await saveApplication({
        ...application,
        interview: decision === 'approved' ? '已同意改期' : '改期已拒绝',
        aiInterview,
    });
    await writeAuditLog({
        actorType: 'admin',
        actorId: body.actorId || 'local-admin',
        action: 'ai_interview.reschedule_decided',
        aggregateType: 'Application',
        aggregateId: applicationId,
        detail: {
            decision,
            rescheduleRequest,
            expiresAt: nextAttempt?.expiresAt || application.aiInterview?.expiresAt || '',
        },
    });
    return {application: next, rescheduleRequest, attempt: nextAttempt};
}

export async function getCandidateInterviewEntry(applicationId, candidateId, options = {}) {
    let application = await getApplication(applicationId);
    if (!application || application.candidateId !== candidateId) return null;
    const publicUrls = options.publicUrls || {};
    let attempt = await latestAttempt(applicationId);
    if (!attempt || ![interviewStatus.pending, interviewStatus.inProgress, interviewStatus.completed].includes(attempt.status)) {
        return {
            application,
            entry: null,
            reason: '当前没有可进入的 AI 面试邀请。',
        };
    }
    ({application, attempt} = await syncInProgressAttemptFromDemo(application, attempt));
    if (attempt.status !== interviewStatus.completed && attempt.expiresAt && new Date(attempt.expiresAt).getTime() < Date.now()) {
        return {
            application,
            entry: null,
            reason: 'AI 面试邀请已过期，请联系招聘者重新邀请。',
        };
    }
    if (attempt.status === interviewStatus.completed) {
        return {
            application,
            entry: {
                status: attempt.status,
                attemptNo: attempt.attemptNo,
                entryUrl: '',
                sessionRef: attempt.sessionRef,
                expiresAt: attempt.expiresAt,
                reportRef: attempt.reportRef,
                note: '这次 AI 面试已经完成，招聘团队会继续查看报告。',
            },
        };
    }
    const summary = attemptSummary(attempt, '', publicUrls);
    const demoReady = await isDemoSessionReady(application, attempt);
    const state = attempt.status === interviewStatus.inProgress
        ? 'started'
        : demoReady ? 'ready' : 'preparing';
    return {
        application: {
            ...application,
            aiInterview: {
                ...(application.aiInterview || {}),
                ...summary,
                preparationStatus: state,
            },
        },
        entry: {
            status: attempt.status,
            attemptNo: attempt.attemptNo,
            entryUrl: summary.publicEntryUrl || summary.entryUrl,
            publicEntryUrl: summary.publicEntryUrl,
            sessionRef: attempt.sessionRef,
            expiresAt: attempt.expiresAt,
            prepared: demoReady,
            note: attempt.status === interviewStatus.inProgress
                ? '本次 AI 面试已开始，不能重新开始。若误关闭页面，请联系招聘团队处理。'
                : demoReady
                    ? '面试间已准备好；进入后点击开始面试才会记为正式开始。'
                    : '面试间准备中，准备好后即可进入。',
        },
        state,
    };
}

async function applyOpenedInterviewEntryState({application, attempt, demoEntryUrl, token = '', publicUrls = {}, actorType = 'candidate', actorId = ''}) {
    const now = new Date().toISOString();
    const summary = attemptSummary(attempt, token, publicUrls);
    const next = await saveApplication({
        ...application,
        status: applicationStatus.needInterview,
        interview: application.interview || '已邀请',
        interviewStatus: attempt.status,
        interviewSessionRef: attempt.sessionRef,
        aiInterview: {
            ...(application.aiInterview || {}),
            ...summary,
            candidateResponse: {
                ...(application.aiInterview?.candidateResponse || {}),
                status: 'room_opened',
                openedAt: application.aiInterview?.candidateResponse?.openedAt || now,
            },
            rescheduleRequest: application.aiInterview?.rescheduleRequest,
        },
    });
    await writeAuditLog({
        actorType,
        actorId: actorId || 'candidate',
        action: 'ai_interview.room_opened',
        aggregateType: 'Application',
        aggregateId: application.id,
        detail: {attemptId: attempt.id, attemptNo: attempt.attemptNo, sessionRef: attempt.sessionRef},
    });
    return {
        application: next,
        entry: {
            status: attempt.status,
            attemptNo: attempt.attemptNo,
            entryUrl: demoEntryUrl,
            publicEntryUrl: publicEntryUrlForAttempt(attempt, token, publicUrls),
            sessionRef: attempt.sessionRef,
            expiresAt: attempt.expiresAt,
            note: 'AI 面试间已打开；进入后点击开始面试才会记为正式开始。',
        },
        state: 'ready',
    };
}

function blockedInterviewStartResponse({application, attempt, token = '', publicUrls = {}, state = 'started', reason = ''}) {
    return {
        application: {
            ...application,
            interviewStatus: attempt?.status || application?.interviewStatus || '',
            aiInterview: attempt
                ? {
                    ...(application?.aiInterview || {}),
                    ...attemptSummary(attempt, token, publicUrls),
                }
                : application?.aiInterview,
        },
        entry: null,
        state,
        reason,
    };
}

export async function startCandidateInterviewEntry(applicationId, candidateId, options = {}) {
    let application = await getApplication(applicationId);
    if (!application || application.candidateId !== candidateId) return null;
    const publicUrls = options.publicUrls || {};
    let attempt = await latestAttempt(applicationId);
    if (!attempt) {
        return blockedInterviewStartResponse({
            application,
            attempt: null,
            state: 'not_found',
            reason: '当前没有可开始的 AI 面试邀请。',
        });
    }
    if (attempt.expiresAt && new Date(attempt.expiresAt).getTime() < Date.now()) {
        return blockedInterviewStartResponse({
            application,
            attempt,
            publicUrls,
            state: 'expired',
            reason: 'AI 面试邀请已过期，请联系招聘者重新发送。',
        });
    }
    ({application, attempt} = await syncInProgressAttemptFromDemo(application, attempt));
    if (attempt.status !== interviewStatus.pending) {
        const reason = attempt.status === interviewStatus.inProgress
            ? '本次 AI 面试已开始，不能重新开始。若误关闭页面，请联系招聘团队处理。'
            : attempt.status === interviewStatus.completed
                ? '这次 AI 面试已经完成，感谢参与。'
                : attempt.errorMessage || '当前不能开始 AI 面试，请联系招聘者。';
        return blockedInterviewStartResponse({
            application,
            attempt,
            publicUrls,
            state: attempt.status === interviewStatus.inProgress ? 'started' : attempt.status,
            reason,
        });
    }
    const prepared = await ensureDemoSession({application, attempt, publicUrls});
    return applyOpenedInterviewEntryState({
        application: prepared.application || application,
        attempt: prepared.attempt,
        demoEntryUrl: prepared.demoEntryUrl,
        publicUrls,
        actorType: 'candidate',
        actorId: candidateId,
    });
}

export async function getPublicInterviewEntry(attemptId, token = '', options = {}) {
    let attempt = await attemptById(attemptId);
    if (!attempt) {
        throw new InterviewFlowError('AI 面试邀请不存在或已被删除。', 404, 'interview_entry_not_found');
    }
    if (!token || hashToken(token) !== attempt.entryTokenHash) {
        throw new InterviewFlowError('AI 面试链接无效，请确认是否使用了完整邀请链接。', 403, 'invalid_interview_entry_token');
    }
    let application = await getApplication(attempt.applicationId);
    if (!application) {
        throw new InterviewFlowError('这次投递不存在或已被删除。', 404, 'application_not_found');
    }
    ({application, attempt} = await syncInProgressAttemptFromDemo(application, attempt));
    const [job, candidate] = await Promise.all([
        getJob(application.jobId),
        getCandidate(application.candidateId),
    ]);
    const publicUrls = options.publicUrls || {};
    const publicApplication = {
        id: application.id,
        jobId: application.jobId,
        jobTitle: job?.title || '岗位',
        candidateName: candidate?.name || '候选人',
        material: application.material || '',
        status: application.status,
        interviewStatus: attempt.status,
        aiInterview: attemptSummary(attempt, token, publicUrls),
    };
    if (attempt.status === interviewStatus.completed) {
        return {
            application: publicApplication,
            entry: null,
            state: 'completed',
            reason: '这次 AI 面试已经完成，感谢参与。',
        };
    }
    if (attempt.expiresAt && new Date(attempt.expiresAt).getTime() < Date.now()) {
        return {
            application: publicApplication,
            entry: null,
            state: 'expired',
            reason: 'AI 面试邀请已过期，请联系招聘者重新发送。',
        };
    }
    if (attempt.status === interviewStatus.failed) {
        return {
            application: publicApplication,
            entry: null,
            state: 'failed',
            reason: attempt.errorMessage || 'AI 面试入口暂时不可用，请联系招聘者。',
        };
    }
    if (attempt.status === interviewStatus.inProgress) {
        return {
            application: publicApplication,
            entry: null,
            state: 'started',
            reason: '本次 AI 面试已开始，不能重新开始。若误关闭页面，请联系招聘团队处理。',
        };
    }
    const demoReady = await isDemoSessionReady(application, attempt);
    const preparationState = demoReady ? 'ready' : 'preparing';
    const summary = attemptSummary(attempt, token, publicUrls);
    const openedAt = application.aiInterview?.candidateResponse?.openedAt || new Date().toISOString();
    const next = await saveApplication({
        ...application,
        status: applicationStatus.needInterview,
        interview: application.interview || '已邀请',
        interviewStatus: attempt.status,
        interviewSessionRef: attempt.sessionRef,
        aiInterview: {
            ...(application.aiInterview || {}),
            ...summary,
            preparationStatus: preparationState,
            candidateResponse: {
                ...(application.aiInterview?.candidateResponse || {}),
                status: application.aiInterview?.candidateResponse?.status || 'opened',
                openedAt,
            },
            rescheduleRequest: application.aiInterview?.rescheduleRequest,
        },
    });
    return {
        application: {
            ...publicApplication,
            status: next.status,
            interviewStatus: next.interviewStatus,
            aiInterview: {
                ...summary,
                preparationStatus: preparationState,
            },
        },
        entry: {
            status: attempt.status,
            attemptNo: attempt.attemptNo,
            entryUrl: publicEntryUrlForAttempt(attempt, token, publicUrls),
            publicEntryUrl: publicEntryUrlForAttempt(attempt, token, publicUrls),
            sessionRef: attempt.sessionRef,
            expiresAt: attempt.expiresAt,
            prepared: demoReady,
            note: demoReady
                ? '面试间已准备好；进入后点击开始面试才会记为正式开始。'
                : '面试间准备中，准备好后即可进入。',
        },
        state: preparationState,
    };
}

export async function startPublicInterviewEntry(attemptId, token = '', options = {}) {
    let attempt = await attemptById(attemptId);
    if (!attempt) {
        throw new InterviewFlowError('AI 面试邀请不存在或已被删除。', 404, 'interview_entry_not_found');
    }
    if (!token || hashToken(token) !== attempt.entryTokenHash) {
        throw new InterviewFlowError('AI 面试链接无效，请确认是否使用了完整邀请链接。', 403, 'invalid_interview_entry_token');
    }
    let application = await getApplication(attempt.applicationId);
    if (!application) {
        throw new InterviewFlowError('这次投递不存在或已被删除。', 404, 'application_not_found');
    }
    const publicUrls = options.publicUrls || {};
    ({application, attempt} = await syncInProgressAttemptFromDemo(application, attempt));
    if (attempt.expiresAt && new Date(attempt.expiresAt).getTime() < Date.now()) {
        return blockedInterviewStartResponse({
            application,
            attempt,
            token,
            publicUrls,
            state: 'expired',
            reason: 'AI 面试邀请已过期，请联系招聘者重新发送。',
        });
    }
    if (attempt.status !== interviewStatus.pending) {
        const reason = attempt.status === interviewStatus.inProgress
            ? '本次 AI 面试已开始，不能重新开始。若误关闭页面，请联系招聘团队处理。'
            : attempt.status === interviewStatus.completed
                ? '这次 AI 面试已经完成，感谢参与。'
                : attempt.errorMessage || '当前不能开始 AI 面试，请联系招聘者。';
        return blockedInterviewStartResponse({
            application,
            attempt,
            token,
            publicUrls,
            state: attempt.status === interviewStatus.inProgress ? 'started' : attempt.status,
            reason,
        });
    }
    const prepared = await ensureDemoSession({application, attempt, token, publicUrls});
    return applyOpenedInterviewEntryState({
        application: prepared.application || application,
        attempt: prepared.attempt,
        demoEntryUrl: prepared.demoEntryUrl,
        token,
        publicUrls,
        actorType: 'candidate',
        actorId: 'public-link',
    });
}

export async function updateInterviewFromBridge(body = {}) {
    const applicationId = body.applicationId;
    const application = await getApplication(applicationId);
    if (!application) return null;
    const attempt = body.attemptId
        ? normalizeAttempt((await query('SELECT * FROM interview_attempts WHERE id = $1', [body.attemptId])).rows[0])
        : await latestAttempt(applicationId);
    if (!attempt) return null;
    const now = new Date().toISOString();
    const status = body.status || attempt.status;
    const report = body.report || body.aiInterview?.report || null;
    const structured = report && typeof report === 'object' && !Array.isArray(report) ? report.structured || null : null;
    const rawReportText = compactText(
        (typeof report === 'string' ? report : report?.text) || body.reportText || body.reportSummary || body.interviewReportSummary,
        4000
    );
    const recommendation = normalizeInterviewRecommendation(
        structured?.recommendation || report?.recommendation || body.recommendation,
        rawReportText
    );
    const decisionReason = compactReportText(
        structured?.decisionReason || report?.decisionReason || body.decisionReason,
        structured?.summary || report?.summary || body.reportSummary || rawReportText,
        180
    );
    const interviewQuality = structured?.interviewQuality || report?.interviewQuality || body.interviewQuality || null;
    const evidenceSummary = reportList(4, structured?.evidenceSummary, report?.evidenceSummary, body.evidenceSummary);
    const followUpQuestions = reportList(4, structured?.followUpQuestions, report?.followUpQuestions, body.followUpQuestions);
    const questionAssessments = Array.isArray(structured?.questionAssessments)
        ? structured.questionAssessments
        : Array.isArray(report?.questionAssessments)
            ? report.questionAssessments
            : Array.isArray(body.questionAssessments)
                ? body.questionAssessments
                : [];
    const reportSummary = compactReportText(
        structured?.summary || report?.summary || body.reportSummary || body.interviewReportSummary,
        decisionReason || rawReportText,
        140
    );
    const riskNotes = reportList(4, structured?.riskNotes, report?.riskNotes, body.riskNotes);
    const bonusNotes = reportList(4, structured?.bonusNotes, report?.bonusNotes, body.bonusNotes);
    const fullTrace = normalizeFullTrace(body.fullTrace || body.trace, body);
    const demo = {
        ...(attempt.demo || {}),
        ...(body.demo || {}),
        sessionId: body.sessionId || body.demo?.sessionId || attempt.demo?.sessionId || '',
        recommendation,
        decisionReason,
        interviewQuality,
        evidenceSummary,
        followUpQuestions,
        questionAssessments,
        reportSummary,
        report,
        riskNotes,
        bonusNotes,
        fullTrace,
        syncedAt: now,
    };
    const nextAttempt = await saveAttempt({
        ...attempt,
        status,
        sessionRef: body.sessionRef || attempt.sessionRef,
        reportRef: body.reportRef || attempt.reportRef,
        errorMessage: body.errorMessage || '',
        recommendation,
        decisionReason,
        interviewQuality,
        evidenceSummary,
        followUpQuestions,
        questionAssessments,
        reportSummary,
        report,
        riskNotes,
        bonusNotes,
        fullTrace,
        demo,
        startedAt: status === interviewStatus.inProgress ? (attempt.startedAt || now) : attempt.startedAt,
        completedAt: [interviewStatus.completed, interviewStatus.failed].includes(status) ? now : attempt.completedAt,
    });
    const next = await saveApplication({
        ...application,
        status: status === interviewStatus.completed ? applicationStatus.needReview : application.status,
        interview: status === interviewStatus.completed ? '已完成' : application.interview,
        interviewStatus: status,
        reviewStatus: status === interviewStatus.completed ? reviewStatus.pending : application.reviewStatus,
        interviewSessionRef: nextAttempt.sessionRef,
        reviewReportRef: nextAttempt.reportRef || application.reviewReportRef,
        aiInterview: {
            ...(application.aiInterview || {}),
            ...attemptSummary(nextAttempt),
            candidateResponse: application.aiInterview?.candidateResponse,
            rescheduleRequest: application.aiInterview?.rescheduleRequest,
            recommendation,
            decisionReason,
            interviewQuality,
            evidenceSummary,
            followUpQuestions,
            questionAssessments,
            reportSummary,
            report,
            riskNotes,
            bonusNotes,
            fullTrace,
        },
    });
    await writeAuditLog({
        actorType: 'system',
        actorId: 'interview-bridge',
        action: 'ai_interview.status_callback',
        aggregateType: 'Application',
        aggregateId: applicationId,
        detail: {attemptId: nextAttempt.id, status, reportRef: nextAttempt.reportRef},
    });
    return {application: next, attempt: nextAttempt};
}
