import {newId} from '../../domain/contracts.js';
import {query} from '../../storage/db.js';
import {getCandidate} from '../candidates/service.js';
import {getJob} from '../jobs/service.js';
import {generateConsultationAnswer, generateConsultationAnswerStream} from '../ai-gateway/service.js';

const adminIntentPattern = /联系|人工|HR|hr|招聘者|客服|重发|再次|重新.*面试|面试邀请|补材料|更新材料/;

function normalizeMessage(message = {}) {
    const kind = message.kind || (message.who === 'assistant' ? 'ai_answer' : 'candidate_question');
    const needsAdmin = Boolean(message.needsAdmin || ['hr_request'].includes(kind));
    return {
        id: message.id || newId('msg'),
        who: message.who || 'assistant',
        kind,
        text: String(message.text || ''),
        createdAt: message.createdAt || new Date().toISOString(),
        ...(message.title ? {title: message.title} : {}),
        ...(message.citations ? {citations: message.citations} : {}),
        ...(message.confidenceNote ? {confidenceNote: message.confidenceNote} : {}),
        ...(message.applicationId ? {applicationId: message.applicationId} : {}),
        ...(message.materialKind ? {materialKind: message.materialKind} : {}),
        ...(message.materialUpdateRequestId ? {materialUpdateRequestId: message.materialUpdateRequestId} : {}),
        ...(message.readByCandidateAt ? {readByCandidateAt: message.readByCandidateAt} : {}),
        ...(message.readByAdminAt ? {readByAdminAt: message.readByAdminAt} : {}),
        ...(message.resolvedAt ? {resolvedAt: message.resolvedAt} : {}),
        ...(needsAdmin ? {needsAdmin: true} : {}),
    };
}

function enrichSession(raw = {}) {
    const messages = (raw.messages || []).map(normalizeMessage);
    const lastMessageAt = messages.reduce((latest, message) => (
        !latest || new Date(message.createdAt).getTime() > new Date(latest).getTime()
            ? message.createdAt
            : latest
    ), raw.updatedAt || raw.createdAt || '');
    const adminUnreadCount = messages.filter((message) => (
        ['candidate_question', 'hr_request'].includes(message.kind)
        && !message.readByAdminAt
    )).length;
    const candidateUnreadCount = messages.filter((message) => (
        ['admin_reply', 'system_notice', 'interview_invite', 'material_request'].includes(message.kind)
        && !message.readByCandidateAt
    )).length;
    return {
        id: raw.id,
        jobId: raw.jobId,
        candidateId: raw.candidateId,
        visits: raw.visits || 0,
        messages,
        lastMessageAt,
        adminUnreadCount,
        candidateUnreadCount,
        needsAdminReply: messages.some((message) => message.needsAdmin && !message.resolvedAt),
    };
}

function inferCandidateKind(text, explicitKind) {
    if (explicitKind && explicitKind !== 'candidate_question') return explicitKind;
    if (/联系|人工|HR|hr|招聘者|客服/.test(text)) return 'hr_request';
    if (adminIntentPattern.test(text)) return 'hr_request';
    return 'candidate_question';
}

function adminAckFor(kind) {
    if (kind === 'hr_request') {
        return '我已经把你的留言转给招聘者了。招聘者回复后，会继续出现在这个岗位聊天里。';
    }
    return '';
}

function jobKnowledgeChunks(job) {
    return (job.knowledge || [])
        .filter((source) => source.status === 'ready')
        .slice(0, 3)
        .map((source) => ({
            id: source.id,
            name: source.name,
            content: source.usage || source.name,
        }));
}

async function getOrCreateSession(jobId, candidateId) {
    const result = await query(
        'SELECT * FROM consultation_sessions WHERE job_id = $1 AND candidate_id = $2',
        [jobId, candidateId]
    );
    if (result.rows[0]) return enrichSession(result.rows[0].data);
    const session = enrichSession({
        id: newId('consult'),
        jobId,
        candidateId,
        messages: [],
        visits: 0,
    });
    await query(
        `INSERT INTO consultation_sessions (id, job_id, candidate_id, data)
         VALUES ($1, $2, $3, $4)`,
        [session.id, jobId, candidateId, session]
    );
    return session;
}

async function saveSession(session) {
    const enriched = enrichSession(session);
    await query(
        'UPDATE consultation_sessions SET data = $2, updated_at = now() WHERE id = $1',
        [enriched.id, enriched]
    );
    return enriched;
}

export async function consultationsSummary(candidateId) {
    if (!candidateId) return {consultedJobIds: [], consultVisitsByJob: {}, consultMessagesByJob: {}};
    const result = await query(
        'SELECT * FROM consultation_sessions WHERE candidate_id = $1 ORDER BY updated_at DESC',
        [candidateId]
    );
    const summary = {
        consultedJobIds: [],
        consultVisitsByJob: {},
        consultMessagesByJob: {},
    };
    for (const row of result.rows) {
        const session = enrichSession(row.data);
        summary.consultedJobIds.push(session.jobId);
        summary.consultVisitsByJob[session.jobId] = session.visits || 0;
        summary.consultMessagesByJob[session.jobId] = session.messages || [];
    }
    return summary;
}

export async function markConsulted(jobId, greeting, candidateId) {
    if (!candidateId) return consultationsSummary(candidateId);
    const session = await getOrCreateSession(jobId, candidateId);
    if (greeting && session.messages[session.messages.length - 1]?.text !== greeting) {
        session.messages.push(normalizeMessage({
            who: 'assistant',
            kind: 'ai_answer',
            text: greeting,
        }));
    }
    session.visits = (session.visits || 0) + 1;
    await saveSession(session);
    return consultationsSummary(candidateId);
}

export async function consult(jobId, {question, kind}, candidateId) {
    if (!candidateId) return null;
    const job = await getJob(jobId);
    const candidate = await getCandidate(candidateId);
    if (!job || !candidate) return null;
    const session = await getOrCreateSession(jobId, candidate.id);
    const text = String(question || '').trim();
    const messageKind = inferCandidateKind(text, kind);
    const candidateMessage = normalizeMessage({
        who: 'candidate',
        kind: messageKind,
        text,
        needsAdmin: ['hr_request'].includes(messageKind),
    });
    session.messages.push(candidateMessage);

    let assistantMessage = null;
    const ack = adminAckFor(messageKind);
    if (ack) {
        assistantMessage = normalizeMessage({
            who: 'assistant',
            kind: 'system_notice',
            text: ack,
        });
    }
    else {
        const answer = await generateConsultationAnswer({
            job,
            question: text,
            chunks: jobKnowledgeChunks(job),
        });
        assistantMessage = normalizeMessage({
            who: 'assistant',
            kind: 'ai_answer',
            text: answer.answer,
            citations: answer.citations || [],
            confidenceNote: answer.confidenceNote || '',
        });
    }

    session.messages.push(assistantMessage);
    await saveSession(session);
    return {
        candidateMessage,
        assistantMessage,
        consultations: await consultationsSummary(candidate.id),
    };
}

export async function streamConsult(jobId, {question, kind}, candidateId, handlers = {}) {
    if (!candidateId) return null;
    const job = await getJob(jobId);
    const candidate = await getCandidate(candidateId);
    if (!job || !candidate) return null;
    const session = await getOrCreateSession(jobId, candidate.id);
    const text = String(question || '').trim();
    const messageKind = inferCandidateKind(text, kind);
    const candidateMessage = normalizeMessage({
        who: 'candidate',
        kind: messageKind,
        text,
        needsAdmin: ['hr_request'].includes(messageKind),
    });
    session.messages.push(candidateMessage);
    handlers.onCandidateMessage?.(candidateMessage);

    const ack = adminAckFor(messageKind);
    let assistantMessage;
    if (ack) {
        assistantMessage = normalizeMessage({
            who: 'assistant',
            kind: 'system_notice',
            text: ack,
        });
        handlers.onDelta?.(ack);
    }
    else {
        const answer = await generateConsultationAnswerStream({
            job,
            question: text,
            chunks: jobKnowledgeChunks(job),
            onDelta: handlers.onDelta,
        });
        assistantMessage = normalizeMessage({
            who: 'assistant',
            kind: 'ai_answer',
            text: answer.answer,
            citations: answer.citations || [],
            confidenceNote: answer.confidenceNote || '',
        });
    }

    session.messages.push(assistantMessage);
    handlers.onAssistantMessage?.(assistantMessage);
    await saveSession(session);
    return {
        candidateMessage,
        assistantMessage,
        consultations: await consultationsSummary(candidate.id),
    };
}

export async function listJobConsultations(jobId) {
    const result = await query(
        'SELECT * FROM consultation_sessions WHERE job_id = $1 ORDER BY updated_at DESC',
        [jobId]
    );
    const sessions = [];
    for (const row of result.rows) {
        const session = enrichSession(row.data);
        sessions.push({
            ...session,
            candidate: await getCandidate(session.candidateId),
        });
    }
    return sessions;
}

export async function ensureConsultationForApplication(application) {
    if (!application?.jobId || !application?.candidateId) return null;
    const session = await getOrCreateSession(application.jobId, application.candidateId);
    return {
        session,
        candidate: await getCandidate(session.candidateId),
        job: await getJob(session.jobId),
    };
}

export async function getConsultation(sessionId) {
    const result = await query('SELECT * FROM consultation_sessions WHERE id = $1', [sessionId]);
    if (!result.rows[0]) return null;
    const session = enrichSession(result.rows[0].data);
    return {
        session,
        candidate: await getCandidate(session.candidateId),
        job: await getJob(session.jobId),
    };
}

export async function sendAdminConsultationMessage(sessionId, {text, kind = 'admin_reply', applicationId = '', materialKind = '', materialUpdateRequestId = ''}) {
    const result = await query('SELECT * FROM consultation_sessions WHERE id = $1', [sessionId]);
    if (!result.rows[0]) return null;
    const now = new Date().toISOString();
    const session = enrichSession(result.rows[0].data);
    session.messages = session.messages.map((message) => (
        message.needsAdmin && !message.resolvedAt
            ? {...message, needsAdmin: false, resolvedAt: now, readByAdminAt: message.readByAdminAt || now}
            : message
    ));
    session.messages.push(normalizeMessage({
        who: 'admin',
        kind,
        text: String(text || '').trim(),
        createdAt: now,
        applicationId,
        materialKind,
        materialUpdateRequestId,
    }));
    const saved = await saveSession(session);
    return {
        session: saved,
        candidate: await getCandidate(saved.candidateId),
        job: await getJob(saved.jobId),
    };
}

export async function markAdminConsultationRead(sessionId) {
    const result = await query('SELECT * FROM consultation_sessions WHERE id = $1', [sessionId]);
    if (!result.rows[0]) return null;
    const now = new Date().toISOString();
    const session = enrichSession(result.rows[0].data);
    session.messages = session.messages.map((message) => (
        ['candidate_question', 'hr_request'].includes(message.kind)
            ? {...message, readByAdminAt: message.readByAdminAt || now}
            : message
    ));
    const saved = await saveSession(session);
    return {
        session: saved,
        candidate: await getCandidate(saved.candidateId),
        job: await getJob(saved.jobId),
    };
}

export async function markCandidateConsultationRead(jobId, candidateId) {
    if (!jobId || !candidateId) return consultationsSummary(candidateId);
    const result = await query(
        'SELECT * FROM consultation_sessions WHERE job_id = $1 AND candidate_id = $2',
        [jobId, candidateId]
    );
    if (!result.rows[0]) return consultationsSummary(candidateId);
    const now = new Date().toISOString();
    const session = enrichSession(result.rows[0].data);
    session.messages = session.messages.map((message) => (
        ['admin_reply', 'system_notice', 'interview_invite', 'material_request'].includes(message.kind)
            ? {...message, readByCandidateAt: message.readByCandidateAt || now}
            : message
    ));
    await saveSession(session);
    return consultationsSummary(candidateId);
}
