import {closePool, query} from '../packages/storage/db.js';

function hasDataUrl(value) {
    return typeof value === 'string' && value.startsWith('data:');
}

function materialBuckets(candidate = {}) {
    return [
        ...(candidate.resumes || []).map((item) => ({kind: 'resume', item})),
        ...(candidate.portfolios || []).map((item) => ({kind: 'portfolio', item})),
        ...(candidate.knowledge || []).map((item) => ({kind: 'knowledge', item})),
    ];
}

function snapshotMaterials(application = {}) {
    const snapshot = application.materialSnapshot || {};
    return [
        {kind: 'resume', item: snapshot.resumeItem},
        ...(snapshot.portfolioItems || []).map((item) => ({kind: 'portfolio', item})),
        ...(snapshot.knowledgeItems || []).map((item) => ({kind: 'knowledge', item})),
        ...(snapshot.portfolioItems || []).flatMap((portfolio) => [
            ...(portfolio.attachmentRefs || []).map((item) => ({kind: 'portfolio-attachment', item})),
            ...(portfolio.screenshots || []).map((item) => ({kind: 'portfolio-screenshot', item})),
        ]),
    ].filter(({item}) => item);
}

function addFinding(findings, severity, area, message, detail = {}) {
    findings.push({severity, area, message, detail});
}

try {
    const [
        jobs,
        candidates,
        applications,
        uploads,
        consultations,
        interviewAttempts,
        interviewPlans,
        modelCalls,
    ] = await Promise.all([
        query('SELECT id, data FROM jobs ORDER BY created_at ASC'),
        query('SELECT id, data FROM candidates ORDER BY created_at ASC'),
        query('SELECT id, data FROM applications ORDER BY created_at ASC'),
        query('SELECT id, owner_type, owner_id, kind, storage_key, status FROM uploads ORDER BY created_at ASC'),
        query('SELECT id, data FROM consultation_sessions ORDER BY updated_at ASC'),
        query('SELECT id FROM interview_attempts').catch(() => ({rows: []})),
        query('SELECT id FROM interview_plans').catch(() => ({rows: []})),
        query('SELECT id FROM model_call_logs').catch(() => ({rows: []})),
    ]);

    const findings = [];
    const uploadKeys = new Set(uploads.rows.map((row) => row.storage_key).filter(Boolean));

    for (const row of candidates.rows) {
        const candidate = row.data || {};
        const avatar = candidate.avatar;
        if (avatar?.mode === 'image' && !avatar.storageKey) {
            addFinding(findings, 'error', 'candidate.avatar', 'Avatar image metadata is missing storageKey.', {
                candidateId: row.id,
            });
        }
        if (avatar?.mode === 'image' && avatar.storageKey && !uploadKeys.has(avatar.storageKey)) {
            addFinding(findings, 'warning', 'candidate.avatar', 'Avatar points to object storage but upload row is missing.', {
                candidateId: row.id,
                storageKey: avatar.storageKey,
            });
        }
        for (const field of ['avatarDataUrl', 'avatarUrl', 'photoUrl', 'profileImageUrl', 'profileImage']) {
            if (hasDataUrl(candidate[field])) {
                addFinding(findings, 'warning', 'candidate.profile', 'Legacy dataURL avatar field found in candidate data.', {
                    candidateId: row.id,
                    field,
                });
            }
        }
        for (const {kind, item} of materialBuckets(candidate)) {
            if (item?.hasOriginalFile === true && !item.storageKey) {
                addFinding(findings, 'error', 'candidate.materials', 'Material claims to have an original file but has no storageKey.', {
                    candidateId: row.id,
                    kind,
                    materialId: item.id || '',
                });
            }
        }
    }

    for (const row of applications.rows) {
        const application = row.data || {};
        if (!application.materialSnapshot) {
            addFinding(findings, 'warning', 'application.snapshot', 'Application has no materialSnapshot.', {
                applicationId: row.id,
            });
        }
        for (const {kind, item} of snapshotMaterials(application)) {
            if (item?.hasOriginalFile === true && !item.storageKey) {
                addFinding(findings, 'error', 'application.snapshot', 'Snapshot material claims to have an original file but has no storageKey.', {
                    applicationId: row.id,
                    kind,
                    materialId: item.id || '',
                });
            }
        }
    }

    const report = {
        checkedAt: new Date().toISOString(),
        counts: {
            jobs: jobs.rows.length,
            candidates: candidates.rows.length,
            applications: applications.rows.length,
            uploads: uploads.rows.length,
            consultationSessions: consultations.rows.length,
            interviewPlans: interviewPlans.rows.length,
            interviewAttempts: interviewAttempts.rows.length,
            modelCalls: modelCalls.rows.length,
        },
        persistenceMap: {
            jobs: 'postgres: jobs.data',
            candidates: 'postgres: candidates.data',
            candidateAvatar: 'postgres: candidates.data.avatar + object storage upload',
            materials: 'postgres: candidates.data material arrays + uploads + object storage',
            applicationSnapshots: 'postgres: applications.data.materialSnapshot',
            chats: 'postgres: consultation_sessions.data.messages',
            aiInterviewState: 'postgres: applications.data.aiInterview + interview_plans/interview_attempts when generated',
            matchReports: 'generated from persisted application snapshot and job/candidate data',
            exports: 'transient response generated from persisted reports',
            browserState: 'allowed transient: login cookie/localStorage session, scroll position, unsent drafts',
        },
        findings,
    };

    console.log(JSON.stringify(report, null, 2));
    const hasErrors = findings.some((item) => item.severity === 'error');
    process.exitCode = hasErrors ? 1 : 0;
}
finally {
    await closePool();
}
