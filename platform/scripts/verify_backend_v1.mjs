import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';

const port = Number(process.env.PORT || 5191);
const baseUrl = `http://127.0.0.1:${port}`;
const verifyPrefix = process.env.RECRUIT_VERIFY_PREFIX || '验收自动-';
const runtimeEnv = {
    ...process.env,
    AI_MODE: 'fixture',
    INTERVIEW_RUNTIME: 'browser-demo',
    INTERVIEW_BASE_URL: process.env.INTERVIEW_BASE_URL || 'http://127.0.0.1:5174',
    INTERVIEW_PUBLIC_BASE_URL: process.env.INTERVIEW_PUBLIC_BASE_URL || 'http://127.0.0.1:5174',
    QUEUE_PROVIDER: 'db',
    STORAGE_PROVIDER: 'filesystem',
    VECTOR_PROVIDER: 'text',
};
let server;
let worker;

async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {'Content-Type': 'application/json', ...(options.headers || {})},
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
        throw new Error(`${options.method || 'GET'} ${path} failed ${response.status}: ${JSON.stringify(body)}`);
    }
    return {body, headers: response.headers};
}

async function waitForServer() {
    for (let index = 0; index < 40; index += 1) {
        try {
            await request('/api/health');
            return;
        }
        catch {
            await sleep(250);
        }
    }
    throw new Error('server did not become ready');
}

function startServer() {
    const env = {
        ...runtimeEnv,
        PORT: String(port),
    };
    server = spawn(process.execPath, ['server.mjs'], {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
    server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
    worker = spawn(process.execPath, ['apps/worker/index.js'], {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', (chunk) => process.stdout.write(`[worker] ${chunk}`));
    worker.stderr.on('data', (chunk) => process.stderr.write(`[worker] ${chunk}`));
}

async function resetVerifyData() {
    await new Promise((resolvePromise, reject) => {
        const child = spawn(
            process.execPath,
            ['scripts/reset-demo-prefix.mjs', '--prefix', verifyPrefix, '--yes'],
            {
                cwd: process.cwd(),
                env: runtimeEnv,
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        );
        let stderr = '';
        child.stdout.on('data', (chunk) => process.stdout.write(`[reset] ${chunk}`));
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
            process.stderr.write(`[reset] ${chunk}`);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolvePromise();
                return;
            }
            reject(new Error(`reset verify data failed: ${stderr || code}`));
        });
    });
}

async function waitForApplication(jobId, applicationId, predicate, label) {
    for (let index = 0; index < 80; index += 1) {
        const result = await request(`/api/admin/jobs/${jobId}/applications`);
        const application = result.body.applications.find((item) => item.id === applicationId);
        if (application && predicate(application)) return application;
        await sleep(250);
    }
    throw new Error(`application did not reach ${label}`);
}

async function main() {
    await resetVerifyData();
    startServer();
    await waitForServer();

    const jobResult = await request('/api/admin/jobs', {
        method: 'POST',
        body: JSON.stringify({
            title: `${verifyPrefix}AI 应用工程师实习生`,
            mode: '实习/全职',
            location: '北京/线上',
            requirements: ['验证完整投递链路', '验证候选人和管理员端联动'],
            jd: ['这是用于真实后端联动验收的岗位。', '候选人投递后，管理员端必须能看到同一条 Application。'],
            screeningRules: [{
                type: '硬性要求',
                label: '有可验证项目证据',
                value: '简历或作品中需要能看到项目证据',
                enabled: true,
            }],
        }),
    });
    const createdJob = jobResult.body.job;
    if (!createdJob?.id) throw new Error('admin job creation failed');

    const publishedJob = await request(`/api/admin/jobs/${createdJob.id}`, {
        method: 'PATCH',
        body: JSON.stringify({status: '已发布'}),
    });
    if (publishedJob.body.job.status !== '已发布') throw new Error('job publish failed');

    const identity = {name: `${verifyPrefix}候选人-${Date.now()}`, idTail: '88990011'};
    const registration = await request('/api/candidate/register', {
        method: 'POST',
        body: JSON.stringify(identity),
    });
    if (!registration.body.candidate?.id) throw new Error('registration missing candidate id');
    const login = await request('/api/candidate/login', {
        method: 'POST',
        body: JSON.stringify(identity),
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
    const headers = {Cookie: cookie};
    if (!login.body.candidate?.id) throw new Error('login missing candidate id');

    const feed = await request('/api/jobs/feed', {headers});
    const job = feed.body.jobs.find((item) => item.id === createdJob.id);
    if (!job) throw new Error('feed missing newly published job');

    const resume = await request('/api/candidate/materials/resume', {
        method: 'POST',
        headers,
        body: JSON.stringify({fileName: '验证简历.pdf', summary: '验证 RAG 项目和作品经历'}),
    });
    if (!resume.body.candidate.resumes?.length) throw new Error('resume upload failed');

    const portfolio = await request('/api/candidate/portfolio-submissions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            title: '验证作品 Demo',
            jobDirection: 'AI 应用 / 产品 Demo',
            oneLineValue: '用可演示 demo 验证招聘提效主链路',
            scenario: '部门招聘初筛',
            problem: '材料格式不统一，筛选证据分散',
            demoFlow: '管理员发布岗位，候选人提交材料，系统生成报告',
            solution: '模块化单体 + worker + AI Gateway',
            role: '本人负责主链路设计和实现',
            contribution: '完成候选人端、管理员端和后端联动',
            screenshots: [{name: 'demo-home.png', caption: '候选人岗位流'}],
        }),
    });
    const portfolioId = portfolio.body.portfolio?.id;
    if (!portfolioId) throw new Error('portfolio upload failed');

    const knowledge = await request('/api/candidate/materials/knowledge-sources', {
        method: 'POST',
        headers,
        body: JSON.stringify({fileName: '验证项目复盘.md', usage: 'RAG 项目细节'}),
    });
    const knowledgeId = knowledge.body.candidate.knowledge.at(-1)?.id;
    if (!knowledgeId) throw new Error('candidate knowledge upload failed');

    const applicationResult = await request('/api/applications', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            jobId: createdJob.id,
            resumeId: resume.body.candidate.resumes[0].id,
            portfolioIds: [portfolioId],
            knowledgeIds: [knowledgeId],
        }),
    });
    const application = applicationResult.body.application;
    if (!application?.materialSnapshot?.resumeId) throw new Error('application snapshot missing');

    await request(`/api/admin/applications/${application.id}`, {
        method: 'PATCH',
        body: JSON.stringify({prescreenAction: 'complete'}),
    });
    const completed = await waitForApplication(
        createdJob.id,
        application.id,
        (item) => item.prescreen?.status === 'completed',
        'completed prescreen'
    );
    if (!Array.isArray(completed.prescreen?.evidenceRefs)) {
        throw new Error('prescreen result missing evidence refs');
    }

    const plan = await request(`/api/admin/applications/${application.id}/interview-plan`, {
        method: 'POST',
        body: JSON.stringify({force: true}),
    });
    if (!plan.body.interviewPlan?.questions?.length) throw new Error('interview plan missing questions');

    const invitation = await request(`/api/admin/applications/${application.id}/ai-interview/invitations`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
    if (invitation.body.application.interviewStatus !== 'pending') throw new Error('interview invitation failed');
    if (!invitation.body.publicEntryUrl?.includes('token=')) {
        throw new Error('interview invitation missing public token link');
    }
    if (!invitation.body.application.aiInterview?.publicEntryUrl?.includes('token=')) {
        throw new Error('application did not persist public interview link');
    }

    const entry = await request(`/api/candidate/applications/${application.id}/ai-interview-entry`, {headers});
    if (!entry.body.entry?.sessionRef) throw new Error('candidate interview entry missing');
    if (entry.body.application.interviewStatus !== 'pending') {
        throw new Error('opening interview entry should not mark interview in progress');
    }

    const callback = await request('/api/interview-bridge/status-callback', {
        method: 'POST',
        headers: {'x-interview-bridge-secret': 'local-interview-bridge-secret'},
        body: JSON.stringify({
            applicationId: application.id,
            status: 'completed',
            reportRef: `report://verify/${application.id}`,
        }),
    });
    if (callback.body.application.status !== '待审核') throw new Error('interview callback did not move to review');

    const adminApps = await request(`/api/admin/jobs/${createdJob.id}/applications`);
    if (!adminApps.body.applications.some((item) => item.id === application.id)) {
        throw new Error('admin job queue missing new application');
    }

    const decision = await request(`/api/admin/applications/${application.id}`, {
        method: 'PATCH',
        body: JSON.stringify({humanDecision: '暂缓', note: '验证人工覆盖'}),
    });
    if (decision.body.application.humanDecision?.status !== '暂缓') {
        throw new Error('human decision failed');
    }

    await request(`/api/admin/jobs/${createdJob.id}`, {
        method: 'PATCH',
        body: JSON.stringify({status: '暂停'}),
    });
    const hiddenFeed = await request('/api/jobs/feed', {headers});
    if (hiddenFeed.body.jobs.some((item) => item.id === createdJob.id)) {
        throw new Error('paused job still appears in candidate feed');
    }

    const candidatePage = await fetch(`${baseUrl}/candidate`);
    const adminPage = await fetch(`${baseUrl}/admin`);
    if (!candidatePage.ok || !adminPage.ok) throw new Error('frontend pages failed');

    console.log('backend v1 verify passed');
}

try {
    await main();
}
finally {
    if (worker) {
        worker.kill('SIGTERM');
    }
    if (server) {
        server.kill('SIGTERM');
    }
    if (!process.env.KEEP_VERIFY_DATA) {
        await resetVerifyData().catch((error) => {
            process.stderr.write(`[reset] cleanup skipped: ${error.message}\n`);
        });
    }
}
