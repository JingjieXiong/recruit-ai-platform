import {jobStatus} from '../packages/domain/contracts.js';
import {createApplication} from '../packages/modules/applications/service.js';
import {addCandidateMaterial, deleteCandidateMaterial} from '../packages/modules/evidence/service.js';
import {saveCandidate} from '../packages/modules/candidates/service.js';
import {saveJob} from '../packages/modules/jobs/service.js';
import {closePool, query} from '../packages/storage/db.js';

const candidateId = 'demo-candidate-001';
const jobId = 'demo-job-ai-app';
const resetDemo = process.argv.includes('--reset-demo');

async function clearDemoData() {
    const applicationIds = await query(
        'SELECT id FROM applications WHERE job_id = $1 OR candidate_id = $2',
        [jobId, candidateId]
    ).then((result) => result.rows.map((row) => row.id));

    if (applicationIds.length) {
        await query('DELETE FROM job_runs WHERE payload->>\'applicationId\' = ANY($1::text[])', [applicationIds]);
        await query('DELETE FROM audit_logs WHERE aggregate_id = ANY($1::text[])', [applicationIds]);
    }
    await query('DELETE FROM audit_logs WHERE aggregate_id IN ($1, $2)', [jobId, candidateId]);
    await query('DELETE FROM uploads WHERE owner_id IN ($1, $2)', [jobId, candidateId]);
    await query('DELETE FROM jobs WHERE id = $1', [jobId]);
    await query('DELETE FROM candidates WHERE id = $1', [candidateId]);
}

async function upsertDemoJob() {
    await saveJob({
        id: jobId,
        title: 'AI 应用工程师',
        mode: '实习/全职',
        location: '北京/线上',
        status: jobStatus.published,
        requirements: ['完整 AI 应用项目经验', '理解 RAG / Agent 基本链路', '能把 demo 做成可演示产品'],
        jd: [
            '负责部门内 AI 应用能力建设，包括知识库问答、智能体编排、语音/数字人交互原型，以及业务场景落地。',
            '需要能把候选人材料、岗位知识库和作品证据整理成可追溯的初筛报告。',
        ],
        jdSources: [{
            id: 'demo-jd-source-001',
            name: 'AI 应用工程师 JD.md',
            status: 'ready',
            version: 'v1',
            updatedAt: new Date().toISOString(),
            storageKey: 'demo/job/ai-app-jd.md',
        }],
        screeningRules: [
            {
                id: 'demo-rule-project',
                type: '硬性要求',
                label: '完整 AI 应用项目',
                value: '候选人材料中需要有可验证的 AI 应用、RAG、Agent 或语音交互项目。',
                enabled: true,
            },
            {
                id: 'demo-rule-demo',
                type: '加分项',
                label: '可演示作品',
                value: '有链接、录屏、代码片段或上线记录更好。',
                enabled: true,
            },
        ],
        portfolioWeights: {
            engineering: 30,
            aiRag: 25,
            product: 15,
            interaction: 10,
            demo: 10,
            evidence: 10,
        },
        knowledge: [{
            id: 'demo-knowledge-001',
            name: '岗位技术 FAQ.md',
            status: 'ready',
            chunks: 8,
            usage: '供 JD 咨询和初筛报告引用',
            storageKey: 'demo/job/faq.md',
        }],
    });
}

async function upsertDemoCandidate() {
    await saveCandidate({
        id: candidateId,
        name: '演示候选人',
        resume: '',
        completeness: 20,
        resumes: [],
        portfolios: [],
        knowledge: [],
    }, '12345678');

    for (const row of await query('SELECT id, kind FROM candidate_material_files WHERE candidate_id = $1', [candidateId]).then((result) => result.rows)) {
        await deleteCandidateMaterial(row.kind, row.id, candidateId);
    }

    await addCandidateMaterial('resume', {
        fileName: 'AI 应用方向简历.pdf',
        summary: '突出 RAG 客服系统、语音问答 Demo 和前端交互工程经验。',
        status: 'ready',
        isDefault: true,
    }, candidateId);
    await addCandidateMaterial('portfolio', {
        title: 'RAG 客服系统',
        fileName: 'rag-demo.pdf',
        summary: '包含 demo 链接、技术说明和效果截图。',
        status: 'ready',
    }, candidateId);
    return addCandidateMaterial('knowledge', {
        fileName: '项目复盘.md',
        summary: '补充项目背景、权衡记录和上线复盘。',
        status: 'ready',
    }, candidateId);
}

async function main() {
    if (resetDemo) {
        await clearDemoData();
    }
    await upsertDemoJob();
    const candidate = await upsertDemoCandidate();
    await query('DELETE FROM applications WHERE job_id = $1 AND candidate_id = $2', [jobId, candidateId]);
    await createApplication({
        jobId,
        candidateId,
        resumeId: candidate.resumes?.[0]?.id,
        portfolioIds: (candidate.portfolios || []).map((item) => item.id),
        knowledgeIds: (candidate.knowledge || []).map((item) => item.id),
    });
    console.log('demo data ready');
    console.log(JSON.stringify({jobId, candidateId}, null, 2));
}

try {
    await main();
}
finally {
    await closePool();
}
