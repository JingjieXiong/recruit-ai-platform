async function request(path, options = {}) {
    const headers = {
        ...(options.headers || {}),
    };
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(path, {
        ...options,
        headers,
    });
    const text = await response.text();
    let body = {};
    try {
        body = text ? JSON.parse(text) : {};
    }
    catch (error) {
        body = {message: text};
    }
    if (!response.ok) {
        const error = new Error(body?.error?.message || body?.message || `Request failed: ${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
    }
    return body;
}

async function textRequest(path, options = {}) {
    const response = await fetch(path, options);
    const text = await response.text();
    if (!response.ok) {
        let body = {};
        try {
            body = text ? JSON.parse(text) : {};
        }
        catch (error) {
            body = {message: text};
        }
        const message = body?.error?.message || body?.message || `Request failed: ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.body = body;
        throw error;
    }
    return text;
}

async function streamRequest(path, payload, handlers = {}) {
    const response = await fetch(path, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload || {}),
    });
    if (!response.ok) {
        const text = await response.text();
        let body = {};
        try {
            body = text ? JSON.parse(text) : {};
        }
        catch (error) {
            body = {message: text};
        }
        const error = new Error(body?.error?.message || body?.message || `Request failed: ${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
    }
    if (!response.body) {
        throw new Error('当前浏览器不支持流式响应');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastSession = null;
    const dispatch = (event, dataText) => {
        let data = {};
        try {
            data = dataText ? JSON.parse(dataText) : {};
        }
        catch (error) {
            data = {text: dataText};
        }
        if (event === 'session') lastSession = data;
        if (handlers[event]) handlers[event](data);
    };

    while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
            let event = 'message';
            const dataLines = [];
            for (const line of frame.split(/\r?\n/)) {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            dispatch(event, dataLines.join('\n'));
        }
    }
    return lastSession;
}

function bodyPayload(payload) {
    return {
        method: 'POST',
        body: JSON.stringify(payload || {}),
    };
}

function patchPayload(payload) {
    return {
        method: 'PATCH',
        body: JSON.stringify(payload || {}),
    };
}

export const api = {
    bootstrap() {
        return request('/api/bootstrap');
    },

    login(payload) {
        return request('/api/candidate/login', bodyPayload(payload));
    },

    register(payload) {
        return request('/api/candidate/register', bodyPayload(payload));
    },

    logout() {
        return request('/api/candidate/logout', bodyPayload({}));
    },

    updateCandidateProfile(payload) {
        return request('/api/candidate/profile', patchPayload(payload));
    },

    markConsulted(jobId, greeting) {
        return request(`/api/jobs/${jobId}/consultations`, bodyPayload({greeting}));
    },

    consult(jobId, question) {
        return request(`/api/jobs/${jobId}/consultations`, bodyPayload({question}));
    },

    markCandidateConsultationRead(jobId) {
        return request(`/api/candidate/jobs/${jobId}/consultation/read`, bodyPayload({}));
    },

    consultStream(jobId, payload, handlers) {
        return streamRequest(`/api/jobs/${jobId}/consultations/stream`, payload, handlers);
    },

    createApplication(jobId, candidateId) {
        return request('/api/applications', bodyPayload({jobId, candidateId}));
    },

    submitApplication(payload) {
        return request('/api/applications', bodyPayload(payload));
    },

    updateApplicationMaterials(applicationId, payload) {
        return request(`/api/candidate/applications/${applicationId}/materials`, patchPayload(payload));
    },

    addResume(payload) {
        return request('/api/candidate/materials/resume', bodyPayload(payload));
    },

    presignUpload(payload) {
        return request('/api/uploads/presign', bodyPayload(payload));
    },

    completeUpload(payload) {
        return request('/api/uploads/complete', bodyPayload(payload));
    },

    uploadLocal(uploadId, file) {
        return request(`/api/uploads/local/${encodeURIComponent(uploadId)}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/octet-stream'},
            body: file,
        });
    },

    addPortfolio(payload) {
        return request('/api/candidate/materials/portfolio', bodyPayload(payload));
    },

    createPortfolioSubmission(payload) {
        return request('/api/candidate/portfolio-submissions', bodyPayload(payload));
    },

    updatePortfolioSubmission(portfolioId, payload) {
        return request(`/api/candidate/portfolio-submissions/${portfolioId}`, patchPayload(payload));
    },

    addCandidateKnowledge(payload) {
        return request('/api/candidate/materials/knowledge-sources', bodyPayload(payload));
    },

    deleteCandidateMaterial(kind, materialId) {
        return request(`/api/candidate/materials/${kind}/${materialId}`, {method: 'DELETE'});
    },

    requestReinterview(applicationId, payload) {
        return request(`/api/applications/${applicationId}/reinterview-requests`, bodyPayload(payload));
    },

    getInterviewEntry(applicationId) {
        return request(`/api/candidate/applications/${applicationId}/ai-interview-entry`);
    },

    startInterviewEntry(applicationId) {
        return request(`/api/candidate/applications/${applicationId}/ai-interview-entry/start`, bodyPayload({}));
    },

    getPublicInterviewEntry(attemptId, token = '') {
        const query = token ? `?token=${encodeURIComponent(token)}` : '';
        return request(`/api/interview-entry/${encodeURIComponent(attemptId)}${query}`);
    },

    startPublicInterviewEntry(attemptId, token = '') {
        const query = token ? `?token=${encodeURIComponent(token)}` : '';
        return request(`/api/interview-entry/${encodeURIComponent(attemptId)}/start${query}`, bodyPayload({}));
    },

    acceptInterview(applicationId, payload = {}) {
        return request(`/api/candidate/applications/${applicationId}/ai-interview/accept`, bodyPayload(payload));
    },

    requestInterviewReschedule(applicationId, payload = {}) {
        return request(`/api/candidate/applications/${applicationId}/ai-interview/reschedule-request`, bodyPayload(payload));
    },

    createJob(payload) {
        return request('/api/admin/jobs', bodyPayload(payload));
    },

    updateJob(jobId, payload) {
        return request(`/api/admin/jobs/${jobId}`, patchPayload(payload));
    },

    deleteJob(jobId) {
        return request(`/api/admin/jobs/${jobId}`, {method: 'DELETE'});
    },

    addJdSource(jobId, payload) {
        return request(`/api/admin/jobs/${jobId}/jd-sources`, bodyPayload(payload));
    },

    addKnowledgeSource(jobId, payload) {
        return request(`/api/admin/jobs/${jobId}/knowledge-sources`, bodyPayload(payload));
    },

    deleteKnowledgeSource(jobId, sourceId) {
        return request(`/api/admin/jobs/${jobId}/knowledge-sources/${sourceId}`, {method: 'DELETE'});
    },

    listScreeningRuleTemplates() {
        return request('/api/admin/screening-rule-templates');
    },

    createScreeningRuleTemplate(payload) {
        return request('/api/admin/screening-rule-templates', bodyPayload(payload));
    },

    deleteScreeningRuleTemplate(templateId) {
        return request(`/api/admin/screening-rule-templates/${templateId}`, {method: 'DELETE'});
    },

    addScreeningRule(jobId, payload) {
        return request(`/api/admin/jobs/${jobId}/screening-rules`, bodyPayload(payload));
    },

    updateScreeningRule(jobId, ruleId, payload) {
        return request(`/api/admin/jobs/${jobId}/screening-rules/${ruleId}`, patchPayload(payload));
    },

    deleteScreeningRule(jobId, ruleId) {
        return request(`/api/admin/jobs/${jobId}/screening-rules/${ruleId}`, {method: 'DELETE'});
    },

    listJobConsultations(jobId) {
        return request(`/api/admin/jobs/${jobId}/consultations`);
    },

    getConsultation(sessionId) {
        return request(`/api/admin/consultations/${sessionId}`);
    },

    ensureAdminConsultation(applicationId) {
        return request(`/api/admin/applications/${applicationId}/consultation`, bodyPayload({}));
    },

    sendAdminConsultationMessage(sessionId, payload) {
        return request(`/api/admin/consultations/${sessionId}/messages`, bodyPayload(payload));
    },

    markAdminConsultationRead(sessionId) {
        return request(`/api/admin/consultations/${sessionId}/read`, bodyPayload({}));
    },

    updateApplication(applicationId, payload) {
        return request(`/api/admin/applications/${applicationId}`, patchPayload(payload));
    },

    getMatchReport(applicationId) {
        return request(`/api/admin/applications/${applicationId}/match-report`);
    },

    getApplicationReportMarkdown(applicationId, reportKind = 'prescreen') {
        return textRequest(`/api/admin/applications/${applicationId}/reports/${encodeURIComponent(reportKind)}.md`, {
            headers: {Accept: 'text/markdown'},
        });
    },

    generateInterviewPlan(applicationId, payload = {}) {
        return request(`/api/admin/applications/${applicationId}/interview-plan`, bodyPayload(payload));
    },

    createInterviewInvitation(applicationId, payload = {}) {
        return request(`/api/admin/applications/${applicationId}/ai-interview/invitations`, bodyPayload(payload));
    },

    decideInterviewReschedule(applicationId, payload = {}) {
        return request(`/api/admin/applications/${applicationId}/ai-interview/reschedule-decision`, bodyPayload(payload));
    },
};
