import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const platformBase = process.env.CAPTURE_PLATFORM_URL || 'http://127.0.0.1:5193';
const outputDirectory = resolve('media', 'screenshots');
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const syntheticIdentity = {name: '演示候选人', idTail: '12345678'};

async function jsonRequest(path, options = {}) {
    const response = await fetch(`${platformBase}${path}`, {
        ...options,
        headers: {'Content-Type': 'application/json', ...(options.headers || {})},
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
    return {body, headers: response.headers};
}

async function prepareInterviewSession() {
    const login = await jsonRequest('/api/candidate/login', {
        method: 'POST',
        body: JSON.stringify(syntheticIdentity),
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
    const bootstrap = await jsonRequest('/api/bootstrap', {headers: {Cookie: cookie}});
    const application = bootstrap.body.applications[0];
    const job = bootstrap.body.jobs.find((item) => item.id === application.jobId);
    await jsonRequest(`/api/admin/applications/${application.id}/ai-interview/invitations`, {
        method: 'POST',
        body: '{}',
    });
    const entry = await jsonRequest(`/api/candidate/applications/${application.id}/ai-interview-entry`, {
        headers: {Cookie: cookie},
    });
    const entryUrl = entry.body.application?.aiInterview?.demo?.entryUrl;
    if (!entryUrl) throw new Error('Browser interview entry URL was not created');
    return {application, job, entryUrl};
}

function syntheticAnswer(index) {
    return [
        '这是合成演示回答。我负责一个 RAG 客服项目的检索链路和评测面板，把问题拆成数据整理、召回、生成与人工复核四个阶段，最终让团队能看到每条回答的证据来源。',
        '我先验证用户最常问的十类问题，再做小规模知识库和可观察日志。我的职责是定义评测集、实现检索接口并组织演示，阶段结果是把定位错误的时间从半天缩短到十分钟。',
        '岗位要求强调完整 AI 应用链路。合成项目覆盖需求、数据、模型调用、工具编排、前端反馈和结果复盘，我会重点说明本人负责的接口与评测部分。',
        '关键难点是召回结果相似但不支持答案。我加入来源分段、阈值和拒答规则，并用固定问题集回归；这让系统在证据不足时明确交给人工处理。',
        '可以核验的本人贡献包括评测集设计、检索接口、日志面板和演示脚本。团队成员负责业务资料，我负责把资料变成可追踪的应用闭环。',
        '如果重做，我会更早加入用户反馈标签和失败样本分类。第一次只看平均准确率，后来发现高风险问题需要单独监控，这也是我最重要的复盘。',
    ][index] || '这是只用于公开演示的合成回答。';
}

await mkdir(outputDirectory, {recursive: true});
const {application, job, entryUrl} = await prepareInterviewSession();
const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
});

try {
    const context = await browser.newContext({
        viewport: {width: 1440, height: 960},
        deviceScaleFactor: 1,
        colorScheme: 'light',
        reducedMotion: 'reduce',
    });
    const page = await context.newPage();

    await page.goto(`${platformBase}/candidate`, {waitUntil: 'networkidle'});
    await page.locator('form[data-form="login"] input[name="name"]').fill(syntheticIdentity.name);
    await page.locator('form[data-form="login"] input[name="idTail"]').fill(syntheticIdentity.idTail);
    await page.locator('form[data-form="login"] button[type="submit"]').click();
    await page.waitForSelector('[data-action="candidate-tab"]');
    await page.screenshot({path: resolve(outputDirectory, '01-candidate-job-feed.png')});

    await page.locator('[data-action="candidate-tab"][data-tab="profile"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({path: resolve(outputDirectory, '02-candidate-materials.png')});

    await page.goto(`${platformBase}/admin?jobId=${encodeURIComponent(job.id)}&tab=applications&appId=${encodeURIComponent(application.id)}`, {
        waitUntil: 'networkidle',
    });
    await page.screenshot({path: resolve(outputDirectory, '03-recruiter-evaluation-workbench.png')});

    await page.goto(`${platformBase}/admin?jobId=${encodeURIComponent(job.id)}&tab=interviews`, {
        waitUntil: 'networkidle',
    });
    await page.waitForTimeout(400);
    await page.screenshot({path: resolve(outputDirectory, '04-interview-orchestration.png')});

    await page.goto(entryUrl, {waitUntil: 'networkidle'});
    await page.waitForSelector('#interview-state:not([hidden])');
    await page.screenshot({path: resolve(outputDirectory, '05-browser-interview-room.png')});
    for (let index = 0; index < 6; index += 1) {
        await page.locator('#answer-input').fill(syntheticAnswer(index));
        await page.locator('#submit-button').click();
        if (index < 5) {
            await page.waitForFunction((expectedQuestion) => (
                document.querySelector('#question-number')?.textContent?.includes(String(expectedQuestion))
                && !document.querySelector('#submit-button')?.disabled
            ), index + 2);
        }
    }
    await page.waitForSelector('#complete-state:not([hidden])');
    await page.screenshot({path: resolve(outputDirectory, '06-report-written-back.png')});

    await page.waitForTimeout(800);
    await page.goto(`${platformBase}/admin?jobId=${encodeURIComponent(job.id)}&tab=applications&appId=${encodeURIComponent(application.id)}`, {
        waitUntil: 'networkidle',
    });
    const reportButton = page.locator('[data-action="open-application-report"][data-report="ai"]').first();
    if (await reportButton.count()) {
        await reportButton.click();
        await page.waitForTimeout(300);
        await page.screenshot({path: resolve(outputDirectory, '07-structured-interview-report.png')});
    }
}
finally {
    await browser.close();
}

process.stdout.write(`Captured synthetic screenshots in ${outputDirectory}\n`);
