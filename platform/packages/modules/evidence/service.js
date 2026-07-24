import {newId, uploadCompleteSchema, uploadStatus} from '../../domain/contracts.js';
import {query} from '../../storage/db.js';
import {presignPutObject, publicStorageRef} from '../../storage/objectStorage.js';
import {getCandidate, updateCandidateData} from '../candidates/service.js';
import {writeAuditLog} from '../audit/service.js';

export function materialKindLabel(kind) {
    return {
        resume: '简历',
        portfolio: '作品',
        knowledge: '可选知识库',
    }[kind] || '材料';
}

export async function presignUpload(body = {}) {
    const uploadId = newId('upload');
    const ownerType = body.ownerType || 'candidate';
    const ownerId = body.ownerId || 'pending';
    const kind = body.kind || 'file';
    const fileName = body.fileName || 'upload.bin';
    const storageKey = `${ownerType}/${ownerId}/${kind}/${uploadId}-${fileName}`;
    const uploadUrl = await presignPutObject(storageKey);
    await query(
        `INSERT INTO uploads (id, owner_type, owner_id, kind, file_name, mime_type, size_bytes, storage_key, status, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [uploadId, ownerType, ownerId, kind, fileName, body.mimeType || '', Number(body.sizeBytes || 0), storageKey, 'presigned', body]
    );
    return {uploadId, uploadUrl, storageKey, storageRef: publicStorageRef(storageKey)};
}

export async function completeUpload(body = {}) {
    const payload = uploadCompleteSchema.parse(body);
    const uploadId = payload.uploadId || newId('upload');
    const storageKey = payload.storageKey || `${payload.ownerType}/${payload.ownerId || 'unknown'}/${payload.kind}/${uploadId}-${payload.fileName}`;
    await query(
        `INSERT INTO uploads (id, owner_type, owner_id, kind, file_name, mime_type, size_bytes, storage_key, status, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9)
         ON CONFLICT (id) DO UPDATE SET
            status = 'completed',
            storage_key = EXCLUDED.storage_key,
            data = EXCLUDED.data,
            updated_at = now()`,
        [uploadId, payload.ownerType, payload.ownerId || '', payload.kind, payload.fileName, payload.mimeType, payload.sizeBytes, storageKey, payload.metadata]
    );
    return {uploadId, storageKey, storageRef: publicStorageRef(storageKey), status: 'completed'};
}

function completionFor(candidate) {
    return Math.max(
        20,
        40 + (candidate.resumes?.length ? 30 : 0)
            + Math.min(candidate.portfolios?.length || 0, 2) * 8
            + Math.min(candidate.knowledge?.length || 0, 2) * 5
    );
}

async function currentCandidate(candidateId) {
    if (!candidateId) return null;
    return getCandidate(candidateId);
}

export async function addCandidateMaterial(kind, body = {}, candidateId) {
    const candidate = await currentCandidate(candidateId);
    if (!candidate) throw new Error('Candidate not found');
    const hasOriginalFile = Boolean(body.storageKey || body.uploadId || body.hasOriginalFile);
    const upload = await completeUpload({
        uploadId: body.uploadId || undefined,
        ownerType: 'candidate',
        ownerId: candidate.id,
        kind,
        fileName: body.fileName || body.name || body.resume || body.title || `${materialKindLabel(kind)}-${Date.now()}`,
        mimeType: body.mimeType || '',
        sizeBytes: Number(body.sizeBytes || 0),
        storageKey: body.storageKey || '',
        metadata: body,
    });
    const materialId = kind === 'resume'
        ? newId('resume')
        : kind === 'portfolio'
            ? newId('portfolio')
            : newId('ck');
    const item = {
        id: materialId,
        name: body.resume || body.name || body.fileName || body.title || upload.storageKey,
        title: body.title || body.name || body.fileName || '',
        type: body.type || materialKindLabel(kind),
        status: body.status || uploadStatus.ready,
        isDefault: kind === 'resume' ? body.isDefault !== false : undefined,
        updatedAt: new Date().toISOString(),
        summary: body.summary || body.note || '已上传，后端 worker 会生成结构化证据。',
        evidence: body.evidence || body.note || '待解析',
        usage: body.usage || body.note || '供初筛和人工审核参考',
        storageKey: upload.storageKey,
        storageRef: upload.storageRef,
        mimeType: body.mimeType || '',
        sizeBytes: Number(body.sizeBytes || 0),
        hasOriginalFile,
    };
    const next = await updateCandidateData(candidate.id, (draft) => {
        if (kind === 'resume') {
            if (item.isDefault) {
                draft.resumes = (draft.resumes || []).map((resume) => ({...resume, isDefault: false}));
            }
            draft.resumes = [item, ...(draft.resumes || [])];
            draft.resume = item.name;
        }
        if (kind === 'portfolio') {
            draft.portfolios = [...(draft.portfolios || []), {...item, title: item.title || item.name}];
        }
        if (kind === 'knowledge') {
            draft.knowledge = [...(draft.knowledge || []), item];
        }
        draft.completeness = completionFor(draft);
        return draft;
    });
    await query(
        `INSERT INTO candidate_material_files (id, candidate_id, kind, name, status, storage_key, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [materialId, candidate.id, kind, item.name || item.title, item.status, upload.storageKey, item]
    );
    await writeAuditLog({
        actorType: 'candidate',
        actorId: candidate.id,
        action: `candidate_material.${kind}.uploaded`,
        aggregateType: 'CandidateProfile',
        aggregateId: candidate.id,
        detail: {materialId, name: item.name || item.title},
    });
    return next;
}

export async function deleteCandidateMaterial(kind, materialId, candidateId) {
    const candidate = await currentCandidate(candidateId);
    if (!candidate) throw new Error('Candidate not found');
    let deleted = false;
    const existingMaterial = await query(
        'SELECT id FROM candidate_material_files WHERE candidate_id = $1 AND kind = $2 AND id = $3',
        [candidate.id, kind, materialId]
    );
    const existingPortfolio = kind === 'portfolio'
        ? await query(
            'SELECT id FROM portfolio_submissions WHERE candidate_id = $1 AND id = $2',
            [candidate.id, materialId]
        )
        : {rows: []};
    deleted ||= Boolean(existingMaterial.rows[0] || existingPortfolio.rows[0]);
    const next = await updateCandidateData(candidate.id, (draft) => {
        if (kind === 'resume') {
            draft.resumes = draft.resumes || [];
            if (materialId === 'legacy-resume') {
                deleted = Boolean(draft.resume) || draft.resumes.length > 0;
                draft.resumes = [];
                draft.resume = '';
            }
            const removed = draft.resumes.find((resume) => resume.id === materialId);
            const beforeCount = draft.resumes.length;
            draft.resumes = draft.resumes.filter((resume) => resume.id !== materialId);
            deleted ||= beforeCount !== draft.resumes.length;
            if (removed?.isDefault && draft.resumes[0]) {
                draft.resumes[0].isDefault = true;
                draft.resume = draft.resumes[0].name;
            }
            if (removed?.name && draft.resume === removed.name) {
                draft.resume = draft.resumes[0]?.name || '';
            }
            if (!draft.resumes.length) {
                draft.resume = '';
            }
        }
        if (kind === 'portfolio') {
            const beforeCount = (draft.portfolios || []).length;
            draft.portfolios = (draft.portfolios || []).filter((portfolio) => portfolio.id !== materialId);
            deleted ||= beforeCount !== draft.portfolios.length;
        }
        if (kind === 'knowledge') {
            const beforeCount = (draft.knowledge || []).length;
            draft.knowledge = (draft.knowledge || []).filter((source, index) => {
                if (typeof source === 'string') return `legacy-knowledge-${index}` !== materialId;
                return source.id !== materialId;
            });
            deleted ||= beforeCount !== draft.knowledge.length;
        }
        draft.completeness = completionFor(draft);
        return draft;
    });
    if (!deleted) {
        throw new Error('Material not found or already deleted');
    }
    await query(
        'DELETE FROM candidate_material_files WHERE candidate_id = $1 AND kind = $2 AND id = $3',
        [candidate.id, kind, materialId]
    );
    if (kind === 'portfolio') {
        await query('DELETE FROM portfolio_submissions WHERE candidate_id = $1 AND id = $2', [candidate.id, materialId]);
    }
    await writeAuditLog({
        actorType: 'candidate',
        actorId: candidate.id,
        action: `candidate_material.${kind}.deleted`,
        aggregateType: 'CandidateProfile',
        aggregateId: candidate.id,
        detail: {materialId},
    });
    return next;
}

export function buildMaterialSnapshot(candidate, body = {}) {
    const resumes = candidate.resumes || [];
    const resume = resumes.find((item) => item.id === body.resumeId)
        || resumes.find((item) => item.isDefault)
        || resumes[0];
    const portfolioIds = body.portfolioIds || body.portfolioSubmissionIds || (candidate.portfolios || []).map((item) => item.id);
    const knowledgeIds = body.knowledgeIds || body.candidateKnowledgeSourceIds || [];
    const portfolios = (candidate.portfolios || []).filter((item) => portfolioIds.includes(item.id));
    const knowledge = (candidate.knowledge || []).filter((item) => knowledgeIds.includes(item.id));
    return {
        resumeId: resume?.id || '',
        resumeName: resume?.name || candidate.resume || '未选择简历',
        resumeItem: resume ? {...resume} : null,
        portfolioIds: portfolios.map((item) => item.id),
        portfolioTitles: portfolios.map((item) => item.title || item.name),
        portfolioItems: portfolios.map((item) => ({...item})),
        knowledgeIds: knowledge.map((item) => item.id),
        knowledgeNames: knowledge.map((item) => item.name),
        knowledgeItems: knowledge.map((item) => ({...item})),
        lockedAt: new Date().toISOString(),
    };
}

export function snapshotSummary(snapshot) {
    const parts = [
        snapshot.resumeName ? '简历' : '',
        snapshot.portfolioTitles?.length ? `${snapshot.portfolioTitles.length} 作品` : '',
        snapshot.knowledgeNames?.length ? '可选知识库' : '',
    ].filter(Boolean);
    return parts.join(' + ') || '材料快照';
}
