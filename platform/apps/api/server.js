import fastifyStatic from '@fastify/static';
import {connect} from 'node:net';
import {resolve} from 'node:path';
import {appConfig} from '../../packages/storage/config.js';
import {query} from '../../packages/storage/db.js';
import {addJob} from '../../packages/storage/queue.js';
import {checkObjectStorageHealth, getObjectReadStream, publicStorageRef, writeObjectBuffer} from '../../packages/storage/objectStorage.js';
import {
    listJobs,
    listPublishedJobs,
    getJob,
    createJob,
    updateJob,
    deleteJob,
    addJdSource,
    addKnowledgeSource,
    deleteKnowledgeSource,
    addScreeningRule,
    updateScreeningRule,
    deleteScreeningRule,
    listScreeningRuleTemplates,
    createScreeningRuleTemplate,
    deleteScreeningRuleTemplate,
    indexKnowledgeSource,
} from '../../packages/modules/jobs/service.js';
import {
    CandidateAuthError,
    getCandidate,
    listCandidates,
    loginCandidate,
    registerCandidate,
    updateCandidateProfile,
} from '../../packages/modules/candidates/service.js';
import {addCandidateMaterial, deleteCandidateMaterial, presignUpload, completeUpload} from '../../packages/modules/evidence/service.js';
import {createApplication, getApplication, listApplications, listApplicationsForCandidate, listApplicationsForJob, requestReinterview, updateApplication, updateApplicationMaterials} from '../../packages/modules/applications/service.js';
import {
    consult,
    consultationsSummary,
    ensureConsultationForApplication,
    getConsultation,
    listJobConsultations,
    markAdminConsultationRead,
    markCandidateConsultationRead,
    markConsulted,
    sendAdminConsultationMessage,
    streamConsult,
} from '../../packages/modules/consultation/service.js';
import {createPortfolioSubmission, getPortfolioSchema, updatePortfolioSubmission} from '../../packages/modules/portfolio/service.js';
import {
    InterviewFlowError,
    acceptInterviewInvitation,
    createInterviewInvitation,
    decideInterviewReschedule,
    generateInterviewPlan,
    getCandidateInterviewEntry,
    getInterviewPlan,
    getPublicInterviewEntry,
    requestInterviewReschedule,
    resolveInterviewPublicUrls,
    startCandidateInterviewEntry,
    startPublicInterviewEntry,
    syncCompletedInterviewReportFromDemo,
    syncCompletedInterviewReportsFromDemo,
    updateInterviewFromBridge,
} from '../../packages/modules/interview-bridge/service.js';
import {
    buildApplicationReportMarkdown,
    buildInformationMatchReport,
    buildJobMatchReportArchive,
} from '../../packages/modules/match-report/service.js';
import {checkDocumentTextHealth} from '../../packages/modules/evidence/document-text.js';

function parseCookies(header = '') {
    return Object.fromEntries(
        header.split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
                const [key, ...value] = part.split('=');
                return [key, decodeURIComponent(value.join('='))];
            })
    );
}

async function candidateFromRequest(request) {
    const cookies = parseCookies(request.headers.cookie || '');
    if (cookies.candidateId) {
        const candidate = await getCandidate(cookies.candidateId);
        if (candidate) return candidate;
    }
    return null;
}

async function requireCandidate(request, reply) {
    const candidate = await candidateFromRequest(request);
    if (!candidate) {
        reply.code(401).send({error: {message: '请先登录'}});
        return null;
    }
    return candidate;
}

function sendCandidateAuthError(error, reply) {
    if (error instanceof CandidateAuthError) {
        return reply.code(error.statusCode).send({
            error: {
                code: error.code,
                message: error.message,
            },
        });
    }
    throw error;
}

function sendFlowError(error, reply) {
    if (error instanceof InterviewFlowError) {
        return reply.code(error.statusCode).send({
            error: {
                code: error.code,
                message: error.message,
            },
        });
    }
    throw error;
}

function firstHeaderValue(value = '') {
    return String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();
}

function requestPublicOrigin(request) {
    const host = firstHeaderValue(request.headers['x-forwarded-host']) || firstHeaderValue(request.headers.host);
    if (!host) return '';
    const proto = firstHeaderValue(request.headers['x-forwarded-proto']) || request.protocol || 'http';
    return `${proto}://${host}`;
}

function requestInterviewPublicUrls(request) {
    return {mainPublicBaseUrl: requestPublicOrigin(request)};
}

function setCandidateCookie(reply, candidateId) {
    reply.header('Set-Cookie', `candidateId=${encodeURIComponent(candidateId)}; Path=/; Max-Age=2592000; SameSite=Lax`);
}

function clearCandidateCookie(reply) {
    reply.header('Set-Cookie', 'candidateId=; Path=/; Max-Age=0; SameSite=Lax');
}

function routeJobId(request) {
    return decodeURIComponent(request.params.jobId);
}

function contentTypeFromName(name = '') {
    const ext = fileExtensionFromName(name);
    return {
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        txt: 'text/plain; charset=utf-8',
        md: 'text/markdown; charset=utf-8',
        csv: 'text/csv; charset=utf-8',
        json: 'application/json; charset=utf-8',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt: 'application/vnd.ms-powerpoint',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }[ext] || 'application/octet-stream';
}

function fileExtensionFromName(name = '') {
    return String(name).split('.').pop()?.toLowerCase() || '';
}

function dispositionFromName(name = '') {
    const ext = fileExtensionFromName(name);
    const inline = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'md', 'csv']);
    const attachment = new Set(['docx', 'pptx', 'xlsx']);
    if (attachment.has(ext)) return 'attachment';
    return inline.has(ext) ? 'inline' : 'attachment';
}

function materialFileName(material = {}, fallback = 'material') {
    return material.fileName || material.name || material.title || fallback;
}

async function sendStoredMaterialFile(material, reply, {fallbackName = 'material', forceInline = false} = {}) {
    if (!material?.storageKey) {
        return reply.code(404).send({error: {message: '原文件暂不可预览'}});
    }
    try {
        const fileName = materialFileName(material, fallbackName);
        const stream = await getObjectReadStream(material.storageKey);
        const disposition = forceInline ? 'inline' : dispositionFromName(fileName);
        return reply
            .header('Content-Type', material.mimeType || contentTypeFromName(fileName))
            .header('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`)
            .send(stream);
    }
    catch (error) {
        return reply.code(404).send({
            error: {message: error.message || '原文件暂不可预览'},
        });
    }
}

function candidateMaterialList(candidate, kind) {
    if (!candidate) return [];
    if (kind === 'resume') return candidate.resumes || [];
    if (kind === 'portfolio') return candidate.portfolios || [];
    if (kind === 'knowledge') {
        return (candidate.knowledge || []).map((source, index) => {
            if (typeof source === 'string') {
                return {id: `legacy-knowledge-${index}`, name: source};
            }
            return source;
        });
    }
    return [];
}

async function sendCandidateMaterialFile(candidate, kind, materialId, reply) {
    const material = candidateMaterialList(candidate, kind).find((item) => item.id === materialId);
    if (!material) return reply.code(404).send({error: {message: 'Material not found'}});
    if (!material.storageKey || material.hasOriginalFile !== true) {
        return reply.code(404).send({error: {message: '原文件暂不可预览，请重新上传后查看'}});
    }
    return sendStoredMaterialFile(material, reply, {forceInline: true});
}

async function sendCandidateAvatarFile(candidate, reply) {
    const avatar = candidate?.avatar;
    if (!avatar || avatar.mode !== 'image' || !avatar.storageKey) {
        return reply.code(404).send({error: {message: '候选人尚未上传头像'}});
    }
    return sendStoredMaterialFile(avatar, reply, {
        fallbackName: avatar.fileName || 'avatar',
        forceInline: true,
    });
}

function idMatches(item = {}, materialId = '') {
    return [
        item.id,
        item.materialId,
        item.uploadId,
        item.storageKey,
        item.storageRef,
        item.fileName,
        item.name,
        item.title,
    ].filter(Boolean).some((value) => String(value) === materialId);
}

function selectedSnapshotMaterial(application, kind, materialId) {
    const snapshot = application?.materialSnapshot || {};
    if (kind === 'resume') {
        const resume = snapshot.resumeItem;
        if (resume && (snapshot.resumeId === materialId || idMatches(resume, materialId))) return resume;
        return null;
    }
    if (kind === 'knowledge') {
        return (snapshot.knowledgeItems || []).find((item) => idMatches(item, materialId)) || null;
    }
    if (kind === 'portfolio') {
        const portfolio = (snapshot.portfolioItems || []).find((item) => idMatches(item, materialId));
        if (!portfolio) return null;
        if (portfolio.storageKey) return portfolio;
        if ((portfolio.attachmentRefs || []).length === 1) return portfolio.attachmentRefs[0];
        return portfolio;
    }
    if (kind === 'portfolio-attachment') {
        for (const portfolio of snapshot.portfolioItems || []) {
            const refs = portfolio.attachmentRefs || [];
            const matched = refs.find((item) => idMatches(item, materialId));
            if (matched) return matched;
            if (portfolio.id === materialId && refs.length === 1) return refs[0];
        }
        return null;
    }
    if (kind === 'portfolio-screenshot') {
        for (const portfolio of snapshot.portfolioItems || []) {
            const refs = portfolio.screenshots || [];
            const matched = refs.find((item) => idMatches(item, materialId));
            if (matched) return matched;
            if (portfolio.id === materialId && refs.length === 1) return refs[0];
        }
        return null;
    }
    return undefined;
}

async function sendApplicationSnapshotMaterialFile(application, kind, materialId, reply) {
    const supported = new Set(['resume', 'knowledge', 'portfolio', 'portfolio-attachment', 'portfolio-screenshot']);
    if (!supported.has(kind)) {
        return reply.code(400).send({error: {message: 'Unsupported material kind'}});
    }
    const material = selectedSnapshotMaterial(application, kind, materialId);
    if (!material) return reply.code(404).send({error: {message: 'Material not found in application snapshot'}});
    return sendStoredMaterialFile(material, reply);
}

async function checkDependency(name, checker, {optional = false} = {}) {
    try {
        return {name, ok: true, ...(optional ? {optional: true} : {}), ...(await checker())};
    }
    catch (error) {
        return {
            name,
            ok: false,
            ...(optional ? {optional: true} : {}),
            error: error.message || error.code || String(error),
        };
    }
}

function checkTcpUrl(url, defaultPort) {
    const parsed = new URL(url);
    const host = parsed.hostname || 'localhost';
    const port = Number(parsed.port || defaultPort);
    return new Promise((resolvePromise, reject) => {
        const socket = connect({host, port});
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`connection timeout: ${host}:${port}`));
        }, 1000);
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.end();
            resolvePromise();
        });
        socket.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

async function checkRedis() {
    if (appConfig.queue.provider === 'db') {
        return {provider: 'db', skipped: true};
    }
    await checkTcpUrl(appConfig.redisUrl, 6379);
    return {provider: appConfig.queue.provider};
}

async function checkObjectStorage() {
    const result = await checkObjectStorageHealth();
    return {
        provider: result.provider,
        bucketReady: result.bucketReady,
    };
}

export async function registerApiRoutes(app) {
    const healthHandler = async (request, reply) => {
        const dependencies = await Promise.all([
            checkDependency('postgres', async () => {
                await query('SELECT 1');
                return {provider: 'postgresql'};
            }),
            checkDependency('redis', checkRedis),
            checkDependency('objectStorage', checkObjectStorage),
            checkDependency('documentText', checkDocumentTextHealth, {optional: true}),
        ]);
        const ok = dependencies.every((item) => (item.ok || item.optional) && item.bucketReady !== false);
        const safeDependencies = dependencies.map((item) => ({
            name: item.name,
            ok: item.ok,
            ...(item.optional ? {optional: true} : {}),
            ...(item.provider ? {provider: item.provider} : {}),
            ...(item.skipped ? {skipped: true} : {}),
            ...(item.bucketReady !== undefined ? {bucketReady: item.bucketReady} : {}),
            ...(!item.ok ? {error: 'dependency_unavailable'} : {}),
        }));
        return reply.code(ok ? 200 : 503).send({
            status: ok ? 'ok' : 'degraded',
            api: {ok: true},
            runtime: appConfig.runtime,
            ai: {
                mode: appConfig.ai.mode,
                configured: appConfig.ai.mode === 'fixture' || Boolean(appConfig.ai.apiKey),
            },
            interview: {
                runtime: appConfig.interviewDemo.runtime,
                configured: Boolean(appConfig.interviewDemo.baseUrl),
            },
            storage: {provider: appConfig.storage.provider},
            queue: {provider: appConfig.queue.provider},
            vector: {provider: appConfig.vector.provider},
            dependencies: safeDependencies,
        });
    };
    app.get('/api/health', healthHandler);
    app.get('/healthz', healthHandler);

    app.get('/api/bootstrap', async (request) => {
        const candidate = await candidateFromRequest(request);
        const [jobs, candidates, rawApplications, consultations, screeningRuleTemplates] = await Promise.all([
            listJobs(),
            listCandidates(),
            listApplications(),
            consultationsSummary(candidate?.id),
            listScreeningRuleTemplates(),
        ]);
        const applications = await syncCompletedInterviewReportsFromDemo(rawApplications);
        return {
            jobs,
            candidate,
            candidates,
            applications,
            consultations,
            screeningRuleTemplates,
            appMeta: {
                aiMode: appConfig.ai.mode,
                interviewDemo: {
                    runtime: appConfig.interviewDemo.runtime,
                    publicBaseUrl: resolveInterviewPublicUrls(requestInterviewPublicUrls(request)).demoPublicBaseUrl,
                },
            },
        };
    });

    app.post('/api/candidate/login', async (request, reply) => {
        try {
            const candidate = await loginCandidate(request.body || {});
            setCandidateCookie(reply, candidate.id);
            return {candidate};
        }
        catch (error) {
            return sendCandidateAuthError(error, reply);
        }
    });

    app.post('/api/candidate/register', async (request, reply) => {
        try {
            const candidate = await registerCandidate(request.body || {});
            clearCandidateCookie(reply);
            return {candidate};
        }
        catch (error) {
            return sendCandidateAuthError(error, reply);
        }
    });

    app.post('/api/candidate/logout', async (request, reply) => {
        clearCandidateCookie(reply);
        return {ok: true};
    });

    app.patch('/api/candidate/profile', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        try {
            return {candidate: await updateCandidateProfile(candidate.id, request.body || {})};
        }
        catch (error) {
            return sendCandidateAuthError(error, reply);
        }
    });

    app.get('/api/candidate/profile/avatar/file', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        return sendCandidateAvatarFile(candidate, reply);
    });

    app.get('/api/jobs/feed', async () => ({jobs: await listPublishedJobs()}));

    app.get('/api/jobs/:jobId', async (request, reply) => {
        const job = await getJob(routeJobId(request));
        if (!job) return reply.code(404).send({error: {message: 'Not found'}});
        return {job};
    });

    app.post('/api/jobs/:jobId/consultations', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        const jobId = routeJobId(request);
        if (request.body?.greeting) {
            return {consultations: await markConsulted(jobId, request.body.greeting, candidate.id)};
        }
        const result = await consult(jobId, request.body || {}, candidate.id);
        if (!result) return reply.code(404).send({error: {message: 'Not found'}});
        return result;
    });

    app.post('/api/jobs/:jobId/consultations/stream', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        const writeEvent = (event, data) => {
            raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        try {
            const result = await streamConsult(routeJobId(request), request.body || {}, candidate.id, {
                onCandidateMessage: (message) => writeEvent('candidate_message', message),
                onDelta: (delta) => writeEvent('assistant_delta', {delta}),
                onAssistantMessage: (message) => writeEvent('assistant_done', message),
            });
            if (!result) writeEvent('error', {message: 'Not found'});
            else writeEvent('session', result.consultations);
        }
        catch (error) {
            writeEvent('error', {message: error.message || '回答失败，可重试'});
        }
        raw.end();
    });

    app.post('/api/uploads/presign', async (request) => presignUpload(request.body || {}));
    app.post('/api/uploads/complete', async (request) => completeUpload(request.body || {}));
    app.put('/api/uploads/local/:uploadId', async (request, reply) => {
        const uploadId = decodeURIComponent(request.params.uploadId);
        const {rows} = await query('SELECT * FROM uploads WHERE id = $1', [uploadId]);
        const upload = rows[0];
        if (!upload) return reply.code(404).send({error: {message: 'Upload not found'}});
        await writeObjectBuffer(upload.storage_key, Buffer.from(request.body || []));
        return {
            uploadId,
            storageKey: upload.storage_key,
            storageRef: publicStorageRef(upload.storage_key),
        };
    });

    app.get('/api/candidate/materials', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        return {candidate};
    });

    app.get('/api/candidate/materials/:kind/:materialId/file', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        const kind = decodeURIComponent(request.params.kind);
        const materialId = decodeURIComponent(request.params.materialId);
        return sendCandidateMaterialFile(candidate, kind, materialId, reply);
    });

    app.post('/api/candidate/materials/resume', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        return {candidate: await addCandidateMaterial('resume', request.body || {}, candidate.id)};
    });

    app.post('/api/candidate/materials/portfolio', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        return {candidate: await addCandidateMaterial('portfolio', request.body || {}, candidate.id)};
    });

    app.post('/api/candidate/materials/knowledge-sources', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        return {candidate: await addCandidateMaterial('knowledge', request.body || {}, candidate.id)};
    });

    app.delete('/api/candidate/materials/:kind/:materialId', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        try {
            return {
                candidate: await deleteCandidateMaterial(
                    decodeURIComponent(request.params.kind),
                    decodeURIComponent(request.params.materialId),
                    candidate.id
                ),
            };
        }
        catch (error) {
            const message = error.message || 'Delete failed';
            const status = /not found|already deleted/i.test(message) ? 404 : 400;
            return reply.code(status).send({error: {message}});
        }
    });

    app.get('/api/admin/portfolio-schema', async () => ({portfolioSchema: getPortfolioSchema()}));

    app.post('/api/candidate/portfolio-submissions', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        return reply.code(201).send(await createPortfolioSubmission(candidate.id, request.body || {}));
    });

    app.patch('/api/candidate/portfolio-submissions/:portfolioId', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        return updatePortfolioSubmission(
            candidate.id,
            decodeURIComponent(request.params.portfolioId),
            request.body || {}
        );
    });

    app.post('/api/applications', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        const result = await createApplication({
            ...(request.body || {}),
            candidateId: request.body?.candidateId || candidate.id,
        });
        return reply.code(result.alreadyApplied ? 200 : 201).send(result);
    });

    app.get('/api/candidate/applications', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        return {applications: await syncCompletedInterviewReportsFromDemo(await listApplicationsForCandidate(candidate.id))};
    });

    app.patch('/api/candidate/applications/:applicationId/materials', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        try {
            const application = await updateApplicationMaterials(
                decodeURIComponent(request.params.applicationId),
                candidate.id,
                request.body || {}
            );
            if (!application) return reply.code(404).send({error: {message: 'Not found'}});
            return {application};
        }
        catch (error) {
            if (error.statusCode) {
                return reply.code(error.statusCode).send({
                    error: {
                        code: error.code || 'material_update_failed',
                        message: error.message || '更新材料失败',
                    },
                });
            }
            throw error;
        }
    });

    app.get('/api/candidate/applications/:applicationId/ai-interview-entry', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        try {
            const result = await getCandidateInterviewEntry(
                decodeURIComponent(request.params.applicationId),
                candidate.id,
                {publicUrls: requestInterviewPublicUrls(request)}
            );
            if (!result) return reply.code(404).send({error: {message: 'Not found'}});
            return result;
        }
        catch (error) {
            return sendFlowError(error, reply);
        }
    });

    app.post('/api/candidate/applications/:applicationId/ai-interview-entry/start', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        try {
            const result = await startCandidateInterviewEntry(
                decodeURIComponent(request.params.applicationId),
                candidate.id,
                {publicUrls: requestInterviewPublicUrls(request)}
            );
            if (!result) return reply.code(404).send({error: {message: 'Not found'}});
            return result;
        }
        catch (error) {
            return sendFlowError(error, reply);
        }
    });

    app.post('/api/candidate/applications/:applicationId/ai-interview/accept', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        try {
            const result = await acceptInterviewInvitation(
                decodeURIComponent(request.params.applicationId),
                candidate.id,
                request.body || {}
            );
            if (!result) return reply.code(404).send({error: {message: 'Not found'}});
            return result;
        }
        catch (error) {
            return sendFlowError(error, reply);
        }
    });

    app.post('/api/candidate/applications/:applicationId/ai-interview/reschedule-request', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        try {
            const result = await requestInterviewReschedule(
                decodeURIComponent(request.params.applicationId),
                candidate.id,
                request.body || {}
            );
            if (!result) return reply.code(404).send({error: {message: 'Not found'}});
            return reply.code(201).send(result);
        }
        catch (error) {
            return sendFlowError(error, reply);
        }
    });

    app.post('/api/applications/:applicationId/reinterview-requests', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        const application = await requestReinterview(decodeURIComponent(request.params.applicationId), request.body || {});
        if (!application) return reply.code(404).send({error: {message: 'Not found'}});
        return reply.code(201).send({application});
    });

    app.post('/api/candidate/jobs/:jobId/consultation/read', async (request, reply) => {
        const candidate = await requireCandidate(request, reply);
        if (!candidate) return reply;
        return {
            consultations: await markCandidateConsultationRead(
                decodeURIComponent(request.params.jobId),
                candidate.id
            ),
        };
    });

    app.get('/api/interview-entry/:attemptId', async (request, reply) => {
        try {
            return await getPublicInterviewEntry(
                decodeURIComponent(request.params.attemptId),
                String(request.query?.token || ''),
                {publicUrls: requestInterviewPublicUrls(request)}
            );
        }
        catch (error) {
            return sendFlowError(error, reply);
        }
    });

    app.post('/api/interview-entry/:attemptId/start', async (request, reply) => {
        try {
            return await startPublicInterviewEntry(
                decodeURIComponent(request.params.attemptId),
                String(request.query?.token || ''),
                {publicUrls: requestInterviewPublicUrls(request)}
            );
        }
        catch (error) {
            return sendFlowError(error, reply);
        }
    });

    app.get('/api/admin/jobs', async () => ({jobs: await listJobs()}));
    app.post('/api/admin/jobs', async (request, reply) => reply.code(201).send({job: await createJob(request.body || {})}));

    app.get('/api/admin/screening-rule-templates', async () => ({
        templates: await listScreeningRuleTemplates(),
    }));

    app.post('/api/admin/screening-rule-templates', async (request, reply) => {
        const result = await createScreeningRuleTemplate(request.body || {});
        return reply.code(result.created ? 201 : 200).send(result);
    });

    app.delete('/api/admin/screening-rule-templates/:templateId', async (request, reply) => {
        const template = await deleteScreeningRuleTemplate(decodeURIComponent(request.params.templateId));
        if (!template) return reply.code(404).send({error: {message: 'Not found'}});
        return {template};
    });

    app.get('/api/admin/jobs/:jobId', async (request, reply) => {
        const job = await getJob(routeJobId(request));
        if (!job) return reply.code(404).send({error: {message: 'Not found'}});
        return {job};
    });

    app.patch('/api/admin/jobs/:jobId', async (request, reply) => {
        const job = await updateJob(routeJobId(request), request.body || {});
        if (!job) return reply.code(404).send({error: {message: 'Not found'}});
        return {job};
    });

    app.delete('/api/admin/jobs/:jobId', async (request, reply) => {
        const job = await deleteJob(routeJobId(request));
        if (!job) return reply.code(404).send({error: {message: 'Not found'}});
        return {job};
    });

    app.post('/api/admin/jobs/:jobId/jd-sources', async (request, reply) => {
        const source = await addJdSource(routeJobId(request), request.body || {});
        if (!source) return reply.code(404).send({error: {message: 'Not found'}});
        return reply.code(201).send({source});
    });

    app.post('/api/admin/jobs/:jobId/knowledge-sources', async (request, reply) => {
        const jobId = routeJobId(request);
        const source = await addKnowledgeSource(jobId, request.body || {});
        if (!source) return reply.code(404).send({error: {message: 'Not found'}});
        try {
            const indexed = await indexKnowledgeSource(jobId, source.id);
            return reply.code(201).send({source: indexed.source || source});
        }
        catch (error) {
            await addJob('knowledge', 'knowledge_index', {jobId, sourceId: source.id}).catch(() => null);
            return reply.code(201).send({
                source: {
                    ...source,
                    status: 'indexing',
                    errorMessage: error.message || '已提交 worker，等待解析索引。',
                },
            });
        }
    });

    app.delete('/api/admin/jobs/:jobId/knowledge-sources/:sourceId', async (request, reply) => {
        const source = await deleteKnowledgeSource(routeJobId(request), decodeURIComponent(request.params.sourceId));
        if (!source) return reply.code(404).send({error: {message: 'Not found'}});
        return {source};
    });

    app.post('/api/admin/jobs/:jobId/screening-rules', async (request, reply) => {
        const job = await addScreeningRule(routeJobId(request), request.body || {});
        if (!job) return reply.code(404).send({error: {message: 'Not found'}});
        return {job};
    });

    app.patch('/api/admin/jobs/:jobId/screening-rules/:ruleId', async (request, reply) => {
        const job = await updateScreeningRule(routeJobId(request), decodeURIComponent(request.params.ruleId), request.body || {});
        if (!job) return reply.code(404).send({error: {message: 'Not found'}});
        return {job};
    });

    app.delete('/api/admin/jobs/:jobId/screening-rules/:ruleId', async (request, reply) => {
        const job = await deleteScreeningRule(routeJobId(request), decodeURIComponent(request.params.ruleId));
        if (!job) return reply.code(404).send({error: {message: 'Not found'}});
        return {job};
    });

    app.get('/api/admin/jobs/:jobId/consultations', async (request) => ({
        sessions: await listJobConsultations(routeJobId(request)),
    }));

    app.get('/api/admin/candidates/:candidateId/avatar/file', async (request, reply) => {
        const candidate = await getCandidate(decodeURIComponent(request.params.candidateId));
        if (!candidate) return reply.code(404).send({error: {message: 'Candidate not found'}});
        return sendCandidateAvatarFile(candidate, reply);
    });

    app.get('/api/admin/consultations/:sessionId', async (request, reply) => {
        const result = await getConsultation(decodeURIComponent(request.params.sessionId));
        if (!result) return reply.code(404).send({error: {message: 'Not found'}});
        return result;
    });

    app.post('/api/admin/applications/:applicationId/consultation', async (request, reply) => {
        const application = await getApplication(decodeURIComponent(request.params.applicationId));
        if (!application) return reply.code(404).send({error: {message: 'Application not found'}});
        const result = await ensureConsultationForApplication(application);
        if (!result) return reply.code(404).send({error: {message: 'Not found'}});
        return reply.code(201).send(result);
    });

    app.post('/api/admin/consultations/:sessionId/messages', async (request, reply) => {
        const result = await sendAdminConsultationMessage(
            decodeURIComponent(request.params.sessionId),
            request.body || {}
        );
        if (!result) return reply.code(404).send({error: {message: 'Not found'}});
        return reply.code(201).send(result);
    });

    app.post('/api/admin/consultations/:sessionId/read', async (request, reply) => {
        const result = await markAdminConsultationRead(decodeURIComponent(request.params.sessionId));
        if (!result) return reply.code(404).send({error: {message: 'Not found'}});
        return result;
    });

    app.get('/api/admin/jobs/:jobId/applications', async (request) => ({
        applications: await syncCompletedInterviewReportsFromDemo(await listApplicationsForJob(routeJobId(request))),
    }));

    app.patch('/api/admin/applications/:applicationId', async (request, reply) => {
        const application = await updateApplication(decodeURIComponent(request.params.applicationId), request.body || {});
        if (!application) return reply.code(404).send({error: {message: 'Not found'}});
        return {application};
    });

    app.get('/api/admin/applications/:applicationId/materials/:kind/:materialId/file', async (request, reply) => {
        const application = await getApplication(decodeURIComponent(request.params.applicationId));
        if (!application) return reply.code(404).send({error: {message: 'Application not found'}});
        return sendApplicationSnapshotMaterialFile(
            application,
            decodeURIComponent(request.params.kind),
            decodeURIComponent(request.params.materialId),
            reply
        );
    });

    app.get('/api/admin/applications/:applicationId/match-report', async (request, reply) => {
        const applicationId = decodeURIComponent(request.params.applicationId);
        await syncCompletedInterviewReportFromDemo(applicationId);
        const result = await buildInformationMatchReport(applicationId);
        if (!result) return reply.code(404).send({error: {message: 'Application not found'}});
        return result;
    });

    app.get('/api/admin/applications/:applicationId/match-report.md', async (request, reply) => {
        const applicationId = decodeURIComponent(request.params.applicationId);
        await syncCompletedInterviewReportFromDemo(applicationId);
        const result = await buildInformationMatchReport(applicationId);
        if (!result) return reply.code(404).send({error: {message: 'Application not found'}});
        return reply
            .header('Content-Type', 'text/markdown; charset=utf-8')
            .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${result.report.candidate.name}-${result.report.job.title}-match-report.md`)}`)
            .send(result.markdown);
    });

    app.get('/api/admin/applications/:applicationId/reports/:reportKind.md', async (request, reply) => {
        const applicationId = decodeURIComponent(request.params.applicationId);
        await syncCompletedInterviewReportFromDemo(applicationId);
        const result = await buildApplicationReportMarkdown(
            applicationId,
            decodeURIComponent(request.params.reportKind)
        );
        if (!result) return reply.code(404).send({error: {message: 'Application not found'}});
        return reply
            .header('Content-Type', 'text/markdown; charset=utf-8')
            .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`)
            .send(result.markdown);
    });

    app.get('/api/admin/jobs/:jobId/match-reports/export', async (request, reply) => {
        const jobId = routeJobId(request);
        await syncCompletedInterviewReportsFromDemo(await listApplicationsForJob(jobId));
        const archive = await buildJobMatchReportArchive(jobId, request.query || {});
        if (!archive) return reply.code(404).send({error: {message: 'Job not found'}});
        return reply
            .header('Content-Type', 'application/zip')
            .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(archive.fileName)}`)
            .send(archive.buffer);
    });

    app.get('/api/admin/applications/:applicationId/interview-plan', async (request, reply) => {
        const interviewPlan = await getInterviewPlan(decodeURIComponent(request.params.applicationId));
        if (!interviewPlan) return reply.code(404).send({error: {message: 'Interview plan not found'}});
        return {interviewPlan};
    });

    app.post('/api/admin/applications/:applicationId/interview-plan', async (request, reply) => {
        const result = await generateInterviewPlan(decodeURIComponent(request.params.applicationId), request.body || {});
        if (!result) return reply.code(404).send({error: {message: 'Not found'}});
        return reply.code(201).send(result);
    });

    app.post('/api/admin/applications/:applicationId/ai-interview/invitations', async (request, reply) => {
        try {
            const result = await createInterviewInvitation(
                decodeURIComponent(request.params.applicationId),
                request.body || {},
                {publicUrls: requestInterviewPublicUrls(request)}
            );
            if (!result) return reply.code(404).send({error: {message: 'Not found'}});
            return reply.code(201).send(result);
        }
        catch (error) {
            return sendFlowError(error, reply);
        }
    });

    app.post('/api/admin/applications/:applicationId/ai-interview/reschedule-decision', async (request, reply) => {
        try {
            const result = await decideInterviewReschedule(
                decodeURIComponent(request.params.applicationId),
                request.body || {}
            );
            if (!result) return reply.code(404).send({error: {message: 'Not found'}});
            return result;
        }
        catch (error) {
            return sendFlowError(error, reply);
        }
    });

    app.post('/api/interview-bridge/status-callback', async (request, reply) => {
        const secret = request.headers['x-interview-bridge-secret'];
        if (secret !== appConfig.interviewBridge.callbackSecret) {
            return reply.code(401).send({error: {message: 'Unauthorized'}});
        }
        const result = await updateInterviewFromBridge(request.body || {});
        if (!result) return reply.code(404).send({error: {message: 'Not found'}});
        return result;
    });

    app.get('/api/admin/candidates', async () => ({candidates: await listCandidates()}));

    app.get('/api/admin/candidates/:candidateId', async (request, reply) => {
        const candidate = await getCandidate(decodeURIComponent(request.params.candidateId));
        if (!candidate) return reply.code(404).send({error: {message: 'Not found'}});
        const applications = await syncCompletedInterviewReportsFromDemo(await listApplicationsForCandidate(candidate.id));
        return {
            candidate: {
                ...candidate,
                applications,
            },
        };
    });

    app.get('/api/admin/candidates/:candidateId/materials/:kind/:materialId/file', async (request, reply) => {
        const candidate = await getCandidate(decodeURIComponent(request.params.candidateId));
        if (!candidate) return reply.code(404).send({error: {message: 'Candidate not found'}});
        const kind = decodeURIComponent(request.params.kind);
        const materialId = decodeURIComponent(request.params.materialId);
        return sendCandidateMaterialFile(candidate, kind, materialId, reply);
    });
}

export async function buildServer() {
    const fastify = (await import('fastify')).default;
    const app = fastify({logger: false, bodyLimit: 50 * 1024 * 1024});
    app.addContentTypeParser(
        'application/octet-stream',
        {parseAs: 'buffer'},
        (request, body, done) => done(null, body)
    );
    await registerApiRoutes(app);
    await app.register(fastifyStatic, {
        root: resolve('apps', 'web'),
        prefix: '/',
    });
    app.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith('/api/')) {
            return reply.code(404).send({error: {message: 'API route not found'}});
        }
        return reply.sendFile('index.html');
    });
    return app;
}

export async function listen({port = appConfig.port} = {}) {
    const app = await buildServer();
    await app.listen({port, host: '0.0.0.0'});
    console.log(`Recruit AI Platform running at http://localhost:${port}/candidate`);
    return app;
}
