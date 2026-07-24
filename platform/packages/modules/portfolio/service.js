import {newId, portfolioSchema, uploadStatus} from '../../domain/contracts.js';
import {query} from '../../storage/db.js';
import {updateCandidateData} from '../candidates/service.js';
import {evaluatePortfolio} from '../ai-gateway/service.js';
import {writeAuditLog} from '../audit/service.js';

export function getPortfolioSchema() {
    return {
        ...portfolioSchema,
        evaluationDimensions: [
            {key: 'authenticity', label: '真实性证据', defaultWeight: 20},
            {key: 'creativity', label: '创意性', defaultWeight: 12},
            {key: 'businessValue', label: '业务实用性', defaultWeight: 16},
            {key: 'cloudInternalValue', label: '智能云/内部价值', defaultWeight: 12},
            {key: 'engineering', label: '工程落地', defaultWeight: 18},
            {key: 'product', label: '产品表达', defaultWeight: 10},
            {key: 'demo', label: '可演示程度', defaultWeight: 8},
            {key: 'reflection', label: '复盘能力', defaultWeight: 4},
        ],
    };
}

function normalizeScreenshots(screenshots = []) {
    return (Array.isArray(screenshots) ? screenshots : [])
        .filter((item) => item?.name || item?.storageRef || item?.caption)
        .slice(0, 5)
        .map((item, index) => ({
            id: item.id || newId('shot'),
            name: item.name || `截图 ${index + 1}`,
            caption: item.caption || '',
            tech: item.tech || '',
            contribution: item.contribution || '',
            validation: item.validation || '',
            storageKey: item.storageKey || '',
            storageRef: item.storageRef || '',
        }));
}

function portfolioSubmissionFromBody(body = {}, existing = {}) {
    const field = (key, fallback = '') => {
        const value = body[key] ?? existing[key] ?? fallback;
        return typeof value === 'string' ? value.trim() : value;
    };
    const title = String(field('title', body.name || existing.name || '未命名作品')).trim() || '未命名作品';
    const now = new Date().toISOString();
    return {
        ...existing,
        id: existing.id || newId('portfolio'),
        title,
        name: title,
        status: body.status || existing.status || uploadStatus.ready,
        jobDirection: field('jobDirection'),
        oneLineValue: field('oneLineValue', body.summary || body.evidence || existing.oneLineValue || ''),
        scenario: field('scenario'),
        currentSolutionGap: field('currentSolutionGap'),
        demoFlow: field('demoFlow'),
        problem: field('problem', body.note || existing.problem || ''),
        solution: field('solution', body.note || existing.solution || ''),
        coreFeatures: field('coreFeatures'),
        role: field('role'),
        contribution: field('contribution', body.note || existing.contribution || ''),
        aiUsage: field('aiUsage'),
        differentiation: field('differentiation'),
        evidenceUrl: field('evidenceUrl', body.url || existing.evidenceUrl || ''),
        screenshotCaption: field('screenshotCaption'),
        screenshotTech: field('screenshotTech'),
        screenshotContribution: field('screenshotContribution'),
        screenshotValidation: field('screenshotValidation'),
        outcome: field('outcome'),
        challenge: field('challenge'),
        reflection: field('reflection'),
        screenshots: body.screenshots ? normalizeScreenshots(body.screenshots) : normalizeScreenshots(existing.screenshots),
        attachmentRefs: body.attachmentRefs || existing.attachmentRefs || [],
        summary: field('summary', body.oneLineValue || body.evidence || existing.summary || ''),
        evidence: field('evidence', body.evidenceUrl || body.summary || existing.evidence || ''),
        updatedAt: now,
    };
}

async function savePortfolioSubmission(candidateId, submission, action) {
    await query(
        `INSERT INTO portfolio_submissions (id, candidate_id, title, status, data)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            status = EXCLUDED.status,
            data = EXCLUDED.data,
            updated_at = now()`,
        [submission.id, candidateId, submission.title, submission.status, submission]
    );
    const candidate = await updateCandidateData(candidateId, (draft) => {
        draft.portfolios = [
            ...(draft.portfolios || []).filter((item) => item.id !== submission.id),
            submission,
        ];
        draft.completeness = Math.max(draft.completeness || 20, 70);
        return draft;
    });
    await writeAuditLog({
        actorType: 'candidate',
        actorId: candidateId,
        action,
        aggregateType: 'PortfolioSubmission',
        aggregateId: submission.id,
        detail: {title: submission.title},
    });
    return {candidate, portfolio: submission};
}

export async function createPortfolioSubmission(candidateId, body = {}) {
    return savePortfolioSubmission(
        candidateId,
        portfolioSubmissionFromBody(body),
        'portfolio_submission.created'
    );
}

export async function updatePortfolioSubmission(candidateId, portfolioId, body = {}) {
    const result = await query(
        'SELECT data FROM portfolio_submissions WHERE id = $1 AND candidate_id = $2',
        [portfolioId, candidateId]
    );
    const existing = result.rows[0]?.data;
    if (!existing) throw new Error('Portfolio submission not found');
    return savePortfolioSubmission(
        candidateId,
        portfolioSubmissionFromBody({...body, id: portfolioId}, {...existing, id: portfolioId}),
        'portfolio_submission.updated'
    );
}

export async function evaluatePortfolios({job, candidate, snapshot}) {
    const selected = snapshot.portfolioItems?.length
        ? snapshot.portfolioItems
        : (candidate.portfolios || []).filter((item) => (
            snapshot.portfolioIds || []
        ).includes(item.id));
    const evaluations = [];
    for (const portfolio of selected) {
        evaluations.push({
            portfolioId: portfolio.id,
            title: portfolio.title || portfolio.name,
            ...(await evaluatePortfolio({job, portfolio})),
        });
    }
    return evaluations;
}
