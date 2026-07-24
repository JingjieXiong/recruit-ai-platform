import {getApplication, listApplicationsForJob} from '../applications/service.js';
import {getCandidate} from '../candidates/service.js';
import {getJob} from '../jobs/service.js';
import {getObjectReadStream} from '../../storage/objectStorage.js';

function compactStructuredValue(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(compactStructuredValue).filter(Boolean).join('；');
    if (typeof value === 'object') {
        const requirement = value.requirement || value.label || value.title || value.name || '';
        const result = value.result || value.reason || value.summary || value.description || value.text || '';
        if (requirement || result) {
            return [requirement, result].map(compactStructuredValue).filter(Boolean).join('：');
        }
        return Object.values(value).map(compactStructuredValue).filter(Boolean).slice(0, 3).join('；');
    }
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^\s*\{/.test(raw)) {
        try {
            return compactStructuredValue(JSON.parse(raw));
        }
        catch {
            const requirement = raw.match(/"requirement"\s*:\s*"([^"]+)/)?.[1] || '';
            const result = raw.match(/"result"\s*:\s*"([^"]+)/)?.[1] || '';
            if (requirement || result) return [requirement, result].filter(Boolean).join('：');
        }
    }
    return raw;
}

function cleanText(value, fallback = '') {
    const text = compactStructuredValue(value).trim();
    if (!text) return fallback;
    if (/pending-ai-module/i.test(text)) return fallback || '尚未回写';
    if (/待解析|示例|请补充|待补充方案说明|待补充本人贡献/.test(text)) {
        return fallback || '';
    }
    return text;
}

function isMachineOnlyValue(value = '') {
    return /^(命中|符合|具备|明确|完成|有|未命中|待确认|待验证|需核验|未明确|未提供|缺失|不足|无法判断|通过|未通过)$/u.test(cleanText(value));
}

function list(values = []) {
    const source = Array.isArray(values) ? values : [values];
    return source.map((item) => cleanText(item)).filter(Boolean);
}

function sentenceChunks(value = '') {
    return String(value || '')
        .replace(/[#*_`>-]/g, ' ')
        .split(/[\n。；;]+/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

function compactAiReportText(value = '', fallback = '', limit = 180) {
    const raw = String(value || '')
        .replace(/---+/g, '\n')
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .replace(/好的，?这是[^。]*?(审核|面试)?报告[。.]?/gu, ' ')
        .replace(/审核报告[:：][^\n#]*/gu, ' ')
        .replace(/面试会话ID[:：][^\n#]*/gu, ' ')
        .trim();
    const firstSentence = (text = '') => {
        const chunks = sentenceChunks(text);
        return chunks.find((line) => /推荐|不建议|未完成|无效|无法|通过|不足|空白|有效回答/.test(line))
            || chunks[0]
            || '';
    };
    const core = firstSentence(raw.match(/核心(?:判定|结论)[:：]\s*([^\n#]+)/u)?.[1] || '');
    const candidates = [
        core,
        ...sentenceChunks(raw),
    ].map((line) => line
        .replace(/^审核报告[:：]?.*$/u, '')
        .replace(/^面试会话ID[:：]?.*$/u, '')
        .replace(/^候选人强项[:：]?.*$/u, '')
        .replace(/^风险点[:：]?.*$/u, '')
        .replace(/^证据引用[:：]?.*$/u, '')
        .replace(/^系统决策.*$/u, '')
        .replace(/\s+/g, ' ')
        .trim())
        .filter(Boolean);
    const picked = candidates.find((line) => /建议|推荐|不建议|未完成|无效|无法|通过|不足|完成/.test(line))
        || candidates.find((line) => line.length >= 12)
        || fallback;
    return cleanText(String(picked || fallback || '').slice(0, limit), fallback);
}

function compactAiReportList(values = [], limit = 4, textLimit = 120) {
    const rows = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : [values]) {
        const text = compactAiReportText(value, '', textLimit);
        const key = text.replace(/\s+/g, '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(text);
        if (rows.length >= limit) break;
    }
    return rows;
}

function normalizeAiRecommendationText(explicit = '', raw = '', completed = false) {
    const signal = `${explicit || ''} ${raw || ''}`;
    if (/未提供任何有效|没有形成有效|空白答案|拒绝作答|无法对候选人.*评估|无法评估|面试未完成|数据严重不足/.test(signal)) {
        return 'AI 面试未通过';
    }
    if (/不建议|拒绝|淘汰|未通过/.test(signal)) return 'AI 面试未通过';
    if (/(推荐|建议).*(人工|真人|继续|沟通|面试)|通过/.test(signal) && !/不建议|暂缓|不足|未通过/.test(signal)) return 'AI 面试通过';
    if (/暂缓|不足|未完成|空白|异常|过短/.test(signal)) return 'AI 面试未通过';
    return cleanText(explicit, completed ? 'AI 面试已完成' : '未进行 AI 面试');
}

function safeName(value, fallback = 'report') {
    return cleanText(value, fallback)
        .replace(/[\\/:*?"<>|\s]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || fallback;
}

function reportLine(title, text, tone = 'info', evidenceRefs = []) {
    return {
        title: cleanText(title, '未命名项'),
        text: cleanText(text),
        tone,
        evidenceRefs,
    };
}

function coerceReportLine(item, tone = 'info') {
    if (item && typeof item === 'object' && ('title' in item || 'text' in item)) {
        return reportLine(item.title, item.text, item.tone || tone, item.evidenceRefs || []);
    }
    return reportLine(item, '', tone);
}

function materialSnapshot(application = {}) {
    const snapshot = application.materialSnapshot || {};
    return {
        lockedAt: snapshot.lockedAt || application.createdAt || '',
        resume: snapshot.resumeItem ? {
            id: snapshot.resumeItem.id || snapshot.resumeId || '',
            name: snapshot.resumeItem.name || snapshot.resumeName || '简历',
            storageKey: snapshot.resumeItem.storageKey || '',
        } : null,
        portfolios: (snapshot.portfolioItems || []).map((item) => ({
            id: item.id || '',
            title: item.title || item.name || '作品',
            name: item.name || item.fileName || item.title || '作品',
            storageKey: item.storageKey || '',
            jobDirection: item.jobDirection || '',
            oneLineValue: item.oneLineValue || item.summary || '',
            problem: item.problem || '',
            scenario: item.scenario || '',
            currentSolutionGap: item.currentSolutionGap || '',
            solution: item.solution || '',
            coreFeatures: item.coreFeatures || '',
            demoFlow: item.demoFlow || '',
            aiUsage: item.aiUsage || '',
            differentiation: item.differentiation || '',
            role: item.role || '',
            contribution: item.contribution || '',
            evidenceUrl: item.evidenceUrl || '',
            outcome: item.outcome || '',
            challenge: item.challenge || '',
            reflection: item.reflection || '',
            attachments: item.attachmentRefs || [],
            screenshots: item.screenshots || [],
        })),
        knowledge: (snapshot.knowledgeItems || []).map((item) => ({
            id: item.id || '',
            name: item.name || item.fileName || '补充资料',
            storageKey: item.storageKey || '',
        })),
    };
}

function evidenceSummary(ref = {}) {
    const sourceTypeLabel = {
        resume: '简历',
        portfolio: '作品',
        portfolio_field: '作品字段',
        attachment: '附件',
        screenshot: '截图',
        knowledge: '知识库',
        interview_plan: '面试计划',
    }[ref.sourceType] || '';
    const extractionLabel = {
        model_vision: '视觉识别',
        model_text: '文本抽取',
        candidate_text: '候选人填写',
        candidate_upload: '候选人上传',
        manual: '人工标注',
    }[ref.extractionMethod] || '';
    const seen = new Set();
    const parts = [
        ref.label,
        ref.fileName,
        !ref.label && sourceTypeLabel ? sourceTypeLabel : '',
        ref.screenshotId ? `截图 ${ref.screenshotId}` : '',
        extractionLabel,
    ].map((item) => cleanText(item)).filter((item) => {
        if (!item || seen.has(item)) return false;
        seen.add(item);
        return true;
    });
    return parts.join(' / ') || cleanText(ref.text, '证据待确认');
}

function evidenceFact(ref = {}) {
    const text = cleanText(ref.text || ref.summary || ref.finding || '');
    if (!text) return '';
    if (/^(education|projects?|resume|portfolio|text|文本抽取|模型抽取|candidate_text|model_text)$/i.test(text)) return '';
    return text.replace(/\s+/g, ' ').slice(0, 140);
}

function evidenceFacts(refs = [], limit = 2) {
    const seen = new Set();
    const rows = [];
    for (const ref of Array.isArray(refs) ? refs : []) {
        const text = evidenceFact(ref);
        const key = text.replace(/\s+/g, '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(text);
        if (rows.length >= limit) break;
    }
    return rows;
}

function matchedItems(application = {}) {
    const prescreen = application.prescreen || {};
    const matched = prescreen.matchedRequirements?.length
        ? prescreen.matchedRequirements
        : (prescreen.rules || []).map((rule) => ({
            requirement: rule.label,
            result: rule.result || rule.reason,
            evidenceRefs: rule.evidenceRefs || [],
        }));
    return matched.filter((item) => {
        const text = cleanText(`${cleanText(item.requirement)} ${cleanText(item.result)}`);
        if (/命中\/待确认|待确认|待验证|需核验|未明确|未提供|未写|缺少|缺失|不足|无法|不满足|风险|模板|占位|解析失败|抽取状态/.test(text)) {
            return false;
        }
        return /命中|符合|具备|明确|完成|有/.test(cleanText(item.result));
    }).map((item) => reportLine(
        item.requirement,
        isMachineOnlyValue(item.result)
            ? evidenceFacts(item.evidenceRefs || []).join('；') || item.result
            : item.result,
        'success',
        item.evidenceRefs || []
    ));
}

function riskItems(application = {}) {
    const evidencePack = application.evidencePack || {};
    const risks = [
        ...(application.prescreen?.risks || []),
        ...(evidencePack.resumeEvidence?.risks || []),
        ...(evidencePack.portfolioEvaluations || []).flatMap((item) => item.risks || []),
        ...(evidencePack.knowledgeEvidence || []).flatMap((item) => item.risks || []),
    ];
    return list(risks).map((item) => reportLine(item, '', 'danger'));
}

function gapItems(application = {}) {
    return list(application.prescreen?.gaps || []).map((item) => reportLine(item, '', 'warning'));
}

function dedupeReportLines(items = [], limit = 4) {
    const seen = new Set();
    const rows = [];
    for (const item of items) {
        const key = `${item.title || ''}:${item.text || ''}`.replace(/\s+/g, '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(item);
        if (rows.length >= limit) break;
    }
    return rows;
}

function visualEvidenceItems(application = {}) {
    const evaluations = application.evidencePack?.portfolioEvaluations || [];
    return evaluations.flatMap((evaluation) => {
        const findings = evaluation.visualFindings || [];
        const modelText = [
            evaluation.modelRouting?.visionModel ? `视觉模型：${evaluation.modelRouting.visionModel}` : '',
            evaluation.modelRouting?.textModel ? `文本模型：${evaluation.modelRouting.textModel}` : '',
            evaluation.modelRouting?.visionRequired ? '视觉必读' : '',
        ].filter(Boolean).join(' / ');
        if (!findings.length) {
            return [reportLine(
                evaluation.title || '作品视觉证据',
                `${modelText ? `${modelText}。` : ''}${evaluation.visualReadStatus === 'read'
                    ? '模型已尝试读取作品截图，但未返回逐图发现。'
                    : '未读取图片，只基于候选人说明和作品字段。'}`,
                evaluation.visualReadStatus === 'read' ? 'info' : 'warning',
                evaluation.evidenceRefs || []
            )];
        }
        return findings.map((finding) => reportLine(
            `${evaluation.title || '作品'} / ${finding.fileName || finding.screenshotId || '截图'}`,
            [
                modelText,
                finding.finding,
                finding.supportedClaims?.length ? `支持：${finding.supportedClaims.join('；')}` : '',
                finding.unverifiedClaims?.length ? `未确认：${finding.unverifiedClaims.join('；')}` : '',
                finding.risks?.length ? `风险：${finding.risks.join('；')}` : '',
            ].filter(Boolean).join('。'),
            finding.status === 'read' ? 'info' : 'warning',
            finding.evidenceRefs || evaluation.evidenceRefs || []
        ));
    });
}

function aiSupplement(application = {}) {
    if (!(application.interviewStatus === 'completed' || application.aiInterview?.status === 'completed' || application.reviewReportRef)) {
        return [];
    }
    const reportRef = cleanText(application.reviewReportRef || application.aiInterview?.reportRef, 'AI 面试报告尚未回写');
    return [
        ...list(application.aiInterview?.riskNotes || application.aiInterview?.report?.riskNotes || []).map((item) => reportLine(item, '', 'danger')),
        ...list(application.aiInterview?.bonusNotes || application.aiInterview?.report?.bonusNotes || []).map((item) => reportLine(item, '', 'success')),
        reportLine('报告引用', reportRef, 'info'),
    ];
}

function markdownList(items, emptyText = '暂无', options = {}) {
    const rows = items
        .filter((item) => item.title || item.text)
        .slice(0, options.maxItems || items.length);
    if (!rows.length) return `- ${emptyText}\n`;
    return rows.map((item) => {
        const evidence = options.showEvidence === false ? '' : item.evidenceRefs?.length
            ? `\n  - 证据：${item.evidenceRefs.map(evidenceSummary).join('；')}`
            : '';
        const text = item.text ? `：${item.text}` : '';
        return `- **${item.title}**${text}${evidence}`;
    }).join('\n') + '\n';
}

function finishSentence(value, fallback = '') {
    const text = cleanText(value, fallback);
    if (!text) return '';
    return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

function reportRowText(item = {}) {
    return [item.title, item.text].map((value) => managerReportText(value)).filter(Boolean).join('：');
}

function managerReportText(value = '', fallback = '') {
    return cleanText(value, fallback)
        .replace(/需要?人工确认/g, '需继续核验')
        .replace(/人工确认关键结论/g, '继续核验关键结论')
        .replace(/仍需在\s*AI\s*面试中核验/g, '本轮面试重点核验')
        .replace(/^面试结论\s*/u, '')
        .replace(/^风险缺口[:：]?\s*/u, '')
        .trim();
}

function reportNarrative(items = [], fallback = '', limit = 3) {
    const rows = dedupeReportLines(items, limit)
        .map(reportRowText)
        .filter(Boolean);
    return finishSentence(naturalJoin(rows), fallback);
}

function compactReportPhrase(value = '', limit = 120) {
    return cleanText(value).replace(/\s+/g, ' ').slice(0, limit);
}

function reportPhraseList(items = [], limit = 3) {
    return dedupeReportLines(items, limit)
        .map(reportRowText)
        .map((item) => compactReportPhrase(item))
        .filter(Boolean);
}

function stripReportTail(value = '') {
    return cleanText(value).replace(/[。；;]+$/u, '');
}

function naturalJoin(rows = []) {
    return rows.map(stripReportTail).filter(Boolean).join('；');
}

function nextStepText(value = '') {
    return stripReportTail(value)
        .replace(/^(下一步|面试重点|建议追问|建议)[:：]\s*/u, '');
}

function composeMatchJudgment(report, keyRows = [], topRisks = []) {
    const summary = prescreenReportSummary(report.summary || '');
    if (summary && !/^(推荐 AI 面试|不建议继续|人工通过评价|招聘者已人工通过初筛)[。.]?$/u.test(summary)) {
        return finishSentence(summary);
    }
    const strengths = reportPhraseList(keyRows, 3);
    const risks = reportPhraseList(topRisks, 3);
    if (strengths.length && risks.length) {
        return `候选人与岗位存在可继续核验的匹配基础，主要体现在${naturalJoin(strengths)}。当前影响匹配度的关键缺口是${naturalJoin(risks)}。建议围绕这些缺口继续确认本人贡献、项目真实性和岗位相关深度。`;
    }
    if (strengths.length) {
        return `候选人与岗位的主要匹配点集中在${naturalJoin(strengths)}。现有材料能支撑进入下一轮核验。`;
    }
    if (risks.length) {
        return `当前材料中影响匹配度的主要问题是${naturalJoin(risks)}。需要先补足这些信息后再判断是否继续推进。`;
    }
    return finishSentence(report.recommendation || '报告已生成');
}

function renderObservationSection(keyRows = [], topRisks = []) {
    const strengths = reportPhraseList(keyRows, 3);
    const risks = reportPhraseList(topRisks, 3);
    if (!strengths.length && !risks.length) return [];
    return [
        '## 重点观察',
        strengths.length ? `优势：${naturalJoin(strengths)}。` : null,
        risks.length ? `不足：${naturalJoin(risks)}。` : null,
        '',
    ].filter((line) => line !== null);
}

function scorePercent(score = 0) {
    const numeric = Number(score);
    if (!Number.isFinite(numeric)) return 0;
    const value = numeric <= 5 ? numeric * 20 : numeric;
    return Math.max(0, Math.min(100, Math.round(value)));
}

function formatReportTime(value, fallback = '未记录') {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return cleanText(value, fallback);
    try {
        return new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(date).replace(/\//g, '-');
    } catch {
        return cleanText(value, fallback);
    }
}

function formatReportTimeRange(start, end, fallback = '未记录') {
    const startText = formatReportTime(start, '');
    const endText = formatReportTime(end, '');
    if (startText && endText && startText !== endText) return `${startText} - ${endText}`;
    return endText || startText || fallback;
}

function materialMarkdown(snapshot) {
    const resume = snapshot.resume
        ? `- 简历：${snapshot.resume.name}${snapshot.resume.storageKey ? '（有原文件）' : ''}`
        : '- 简历：未选择';
    const portfolios = snapshot.portfolios.length
        ? snapshot.portfolios.map((item) => {
            const attachmentCount = Array.isArray(item.attachments) ? item.attachments.length : 0;
            const screenshotCount = Array.isArray(item.screenshots) ? item.screenshots.length : 0;
            return `- 作品：${item.title}（附件 ${attachmentCount}，截图 ${screenshotCount}）`;
        }).join('\n')
        : '- 作品：未选择';
    const knowledge = snapshot.knowledge.length
        ? snapshot.knowledge.map((item) => `- 可选知识库：${item.name}${item.storageKey ? '（有原文件）' : ''}`).join('\n')
        : '- 可选知识库：未选择';
    return [resume, portfolios, knowledge].join('\n');
}

function prescreenReportSummary(value = '') {
    const summary = cleanText(value);
    if (/招聘者已(发送 AI 面试邀请|人工通过初筛并发起 AI 面试)|视为人工通过初筛进入 AI 面试/.test(summary)) {
        return '';
    }
    return summary;
}

export async function buildInformationMatchReport(applicationOrId) {
    const application = typeof applicationOrId === 'string'
        ? await getApplication(applicationOrId)
        : applicationOrId;
    if (!application) return null;
    const [candidate, job] = await Promise.all([
        getCandidate(application.candidateId),
        getJob(application.jobId),
    ]);
    const snapshot = materialSnapshot(application);
    const report = {
        applicationId: application.id,
        generatedAt: application.prescreen?.generatedAt || '',
        candidate: {
            id: candidate?.id || application.candidateId,
            name: candidate?.name || '候选人',
            idTail: candidate?.idTail || '',
        },
        job: {
            id: job?.id || application.jobId,
            title: job?.title || '岗位',
            knowledge: job?.knowledge || [],
            screeningRules: job?.screeningRules || [],
        },
        recommendation: application.prescreen?.recommendation || application.screen || '待评价',
        summary: prescreenReportSummary(application.prescreen?.summary || ''),
        adminSuggestion: application.prescreen?.adminSuggestion || '',
        score: application.score || application.prescreen?.score || 0,
        markdownReport: application.prescreen?.markdownReport || '',
        materialSnapshot: snapshot,
        evidenceCount: application.evidencePack?.evidenceRefs?.length || 0,
        hits: matchedItems(application),
        risks: riskItems(application),
        gaps: gapItems(application),
        visualEvidence: visualEvidenceItems(application),
        aiSupplement: aiSupplement(application),
        materialUpdatedAt: snapshot.lockedAt || application.updatedAt || application.createdAt || '',
        evidenceNote: application.prescreen?.evidenceNote || '',
    };
    const markdown = renderInformationMatchMarkdown(report);
    return {report, markdown};
}

export function renderInformationMatchMarkdown(report) {
    if (report.markdownReport) {
        return [
            report.markdownReport.trim(),
            '',
            '## 已投递材料',
            materialMarkdown(report.materialSnapshot),
            '',
            '## 说明',
            `- 结构化总分：${report.score}/10`,
            `- 证据引用数量：${report.evidenceCount}`,
            '- AI 只生成建议，最终决策由招聘者完成。',
            '- 若报告标记“材料未体现”或“未读取图片”，表示对应信息不能作为强证据。',
        ].join('\n') + '\n';
    }
    const topRisks = dedupeReportLines([
        ...(report.gaps || []).map((item) => coerceReportLine(item, 'warning')),
        ...(report.risks || []).map((item) => coerceReportLine(item, 'danger')),
    ], 6);
    const keyRows = dedupeReportLines((report.hits || []).map((item) => coerceReportLine(item, 'success')), 5);
    const evaluationText = composeMatchJudgment(report, keyRows, topRisks);
    const keyEvidenceSection = keyRows.length ? [
        '## 匹配证据',
        markdownList(keyRows, '', {maxItems: 5, showEvidence: false}),
        '',
    ] : [];
    const riskText = reportNarrative(topRisks, '', 6);
    const riskSection = topRisks.length ? [
        '## 缺口与风险',
        riskText,
        '',
    ] : [];
    return [
        `# 初筛报告：${report.candidate.name} / ${report.job.title}`,
        '',
        `材料投递/更新：${formatReportTime(report.materialUpdatedAt || report.materialSnapshot?.lockedAt)}`,
        `报告生成：${formatReportTime(report.generatedAt)}`,
        '',
        `> **初筛建议：${report.recommendation}**`,
        report.adminSuggestion ? `> 下一步：${nextStepText(report.adminSuggestion)}` : null,
        '',
        evaluationText ? '## 匹配判断' : null,
        evaluationText || finishSentence(report.recommendation),
        '',
        ...renderObservationSection(keyRows, topRisks),
        ...keyEvidenceSection,
        ...riskSection,
        '## 已投递材料',
        materialMarkdown(report.materialSnapshot),
        '',
        '## 说明',
        `- 证据引用数量：${report.evidenceCount}`,
        '- AI 只生成建议，最终决策由招聘者完成。',
        '- 若报告标记“未读取图片”，表示模型没有识别截图像素，只能作为候选人自述线索。',
    ].filter((line) => line !== null).join('\n') + '\n';
}

function aiInterviewCompleted(application = {}) {
    return application.interviewStatus === 'completed'
        || application.aiInterview?.status === 'completed'
        || Boolean(application.reviewReportRef);
}

function aiTraceTurns(application = {}) {
    const fullTrace = application.aiInterview?.fullTrace || application.aiInterview?.demo?.fullTrace;
    return Array.isArray(fullTrace?.turns) ? fullTrace.turns : [];
}

function aiTraceQuality(application = {}) {
    const fullTrace = application.aiInterview?.fullTrace || application.aiInterview?.demo?.fullTrace;
    const turns = aiTraceTurns(application);
    if (!fullTrace && !turns.length) return null;
    const plannedQuestions = Number(fullTrace?.questionCount || 0) || turns.filter((turn) => /^q\d+/i.test(turn.questionId || '')).length;
    const effectiveTurns = turns.filter((turn) => cleanText(turn.answerText || turn.answer).length >= 20);
    const emptyTurns = turns.filter((turn) => !cleanText(turn.answerText || turn.answer));
    return {
        status: effectiveTurns.length ? '已完成' : turns.length ? '有效回答不足' : '未记录回答',
        answeredQuestions: effectiveTurns.length,
        plannedQuestions,
        effectiveAnswerCount: effectiveTurns.length,
        emptyAnswerCount: emptyTurns.length,
        endedReason: turns.some((turn) => turn.turnType === 'manual_close') ? '候选人或系统手动结束面试' : '',
    };
}

function questionAssessmentReportLine(item = {}, index = 0) {
    const title = cleanText(item.dimension || item.competency || item.question || item.title, `题目 ${index + 1}`);
    const text = [
        item.summary,
        item.assessment,
        item.evaluation,
        item.comment,
        item.answerQuality,
        item.signal,
        item.risk ? `风险：${item.risk}` : '',
        item.gap ? `缺口：${item.gap}` : '',
        item.score != null ? `评分：${item.score}` : '',
    ].map((value) => cleanText(value)).filter(Boolean).join('；');
    return reportLine(title, text, 'info');
}

function firstNonEmptyArray(...values) {
    return values.find((value) => Array.isArray(value) && value.length) || [];
}

function aiReportData(application = {}) {
    const ai = application.aiInterview || {};
    const report = ai.report || {};
    const quality = report.interviewQuality || ai.interviewQuality || aiTraceQuality(application) || {};
    const completed = aiInterviewCompleted(application);
    const rawText = [
        report.recommendation,
        report.summary,
        report.decisionReason,
        ai.recommendation,
        ai.summary,
        ai.decisionReason,
    ].filter(Boolean).join(' ');
    const recommendation = normalizeAiRecommendationText(report.recommendation || ai.recommendation, rawText, completed);
    const summary = compactAiReportText(report.summary || ai.summary || report.decisionReason || ai.decisionReason, '', 160);
    const decisionReason = compactAiReportText(report.decisionReason || ai.decisionReason || report.summary || ai.summary, '', 180);
    return {
        completed,
        status: completed ? '已完成'
            : ai.status === 'pending' || application.interviewStatus === 'pending' ? '已发起，等待候选人完成'
                : application.interviewStatus === 'in_progress' || ai.status === 'in_progress' ? '面试进行中'
                    : '未进行 AI 面试',
        recommendation,
        tone: /不建议|暂缓|未通过|无效|无法|不足/.test(rawText) ? 'negative'
            : /建议|推荐|通过|进入|继续|真人|人工面试/.test(rawText) ? 'positive'
                : 'neutral',
        summary,
        decisionReason,
        markdownReport: cleanText(report.markdownReport || report.text || ai.markdownReport || ''),
        riskNotes: compactAiReportList(firstNonEmptyArray(report.riskNotes, ai.riskNotes), 4, 120),
        bonusNotes: compactAiReportList(firstNonEmptyArray(report.bonusNotes, ai.bonusNotes), 4, 120),
        followUpQuestions: compactAiReportList(firstNonEmptyArray(report.followUpQuestions, ai.followUpQuestions), 4, 120),
        questionAssessments: firstNonEmptyArray(report.questionAssessments, ai.questionAssessments).slice(0, 8),
        quality,
        reportRef: cleanText(ai.reportRef || application.reviewReportRef || report.ref, ''),
        startedAt: ai.startedAt || report.startedAt || application.interviewSession?.startedAt || '',
        completedAt: ai.completedAt || report.completedAt || '',
        generatedAt: report.generatedAt || ai.reportGeneratedAt || '',
    };
}

function managerVisibleTraceText(value, fallback = '') {
    return cleanText(value, fallback)
        .replace(/sourceRefs/gi, '来源引用')
        .replace(/portfolio_field/gi, '作品字段')
        .replace(/model_text/gi, '模型文本')
        .replace(/interview_plan/gi, '面试计划');
}

function hasFullInterviewTraceSection(markdown = '') {
    return /^##\s+(?:[^\u4e00-\u9fffA-Za-z0-9]+\s*)?完整(?:面试|问答)记录/m.test(String(markdown || ''));
}

function aiInterviewTraceMarkdown(application = {}, report = {}) {
    const existingMarkdown = cleanText(report.markdownReport || report.text || '');
    if (hasFullInterviewTraceSection(existingMarkdown)) return [];
    const fullTrace = application.aiInterview?.fullTrace || application.aiInterview?.demo?.fullTrace;
    const traceTurns = Array.isArray(fullTrace?.turns) ? fullTrace.turns : [];
    if (!fullTrace && !traceTurns.length) return [];
    const meta = [
        '- 完整问答用于复核原始回答，不替代上面的面评摘要。',
        `- 轮次：${traceTurns.length || fullTrace?.turnCount || 0}`,
        report.completedAt ? `- 完成时间：${formatReportTime(report.completedAt)}` : '',
        fullTrace?.sessionId ? `- 会话 ID：${fullTrace.sessionId}` : '',
    ].filter(Boolean);
    const turns = traceTurns.length
        ? traceTurns.slice(0, 50).flatMap((turn, index) => [
            `### Q${index + 1}`,
            `**面试官：** ${managerVisibleTraceText(turn.questionText || turn.question, '面试问题')}`,
            '',
            `**候选人：** ${managerVisibleTraceText(turn.answerText || turn.answer, '未记录回答文本')}`,
            '',
        ])
        : ['- 完整 session 已保存，但当前快照未带逐轮问答文本。'];
    return [
        '## 完整问答记录',
        ...meta,
        '',
        ...turns,
    ];
}

function aiInitialFocus(application = {}, initialReport = null) {
    const rows = dedupeReportLines([
        ...(initialReport?.gaps || []).map((item) => coerceReportLine(item, 'warning')),
        ...(initialReport?.risks || []).map((item) => coerceReportLine(item, 'danger')),
        ...(application.prescreen?.gaps || []).map((item) => reportLine(item, '', 'warning')),
        ...(application.prescreen?.risks || []).map((item) => reportLine(item, '', 'danger')),
    ], 3);
    const summary = prescreenReportSummary(application.prescreen?.summary || initialReport?.summary || '');
    const focus = reportNarrative(rows, '', 3);
    return managerReportText(focus || summary);
}

function aiQuestionAssessmentRows(report = {}) {
    return (report.questionAssessments || []).map((item, index) => questionAssessmentReportLine(item, index));
}

function aiInterviewStrengthRows(report = {}) {
    return dedupeReportLines([
        ...report.bonusNotes.map((item) => reportLine('面试亮点', item, 'success')),
        report.summary && !/未通过|不建议|无效|不足|无法/.test(report.summary)
            ? reportLine('表现概况', report.summary, 'info')
            : null,
    ].filter(Boolean), 5);
}

function aiInterviewRiskRows(report = {}) {
    const riskNoteRows = report.riskNotes.map((item) => reportLine('风险缺口', item, 'danger'));
    return dedupeReportLines([
        ...riskNoteRows,
        !riskNoteRows.length && report.decisionReason ? reportLine('结论原因', report.decisionReason, report.tone === 'negative' ? 'danger' : 'info') : null,
        report.quality.emptyAnswerCount ? reportLine('回答质量', `空白或过短 ${report.quality.emptyAnswerCount} 轮`, 'warning') : null,
        report.quality.status && /不足|未记录|无效/.test(report.quality.status) ? reportLine('回答质量', report.quality.status, 'warning') : null,
    ].filter(Boolean), 6);
}

function reportTextList(items = [], limit = 5) {
    const seen = new Set();
    const rows = [];
    for (const item of dedupeReportLines(items, limit)) {
        const text = managerReportText(item.text || item.title);
        const key = text.replace(/\s+/g, '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(text);
        if (rows.length >= limit) break;
    }
    return rows;
}

function composeAiInterviewJudgment(report = {}, initialFocus = '', strengthRows = [], riskRows = []) {
    const directJudgment = compactAiReportText(report.decisionReason || report.summary, '', 260);
    const strengths = reportTextList(strengthRows, 4);
    const risks = reportTextList(riskRows, 5);
    const parts = [];
    parts.push(`${report.recommendation || 'AI 面试已完成'}。`);
    if (directJudgment) parts.push(finishSentence(directJudgment));
    if (initialFocus) {
        parts.push(`结合初筛，面试重点是在核验${finishSentence(initialFocus)}`);
    }
    if (strengths.length) {
        parts.push(`本轮回答里的正向信号是${naturalJoin(strengths)}。`);
    }
    if (risks.length) {
        parts.push(`仍然影响匹配度的关键问题是${naturalJoin(risks)}。`);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function renderAiObservationSection(strengthRows = [], riskRows = []) {
    const strengths = reportTextList(strengthRows, 4);
    const risks = reportTextList(riskRows, 5);
    if (!strengths.length && !risks.length) return [];
    return [
        '## 面试表现',
        strengths.length ? `优势：${naturalJoin(strengths)}。` : null,
        risks.length ? `不足：${naturalJoin(risks)}。` : null,
        '',
    ].filter((line) => line !== null);
}

function renderAiInterviewMarkdown(application = {}, initialReport = null) {
    const report = aiReportData(application);
    const candidateName = initialReport?.candidate?.name || application.candidateName || application.candidateId || '候选人';
    const jobTitle = initialReport?.job?.title || application.jobTitle || application.jobId || '岗位';
    const initialDecision = initialReport?.recommendation || application.prescreen?.recommendation || application.screen || '初筛待核验';
    const initialFocus = aiInitialFocus(application, initialReport);
    if (!report.completed) {
        return [
            `# AI 面试综合报告：${candidateName} / ${jobTitle}`,
            '',
            `> 状态：${report.status}`,
            `> 初筛：${initialDecision}`,
            '',
            '本次尚未形成 AI 面试报告。导出中先保留初筛结论和当前面试状态，便于确认候选人当前流程阶段。',
            '',
            '## 当前判断',
            finishSentence(initialFocus || application.screen, '初筛阶段尚未形成明确摘要。'),
            '',
            '## 等待面试补充',
            'AI 面试完成后，这里会重点补充现场回答、项目拆解、本人贡献、技术/业务理解和仍需人工追问的点。',
        ].join('\n') + '\n';
    }
    if (report.markdownReport) {
        const traceSection = aiInterviewTraceMarkdown(application, report);
        return [
            report.markdownReport.trim(),
            '',
            ...traceSection,
            traceSection.length ? '' : null,
            '## 系统记录',
            report.reportRef ? `- 报告引用：${report.reportRef}` : '',
            report.completedAt ? `- 完成时间：${formatReportTime(report.completedAt)}` : '',
            '- AI 只生成建议，最终决策由招聘者完成。',
        ].filter((line) => line !== null).join('\n') + '\n';
    }
    const qualityText = [
        report.quality.answeredQuestions != null && report.quality.plannedQuestions != null
            ? `有效覆盖 ${report.quality.answeredQuestions}/${report.quality.plannedQuestions} 题`
            : '',
        report.quality.emptyAnswerCount ? `空白或过短 ${report.quality.emptyAnswerCount} 轮` : '',
        report.quality.endedReason,
    ].filter(Boolean).join('；');
    const strengthRows = aiInterviewStrengthRows(report);
    const riskRows = aiInterviewRiskRows(report);
    const questionSummary = aiQuestionAssessmentRows(report);
    const overallText = finishSentence(composeAiInterviewJudgment(report, initialFocus, strengthRows, riskRows), '');
    const fullTrace = application.aiInterview?.fullTrace || application.aiInterview?.demo?.fullTrace;
    const traceTurns = fullTrace?.turns || [];
    const reportGeneratedAt = report.generatedAt || new Date().toISOString();
    const interviewTime = formatReportTimeRange(
        report.startedAt || fullTrace?.startedAt || application.aiInterview?.startedAt,
        report.completedAt || fullTrace?.completedAt || application.aiInterview?.completedAt
    );
    const traceLines = traceTurns.length
        ? traceTurns.slice(0, 20).flatMap((turn, index) => [
            `### Q${index + 1} ${managerVisibleTraceText(turn.questionText || turn.question, '面试问题')}`,
            managerVisibleTraceText(turn.answerText || turn.answer, '未记录回答文本'),
            '',
        ])
        : [];
    const observationSection = renderAiObservationSection(strengthRows, riskRows);
    const followUpSection = report.followUpQuestions.length ? [
        '## 继续核验点',
        markdownList(report.followUpQuestions.map((item) => reportLine('追问', item, 'info')), '', {showEvidence: false, maxItems: report.followUpQuestions.length}),
        '',
    ] : [];
    const questionSection = questionSummary.length ? [
        '## 能力观察',
        markdownList(questionSummary, '', {showEvidence: false, maxItems: questionSummary.length}),
        '',
    ] : [];
    const traceMeta = [
        '- 完整记录用于复核原始问答，不替代上面的面评摘要。',
        report.completedAt ? `- 完成时间：${formatReportTime(report.completedAt)}` : '',
        fullTrace?.sessionId ? `- 会话 ID：${fullTrace.sessionId}` : '',
    ].filter(Boolean);
    return [
        `# AI 面试综合报告：${candidateName} / ${jobTitle}`,
        '',
        `面试时间：${interviewTime}`,
        `报告生成：${formatReportTime(reportGeneratedAt)}`,
        '',
        `> **综合结论：${combinedRecommendation(application, initialReport)}**`,
        `> ${['初筛：' + initialDecision, 'AI 面试：' + report.recommendation, qualityText].filter(Boolean).join('；')}`,
        '',
        overallText ? '## 综合面评' : '',
        overallText,
        '',
        ...observationSection,
        ...followUpSection,
        ...questionSection,
        '## 完整问答记录',
        ...traceMeta,
        '',
        ...traceLines,
    ].filter((line) => line !== '').join('\n') + '\n';
}

function combinedRecommendation(application = {}, initialReport = null) {
    const ai = aiReportData(application);
    if (ai.completed && ai.tone === 'positive') return 'AI 面试通过';
    if (ai.completed && ai.tone === 'negative') return 'AI 面试未通过';
    if (ai.completed) return 'AI 面试已完成';
    if (/推荐 AI 面试/.test(initialReport?.recommendation || application.prescreen?.recommendation || '')) return '初筛通过，等待 AI 面试';
    if (/不建议/.test(initialReport?.recommendation || application.prescreen?.recommendation || '')) return '初筛未通过';
    return '初筛待核验';
}

function renderCombinedApplicationMarkdown(application = {}, initialReport = null) {
    const ai = aiReportData(application);
    const recommendation = combinedRecommendation(application, initialReport);
    const basis = [
        initialReport?.recommendation ? `初筛：${initialReport.recommendation}` : '',
        ai.completed ? `AI 面试：${ai.recommendation}` : `AI 面试：${ai.status}`,
    ].filter(Boolean);
    const combinedText = ai.completed
        ? finishSentence(ai.decisionReason || ai.summary, 'AI 面试已完成，结合初筛证据和面试表现形成当前判断。')
        : /推荐 AI 面试/.test(initialReport?.recommendation || application.prescreen?.recommendation || '')
            ? '候选人已通过初筛，现有材料具备继续核验基础，当前综合判断等待 AI 面试补充。'
            : finishSentence(initialReport?.summary || application.prescreen?.summary || initialReport?.recommendation, '当前仍处于初筛阶段，尚未形成 AI 面试补充判断。');
    return [
        `# 综合报告：${initialReport?.candidate?.name || application.candidateId} / ${initialReport?.job?.title || application.jobId}`,
        '',
        `> **${recommendation}**`,
        `> ${combinedText}`,
        '',
        '## 综合判断',
        combinedText,
        '',
        '## 关键依据',
        markdownList(basis.map((item) => reportLine(item, '', 'info')), '暂无判断依据', {showEvidence: false}),
        '',
        '## 后续核验点',
        markdownList([
            ...(initialReport?.gaps || []),
            ...(initialReport?.risks || []),
            ...ai.followUpQuestions.map((item) => reportLine(item, '', 'info')),
        ], '暂无额外核验点', {showEvidence: false, maxItems: 6}),
        '',
        '## 当前状态',
        `- 投递状态：${application.status || '未知'}`,
        `- AI 面试：${ai.status}`,
    ].filter((line) => line !== '').join('\n') + '\n';
}

function markdownAsSection(markdown = '', title = '报告') {
    const lines = String(markdown || '').split(/\r?\n/);
    if (lines[0]?.startsWith('# ')) {
        lines.shift();
        if (!lines[0]?.trim()) lines.shift();
    }
    return [`## ${title}`, '', ...lines].join('\n').trimEnd() + '\n';
}

function renderFullApplicationExportMarkdown(application = {}, result) {
    const candidateName = result?.report?.candidate?.name || application.candidateId || '候选人';
    const jobTitle = result?.report?.job?.title || application.jobId || '岗位';
    return [
        `# ${candidateName} / ${jobTitle} 评估报告`,
        '',
        markdownAsSection(renderCombinedApplicationMarkdown(application, result?.report), '综合摘要'),
        '',
        '---',
        '',
        markdownAsSection(result?.markdown || '', '初筛报告'),
        '',
        '---',
        '',
        markdownAsSection(renderAiInterviewMarkdown(application, result?.report), 'AI 面试综合报告'),
    ].join('\n').trimEnd() + '\n';
}

function renderHumanInterviewMarkdown(application = {}, initialReport = null) {
    const candidateName = initialReport?.candidate?.name || application.candidateName || application.candidateId || '候选人';
    const jobTitle = initialReport?.job?.title || application.jobTitle || application.jobId || '岗位';
    const decision = application.humanDecision?.decision || application.humanDecision?.status || application.decision || '暂无';
    const note = cleanText(application.humanDecision?.note || application.reviewNote || '', '暂无人工面试安排。');
    return [
        `# 人工面试报告：${candidateName} / ${jobTitle}`,
        '',
        `> 当前人工结果：${decision}`,
        '',
        '## 人工面试概况',
        note,
        '',
        '## 接口说明',
        '- 当前版本先保留人工面试报告位。',
        '- 后续可接入一面、二面、终面的排期、面评和最终定级。',
        '- AI 只生成建议，最终决策由招聘者完成。',
    ].join('\n') + '\n';
}

export async function buildApplicationReportMarkdown(applicationId, reportKind = 'prescreen') {
    const application = await getApplication(applicationId);
    if (!application) return null;
    const result = await buildInformationMatchReport(application);
    if (!result) return null;
    const kind = ['prescreen', 'ai', 'human'].includes(reportKind) ? reportKind : 'prescreen';
    const candidateName = result.report?.candidate?.name || application.candidateId || '候选人';
    const jobTitle = result.report?.job?.title || application.jobId || '岗位';
    const reportNames = {
        prescreen: '初筛报告',
        ai: 'AI面试综合报告',
        human: '人工面试报告',
    };
    const markdown = kind === 'ai'
        ? renderAiInterviewMarkdown(application, result.report)
        : kind === 'human'
            ? renderHumanInterviewMarkdown(application, result.report)
            : result.markdown;
    return {
        markdown,
        fileName: `${safeName(candidateName, '候选人')}-${safeName(jobTitle, '岗位')}-${reportNames[kind]}.md`,
    };
}

const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let j = 0; j < 8; j += 1) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[i] = value >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const year = Math.max(date.getFullYear(), 1980);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return {time, day};
}

function uint16(value) {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16LE(value);
    return buffer;
}

function uint32(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value >>> 0);
    return buffer;
}

function zipStore(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const {time, day} = dosDateTime();
    for (const file of files) {
        const name = Buffer.from(file.name, 'utf8');
        const body = Buffer.isBuffer(file.content)
            ? file.content
            : Buffer.from(String(file.content ?? ''), 'utf8');
        const crc = crc32(body);
        const localHeader = Buffer.concat([
            uint32(0x04034b50),
            uint16(20),
            uint16(0x0800),
            uint16(0),
            uint16(time),
            uint16(day),
            uint32(crc),
            uint32(body.length),
            uint32(body.length),
            uint16(name.length),
            uint16(0),
            name,
        ]);
        localParts.push(localHeader, body);
        const centralHeader = Buffer.concat([
            uint32(0x02014b50),
            uint16(20),
            uint16(20),
            uint16(0x0800),
            uint16(0),
            uint16(time),
            uint16(day),
            uint32(crc),
            uint32(body.length),
            uint32(body.length),
            uint16(name.length),
            uint16(0),
            uint16(0),
            uint16(0),
            uint16(0),
            uint32(0),
            uint32(offset),
            name,
        ]);
        centralParts.push(centralHeader);
        offset += localHeader.length + body.length;
    }
    const central = Buffer.concat(centralParts);
    const end = Buffer.concat([
        uint32(0x06054b50),
        uint16(0),
        uint16(0),
        uint16(files.length),
        uint16(files.length),
        uint32(central.length),
        uint32(offset),
        uint16(0),
    ]);
    return Buffer.concat([...localParts, central, end]);
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function exportTimestamp(date = new Date()) {
    return [
        date.getFullYear(),
        pad2(date.getMonth() + 1),
        pad2(date.getDate()),
    ].join('') + '-' + [pad2(date.getHours()), pad2(date.getMinutes())].join('');
}

const exportStageLabels = {
    all: '全部',
    prescreen_passed: '初筛通过',
    ai_interview_passed: 'AI面试通过',
    prescreen_ready: '待发AI面试',
    interview_pending: '已邀面试',
    interview_done_positive: 'AI面试通过',
    interview_done_negative: 'AI面试未通过',
    manual_pending: '待处理',
    manual_passed: '已通过',
    manual_rejected: '已拒绝',
};

function exportStageLabel(stage = 'all') {
    return exportStageLabels[stage] || exportStageLabels.all;
}

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

function fileDisplayName(item = {}, fallback = 'material') {
    return cleanText(item.fileName || item.name || item.title || fallback, fallback);
}

async function appendStoredFile(files, name, item = {}) {
    if (!item?.storageKey) {
        files.push({
            name: `${name}.缺失说明.txt`,
            content: [
                '没有可导出的原始文件。',
                `材料名称：${fileDisplayName(item, '未知材料')}`,
                '可能原因：历史数据未保存 storageKey，或这份材料本来就是结构化文本。',
            ].join('\n') + '\n',
        });
        return false;
    }
    try {
        const stream = await getObjectReadStream(item.storageKey);
        files.push({name, content: await streamToBuffer(stream)});
        return true;
    }
    catch (error) {
        files.push({
            name: `${name}.读取失败.txt`,
            content: `原文件读取失败：${error.message || String(error)}\n`,
        });
        return false;
    }
}

function uniqueFolderName(base, used) {
    const clean = safeName(base, '候选人');
    const count = (used.get(clean) || 0) + 1;
    used.set(clean, count);
    return count === 1 ? clean : `${clean}-${count}`;
}

function portfolioExportMarkdown(portfolio = {}) {
    const rows = [
        ['岗位关联方向', portfolio.jobDirection],
        ['一句话价值', portfolio.oneLineValue],
        ['使用场景', portfolio.scenario],
        ['本人职责', portfolio.role],
        ['本人贡献', portfolio.contribution],
        ['可验证链接', portfolio.evidenceUrl],
        ['结果指标/预期价值', portfolio.outcome],
        ['最大难点', portfolio.challenge],
        ['复盘改进', portfolio.reflection],
    ].filter(([, value]) => cleanText(value));
    const screenshots = (portfolio.screenshots || []).map((item, index) => (
        `- 截图 ${index + 1}：${fileDisplayName(item, `截图-${index + 1}`)}${cleanText(item.caption) ? `，说明：${cleanText(item.caption)}` : ''}`
    ));
    const attachments = (portfolio.attachments || []).map((item, index) => (
        `- 附件 ${index + 1}：${fileDisplayName(item, `附件-${index + 1}`)}`
    ));
    return [
        `# 作品：${cleanText(portfolio.title || portfolio.name, '未命名作品')}`,
        '',
        ...rows.flatMap(([label, value]) => [`## ${label}`, cleanText(value), '']),
        '## 附件与截图',
        attachments.length ? attachments.join('\n') : '- 附件：无',
        screenshots.length ? screenshots.join('\n') : '- 截图：无',
    ].join('\n').trimEnd() + '\n';
}

function parseCsv(value = '') {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function exportStageKey(application = {}) {
    const ai = aiReportData(application);
    if (application.status === '已通过' || application.decision === '通过') return 'manual_passed';
    if (application.status === '已拒绝' || application.decision === '拒绝') return 'manual_rejected';
    if (ai.completed && ai.tone === 'positive') return 'interview_done_positive';
    if (ai.completed && ai.tone === 'negative') return 'interview_done_negative';
    if (ai.completed || application.status === '待审核' || application.decision === '待定') return 'manual_pending';
    if (application.interviewStatus === 'pending' || application.interviewStatus === 'in_progress') return 'interview_pending';
    if (application.status === '待 AI 面试' || /推荐 AI 面试/.test(application.prescreen?.recommendation || '')) return 'prescreen_ready';
    return 'all';
}

function exportHumanDecisionState(application = {}) {
    const text = [
        application.humanDecision?.status,
        application.decision,
        application.status,
    ].filter(Boolean).join(' ');
    if (/通过/.test(text)) return 'passed';
    if (/拒绝|淘汰/.test(text)) return 'rejected';
    if (/暂缓/.test(text)) return 'held';
    return '';
}

function exportHasAiInterview(application = {}) {
    const interviewStatus = cleanText(application.interviewStatus || application.aiInterview?.status, '');
    return Boolean(
        (interviewStatus && !['none', 'not_started', 'idle'].includes(interviewStatus))
        || application.reviewReportRef
        || application.interviewSessionRef
        || application.aiInterview?.demo?.sessionId
        || application.aiInterview?.invitedAt
        || application.aiInterview?.expiresAt
    );
}

function exportPrescreenPassed(application = {}) {
    if (exportHumanDecisionState(application) === 'rejected') return false;
    return Boolean(
        application.prescreen?.recommendation === '推荐 AI 面试'
        || application.status === '待 AI 面试'
        || application.status === '已通过'
        || exportHasAiInterview(application)
    );
}

function exportAiInterviewPassed(application = {}) {
    const decision = exportHumanDecisionState(application);
    if (decision === 'passed') return true;
    if (decision === 'rejected' || decision === 'held') return false;
    const ai = aiReportData(application);
    return ai.completed && ai.tone === 'positive';
}

function exportStageMatches(application = {}, stage = 'all') {
    if (!stage || stage === 'all') return true;
    if (stage === 'prescreen_passed') return exportPrescreenPassed(application);
    if (stage === 'ai_interview_passed') return exportAiInterviewPassed(application);
    return exportStageKey(application) === stage;
}

function filterExportApplications(applications = [], options = {}) {
    const selectedIds = new Set(parseCsv(options.appIds || options.applicationIds || options.ids));
    const stage = cleanText(options.stage || 'all', 'all');
    return applications.filter((application) => {
        if (selectedIds.size && !selectedIds.has(application.id)) return false;
        if (!exportStageMatches(application, stage)) return false;
        return true;
    });
}

export async function buildJobMatchReportArchive(jobId, options = {}) {
    const [job, applications] = await Promise.all([
        getJob(jobId),
        listApplicationsForJob(jobId),
    ]);
    if (!job) return null;
    const files = [];
    const scopedApplications = filterExportApplications(applications, options);
    const stageLabel = exportStageLabel(cleanText(options.stage || 'all', 'all'));
    const selectedIds = parseCsv(options.appIds || options.applicationIds || options.ids);
    const rootName = safeName(`${exportTimestamp()}-${stageLabel}${selectedIds.length ? `-已选${scopedApplications.length}人` : ''}`, '资料和报告');
    const usedCandidateFolders = new Map();
    files.push({
        name: `${rootName}/导出说明.md`,
        content: [
            `# ${job.title || '岗位'} 资料和报告导出`,
            '',
            `- 导出时间：${new Date().toISOString()}`,
            `- 筛选进度：${stageLabel}`,
            `- 候选人数：${scopedApplications.length}`,
            '- 每个候选人目录包含合并报告、简历、可选知识库、作品说明及可读取到的原始附件/截图。',
        ].join('\n') + '\n',
    });
    for (const application of scopedApplications) {
        const result = await buildInformationMatchReport(application);
        if (!result) continue;
        const candidateFolder = `${rootName}/${uniqueFolderName(result.report.candidate.name, usedCandidateFolders)}`;
        const snapshot = result.report.materialSnapshot || materialSnapshot(application);
        files.push({
            name: `${candidateFolder}/报告.md`,
            content: renderFullApplicationExportMarkdown(application, result),
        });
        if (snapshot.resume) {
            await appendStoredFile(
                files,
                `${candidateFolder}/简历/${safeName(fileDisplayName(snapshot.resume, '简历'), '简历')}`,
                snapshot.resume
            );
        }
        else {
            files.push({
                name: `${candidateFolder}/简历/材料缺失说明.md`,
                content: '# 简历\n\n本次投递未选择简历，或历史快照里没有可导出的简历文件。\n',
            });
        }
        for (const item of snapshot.knowledge || []) {
            await appendStoredFile(
                files,
                `${candidateFolder}/知识库/${safeName(fileDisplayName(item, '知识库'), '知识库')}`,
                item
            );
        }
        if (!(snapshot.knowledge || []).length) {
            files.push({
                name: `${candidateFolder}/知识库/材料缺失说明.md`,
                content: '# 可选知识库\n\n本次投递未选择候选人知识库。\n',
            });
        }
        for (const [portfolioIndex, portfolio] of (snapshot.portfolios || []).entries()) {
            const portfolioFolder = `${candidateFolder}/作品/${safeName(portfolio.title || portfolio.name || `作品-${portfolioIndex + 1}`, `作品-${portfolioIndex + 1}`)}`;
            files.push({
                name: `${portfolioFolder}/作品说明.md`,
                content: portfolioExportMarkdown(portfolio),
            });
            if (portfolio.storageKey) {
                await appendStoredFile(
                    files,
                    `${portfolioFolder}/${safeName(fileDisplayName(portfolio, '作品原文件'), '作品原文件')}`,
                    portfolio
                );
            }
            for (const [index, attachment] of (portfolio.attachments || []).entries()) {
                await appendStoredFile(
                    files,
                    `${portfolioFolder}/附件/${safeName(fileDisplayName(attachment, `附件-${index + 1}`), `附件-${index + 1}`)}`,
                    attachment
                );
            }
            for (const [index, screenshot] of (portfolio.screenshots || []).entries()) {
                await appendStoredFile(
                    files,
                    `${portfolioFolder}/截图/${safeName(fileDisplayName(screenshot, `截图-${index + 1}`), `截图-${index + 1}`)}`,
                    screenshot
                );
            }
        }
        if (!(snapshot.portfolios || []).length) {
            files.push({
                name: `${candidateFolder}/作品/材料缺失说明.md`,
                content: '# 作品\n\n本次投递未选择作品。\n',
            });
        }
    }
    if (scopedApplications.length === 0) {
        files.push({
            name: `${rootName}/暂无候选人.md`,
            content: `# ${job.title} 报告导出\n\n当前筛选范围下没有可导出的候选人报告。\n`,
        });
    }
    return {
        fileName: `${safeName(job.title, '岗位')}-${rootName}-资料和报告.zip`,
        buffer: zipStore(files),
        count: scopedApplications.length,
    };
}
