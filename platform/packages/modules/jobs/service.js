import {jobStatus, newId, uploadStatus} from '../../domain/contracts.js';
import {query} from '../../storage/db.js';
import {writeAuditLog} from '../audit/service.js';
import {compactDocumentForPrompt, extractMaterialDocumentText} from '../evidence/document-text.js';

const screeningRuleRewrites = new Map([
    ['研究生或同等能力', {
        type: '硬性门槛',
        label: '研究生或同等研究/工作经历',
        value: '优先识别硕士/博士在读或毕业；本科候选人需由长期高质量科研、核心业务实习或同等强度工作经历补充说明，不能由普通项目经历直接替代。',
    }],
    ['985/211 或同等项目经历', {
        type: '硬性门槛',
        label: '985/211/双一流或同等层次院校',
        value: '模型需结合院校层次判断：985/211、双一流、中科院、南方科大/上科大等新型高水平院校，以及海外同等层次高校；不确定时进入 AI 面试核验。',
    }],
    ['完整 AI 项目', {
        type: '评价维度',
        label: '完整 AI/Agent 应用链路',
        value: '能说明需求、数据/知识库、模型调用、工具/流程编排、上线或可演示结果。',
    }],
    ['可演示作品', {
        type: '评价维度',
        label: '可演示作品与证据',
        value: '有可体验链接、截图、录屏、代码片段或上线记录，并能说明本人贡献。',
    }],
    ['沟通表达', {
        type: '风险项',
        label: '材料真实性不清',
        value: '作品无法验证、贡献边界模糊或表达不清时，需要在 AI 面试/人审中重点确认。',
    }],
    ['有相关项目或作品证据', {
        type: '评价维度',
        label: '可验证作品或项目证据',
        value: '简历、作品、补充资料中需要说明本人贡献、可演示结果和可验证证据。',
    }],
]);

function normalizeScreeningRule(rule = {}) {
    const rewrite = screeningRuleRewrites.get(rule.label);
    if (!rewrite) return rule;
    return {
        ...rule,
        ...rewrite,
    };
}

function normalizeScreeningRules(rules = []) {
    return rules.map(normalizeScreeningRule);
}

function splitKnowledgeChunks(text, size = 900) {
    const normalized = String(text || '')
        .replace(/\u0000/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!normalized) return [];
    const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
    const chunks = [];
    let current = '';
    for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
        if (!current) {
            current = paragraph;
        }
        else if ((current.length + paragraph.length + 2) <= size) {
            current = `${current}\n\n${paragraph}`;
        }
        else {
            chunks.push(current);
            current = paragraph;
        }
        while (current.length > size) {
            chunks.push(current.slice(0, size));
            current = current.slice(size);
        }
    }
    if (current) chunks.push(current);
    return chunks.slice(0, 40);
}

function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeInterviewSettings(settings = {}) {
    return {
        questionCount: clampInteger(settings.questionCount, 6, 3, 10),
        maxFollowUpsPerQuestion: clampInteger(settings.maxFollowUpsPerQuestion, 2, 0, 5),
        durationMinutes: clampInteger(settings.durationMinutes, 25, 10, 60),
        invitationValidDays: clampInteger(settings.invitationValidDays, 3, 1, 14),
        provider: {
            kind: 'browser-demo',
            speechSynthesis: true,
        },
    };
}

function normalizeScreeningTemplateLabel(label = '') {
    return String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function templateFromRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        type: row.type,
        label: row.label,
        value: row.value,
        ...(row.data || {}),
        createdAt: row.created_at?.toISOString?.() || row.created_at || '',
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at || '',
    };
}

export function normalizeJob(row) {
    if (!row) return null;
    const hasInterviewSettings = Boolean(row.data?.interviewSettings);
    const data = {
        ...row.data,
        screeningRules: normalizeScreeningRules(row.data?.screeningRules || []),
        interviewSettings: normalizeInterviewSettings(row.data?.interviewSettings || {}),
        interviewSettingsConfigured: hasInterviewSettings,
    };
    return {
        ...data,
        id: row.id,
        title: row.title,
        status: row.status,
    };
}

export async function listJobs() {
    const result = await query('SELECT * FROM jobs ORDER BY created_at ASC');
    return result.rows.map(normalizeJob);
}

export async function listPublishedJobs() {
    const result = await query('SELECT * FROM jobs WHERE status = $1 ORDER BY created_at ASC', [jobStatus.published]);
    return result.rows.map(normalizeJob);
}

export async function getJob(jobId) {
    const result = await query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    return normalizeJob(result.rows[0]);
}

export async function listScreeningRuleTemplates() {
    const result = await query('SELECT * FROM screening_rule_templates ORDER BY created_at ASC');
    return result.rows.map(templateFromRow);
}

export async function createScreeningRuleTemplate(body = {}) {
    const label = String(body.label || '').trim() || '自定义评价项';
    const normalizedLabel = normalizeScreeningTemplateLabel(label);
    const type = String(body.type || '').trim() || '评价维度';
    const value = String(body.value || '').trim() || '请补充判断标准';
    const data = {
        ...(body.data || {}),
        source: body.source || body.data?.source || 'admin',
    };
    const result = await query(
        `INSERT INTO screening_rule_templates (id, type, label, normalized_label, value, data)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (normalized_label) DO NOTHING
         RETURNING *`,
        [body.id || newId('tpl'), type, label, normalizedLabel, value, data]
    );
    if (result.rows[0]) {
        const template = templateFromRow(result.rows[0]);
        await writeAuditLog({
            actorType: 'admin',
            actorId: 'local-admin',
            action: 'screening_rule_template.created',
            aggregateType: 'ScreeningRuleTemplate',
            aggregateId: template.id,
            detail: {label: template.label, type: template.type},
        });
        return {template, created: true};
    }
    const existing = await query('SELECT * FROM screening_rule_templates WHERE normalized_label = $1', [normalizedLabel]);
    return {template: templateFromRow(existing.rows[0]), created: false};
}

export async function deleteScreeningRuleTemplate(templateId) {
    const result = await query('DELETE FROM screening_rule_templates WHERE id = $1 RETURNING *', [templateId]);
    const template = templateFromRow(result.rows[0]);
    if (template) {
        await writeAuditLog({
            actorType: 'admin',
            actorId: 'local-admin',
            action: 'screening_rule_template.deleted',
            aggregateType: 'ScreeningRuleTemplate',
            aggregateId: template.id,
            detail: {label: template.label, type: template.type},
        });
    }
    return template;
}

export async function saveJob(job) {
    const {interviewSettingsConfigured: _configured, ...persistableJob} = job;
    const normalizedJob = {
        ...persistableJob,
        screeningRules: normalizeScreeningRules(job.screeningRules || []),
        interviewSettings: normalizeInterviewSettings(job.interviewSettings || {}),
    };
    await query(
        `INSERT INTO jobs (id, title, status, data)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            status = EXCLUDED.status,
            data = EXCLUDED.data,
            updated_at = now()`,
        [normalizedJob.id, normalizedJob.title, normalizedJob.status, normalizedJob]
    );
    return normalizedJob;
}

export async function createJob(body = {}) {
    const job = {
        id: newId('job'),
        title: body.title || '新岗位',
        mode: body.mode || '实习',
        location: body.location || '北京',
        status: jobStatus.draft,
        requirements: body.requirements || [],
        jd: body.jd || ['请补充岗位 JD。'],
        jdSources: [],
        screeningRules: body.screeningRules || [{
            id: newId('rule'),
            type: '评价维度',
            label: '业务实用性',
            value: '候选人的作品或经历需要说明真实业务场景、用户价值、落地路径和可验证收益。',
            enabled: true,
        }],
        portfolioWeights: body.portfolioWeights || {
            engineering: 30,
            aiRag: 25,
            product: 15,
            interaction: 10,
            demo: 10,
            evidence: 10,
        },
        interviewSettings: normalizeInterviewSettings(body.interviewSettings || {}),
        knowledge: [],
    };
    await saveJob(job);
    await writeAuditLog({
        actorType: 'admin',
        actorId: 'local-admin',
        action: 'job.created',
        aggregateType: 'JobPosting',
        aggregateId: job.id,
        detail: {title: job.title},
    });
    return job;
}

export async function updateJob(jobId, body = {}) {
    const job = await getJob(jobId);
    if (!job) return null;
    const next = {...job, ...body};
    const saved = await saveJob(next);
    await writeAuditLog({
        actorType: 'admin',
        actorId: 'local-admin',
        action: 'job.updated',
        aggregateType: 'JobPosting',
        aggregateId: jobId,
        detail: body,
    });
    return {
        ...saved,
        interviewSettingsConfigured: true,
    };
}

export async function deleteJob(jobId) {
    const job = await getJob(jobId);
    if (!job) return null;
    await query('DELETE FROM jobs WHERE id = $1', [jobId]);
    await writeAuditLog({
        actorType: 'admin',
        actorId: 'local-admin',
        action: 'job.deleted',
        aggregateType: 'JobPosting',
        aggregateId: jobId,
        detail: {title: job.title, status: job.status},
    });
    return job;
}

export async function addJdSource(jobId, body = {}) {
    const job = await getJob(jobId);
    if (!job) return null;
    const source = {
        id: newId('jdsrc'),
        name: body.name || body.fileName || '岗位 JD.docx',
        status: body.status || uploadStatus.ready,
        version: `v${(job.jdSources || []).length + 1}`,
        updatedAt: new Date().toISOString(),
        storageKey: body.storageKey || '',
    };
    job.jdSources = [source, ...(job.jdSources || [])];
    if (body.jd?.length) job.jd = body.jd;
    await saveJob(job);
    return source;
}

export async function addKnowledgeSource(jobId, body = {}) {
    const job = await getJob(jobId);
    if (!job) return null;
    const source = {
        id: newId('know'),
        name: body.name || body.fileName || '新资料',
        status: body.status || 'indexing',
        chunks: Number(body.chunks || 0),
        usage: body.usage || '待解析',
        storageKey: body.storageKey || '',
        storageRef: body.storageRef || '',
        uploadId: body.uploadId || '',
        fileName: body.fileName || body.name || '',
        mimeType: body.mimeType || '',
        sizeBytes: Number(body.sizeBytes || 0),
        hasOriginalFile: Boolean(body.storageKey || body.uploadId || body.hasOriginalFile),
        updatedAt: new Date().toISOString(),
    };
    job.knowledge = [...(job.knowledge || []), source];
    await saveJob(job);
    return source;
}

export async function updateKnowledgeSource(jobId, sourceId, patch = {}) {
    const job = await getJob(jobId);
    if (!job) return null;
    job.knowledge = (job.knowledge || []).map((source) => (
        source.id === sourceId ? {...source, ...patch} : source
    ));
    await saveJob(job);
    return job.knowledge.find((source) => source.id === sourceId);
}

export async function deleteKnowledgeSource(jobId, sourceId) {
    const job = await getJob(jobId);
    if (!job) return null;
    const source = (job.knowledge || []).find((item) => item.id === sourceId);
    if (!source) return null;
    job.knowledge = (job.knowledge || []).filter((item) => item.id !== sourceId);
    await saveJob(job);
    await query('DELETE FROM job_knowledge_chunks WHERE job_id = $1 AND source_id = $2', [jobId, sourceId]);
    await writeAuditLog({
        actorType: 'admin',
        actorId: 'local-admin',
        action: 'knowledge_source.deleted',
        aggregateType: 'JobPosting',
        aggregateId: jobId,
        detail: {sourceId, name: source.name},
    });
    return source;
}

export async function listJobKnowledgeChunks(jobId, {limit = 12} = {}) {
    const result = await query(
        `SELECT id, source_id, chunk_index, content, data
         FROM job_knowledge_chunks
         WHERE job_id = $1
         ORDER BY source_id ASC, chunk_index ASC
         LIMIT $2`,
        [jobId, Number(limit || 12)]
    );
    return result.rows.map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        chunkIndex: row.chunk_index,
        content: row.content,
        ...(row.data || {}),
    }));
}

export async function indexKnowledgeSource(jobId, sourceId) {
    const job = await getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    const source = (job.knowledge || []).find((item) => item.id === sourceId);
    if (!source) throw new Error(`Knowledge source not found: ${sourceId}`);

    const extracted = await extractMaterialDocumentText(source, {maxChars: 40000});
    const documentContext = compactDocumentForPrompt(source, extracted, {maxChars: 1200});
    const sourceHasOriginal = Boolean(source.storageKey || source.hasOriginalFile || source.uploadId);
    const documentText = String(extracted.text || '').trim();
    const metadataText = [
        source.usage && !/待解析|等待 worker/.test(source.usage) ? source.usage : '',
        source.name && !sourceHasOriginal ? source.name : '',
    ].filter(Boolean).join('\n');
    const indexText = [
        documentText,
        metadataText,
        ...(job.jd || []).slice(0, 4).map((item) => `岗位 JD：${item}`),
    ].filter(Boolean).join('\n\n');
    const rawChunks = splitKnowledgeChunks(indexText);
    const ready = rawChunks.length > 0 && (documentText || !sourceHasOriginal);
    const chunks = ready ? rawChunks : [];

    await query('DELETE FROM job_knowledge_chunks WHERE job_id = $1 AND source_id = $2', [jobId, sourceId]);
    for (const [index, content] of chunks.entries()) {
        await query(
            `INSERT INTO job_knowledge_chunks (id, job_id, source_id, chunk_index, content, data)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                `chunk-${sourceId}-${index}`,
                jobId,
                sourceId,
                index,
                content,
                {
                    sourceName: source.name || source.fileName || '岗位资料',
                    fileName: source.fileName || source.name || '',
                    storageKey: source.storageKey || '',
                    extractionStatus: documentContext.status,
                    extractionMethod: documentContext.extractionMethod,
                },
            ]
        );
    }

    const next = await updateKnowledgeSource(jobId, sourceId, {
        status: ready ? 'ready' : uploadStatus.failed,
        chunks: ready ? chunks.length : 0,
        usage: ready && source.usage === '待解析'
            ? '候选人咨询 / 初筛引用 / 面试追问'
            : source.usage,
        documentContext: {
            ...documentContext,
            text: documentContext.text.slice(0, 1200),
        },
        updatedAt: new Date().toISOString(),
        errorMessage: ready ? '' : (documentContext.warnings?.[0] || '岗位资料未抽取到可索引文本'),
    });
    await writeAuditLog({
        actorType: 'worker',
        actorId: 'knowledge',
        action: ready ? 'knowledge.indexed' : 'knowledge.index_failed',
        aggregateType: 'JobPosting',
        aggregateId: jobId,
        detail: {
            sourceId,
            chunks: ready ? chunks.length : 0,
            extractionStatus: documentContext.status,
            extractionMethod: documentContext.extractionMethod,
        },
    });
    return {
        source: next,
        chunks: ready ? chunks.length : 0,
        extractionStatus: documentContext.status,
    };
}

export async function addScreeningRule(jobId, body = {}) {
    const job = await getJob(jobId);
    if (!job) return null;
    const label = String(body.label || '').trim() || '自定义评价项';
    if ((job.screeningRules || []).some((rule) => rule.label === label)) return job;
    job.screeningRules = [
        ...(job.screeningRules || []),
        {
            id: newId('rule'),
            type: body.type || '评价维度',
            label,
            value: body.value || '请补充判断标准',
            enabled: body.enabled !== false,
        },
    ];
    await saveJob(job);
    return job;
}

export async function updateScreeningRule(jobId, ruleId, body = {}) {
    const job = await getJob(jobId);
    if (!job) return null;
    const nextLabel = String(body.label || '').trim();
    const duplicate = nextLabel && (job.screeningRules || []).some((rule) => (
        rule.id !== ruleId && rule.label === nextLabel
    ));
    if (duplicate) return job;
    job.screeningRules = (job.screeningRules || []).map((rule) => (
        rule.id === ruleId
            ? {
                ...rule,
                type: body.type || rule.type,
                label: nextLabel || rule.label,
                value: body.value || rule.value,
                enabled: body.enabled !== false,
            }
            : rule
    ));
    await saveJob(job);
    return job;
}

export async function deleteScreeningRule(jobId, ruleId) {
    const job = await getJob(jobId);
    if (!job) return null;
    job.screeningRules = (job.screeningRules || []).filter((rule) => rule.id !== ruleId);
    await saveJob(job);
    return job;
}
