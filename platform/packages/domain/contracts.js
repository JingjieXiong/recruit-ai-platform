import {z} from 'zod';

export const applicationStatus = {
    submitted: '已投递',
    materialProcessing: '材料处理中',
    materialFailed: '材料处理失败',
    evidenceReady: '证据已生成',
    prescreening: '初筛中',
    prescreened: '初筛完成',
    prescreenFailed: '初筛失败',
    needMaterials: '待补充',
    needInterview: '待 AI 面试',
    needReview: '待审核',
    passed: '已通过',
    rejected: '已拒绝',
    held: '暂缓',
};

export const interviewStatus = {
    notStarted: 'not_started',
    pending: 'pending',
    inProgress: 'in_progress',
    completed: 'completed',
    failed: 'failed',
};

export const reviewStatus = {
    none: 'none',
    pending: 'pending',
    passed: 'passed',
    rejected: 'rejected',
    needMaterials: 'need_materials',
};

export const uploadStatus = {
    ready: 'ready',
    parsing: 'parsing',
    failed: 'failed',
};

export const prescreenStatus = {
    pending: 'pending',
    processing: 'processing',
    completed: 'completed',
    failed: 'failed',
    overridden: 'overridden',
};

export const reinterviewStatus = {
    none: 'none',
    requested: 'requested',
    approved: 'approved',
    rejected: 'rejected',
};

export const jobStatus = {
    published: '已发布',
    draft: '草稿',
    paused: '暂停',
};

export const portfolioSchema = {
    version: 'creative-demo-v2',
    fields: [
        {key: 'title', label: '作品名称', required: true},
        {key: 'jobDirection', label: '岗位关联方向', required: true},
        {key: 'oneLineValue', label: '一句话价值', required: true},
        {key: 'problem', label: '创意背景 / 问题来源', required: true},
        {key: 'scenario', label: '使用场景', required: true},
        {key: 'currentSolutionGap', label: '现有方案与不足', required: false},
        {key: 'solution', label: '解决方案简介', required: true},
        {key: 'coreFeatures', label: '核心功能 / 价值', required: false},
        {key: 'demoFlow', label: 'Demo 使用流程', required: true},
        {key: 'aiUsage', label: 'AI/Agent/自动化能力说明', required: false},
        {key: 'differentiation', label: '和普通工具相比新在哪里', required: false},
        {key: 'role', label: '本人职责', required: true},
        {key: 'contribution', label: '本人贡献', required: true},
        {key: 'screenshots', label: '关键截图', required: false},
        {key: 'screenshotCaption', label: '截图说明', required: false},
        {key: 'evidenceUrl', label: '可验证证据链接', required: false},
        {key: 'outcome', label: '结果指标', required: false},
        {key: 'challenge', label: '最大难点', required: false},
        {key: 'reflection', label: '复盘改进', required: false},
    ],
};

export const evidenceRefSchema = z.object({
    sourceType: z.string().default('unknown'),
    sourceId: z.string().default(''),
    label: z.string().default(''),
    text: z.string().default(''),
    materialId: z.string().default(''),
    sourceField: z.string().default(''),
    storageKey: z.string().default(''),
    fileName: z.string().default(''),
    screenshotId: z.string().default(''),
    modality: z.string().default('text'),
    extractionMethod: z.string().default('unknown'),
    confidence: z.number().default(0),
});

export const documentContextSchema = z.object({
    id: z.string().default(''),
    fileName: z.string().default(''),
    mimeType: z.string().default(''),
    storageKey: z.string().default(''),
    storageRef: z.string().default(''),
    status: z.string().default('unknown'),
    extractionMethod: z.string().default(''),
    warnings: z.array(z.string()).default([]),
    text: z.string().default(''),
}).default({});

export const consultationAnswerSchema = z.object({
    answer: z.string(),
    citations: z.array(evidenceRefSchema).default([]),
    confidenceNote: z.string().default(''),
});

export const resumeEvidenceSchema = z.object({
    education: z.string().default(''),
    experiences: z.array(z.string()).default([]),
    projects: z.array(z.string()).default([]),
    skills: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    documentContext: documentContextSchema,
    evidenceRefs: z.array(evidenceRefSchema).default([]),
});

export const portfolioEvaluationSchema = z.object({
    score: z.number().default(0),
    highlights: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    verificationNeeds: z.array(z.string()).default([]),
    followUps: z.array(z.string()).default([]),
    evidenceRefs: z.array(evidenceRefSchema).default([]),
    visualReadStatus: z.string().default('not_requested'),
    attachmentContexts: z.array(documentContextSchema).default([]),
    modelRouting: z.object({
        textModel: z.string().default(''),
        visionModel: z.string().default(''),
        visionRequired: z.boolean().default(false),
        reviewerModel: z.string().default(''),
    }).default({}),
    visualFindings: z.array(z.object({
        screenshotId: z.string().default(''),
        fileName: z.string().default(''),
        status: z.string().default('not_read'),
        finding: z.string().default(''),
        supportedClaims: z.array(z.string()).default([]),
        unverifiedClaims: z.array(z.string()).default([]),
        risks: z.array(z.string()).default([]),
        evidenceRefs: z.array(evidenceRefSchema).default([]),
    })).default([]),
    dimensions: z.array(z.object({
        key: z.string(),
        label: z.string(),
        score: z.number(),
        reason: z.string().default(''),
    })).default([]),
});

export const candidateKnowledgeEvidenceSchema = z.object({
    claims: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    documentContext: documentContextSchema,
    evidenceRefs: z.array(evidenceRefSchema).default([]),
});

export const prescreenResultSchema = z.object({
    recommendation: z.enum(['推荐 AI 面试', '不建议继续']),
    score: z.number(),
    summary: z.string(),
    matchedRequirements: z.array(z.object({
        requirement: z.string(),
        result: z.string(),
        evidenceRefs: z.array(evidenceRefSchema).default([]),
    })).default([]),
    gaps: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    markdownReport: z.string().default(''),
    adminSuggestion: z.string().default(''),
    evidenceRefs: z.array(evidenceRefSchema).default([]),
});

export const interviewPlanSchema = z.object({
    title: z.string().default('AI 面试计划'),
    durationMinutes: z.number().default(25),
    focusAreas: z.array(z.string()).default([]),
    questions: z.array(z.object({
        id: z.string().default(''),
        type: z.string(),
        competency: z.string(),
        prompt: z.string(),
        sourceRefs: z.array(evidenceRefSchema).default([]),
        expectedEvidence: z.string().default(''),
        followUps: z.array(z.string()).default([]),
        scoringHints: z.array(z.string()).default([]),
        timeLimitSec: z.number().default(180),
        required: z.boolean().default(true),
    })).min(1).max(10),
    closingPrompt: z.string().default('你可以补充一个最希望面试官知道的点。'),
    riskNotes: z.array(z.string()).default([]),
});

export const candidateLoginSchema = z.object({
    name: z.string().trim().min(1),
    idTail: z.string()
        .trim()
        .regex(/^\d{7}[\dX]$/, '请输入证件后 8 位，末位可为大写 X')
        .transform((value) => value.toUpperCase()),
});

export const candidateAvatarSchema = z.union([
    z.object({
        mode: z.literal('generated'),
    }),
    z.object({
        mode: z.literal('image'),
        storageKey: z.string().min(1),
        storageRef: z.string().optional().default(''),
        fileName: z.string().min(1),
        mimeType: z.string().optional().default(''),
        sizeBytes: z.number().optional().default(0),
        updatedAt: z.string().optional().default(''),
    }),
    z.null(),
]);

export const candidateProfilePatchSchema = z.object({
    avatar: candidateAvatarSchema.optional(),
}).strict();

export const uploadCompleteSchema = z.object({
    uploadId: z.string().optional(),
    ownerType: z.string().default('candidate'),
    ownerId: z.string().optional(),
    kind: z.string(),
    fileName: z.string().min(1),
    mimeType: z.string().optional().default(''),
    sizeBytes: z.number().optional().default(0),
    storageKey: z.string().optional().default(''),
    metadata: z.any().optional().default({}),
});

export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export function nowLabel(date = new Date()) {
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date).replace(/\//g, '-');
}

export function newId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
