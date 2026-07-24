import {createHash} from 'node:crypto';
import {appConfig} from '../../storage/config.js';
import {query} from '../../storage/db.js';
import {candidateLoginSchema, candidateProfilePatchSchema, newId, uploadStatus} from '../../domain/contracts.js';
import {writeAuditLog} from '../audit/service.js';

export class CandidateAuthError extends Error {
    constructor(message, statusCode = 400, code = 'candidate_auth_error') {
        super(message);
        this.name = 'CandidateAuthError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

export function normalizeIdTail(idTail) {
    return String(idTail || '').trim().toUpperCase();
}

export function hashIdTail(idTail) {
    return createHash('sha256').update(`${appConfig.idHashSalt}:${normalizeIdTail(idTail)}`).digest('hex');
}

export function normalizeCandidate(row) {
    if (!row) return null;
    return {
        ...row.data,
        id: row.id,
        name: row.name,
        idTail: row.id_tail_hint ? `******${row.id_tail_hint}` : '',
    };
}

export async function listCandidates() {
    const result = await query('SELECT * FROM candidates ORDER BY created_at ASC');
    return result.rows.map(normalizeCandidate);
}

export async function getCandidate(candidateId) {
    const result = await query('SELECT * FROM candidates WHERE id = $1', [candidateId]);
    return normalizeCandidate(result.rows[0]);
}

function ensureCandidateShape(candidate) {
    const next = {...candidate};
    next.resumes ||= [];
    next.portfolios ||= [];
    next.knowledge ||= [];
    next.completeness ||= 20;
    if (!next.resumes.length && next.resume) {
        next.resumes = [{
            id: newId('resume'),
            name: next.resume,
            status: uploadStatus.ready,
            isDefault: true,
            updatedAt: '',
            summary: '从旧简历字段迁移而来。',
        }];
    }
    return next;
}

export async function saveCandidate(candidate, idTail = '') {
    const shaped = ensureCandidateShape(candidate);
    const normalizedIdTail = normalizeIdTail(idTail);
    const hash = normalizedIdTail ? hashIdTail(normalizedIdTail) : candidate.idTailHash || hashIdTail(candidate.idTail || candidate.id || 'seed');
    const hint = normalizedIdTail ? normalizedIdTail.slice(-2) : candidate.idTailHint || normalizeIdTail(candidate.idTail).slice(-2);
    const stored = {...shaped};
    delete stored.idTail;
    delete stored.idTailHash;
    delete stored.idTailHint;
    await query(
        `INSERT INTO candidates (id, name, id_tail_hash, id_tail_hint, data)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            id_tail_hash = EXCLUDED.id_tail_hash,
            id_tail_hint = EXCLUDED.id_tail_hint,
            data = EXCLUDED.data,
            updated_at = now()`,
        [shaped.id, shaped.name, hash, hint, stored]
    );
    return stored;
}

function parseCandidateIdentity(payload) {
    const parsed = candidateLoginSchema.safeParse(payload || {});
    if (!parsed.success) {
        throw new CandidateAuthError('请输入姓名和证件后 8 位，末位可为大写 X', 400, 'invalid_identity');
    }
    return parsed.data;
}

async function findCandidateByIdentity(payload) {
    const {name, idTail} = parseCandidateIdentity(payload);
    const idTailHash = hashIdTail(idTail);
    const result = await query(
        'SELECT * FROM candidates WHERE name = $1 AND id_tail_hash = $2',
        [name, idTailHash]
    );
    return {
        candidate: normalizeCandidate(result.rows[0]),
        name,
        idTail,
        idTailHash,
    };
}

export async function loginCandidate(payload) {
    const {candidate: existing} = await findCandidateByIdentity(payload);
    if (existing) return existing;
    throw new CandidateAuthError(
        '未找到该候选人，请确认姓名和证件后 8 位，或切换到注册创建新档案',
        404,
        'candidate_not_found'
    );
}

export async function registerCandidate(payload) {
    const {candidate: existing, name, idTail, idTailHash} = await findCandidateByIdentity(payload);
    if (existing) {
        throw new CandidateAuthError(
            '该候选人档案已存在，请直接登录',
            409,
            'candidate_exists'
        );
    }
    const candidate = ensureCandidateShape({
        id: newId('cand'),
        name,
        resume: '',
        completeness: 20,
        resumes: [],
        portfolios: [],
        knowledge: [],
    });
    const stored = {...candidate};
    delete stored.idTail;
    await query(
        `INSERT INTO candidates (id, name, id_tail_hash, id_tail_hint, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [candidate.id, name, idTailHash, idTail.slice(-2), stored]
    );
    await writeAuditLog({
        actorType: 'candidate',
        actorId: candidate.id,
        action: 'candidate.created',
        aggregateType: 'CandidateProfile',
        aggregateId: candidate.id,
        detail: {identity: 'name_id_tail_hash'},
    });
    return stored;
}

export async function updateCandidateData(candidateId, updater) {
    const current = await getCandidate(candidateId);
    if (!current) throw new Error('Candidate not found');
    const next = ensureCandidateShape(updater(current));
    await query(
        'UPDATE candidates SET data = $2, updated_at = now() WHERE id = $1',
        [candidateId, next]
    );
    return next;
}

export async function updateCandidateProfile(candidateId, body = {}) {
    const parsed = candidateProfilePatchSchema.safeParse(body || {});
    if (!parsed.success) {
        throw new CandidateAuthError('候选人资料字段不合法', 400, 'invalid_profile_patch');
    }
    const current = await getCandidate(candidateId);
    if (!current) throw new CandidateAuthError('未找到候选人档案', 404, 'candidate_not_found');

    const next = ensureCandidateShape({...current});
    const detail = {};
    if (Object.hasOwn(parsed.data, 'avatar')) {
        const avatar = parsed.data.avatar;
        if (!avatar || avatar.mode === 'generated') {
            next.avatar = {mode: 'generated'};
            detail.avatar = {mode: 'generated'};
        }
        else {
            next.avatar = {
                ...avatar,
                updatedAt: avatar.updatedAt || new Date().toISOString(),
            };
            detail.avatar = {
                mode: 'image',
                storageKey: next.avatar.storageKey,
                fileName: next.avatar.fileName,
                mimeType: next.avatar.mimeType,
            };
        }
    }

    await query(
        'UPDATE candidates SET data = $2, updated_at = now() WHERE id = $1',
        [candidateId, next]
    );
    await writeAuditLog({
        actorType: 'candidate',
        actorId: candidateId,
        action: 'candidate.profile_updated',
        aggregateType: 'CandidateProfile',
        aggregateId: candidateId,
        detail,
    });
    return next;
}
