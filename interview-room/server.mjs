import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const port = Number(process.env.INTERVIEW_PORT || process.env.PORT || 5174);
const host = process.env.INTERVIEW_HOST || '127.0.0.1';
const publicRoot = resolve('public');
const sessions = new Map();

const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
};

function sendJson(response, status, body) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, x-interview-bridge-secret',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    response.end(JSON.stringify(body));
}

async function readJson(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(chunk);
        if (chunks.reduce((total, item) => total + item.length, 0) > 1024 * 1024) {
            throw new Error('request_too_large');
        }
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sessionForClient(session) {
    if (!session) return null;
    const {callback, ...safe} = session;
    return safe;
}

function questionBank(snapshot = {}) {
    const configured = snapshot.interviewPlan?.questions || [];
    if (configured.length) {
        return configured.map((question, index) => ({
            ...question,
            id: question.id || `plan-q${index + 1}`,
            competency: question.competency || question.type || question.label || '结构化问答',
            prompt: question.prompt || question.text || question.question || question.title || `请回答第 ${index + 1} 个问题。`,
        }));
    }
    return [
        {
            id: 'fixture-q1',
            competency: '项目经历',
            prompt: '请选择一个最能代表你能力的项目，说明你负责什么、做了什么、结果如何。',
        },
        {
            id: 'fixture-q2',
            competency: '复盘与取舍',
            prompt: '项目中最关键的一次取舍是什么？如果重做一次，你会改变什么？',
        },
        {
            id: 'fixture-q3',
            competency: '协作与风险',
            prompt: '请讲一次你发现风险并推动团队解决问题的经历。',
        },
    ];
}

function createReport(session) {
    const answered = session.turns.filter((turn) => turn.answerText.trim());
    const answerRate = session.questionBank.length
        ? answered.length / session.questionBank.length
        : 0;
    const strongAnswers = answered.filter((turn) => turn.answerText.trim().length >= 60);
    const recommendation = answerRate >= 0.8
        ? '建议进入人工复核'
        : '建议补充核验';
    const summary = answerRate >= 0.8
        ? '候选人完成了主要问题，回答覆盖项目职责、关键行动和复盘线索；请由招聘者结合原始材料做最终判断。'
        : '候选人回答信息仍不完整，当前记录只适合辅助人工复核，不应据此自动淘汰。';
    const reportRef = `interview://browser-demo/${session.id}/report`;
    return {
        ref: reportRef,
        title: 'AI 面试结构化报告',
        summary,
        recommendation,
        score: Math.round((5.5 + answerRate * 2.5 + Math.min(strongAnswers.length, 2) * 0.5) * 10) / 10,
        strengths: strongAnswers.length
            ? ['至少一个回答包含较完整的背景、行动或结果信息。']
            : [],
        riskNotes: [
            '报告由公开版浏览器演示规则生成，不代表真实模型评估。',
            '所有结论必须由招聘者结合岗位、材料和完整问答复核。',
        ],
        bonusNotes: answerRate === 1 ? ['候选人完成了全部演示问题。'] : [],
        questionReviews: session.turns.map((turn) => ({
            questionId: turn.questionId,
            question: turn.questionText,
            answer: turn.answerText,
            evidence: turn.answerText.trim().length >= 60 ? '回答包含较充分的事实线索。' : '回答较短，建议补充核验。',
        })),
        markdown: [
            '# AI 面试结构化报告',
            '',
            `> ${summary}`,
            '',
            `- 建议：${recommendation}`,
            `- 完成度：${answered.length}/${session.questionBank.length}`,
            '- 边界：本报告只提供证据整理，不做录用决定。',
        ].join('\n'),
        generatedAt: new Date().toISOString(),
    };
}

function trace(session) {
    return {
        sessionId: session.id,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        questionCount: session.questionBank.length,
        turnCount: session.turns.length,
        turns: session.turns,
    };
}

async function notifyPlatform(session) {
    const callback = session.callback || {};
    if (!callback.statusCallbackUrl) return;
    const report = session.report || createReport(session);
    const payload = {
        status: 'completed',
        applicationId: callback.applicationId || session.projectSnapshot?.source?.applicationId || '',
        attemptId: callback.attemptId || session.projectSnapshot?.source?.attemptId || '',
        sessionId: session.id,
        sessionRef: `interview://browser-demo/${session.id}`,
        reportRef: report.ref,
        reportSummary: report.summary,
        recommendation: report.recommendation,
        report,
        riskNotes: report.riskNotes,
        bonusNotes: report.bonusNotes,
        fullTrace: trace(session),
        demo: {
            sessionId: session.id,
            mode: 'browser_demo',
            updatedAt: session.updatedAt,
        },
    };
    try {
        const response = await fetch(callback.statusCallbackUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(callback.secret ? {'x-interview-bridge-secret': callback.secret} : {}),
            },
            body: JSON.stringify(payload),
        });
        session.callbackDelivery = {
            ok: response.ok,
            status: response.status,
            at: new Date().toISOString(),
        };
    }
    catch {
        session.callbackDelivery = {
            ok: false,
            status: 0,
            at: new Date().toISOString(),
        };
    }
}

function completeSession(session) {
    session.status = 'closed';
    session.phase = 'completed';
    session.completedAt = new Date().toISOString();
    session.updatedAt = session.completedAt;
    session.report = createReport(session);
    void notifyPlatform(session);
}

async function serveFile(response, pathname) {
    const fileName = pathname === '/'
        ? 'index.html'
        : pathname.replace(/^\/+/, '');
    if (!['index.html', 'app.js', 'styles.css'].includes(fileName)) return false;
    const body = await readFile(resolve(publicRoot, fileName));
    response.writeHead(200, {
        'Content-Type': mimeTypes[extname(fileName)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
    });
    response.end(body);
    return true;
}

const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
    if (request.method === 'OPTIONS') {
        sendJson(response, 204, {});
        return;
    }
    try {
        if (request.method === 'GET' && url.pathname === '/healthz') {
            sendJson(response, 200, {
                status: 'ok',
                runtime: 'browser-demo',
                provider: {kind: 'browser-demo', ready: true},
            });
            return;
        }
        if (request.method === 'GET' && url.pathname === '/api/status') {
            sendJson(response, 200, {
                status: 'ok',
                activeSessions: [...sessions.values()].filter((item) => item.status !== 'closed').length,
                completedSessions: [...sessions.values()].filter((item) => item.status === 'closed').length,
            });
            return;
        }
        if (request.method === 'POST' && url.pathname === '/api/agent-sessions') {
            const body = await readJson(request);
            const id = String(body.sessionId || randomUUID());
            const now = new Date().toISOString();
            const session = {
                id,
                status: 'ready',
                phase: 'ready',
                mode: 'browser_demo',
                projectSnapshot: body.projectSnapshot || {},
                callback: body.callback || {},
                questionBank: questionBank(body.projectSnapshot),
                turns: [],
                currentQuestionIndex: 0,
                createdAt: now,
                updatedAt: now,
                startedAt: '',
                completedAt: '',
                report: null,
            };
            sessions.set(id, session);
            sendJson(response, 201, {
                session: sessionForClient(session),
                entryUrl: `/?sessionId=${encodeURIComponent(id)}`,
            });
            return;
        }
        const sessionMatch = url.pathname.match(/^\/api\/agent-sessions\/([^/]+)$/);
        if (request.method === 'GET' && sessionMatch) {
            const session = sessions.get(decodeURIComponent(sessionMatch[1]));
            if (!session) {
                sendJson(response, 404, {error: {message: 'Session not found'}});
                return;
            }
            sendJson(response, 200, {session: sessionForClient(session)});
            return;
        }
        const answerMatch = url.pathname.match(/^\/api\/agent-sessions\/([^/]+)\/answers$/);
        if (request.method === 'POST' && answerMatch) {
            const session = sessions.get(decodeURIComponent(answerMatch[1]));
            if (!session) {
                sendJson(response, 404, {error: {message: 'Session not found'}});
                return;
            }
            if (session.status === 'closed') {
                sendJson(response, 409, {error: {message: 'Session already completed'}});
                return;
            }
            const body = await readJson(request);
            const answerText = String(body.answerText || '').trim();
            if (!answerText) {
                sendJson(response, 400, {error: {message: 'answerText is required'}});
                return;
            }
            const question = session.questionBank[session.currentQuestionIndex];
            const now = new Date().toISOString();
            session.startedAt ||= now;
            session.status = 'in_progress';
            session.phase = 'interview';
            session.turns.push({
                questionId: question?.id || `q${session.currentQuestionIndex + 1}`,
                questionIndex: session.currentQuestionIndex,
                questionText: question?.prompt || '',
                answerText,
                decision: {action: 'next'},
                decisionSource: 'browser_demo',
                isPlanQuestion: true,
                turnType: 'answer',
                startedAt: now,
                endedAt: now,
            });
            session.currentQuestionIndex += 1;
            session.updatedAt = now;
            if (session.currentQuestionIndex >= session.questionBank.length) {
                completeSession(session);
            }
            sendJson(response, 200, {
                session: sessionForClient(session),
                completed: session.status === 'closed',
                nextQuestion: session.questionBank[session.currentQuestionIndex] || null,
            });
            return;
        }
        if (request.method === 'POST' && url.pathname === '/api/report') {
            const body = await readJson(request);
            const session = sessions.get(String(body.sessionId || ''));
            if (!session) {
                sendJson(response, 404, {error: {message: 'Session not found'}});
                return;
            }
            if (!session.report) {
                completeSession(session);
            }
            sendJson(response, 200, {
                session: sessionForClient(session),
                report: session.report,
            });
            return;
        }
        if (request.method === 'GET' && await serveFile(response, url.pathname)) {
            return;
        }
        sendJson(response, 404, {error: {message: 'Not found'}});
    }
    catch (error) {
        sendJson(response, error.message === 'request_too_large' ? 413 : 400, {
            error: {message: error.message || 'Bad request'},
        });
    }
});

server.listen(port, host, () => {
    process.stdout.write(`Interview room listening on http://${host}:${port}\n`);
});

function shutdown() {
    server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
