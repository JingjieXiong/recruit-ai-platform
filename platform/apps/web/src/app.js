import {api} from './apiClient.js';

const root = document.querySelector("#app");
let jobs = [];
let candidate = null;
let candidates = [];
let candidateMessageSyncTimer = null;
let candidateMessageSyncInFlight = false;
let candidateJobPreviewObserver = null;
let candidateTabTransitionTimer = null;
let candidateTabDeferredRenderTimer = null;
let candidateChatKeyboardTimer = null;
let publicInterviewPollTimer = null;
let candidateInterviewPollTimer = null;
let appMeta = {};
const avatarCropPointers = new Map();
let avatarCropGesture = null;

const state = {
    ready: false,
    loggedIn: false,
    candidateAuthMode: "login",
    candidateAuthError: "",
    candidateAuthNotice: "",
    candidateAuthPrefill: null,
    candidateRegistrationConfirm: null,
    candidateRegistrationSubmitting: false,
    selectedJobId: "",
    candidateTab: "jobs",
    candidateTabTransitionFrom: "",
    candidateTabTransitionId: 0,
    candidateTabTransitionRenderedId: 0,
    candidateMessageJobId: "",
    candidateFeedScrollTop: 0,
    candidateChatScrollByJob: {},
    candidateChatPinnedByJob: {},
    candidateChatForceScrollJobId: "",
    dismissedPinnedJobIds: [],
    candidateJobDetail: false,
    consultedJobIds: [],
    consultVisitsByJob: {},
    avatarEditorOpen: false,
    avatarPreviewOpen: false,
    avatarCrop: null,
    applicationSheetJobId: "",
    applicationUpdateAppId: "",
    applicationUpdateRequestId: "",
    applicationMaterialDrafts: {},
    applicationSheetScrollByKey: {},
    applicationSubmitting: false,
    applicationSubmitError: "",
    candidateApplicationDetailId: "",
    candidateMaterialForm: "",
    candidateMaterialError: "",
    candidateMaterialDetailKey: "",
    candidateMaterialDeleteKind: "",
    candidateMaterialDeleteConfirm: null,
    candidateMaterialDeletingId: "",
    candidateMaterialManagerKind: "",
    candidateInterviewManagerOpen: false,
    candidateInterviewEntryAppId: "",
    candidateInterviewEntry: null,
    publicInterviewKey: "",
    publicInterviewLoading: false,
    publicInterviewStarting: false,
    publicInterviewEntry: null,
    publicInterviewError: "",
    candidateInterviewStartingAppId: "",
    candidateRefreshing: false,
    candidateMessageLastSync: 0,
    candidatePanel: "materials",
    adminPage: "jobs",
    adminWorkbenchReturnUrl: "/admin",
    lastRouteName: "",
    lastAdminRoute: "/admin",
    adminCandidateQuery: "",
    adminJobQuery: "",
    selectedJobTab: "jd",
    adminJobSidebarCollapsed: false,
    adminEditingSection: "",
    adminEditingRuleId: "",
    adminEditingRuleTemplates: false,
    adminRecentTemplateId: "",
    adminDeleteJobId: "",
    adminDeleteJobError: "",
    adminDeletingJobId: "",
    adminForceInterviewAppId: "",
    adminForceInterviewReason: "",
    adminForceInterviewError: "",
    adminForceInterviewBusy: false,
    adminForceInterviewSessionId: "",
    adminSendingInterviewAppId: "",
    adminPortfolioDetailAppId: "",
    adminPortfolioDetailId: "",
    adminApplicationReportModal: "",
    selectedCandidateId: "",
    activeApplicationId: "",
    routeAppIdApplied: "",
    adminCreateJobOpen: false,
    toast: "",
    consultMessagesByJob: {},
    consultStreamingByJob: {},
    adminConsultationsByJob: {},
    adminSelectedConsultationId: "",
    adminChatScrollBySession: {},
    adminChatPinnedBySession: {},
    adminChatForceScrollSessionId: "",
    adminConsultationLoading: false,
    adminConsultationError: "",
    adminMessageActionMenuId: "",
    adminMatchReportsByApp: {},
    adminMatchReportLoadingAppId: "",
    adminMatchReportError: "",
    adminApplicationReportMarkdownByKey: {},
    adminApplicationReportLoadingKey: "",
    adminApplicationReportError: "",
    adminApplicationExportFilter: "all",
    adminApplicationExportSelectedIds: [],
};

const store = {
    applications: [],
    screeningRuleTemplates: [],
};

const candidateSessionKey = "recruit-ai-candidate-session";
const candidateAvatarMaxInputBytes = 8 * 1024 * 1024;
const routeSessionKey = "recruit-ai-route-session";
const adminSearchInputs = new Set(["admin-candidate-search", "admin-job-search"]);
let adminSearchRenderTimer = 0;

function loadCandidateSession() {
    try {
        return JSON.parse(window.localStorage.getItem(candidateSessionKey) || "null");
    }
    catch (error) {
        return null;
    }
}

function saveCandidateSession(nextCandidate, identity) {
    if (!nextCandidate?.id) return;
    window.localStorage.setItem(candidateSessionKey, JSON.stringify({
        candidateId: nextCandidate.id,
        name: identity?.name || nextCandidate.name || "",
        savedAt: new Date().toISOString(),
    }));
}

function clearCandidateSession() {
    window.localStorage.removeItem(candidateSessionKey);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

const avatarPalettes = [
    {a: "#22B8A9", b: "#4D78C8", glow: "rgba(77, 120, 200, 0.18)"},
    {a: "#5BAF45", b: "#2F8C73", glow: "rgba(91, 175, 69, 0.18)"},
    {a: "#E07A5F", b: "#B65B5B", glow: "rgba(182, 91, 91, 0.18)"},
    {a: "#C8903B", b: "#6E9B8F", glow: "rgba(181, 132, 47, 0.18)"},
    {a: "#5A8DEE", b: "#7C6BC8", glow: "rgba(90, 141, 238, 0.18)"},
    {a: "#2AA7A5", b: "#7A9D54", glow: "rgba(42, 167, 165, 0.18)"},
    {a: "#D66F9A", b: "#7E78C6", glow: "rgba(214, 111, 154, 0.18)"},
    {a: "#3F8C7A", b: "#395C8F", glow: "rgba(63, 140, 122, 0.18)"},
];

function stableHash(value) {
    return Array.from(String(value || "candidate")).reduce((hash, char) => {
        return ((hash << 5) - hash + char.charCodeAt(0)) >>> 0;
    }, 2166136261);
}

function candidateAvatarSeed(cand = candidate) {
    return [cand?.id, cand?.name, cand?.idTail].filter(Boolean).join(":") || "candidate";
}

function candidateAvatarInitial(cand = candidate) {
    const chars = Array.from(String(cand?.name || "候").trim()).filter((char) => char.trim());
    return chars.at(-1) || "候";
}

function candidateAvatarStyle(cand = candidate) {
    const palette = avatarPalettes[stableHash(candidateAvatarSeed(cand)) % avatarPalettes.length];
    return `--avatar-a:${palette.a};--avatar-b:${palette.b};--avatar-glow:${palette.glow};`;
}

function candidateAvatarImage(cand = candidate) {
    const avatar = cand?.avatar;
    if (avatar?.mode !== "image" || !avatar.storageKey) return "";
    const candidateId = cand?.id || cand?.candidateId || "";
    if (!candidateId) return "";
    const version = encodeURIComponent(avatar.updatedAt || avatar.storageKey);
    if (candidate?.id && candidateId === candidate.id) {
        return `/api/candidate/profile/avatar/file?v=${version}`;
    }
    return `/api/admin/candidates/${encodeURIComponent(candidateId)}/avatar/file?v=${version}`;
}

function renderCandidateAvatar(cand = candidate, className = "profile-avatar") {
    const image = candidateAvatarImage(cand);
    if (image) {
        return `<span class="${escapeHtml(className)} custom-avatar"><img src="${escapeHtml(image)}" alt="" /></span>`;
    }
    return `<span class="${escapeHtml(className)} generated-avatar" style="${escapeHtml(candidateAvatarStyle(cand))}">${escapeHtml(candidateAvatarInitial(cand))}</span>`;
}

function renderCandidateAvatarPreview(cand = candidate) {
    const image = candidateAvatarImage(cand);
    if (image) {
        return `<img src="${escapeHtml(image)}" alt="${escapeHtml(cand?.name || "候选人")}头像" />`;
    }
    return `<span class="avatar-preview-generated" style="${escapeHtml(candidateAvatarStyle(cand))}">${escapeHtml(candidateAvatarInitial(cand))}</span>`;
}

function candidateAvatarMeta(cand = candidate) {
    const image = candidateAvatarImage(cand);
    if (image) {
        return {
            avatarClass: "candidate custom-avatar",
            avatar: `<img src="${escapeHtml(image)}" alt="" />`,
            avatarStyle: "",
        };
    }
    return {
        avatarClass: "candidate",
        avatar: escapeHtml(candidateAvatarInitial(cand)),
        avatarStyle: candidateAvatarStyle(cand),
    };
}

function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
}

function validateCandidateAvatarFile(file) {
    if (!file) throw new Error("请先选择一张图片。");
    if (!String(file.type || "").startsWith("image/")) throw new Error("头像只支持图片文件。");
    if (file.size > candidateAvatarMaxInputBytes) throw new Error("图片过大，请选择 8MB 以内的头像。");
}

function clearAvatarCrop() {
    if (state.avatarCrop?.objectUrl) URL.revokeObjectURL(state.avatarCrop.objectUrl);
    state.avatarCrop = null;
    avatarCropPointers.clear();
    avatarCropGesture = null;
}

function beginAvatarCrop(file) {
    validateCandidateAvatarFile(file);
    clearAvatarCrop();
    state.avatarCrop = {
        file,
        objectUrl: URL.createObjectURL(file),
        x: 0,
        y: 0,
        zoom: 1,
        naturalWidth: 0,
        naturalHeight: 0,
        saving: false,
        error: "",
    };
    state.avatarPreviewOpen = false;
    state.avatarEditorOpen = true;
}

function avatarCropMetrics() {
    const crop = state.avatarCrop;
    const stage = document.querySelector(".avatar-crop-stage");
    if (!crop || !stage || !crop.naturalWidth || !crop.naturalHeight) return null;
    const stageSize = stage.clientWidth;
    const cropSize = stageSize;
    const baseScale = Math.max(cropSize / crop.naturalWidth, cropSize / crop.naturalHeight);
    const zoom = clampNumber(crop.zoom, 1, 4);
    const displayWidth = crop.naturalWidth * baseScale * zoom;
    const displayHeight = crop.naturalHeight * baseScale * zoom;
    return {
        stage,
        image: stage.querySelector(".avatar-crop-image"),
        stageSize,
        cropSize,
        zoom,
        displayWidth,
        displayHeight,
        maxX: Math.max(0, (displayWidth - cropSize) / 2),
        maxY: Math.max(0, (displayHeight - cropSize) / 2),
    };
}

function applyAvatarCropTransform() {
    const crop = state.avatarCrop;
    const metrics = avatarCropMetrics();
    if (!crop || !metrics?.image) return;
    crop.zoom = metrics.zoom;
    crop.x = clampNumber(crop.x, -metrics.maxX, metrics.maxX);
    crop.y = clampNumber(crop.y, -metrics.maxY, metrics.maxY);
    metrics.image.style.width = `${metrics.displayWidth}px`;
    metrics.image.style.height = `${metrics.displayHeight}px`;
    metrics.image.style.transform = `translate(-50%, -50%) translate(${crop.x}px, ${crop.y}px)`;
    const zoomInput = document.querySelector("[data-input='avatar-crop-zoom']");
    if (zoomInput) zoomInput.value = String(crop.zoom);
}

function updateAvatarCrop(patch) {
    if (!state.avatarCrop) return;
    Object.assign(state.avatarCrop, patch);
    applyAvatarCropTransform();
}

function attachAvatarCropper() {
    const crop = state.avatarCrop;
    const image = document.querySelector(".avatar-crop-image");
    if (!crop || !image) return;
    const syncImageSize = () => {
        crop.naturalWidth = image.naturalWidth;
        crop.naturalHeight = image.naturalHeight;
        applyAvatarCropTransform();
    };
    if (image.complete && image.naturalWidth) syncImageSize();
    else image.addEventListener("load", syncImageSize, {once: true});
}

function resetAvatarCropGesture() {
    const points = [...avatarCropPointers.values()];
    if (!points.length || !state.avatarCrop) {
        avatarCropGesture = null;
        return;
    }
    const center = points.reduce((sum, point) => ({
        x: sum.x + point.x / points.length,
        y: sum.y + point.y / points.length,
    }), {x: 0, y: 0});
    const distance = points.length >= 2
        ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
        : 1;
    avatarCropGesture = {
        center,
        distance,
        x: state.avatarCrop.x,
        y: state.avatarCrop.y,
        zoom: state.avatarCrop.zoom,
    };
}

function moveAvatarCropGesture() {
    const points = [...avatarCropPointers.values()];
    if (!points.length || !avatarCropGesture) return;
    const center = points.reduce((sum, point) => ({
        x: sum.x + point.x / points.length,
        y: sum.y + point.y / points.length,
    }), {x: 0, y: 0});
    const patch = {
        x: avatarCropGesture.x + center.x - avatarCropGesture.center.x,
        y: avatarCropGesture.y + center.y - avatarCropGesture.center.y,
    };
    if (points.length >= 2) {
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        patch.zoom = avatarCropGesture.zoom * (distance / Math.max(1, avatarCropGesture.distance));
    }
    updateAvatarCrop(patch);
}

async function createCroppedAvatarFile() {
    const crop = state.avatarCrop;
    const metrics = avatarCropMetrics();
    if (!crop || !metrics) throw new Error("请先选择并调整头像。");
    applyAvatarCropTransform();
    const image = await loadImage(crop.objectUrl);
    const pixelScale = metrics.displayWidth / crop.naturalWidth;
    const center = metrics.stageSize / 2;
    const imageLeft = center + crop.x - (metrics.displayWidth / 2);
    const imageTop = center + crop.y - (metrics.displayHeight / 2);
    const cropLeft = center - (metrics.cropSize / 2);
    const cropTop = center - (metrics.cropSize / 2);
    const sourceX = (cropLeft - imageLeft) / pixelScale;
    const sourceY = (cropTop - imageTop) / pixelScale;
    const sourceSize = metrics.cropSize / pixelScale;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 512, 512);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.94));
    if (!blob) throw new Error("头像裁剪失败，请换一张图片。");
    return new File([blob], "avatar.png", {type: "image/png"});
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片读取失败，请换一张图片。"));
        image.src = src;
    });
}

function normalizeIdTailInput(value) {
    return String(value || "").trim();
}

function applyBootstrap(data) {
    jobs = data.jobs || [];
    candidate = data.candidate || null;
    candidates = data.candidates || [];
    appMeta = data.appMeta || {};
    store.applications = data.applications || [];
    store.screeningRuleTemplates = data.screeningRuleTemplates || [];
    state.consultedJobIds = data.consultations?.consultedJobIds || [];
    state.consultVisitsByJob = data.consultations?.consultVisitsByJob || {};
    state.consultMessagesByJob = data.consultations?.consultMessagesByJob || {};
    state.selectedJobId ||= jobs[0]?.id || "";
    const savedSession = loadCandidateSession();
    const sessionMatches = Boolean(candidate?.id && savedSession?.candidateId === candidate.id);
    state.loggedIn = sessionMatches;
    if (sessionMatches) {
        state.selectedCandidateId = candidate.id;
    }
    else {
        candidate = null;
        if (routeName() === "candidate") {
            state.selectedCandidateId = "";
        }
        else {
            state.selectedCandidateId ||= candidates[0]?.id || "";
        }
    }
    state.ready = true;
}

async function loadBootstrap() {
    try {
        applyBootstrap(await api.bootstrap());
    }
    catch (error) {
        root.innerHTML = `
            <main class="candidate-shell">
                <section class="candidate-empty-state">
                    ${helperMark("mini")}
                    <strong>前端初始化失败</strong>
                    <p>${escapeHtml(error.message)}</p>
                </section>
            </main>
        `;
    }
}

async function refreshCandidateState() {
    const data = await api.bootstrap();
    applyBootstrap(data);
}

function shouldSyncCandidateMessages() {
    return routeName() === "candidate"
        && state.ready
        && state.loggedIn
        && state.candidateTab === "messages";
}

function isComposingCandidateMessage() {
    const active = document.activeElement;
    return Boolean(active?.matches?.(".candidate-chat-input input") && active.value);
}

function activeCandidateChatInput() {
    const active = document.activeElement;
    return active?.matches?.(".candidate-chat-input input") ? active : null;
}

function syncCandidateChatKeyboard() {
    const input = activeCandidateChatInput();
    const composer = input?.closest(".candidate-chat-input");
    document.body.classList.toggle("candidate-chat-focus", Boolean(input && composer));
    document.documentElement.style.setProperty("--candidate-chat-keyboard-adjust", "0px");
    if (!input || !composer) return;

    const chat = document.querySelector(".app-chat-list[data-chat-job-id]");
    if (chat && state.candidateChatPinnedByJob[chat.dataset.chatJobId] !== false) {
        chat.scrollTop = chat.scrollHeight;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
        composer.scrollIntoView({block: "nearest"});
        return;
    }

    const visibleBottom = viewport.offsetTop + viewport.height;
    const rect = composer.getBoundingClientRect();
    const overlap = Math.max(0, Math.ceil(rect.bottom - visibleBottom + 10));
    document.documentElement.style.setProperty("--candidate-chat-keyboard-adjust", `${overlap}px`);
}

function scheduleCandidateChatKeyboardSync() {
    window.clearTimeout(candidateChatKeyboardTimer);
    candidateChatKeyboardTimer = window.setTimeout(syncCandidateChatKeyboard, 40);
}

function hasActiveCandidateChatStream() {
    return Object.values(state.consultStreamingByJob || {}).some(Boolean);
}

function hasCandidateBlockingInteraction() {
    return Boolean(
        state.applicationSheetJobId
        || state.applicationUpdateAppId
        || state.applicationSubmitting
        || state.candidateApplicationDetailId
        || state.candidateInterviewManagerOpen
        || state.candidateInterviewEntryAppId
        || state.candidateMaterialManagerKind
        || state.candidateMaterialForm
        || state.candidateMaterialDetailKey
        || state.candidateMaterialDeleteKind
        || state.candidateMaterialDeleteConfirm
        || state.avatarPreviewOpen
        || state.avatarEditorOpen
    );
}

async function syncCandidateMessages({showLoading = false} = {}) {
    if (
        candidateMessageSyncInFlight
        || !shouldSyncCandidateMessages()
        || isComposingCandidateMessage()
        || hasActiveCandidateChatStream()
        || hasCandidateBlockingInteraction()
    ) return;
    candidateMessageSyncInFlight = true;
    if (showLoading) state.candidateRefreshing = true;
    try {
        await refreshCandidateState();
        state.candidateMessageLastSync = Date.now();
    }
    catch (error) {
        if (showLoading) setToast(`同步消息失败：${error.message}`);
    }
    finally {
        candidateMessageSyncInFlight = false;
        if (showLoading) state.candidateRefreshing = false;
        if (shouldSyncCandidateMessages()) renderAfterCandidateTabbarSettles();
    }
}

function markCandidateMessagesReadLocally(jobId) {
    const now = new Date().toISOString();
    replaceJobMessages(jobId, messagesForJob(jobId).map((message) => (
        isCandidateUnreadMessage(message)
            ? {...message, readByCandidateAt: message.readByCandidateAt || now}
            : message
    )));
}

async function markCandidateConversationRead(jobId) {
    if (!jobId || !candidateUnreadCountForJob(jobId)) return;
    markCandidateMessagesReadLocally(jobId);
    try {
        const result = await api.markCandidateConsultationRead(jobId);
        if (result?.consultations) {
            state.consultMessagesByJob = result.consultations.consultMessagesByJob;
            state.consultedJobIds = result.consultations.consultedJobIds;
            state.consultVisitsByJob = result.consultations.consultVisitsByJob;
            state.candidateMessageLastSync = Date.now();
        }
    }
    catch {
        // Reading the conversation should stay lightweight; the next sync can retry the marker.
    }
}

function ensureCandidateMessageSync() {
    if (!shouldSyncCandidateMessages()) {
        if (candidateMessageSyncTimer) {
            window.clearInterval(candidateMessageSyncTimer);
            candidateMessageSyncTimer = null;
        }
        return;
    }
    if (!candidateMessageSyncTimer) {
        candidateMessageSyncTimer = window.setInterval(() => {
            syncCandidateMessages();
        }, 5000);
    }
    if (Date.now() - state.candidateMessageLastSync > 5000) {
        window.setTimeout(() => syncCandidateMessages(), 250);
    }
}

function isNearScrollBottom(element, tolerance = 90) {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= tolerance;
}

function activeApplicationSheetKey() {
    if (state.applicationUpdateAppId) return `update:${state.applicationUpdateAppId}:${state.applicationUpdateRequestId || "legacy"}`;
    if (state.applicationSheetJobId) return `submit:${state.applicationSheetJobId}`;
    return "";
}

function applicationChoiceDraftFromForm(form) {
    return {
        resumeId: form.querySelector('input[name="resumeId"]:checked')?.value || "",
        portfolioIds: [...form.querySelectorAll('input[name="portfolioIds"]:checked')].map((input) => input.value),
        knowledgeIds: [...form.querySelectorAll('input[name="knowledgeIds"]:checked')].map((input) => input.value),
    };
}

function captureApplicationSheetState() {
    const key = activeApplicationSheetKey();
    if (!key) return;
    const sheet = document.querySelector(".application-submit-sheet");
    if (sheet) {
        state.applicationSheetScrollByKey = {
            ...state.applicationSheetScrollByKey,
            [key]: sheet.scrollTop,
        };
    }
    const form = sheet?.querySelector('form[data-form="application-submit"], form[data-form="application-material-update"]');
    if (form) {
        state.applicationMaterialDrafts = {
            ...state.applicationMaterialDrafts,
            [key]: applicationChoiceDraftFromForm(form),
        };
    }
}

function restoreApplicationSheetState() {
    const key = activeApplicationSheetKey();
    if (!key) return;
    const sheet = document.querySelector(".application-submit-sheet");
    if (!sheet) return;
    if (Object.prototype.hasOwnProperty.call(state.applicationSheetScrollByKey, key)) {
        sheet.scrollTop = state.applicationSheetScrollByKey[key] || 0;
    }
    sheet.addEventListener("scroll", captureApplicationSheetState, {passive: true});
}

function clearApplicationSheetDraft(key = activeApplicationSheetKey()) {
    if (!key) return;
    const nextDrafts = {...state.applicationMaterialDrafts};
    const nextScroll = {...state.applicationSheetScrollByKey};
    delete nextDrafts[key];
    delete nextScroll[key];
    state.applicationMaterialDrafts = nextDrafts;
    state.applicationSheetScrollByKey = nextScroll;
}

function captureCandidateViewState() {
    captureApplicationSheetState();

    const feed = document.querySelector("[data-candidate-feed]");
    if (feed) {
        state.candidateFeedScrollTop = feed.scrollTop;
    }

    const chat = document.querySelector(".app-chat-list[data-chat-job-id]");
    const jobId = chat?.dataset.chatJobId;
    if (!chat || !jobId) return;
    const streamPinned = state.consultStreamingByJob[jobId] && state.candidateChatPinnedByJob[jobId] !== false;
    if (streamPinned) return;
    state.candidateChatScrollByJob = {
        ...state.candidateChatScrollByJob,
        [jobId]: chat.scrollTop,
    };
    state.candidateChatPinnedByJob = {
        ...state.candidateChatPinnedByJob,
        [jobId]: isNearScrollBottom(chat),
    };
}

function attachCandidateChatScroll() {
    const chat = document.querySelector(".app-chat-list[data-chat-job-id]");
    const jobId = chat?.dataset.chatJobId;
    if (!chat || !jobId) return;

    const forceBottom = state.candidateChatForceScrollJobId === jobId;
    const pinned = state.candidateChatPinnedByJob[jobId] !== false;
    if (forceBottom || pinned) {
        chat.scrollTop = chat.scrollHeight;
        state.candidateChatForceScrollJobId = "";
        state.candidateChatPinnedByJob = {
            ...state.candidateChatPinnedByJob,
            [jobId]: true,
        };
    }
    else {
        chat.scrollTop = state.candidateChatScrollByJob[jobId] || 0;
    }

    chat.addEventListener("scroll", () => {
        state.candidateChatScrollByJob = {
            ...state.candidateChatScrollByJob,
            [jobId]: chat.scrollTop,
        };
        state.candidateChatPinnedByJob = {
            ...state.candidateChatPinnedByJob,
            [jobId]: isNearScrollBottom(chat),
        };
    }, {passive: true});
}

function attachCandidateJobPreviews() {
    const previews = [...document.querySelectorAll(".job-jd-preview")];
    if (candidateJobPreviewObserver) {
        candidateJobPreviewObserver.disconnect();
        candidateJobPreviewObserver = null;
    }
    if (!previews.length) return;

    const updatePreview = (preview) => {
        const hint = preview.querySelector(".job-jd-more-hint");
        const contentItems = [...preview.querySelectorAll("h3, p, li, blockquote, h4")];
        const lastItem = contentItems[contentItems.length - 1];
        const truncated = lastItem
            ? lastItem.getBoundingClientRect().bottom > preview.getBoundingClientRect().bottom - 4
            : false;
        preview.classList.toggle("is-truncated", truncated);
        if (hint) hint.hidden = !truncated;
    };

    previews.forEach(updatePreview);
    if ("ResizeObserver" in window) {
        candidateJobPreviewObserver = new ResizeObserver((entries) => {
            entries.forEach((entry) => updatePreview(entry.target));
        });
        previews.forEach((preview) => candidateJobPreviewObserver.observe(preview));
    }
    else {
        window.addEventListener("resize", () => previews.forEach(updatePreview), {once: true});
    }
}

function updatePortfolioScreenshotSlot(input) {
    const card = input.closest(".portfolio-screenshot-card");
    if (!card) return;
    const file = input.files?.[0];
    const fileLabel = card.querySelector("[data-screenshot-file]");
    const title = card.querySelector("[data-screenshot-title]");
    const preview = card.querySelector("[data-screenshot-preview]");
    if (card.dataset.previewUrl) {
        URL.revokeObjectURL(card.dataset.previewUrl);
        delete card.dataset.previewUrl;
    }
    card.classList.toggle("has-file", Boolean(file));
    if (title) title.textContent = file ? "更换截图" : "添加截图";
    if (fileLabel) fileLabel.textContent = file?.name || (input.dataset.screenshotIndex === "0" ? "PNG / JPG" : "可继续添加");
    if (preview) {
        if (file) {
            const previewUrl = URL.createObjectURL(file);
            card.dataset.previewUrl = previewUrl;
            preview.src = previewUrl;
            preview.hidden = false;
        }
        else {
            preview.removeAttribute("src");
            preview.hidden = true;
        }
    }
    const cards = [...card.parentElement.querySelectorAll(".portfolio-screenshot-card")];
    const next = cards[cards.indexOf(card) + 1];
    if (file && next) next.hidden = false;
}

function captureAdminChatViewState() {
    const chat = document.querySelector(".admin-chat-log[data-admin-session-id]");
    const sessionId = chat?.dataset.adminSessionId;
    if (!chat || !sessionId) return;
    state.adminChatScrollBySession = {
        ...state.adminChatScrollBySession,
        [sessionId]: chat.scrollTop,
    };
    state.adminChatPinnedBySession = {
        ...state.adminChatPinnedBySession,
        [sessionId]: isNearScrollBottom(chat),
    };
}

function attachAdminChatScroll() {
    const chat = document.querySelector(".admin-chat-log[data-admin-session-id]");
    const sessionId = chat?.dataset.adminSessionId;
    if (!chat || !sessionId) return;

    const forceBottom = state.adminChatForceScrollSessionId === sessionId;
    const pinned = state.adminChatPinnedBySession[sessionId] !== false;
    if (forceBottom || pinned) {
        chat.scrollTop = chat.scrollHeight;
        state.adminChatForceScrollSessionId = "";
        state.adminChatPinnedBySession = {
            ...state.adminChatPinnedBySession,
            [sessionId]: true,
        };
    }
    else {
        chat.scrollTop = state.adminChatScrollBySession[sessionId] || 0;
    }

    chat.addEventListener("scroll", () => {
        state.adminChatScrollBySession = {
            ...state.adminChatScrollBySession,
            [sessionId]: chat.scrollTop,
        };
        state.adminChatPinnedBySession = {
            ...state.adminChatPinnedBySession,
            [sessionId]: isNearScrollBottom(chat),
        };
    }, {passive: true});
}

async function loadAdminMatchReport(applicationId) {
    if (!applicationId || state.adminMatchReportsByApp[applicationId] || state.adminMatchReportLoadingAppId === applicationId) return;
    state.adminMatchReportLoadingAppId = applicationId;
    state.adminMatchReportError = "";
    try {
        const result = await api.getMatchReport(applicationId);
        state.adminMatchReportsByApp = {
            ...state.adminMatchReportsByApp,
            [applicationId]: result,
        };
    }
    catch (error) {
        state.adminMatchReportError = error.message || "匹配报告生成失败";
    }
    finally {
        if (state.adminMatchReportLoadingAppId === applicationId) {
            state.adminMatchReportLoadingAppId = "";
        }
        render();
    }
}

function applicationReportCacheKey(applicationId, reportKind = "prescreen") {
    return `${applicationId}:${reportKind}`;
}

function clearApplicationReportMarkdownCache(applicationId) {
    if (!applicationId) return;
    const prefix = `${applicationId}:`;
    state.adminApplicationReportMarkdownByKey = Object.fromEntries(
        Object.entries(state.adminApplicationReportMarkdownByKey)
            .filter(([key]) => !key.startsWith(prefix))
    );
    if (state.adminApplicationReportLoadingKey.startsWith(prefix)) {
        state.adminApplicationReportLoadingKey = "";
    }
}

async function loadAdminApplicationReportMarkdown(applicationId, reportKind = "prescreen") {
    if (!applicationId) return;
    const kind = ["prescreen", "ai"].includes(reportKind) ? reportKind : "prescreen";
    const key = applicationReportCacheKey(applicationId, kind);
    if (state.adminApplicationReportMarkdownByKey[key] || state.adminApplicationReportLoadingKey === key) return;
    state.adminApplicationReportLoadingKey = key;
    state.adminApplicationReportError = "";
    try {
        let markdown = "";
        if (kind === "prescreen") {
            const result = await api.getMatchReport(applicationId);
            markdown = result.markdown || "";
            state.adminMatchReportsByApp = {
                ...state.adminMatchReportsByApp,
                [applicationId]: result,
            };
        }
        else {
            markdown = await api.getApplicationReportMarkdown(applicationId, kind);
        }
        state.adminApplicationReportMarkdownByKey = {
            ...state.adminApplicationReportMarkdownByKey,
            [key]: markdown,
        };
    }
    catch (error) {
        state.adminApplicationReportError = error.message || "报告读取失败";
    }
    finally {
        if (state.adminApplicationReportLoadingKey === key) {
            state.adminApplicationReportLoadingKey = "";
        }
        render();
    }
}

function requestVisibleAdminMatchReport() {
    if (
        routeName() !== "admin"
        || state.adminPage !== "jobDetail"
        || state.selectedJobTab !== "applications"
        || !state.activeApplicationId
    ) return;
    window.requestAnimationFrame(() => {
        loadAdminMatchReport(state.activeApplicationId);
    });
}

function routeName() {
    const path = window.location.pathname;
    if (path.startsWith("/admin")) return "admin";
    if (path.startsWith("/interview/")) return "interview";
    return "candidate";
}

const adminJobTabs = new Set(["jd", "knowledge", "rubric", "applications", "interviews", "communication"]);

function adminJobUrl(jobId = state.selectedJobId, {tab = state.selectedJobTab, appId = ""} = {}) {
    if (!jobId) return "/admin";
    const params = new URLSearchParams({jobId});
    if (adminJobTabs.has(tab) && tab !== "jd") {
        params.set("tab", tab);
    }
    if (appId) {
        params.set("appId", appId);
    }
    return `/admin?${params.toString()}`;
}

function adminRoutePath() {
    return `${window.location.pathname}${window.location.search}`;
}

function readRouteSession() {
    try {
        return JSON.parse(window.sessionStorage.getItem(routeSessionKey) || "{}");
    }
    catch (error) {
        return {};
    }
}

function writeRouteSession(route, adminRoute = state.lastAdminRoute) {
    try {
        window.sessionStorage.setItem(routeSessionKey, JSON.stringify({route, adminRoute}));
    }
    catch (error) {
        // sessionStorage can be unavailable in private or embedded contexts; route memory is only a convenience.
    }
}

function navigationWasBackForward() {
    return performance.getEntriesByType("navigation")?.[0]?.type === "back_forward";
}

function restoreAdminRouteFromBrowserBack() {
    if (routeName() !== "candidate" || !navigationWasBackForward()) return;
    const persisted = readRouteSession();
    if (persisted.route !== "admin") return;
    const target = persisted.adminRoute || state.lastAdminRoute || "/admin";
    window.history.replaceState({}, "", target);
    state.lastAdminRoute = target;
    state.lastRouteName = "admin";
}

function rememberAdminRoute(path = adminRoutePath()) {
    if (path.startsWith("/admin")) {
        state.lastAdminRoute = path;
        writeRouteSession("admin", path);
    }
}

function rememberAdminWorkbenchUrl() {
    if (routeName() !== "admin") return;
    if (["candidateHub", "candidateDetail"].includes(state.adminPage)) return;
    if (state.adminPage === "jobDetail" && state.selectedJobId) {
        const target = adminJobUrl(state.selectedJobId, {
            tab: state.selectedJobTab,
            appId: state.activeApplicationId,
        });
        state.adminWorkbenchReturnUrl = target;
        return;
    }
    state.adminWorkbenchReturnUrl = adminRoutePath();
}

function showAdminJobList() {
    state.adminPage = "jobs";
    state.adminWorkbenchReturnUrl = "/admin";
    state.activeApplicationId = "";
    state.routeAppIdApplied = "";
    window.history.replaceState({}, "", "/admin");
    rememberAdminRoute("/admin");
}

function restoreAdminWorkbench() {
    const target = state.adminWorkbenchReturnUrl || "/admin";
    window.history.replaceState({}, "", target);
    rememberAdminRoute(target);
    if (target === "/admin") {
        state.adminPage = "jobs";
        state.activeApplicationId = "";
        state.routeAppIdApplied = "";
        return;
    }
    syncRouteState();
}

function syncRouteState() {
    if (window.location.pathname === "/") {
        window.history.replaceState({}, "", "/candidate");
    }
    restoreAdminRouteFromBrowserBack();
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("jobId");
    const appId = params.get("appId");
    const tab = params.get("tab");
    if (jobId && jobs.some((job) => job.id === jobId)) {
        state.selectedJobId = jobId;
        if (routeName() === "admin") {
            state.adminPage = "jobDetail";
            if (adminJobTabs.has(tab)) {
                state.selectedJobTab = tab;
            }
            state.adminWorkbenchReturnUrl = adminJobUrl(jobId, {tab: adminJobTabs.has(tab) ? tab : "jd"});
        }
    }
    if (appId && appId !== state.routeAppIdApplied && store.applications.some((app) => app.id === appId)) {
        state.activeApplicationId = appId;
        state.routeAppIdApplied = appId;
        if (routeName() === "admin") {
            const app = applicationById(appId);
            state.adminPage = "jobDetail";
            state.selectedJobId = app.jobId;
            state.selectedJobTab = "applications";
            state.adminWorkbenchReturnUrl = adminJobUrl(app.jobId, {tab: "applications", appId});
        }
    }
    if (!appId) {
        state.routeAppIdApplied = "";
        if (routeName() === "admin" && state.selectedJobTab === "applications") {
            state.activeApplicationId = "";
        }
    }
    if (routeName() === "admin") {
        rememberAdminRoute();
    }
    state.lastRouteName = routeName();
    writeRouteSession(state.lastRouteName, state.lastAdminRoute);
}

function navigate(path) {
    window.history.pushState({}, "", path);
    syncRouteState();
    render();
}

function jobById(id) {
    return jobs.find((job) => job.id === id) || jobs[0];
}

function candidateVisibleJobs() {
    return jobs.filter((job) => job.status === "已发布");
}

function selectedCandidateJob() {
    const visibleJobs = candidateVisibleJobs();
    return visibleJobs.find((job) => job.id === state.selectedJobId) || visibleJobs[0] || null;
}

function candidateLocation(job) {
    return job.location
        .split("/")
        .map((item) => item.trim())
        .filter((item) => item && item !== "线上")
        .join(" · ") || "北京";
}

function candidateMode(job) {
    if (job.mode.includes("实习")) return "实习";
    if (job.mode.includes("全职")) return "全职";
    return job.mode.replace("/线上", "");
}

function messagesForJob(jobId) {
    if (!state.consultMessagesByJob[jobId]) {
        state.consultMessagesByJob[jobId] = [];
    }
    return state.consultMessagesByJob[jobId];
}

function replaceJobMessages(jobId, messages) {
    state.consultMessagesByJob = {
        ...state.consultMessagesByJob,
        [jobId]: messages || [],
    };
}

function appendLocalMessage(jobId, message) {
    const localId = message.id || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    replaceJobMessages(jobId, [
        ...messagesForJob(jobId),
        {
            id: localId,
            createdAt: new Date().toISOString(),
            ...message,
        },
    ]);
    return localId;
}

function updateLocalMessage(jobId, messageId, patch) {
    replaceJobMessages(jobId, messagesForJob(jobId).map((message) => (
        message.id === messageId ? {...message, ...patch} : message
    )));
}

function isTodoMessage(message) {
    const app = message?.app || (message?.applicationId ? applicationById(message.applicationId) : null);
    if (message?.kind === "interview_invite" && app && aiInterviewExpired(app)) return false;
    return ["interview_invite", "material_request"].includes(message?.kind);
}

const candidateUnreadKinds = ["admin_reply", "system_notice", "interview_invite", "material_request"];

function isCandidateUnreadMessage(message) {
    return candidateUnreadKinds.includes(message?.kind) && !message.readByCandidateAt;
}

function candidateUnreadMessagesForJob(jobId) {
    return messagesForJob(jobId).filter(isCandidateUnreadMessage);
}

function candidateUnreadCountForJob(jobId) {
    return candidateUnreadMessagesForJob(jobId).length;
}

function candidateTotalUnreadCount() {
    return candidateMessageJobIds().reduce((sum, jobId) => sum + candidateUnreadCountForJob(jobId), 0);
}

function isSystemNoticeMessage(message) {
    return ["system_notice", "interview_invite", "material_request"].includes(message?.kind);
}

function chatBubbleClass(message) {
    return [
        "chat-bubble",
        message.who,
        ["ai_answer", "greeting"].includes(message.kind) ? "greeting" : "",
        ["system_notice", "interview_invite", "material_request", "admin_reply", "hr_request"].includes(message.kind) ? "notice" : "",
    ].filter(Boolean).join(" ");
}

function messageTextForDisplay(message = {}) {
    const text = String(message.text || "");
    if (message.kind === "reinterview_request" || /申请重发 AI 面试|重发 AI 面试邀请/.test(text)) {
        if (message.who === "candidate") return "我想联系招聘者";
        return "我已经把你的留言转给招聘者了。招聘者回复后，会继续出现在这个岗位聊天里。";
    }
    return text;
}

function adminMessageTextForDisplay(message = {}, session = {}) {
    if (message.kind === "interview_invite") {
        const app = message.applicationId
            ? applicationById(message.applicationId)
            : applicationForConsultation(session);
        const expiry = app?.aiInterview?.expiresAt
            ? `有效期至 ${formatDateTime(app.aiInterview.expiresAt)}。`
            : "";
        return `已向候选人发送 AI 面试邀请。${expiry}管理员端已进入等待候选人完成面试的状态。`;
    }
    if (message.kind === "material_request") {
        return "已向候选人发送补材料提醒。候选人更新材料后，投递状态会同步刷新。";
    }
    return messageTextForDisplay(message);
}

function chatRowClass(message) {
    return [
        "chat-message-row",
        message.who || "assistant",
        ["system_notice", "interview_invite", "material_request"].includes(message.kind) ? "notice" : "",
    ].filter(Boolean).join(" ");
}

function chatSenderMeta(message = {}) {
    if (["interview_invite", "material_request", "system_notice"].includes(message.kind)) {
        return {
            label: message.kind === "material_request" ? "材料通知" : message.kind === "interview_invite" ? "面试通知" : "系统通知",
            badge: "通知",
            avatarClass: "system",
            avatar: icon("message"),
        };
    }
    if (message.who === "candidate") {
        return {
            label: "我",
            badge: "候选人",
            ...candidateAvatarMeta(candidate),
        };
    }
    if (message.who === "admin") {
        return {
            label: "招聘者",
            badge: "招聘者",
            avatarClass: "recruiter",
            avatar: "招",
        };
    }
    return {
        label: "AI分身",
        badge: "AI",
        avatarClass: "assistant",
        avatar: "AI",
    };
}

function renderChatAvatar(meta) {
    const style = meta.avatarStyle ? ` style="${escapeHtml(meta.avatarStyle)}"` : "";
    return `<span class="chat-avatar ${escapeHtml(meta.avatarClass)}"${style}>${meta.avatar}</span>`;
}

function candidateInterviewAppForMessage(message = {}, fallbackJobId = "") {
    if (message.app?.id) return message.app;
    if (message.applicationId) return applicationById(message.applicationId);
    return applicationsForCandidate(candidate.id).find((app) => app.jobId === fallbackJobId && candidateCanOpenInterviewEntry(app));
}

function currentMaterialUpdateRequestId(app = {}) {
    return String(app?.materialUpdate?.requestId || app?.materialUpdate?.materialUpdateRequestId || "").trim();
}

function materialRequestIdForMessage(message = {}, app = null) {
    const explicit = String(message.materialUpdateRequestId || message.materialRequestId || message.requestId || "").trim();
    if (explicit) return explicit;
    const currentRequestId = currentMaterialUpdateRequestId(app);
    const requestedAt = new Date(app?.materialUpdate?.requestedAt || "").getTime();
    const messageAt = new Date(message.createdAt || "").getTime();
    if (currentRequestId && Number.isFinite(requestedAt) && Number.isFinite(messageAt) && messageAt + 2000 < requestedAt) {
        return "";
    }
    return currentRequestId;
}

function materialMessageBeforeCurrentRequest(message = {}, app = null) {
    if (message.materialUpdateRequestId || message.materialRequestId || message.requestId) return false;
    const currentRequestId = currentMaterialUpdateRequestId(app);
    const requestedAt = new Date(app?.materialUpdate?.requestedAt || "").getTime();
    const messageAt = new Date(message.createdAt || "").getTime();
    return Boolean(currentRequestId && Number.isFinite(requestedAt) && Number.isFinite(messageAt) && messageAt + 2000 < requestedAt);
}

function latestMaterialRequestMessage(jobId = "", applicationId = "") {
    const messages = messagesForJob(jobId).filter((item) => (
        item?.kind === "material_request"
        && (!applicationId || !item.applicationId || item.applicationId === applicationId)
    ));
    if (!messages.length) return null;
    return messages.reduce((latest, item, index) => (
        !latest || messageTime(item, index) >= messageTime(latest.message, latest.index)
            ? {message: item, index}
            : latest
    ), null)?.message || null;
}

function isLatestMaterialRequestMessage(message = {}, jobId = "") {
    const latest = latestMaterialRequestMessage(jobId, message.applicationId || "");
    if (!latest) return true;
    if (message.id && latest.id) return message.id === latest.id;
    return message === latest;
}

function applicationMaterialUpdateUsed(app, requestId = "") {
    const update = app?.materialUpdate || {};
    if (update.status !== "used") return false;
    const currentRequestId = currentMaterialUpdateRequestId(app);
    const usedRequestId = String(update.usedRequestId || currentRequestId || "").trim();
    const expectedRequestId = String(requestId || currentRequestId || "").trim();
    return !expectedRequestId || !usedRequestId || usedRequestId === expectedRequestId;
}

function renderMaterialUpdateControl(message, materialKind, jobId = "") {
    if (message.kind !== "material_request") return "";
    const app = message.applicationId ? applicationById(message.applicationId) : null;
    if (app && materialMessageBeforeCurrentRequest(message, app)) {
        return `<span class="chat-inline-note">请使用最新补材料通知。</span>`;
    }
    const requestId = materialRequestIdForMessage(message, app);
    const currentRequestId = currentMaterialUpdateRequestId(app);
    if (app && currentRequestId && requestId && requestId !== currentRequestId) {
        return `<span class="chat-inline-note">请使用最新补材料通知。</span>`;
    }
    if (app && !isLatestMaterialRequestMessage(message, jobId)) {
        return `<span class="chat-inline-note">请使用最新补材料通知。</span>`;
    }
    if (app && applicationMaterialUpdateUsed(app, requestId)) {
        return `<span class="chat-inline-note">本次补材料已提交，等待招聘者处理。</span>`;
    }
    return `<button class="primary small chat-inline-action" data-action="candidate-update-materials" data-app-id="${escapeHtml(message.applicationId || "")}" data-request-id="${escapeHtml(requestId)}" data-kind="${escapeHtml(materialKind)}">${icon("upload")}更新材料</button>`;
}

function renderCandidateChatMessage(message, jobId = "") {
    const interviewApp = candidateInterviewAppForMessage(message, jobId);
    const canOpenInterview = message.kind === "interview_invite" && interviewApp && candidateCanOpenInterviewEntry(interviewApp);
    const materialKind = message.materialKind || "portfolio";
    const materialUpdateControl = renderMaterialUpdateControl(message, materialKind, jobId);
    if (isSystemNoticeMessage(message)) {
        return `
            <div class="chat-system-notice">
                <small>${escapeHtml(messageKindLabel(message.kind))} · ${escapeHtml(messageTimeText(message))}</small>
                <div class="chat-markdown chat-system-notice-text">${renderChatMarkdownHtml(messageTextForDisplay(message))}</div>
                ${canOpenInterview ? `<button class="primary small chat-inline-action interview-entry-trigger" data-action="candidate-enter-interview" data-app-id="${escapeHtml(interviewApp.id)}">${icon("video")}进入 AI 面试</button>` : ""}
                ${materialUpdateControl}
            </div>
        `;
    }
    const meta = chatSenderMeta(message);
    return `
        <div class="${chatRowClass(message)}">
            ${renderChatAvatar(meta)}
            <div class="${chatBubbleClass(message)}">
                <span class="chat-sender-line">
                    <strong>${escapeHtml(meta.label)}</strong>
                    <em>${escapeHtml(meta.badge)}</em>
                </span>
                <div class="chat-markdown">${renderChatMarkdownHtml(messageTextForDisplay(message))}</div>
                ${canOpenInterview ? `<button class="primary small chat-inline-action interview-entry-trigger" data-action="candidate-enter-interview" data-app-id="${escapeHtml(interviewApp.id)}">${icon("video")}进入 AI 面试</button>` : ""}
                ${materialUpdateControl}
            </div>
        </div>
    `;
}

function messageTime(message, index = 0) {
    const value = message?.createdAt
        || message?.app?.aiInterview?.invitedAt
        || message?.app?.prescreen?.updatedAt
        || message?.app?.updatedAt
        || message?.app?.createdAt;
    const timestamp = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(timestamp) ? timestamp : index;
}

function messageTimeText(message) {
    const value = message?.createdAt
        || message?.app?.aiInterview?.invitedAt
        || message?.app?.prescreen?.updatedAt
        || message?.app?.updatedAt
        || message?.app?.createdAt;
    const timestamp = value ? new Date(value).getTime() : NaN;
    if (!Number.isFinite(timestamp)) return "刚刚";
    const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (diffMinutes < 1) return "刚刚";
    if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} 小时前`;
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateTime(value, fallback = "") {
    if (!value) return fallback;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return fallback || String(value);
    const parts = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        hour12: false,
    }).formatToParts(date).reduce((acc, part) => {
        if (part.type !== "literal") acc[part.type] = part.value;
        return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function latestMessage(messages) {
    return messages.reduce((latest, message, index) => (
        !latest || messageTime(message, index) >= messageTime(latest.message, latest.index)
            ? {message, index}
            : latest
    ), null)?.message || messages[messages.length - 1];
}

function markJobConsulted(jobId) {
    if (!state.consultedJobIds.includes(jobId)) {
        state.consultedJobIds.unshift(jobId);
    }
}

function consultGreetingFor(job, visitIndex) {
    const greetings = [
        `我是 ${job.title} 岗位的小助手。关于工作内容、准备方向、投递材料，都可以直接问我。`,
        `又见面啦。你还在看 ${job.title} 吗？可以继续问岗位细节，也可以让我帮你想想简历里哪段经历最该亮出来。`,
        `欢迎回来，${candidate.name}。准备得怎么样？如果你愿意，我们可以先把 ${job.title} 最容易被追问的点过一遍。`,
    ];
    return greetings[Math.min(visitIndex, greetings.length - 1)];
}

function addConsultGreeting(jobId) {
    const job = jobById(jobId);
    const messages = messagesForJob(jobId);
    const visitIndex = state.consultVisitsByJob[jobId] || 0;
    const text = consultGreetingFor(job, visitIndex);
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.text !== text) {
        messages.push({who: "assistant", kind: "greeting", text});
    }
    state.consultVisitsByJob[jobId] = visitIndex + 1;
}

function consultAnswerFor(job, question) {
    const compactQuestion = question.replace(/\s+/g, "");
    if (/你是谁|是谁|什么助手|介绍/.test(compactQuestion)) {
        return `我是 ${job.title} 岗位的小助手，负责把这个岗位的 JD 和岗位资料讲清楚。你问工作内容、准备方向、投递材料，我都会尽量说人话。`;
    }
    if (/算法|研究|工程|落地|技术/.test(compactQuestion)) {
        return `${job.title} 更看重工程落地。按这个岗位资料看，重点会放在把方案做成可演示、可协作、能被业务同学使用的东西。`;
    }
    if (/投递|申请|能投|可以投|简历|材料/.test(compactQuestion)) {
        return `可以投递。建议你把简历里最贴近这个岗位的项目放前面，再补一两条能证明你实际做过的作品或链接。`;
    }
    if (/面试|准备|追问|怎么问/.test(compactQuestion)) {
        return `准备时可以先抓三件事：你做过什么、你具体负责哪一段、遇到问题怎么处理。这个岗位很可能会围绕这些点继续追问。`;
    }
    if (/录取|通过|稳吗|机会/.test(compactQuestion)) {
        return `我不能替面试官提前下结论，但可以帮你把岗位里最看重的经历准备清楚。你可以把项目经历发我，我按这个 JD 帮你拆重点。`;
    }
    return `按这个岗位资料看，重点是 ${job.jd[0]} 你也可以继续问我工作内容、准备材料，或者面试可能会怎么追问。`;
}

function candidateById(id) {
    return candidates.find((item) => item.id === id) || candidates[0];
}

function applicationById(id) {
    return store.applications.find((item) => item.id === id) || store.applications[0];
}

function applicationsForJob(jobId) {
    return store.applications.filter((item) => item.jobId === jobId);
}

function applicationsForCandidate(candidateId) {
    return store.applications.filter((item) => item.candidateId === candidateId);
}

function aiInterviewExpired(app) {
    const status = app?.aiInterview?.status || app?.interviewStatus;
    if (status === "expired") return true;
    if (["completed", "cancelled"].includes(status)) return false;
    const expiresAt = app?.aiInterview?.expiresAt;
    if (!expiresAt) return false;
    const timestamp = new Date(expiresAt).getTime();
    if (!Number.isFinite(timestamp) || timestamp >= Date.now()) return false;
    return app?.interviewStatus === "pending"
        || app?.aiInterview?.status === "pending"
        || app?.interview === "已邀请"
        || app?.interview === "待再次面试";
}

function interviewPending(app) {
    if (aiInterviewExpired(app)) return false;
    return app?.interviewStatus === "pending"
        || app?.aiInterview?.status === "pending"
        || app?.interview === "已邀请"
        || app?.interview === "待再次面试";
}

function candidateCanOpenInterviewEntry(app) {
    if (aiInterviewExpired(app)) return false;
    return interviewPending(app)
        || app?.interviewStatus === "in_progress"
        || app?.aiInterview?.status === "in_progress";
}

function isOpenableInterviewUrl(url = "") {
    const value = String(url || "").trim();
    if (!value) return false;
    try {
        const parsed = new URL(value, window.location.origin);
        return ["http:", "https:"].includes(parsed.protocol);
    }
    catch {
        return false;
    }
}

function interviewEntryUrl(entryResult = {}, fallbackApp = null) {
    const entry = entryResult?.entry || {};
    const app = entryResult?.application || fallbackApp || {};
    const candidates = [
        entry.entryUrl,
        entry.publicEntryUrl,
        entry.url,
        app.aiInterview?.demo?.entryUrl,
        app.aiInterview?.entryUrl,
        app.aiInterview?.publicEntryUrl,
        fallbackApp?.aiInterview?.demo?.entryUrl,
        fallbackApp?.aiInterview?.entryUrl,
        fallbackApp?.aiInterview?.publicEntryUrl,
    ];
    return candidates.find(isOpenableInterviewUrl) || "";
}

function isInvitationInterviewUrl(url = "") {
    const value = String(url || "").trim();
    if (!value) return false;
    try {
        const parsed = new URL(value, window.location.origin);
        return ["http:", "https:"].includes(parsed.protocol)
            && /\/interview\/[^/]+/.test(parsed.pathname)
            && parsed.searchParams.has("token");
    }
    catch {
        return false;
    }
}

function interviewInvitationLink(entryResult = {}, fallbackApp = null) {
    const entry = entryResult?.entry || {};
    const app = entryResult?.application || fallbackApp || {};
    const candidates = [
        entry.publicEntryUrl,
        app.aiInterview?.publicEntryUrl,
        fallbackApp?.aiInterview?.publicEntryUrl,
        entry.entryUrl,
        app.aiInterview?.entryUrl,
        fallbackApp?.aiInterview?.entryUrl,
    ];
    const url = candidates.find(isInvitationInterviewUrl) || "";
    if (!url) return "";
    try {
        const parsed = new URL(url, window.location.origin);
        return `${window.location.origin}${parsed.pathname}${parsed.search}`;
    }
    catch {
        return url;
    }
}

function shortInterviewLink(url = "") {
    if (!url) return "面试链接待生成";
    try {
        const parsed = new URL(url, window.location.origin);
        return `${parsed.host}${parsed.pathname}`;
    }
    catch {
        return url;
    }
}

function publicInterviewCurrentLink() {
    return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

function openStartedInterviewUrl(result) {
    const url = result?.entry?.entryUrl || "";
    if (!isOpenableInterviewUrl(url) || isInvitationInterviewUrl(url)) {
        setToast(result?.reason || "当前没有可打开的面试间");
        return false;
    }
    window.location.href = url;
    return true;
}

function candidateInterviewTodoApps() {
    return applicationsForCandidate(candidate.id).filter(candidateCanOpenInterviewEntry);
}

function candidateTodoApps() {
    const map = new Map();
    for (const app of candidateInterviewTodoApps()) {
        map.set(app.id, app);
    }
    return [...map.values()].sort((a, b) => (
        new Date(b.updatedAt || b.aiInterview?.invitedAt || b.createdAt || 0).getTime()
        - new Date(a.updatedAt || a.aiInterview?.invitedAt || a.createdAt || 0).getTime()
    ));
}

function candidateInterviewApps() {
    return applicationsForCandidate(candidate.id)
        .filter((app) => candidateCanOpenInterviewEntry(app)
            || app.interviewSessionRef
            || app.reviewReportRef
            || app.aiInterview?.status === "completed"
            || app.aiInterview?.status === "expired")
        .sort((a, b) => (
            new Date(b.aiInterview?.invitedAt || b.createdAt || 0).getTime()
            - new Date(a.aiInterview?.invitedAt || a.createdAt || 0).getTime()
        ));
}

function suggestedMaterialKindForApp(app) {
    if (!defaultResume(candidate)) return "resume";
    if (!candidate.portfolios?.length) return "portfolio";
    return "knowledge";
}

function candidatePendingApps() {
    return applicationsForCandidate(candidate.id)
        .filter((app) => !["已通过", "已拒绝"].includes(app.status) || interviewPending(app));
}

function candidateResumes(item = candidate) {
    if (item?.resumes?.length) return item.resumes;
    if (!item?.resume) return [];
    return [{
        id: "legacy-resume",
        name: item.resume || "默认简历.pdf",
        status: "ready",
        isDefault: true,
        summary: "从旧材料字段读取。",
    }];
}

function candidateKnowledge(item = candidate) {
    return (item?.knowledge || []).map((source, index) => {
        if (typeof source === "string") {
            return {id: `legacy-knowledge-${index}`, name: source, status: "ready", usage: "候选人补充资料"};
        }
        return source;
    });
}

function materialFormats(kind) {
    const map = {
        resume: "PDF / DOC / DOCX",
        portfolio: "PDF / PPT / PPTX / PNG / JPG / URL",
        knowledge: "PDF / DOC / DOCX / MD / TXT / XLSX / CSV",
    };
    return map[kind] || "PDF / DOC / DOCX";
}

function materialAccept(kind) {
    const map = {
        resume: ".pdf,.doc,.docx",
        portfolio: ".pdf,.ppt,.pptx,.png,.jpg,.jpeg",
        knowledge: ".pdf,.doc,.docx,.md,.txt,.xlsx,.csv",
    };
    return map[kind] || ".pdf,.doc,.docx";
}

function screenshotAccept() {
    return ".png,.jpg,.jpeg";
}

function materialKindLabel(kind) {
    const map = {
        resume: "简历",
        portfolio: "作品",
        knowledge: "可选知识库",
    };
    return map[kind] || "材料";
}

function uploadActionLabel(kind) {
    if (kind === "knowledge") return "上传资料";
    return `上传${materialKindLabel(kind)}`;
}

function fileFormatFromName(name = "") {
    if (/^https?:\/\//i.test(name)) return "URL";
    const match = String(name).match(/\.([a-z0-9]+)(?:$|\?)/i);
    return match ? match[1].toUpperCase() : "待识别";
}

function fileExtensionFromName(name = "") {
    const match = String(name).match(/\.([a-z0-9]+)(?:$|\?)/i);
    return match ? match[1].toLowerCase() : "";
}

function canInlinePreviewMaterial(item) {
    return ["pdf", "png", "jpg", "jpeg", "webp", "gif", "txt", "md", "csv"].includes(fileExtensionFromName(item?.name || item?.title || ""));
}

function materialPreviewUrl(item) {
    if (!item?.id || !item?.kind || !item?.storageKey || item.hasOriginalFile !== true) return "";
    return `/api/candidate/materials/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}/file`;
}

function materialDisplayName(item) {
    return item?.name || item?.title || item?.fileName || "未命名材料";
}

function candidateMaterialState(item = {}) {
    if (["failed", "error"].includes(item.status)) {
        return {label: "解析失败", tone: "danger", detail: "上传已记录，但解析失败；可以删除后重新上传。"};
    }
    if (["queued", "processing", "parsing", "indexing", "pending"].includes(item.status)) {
        return {label: "解析中", tone: "warning", detail: "已上传，后台解析中；仍可先用于投递。"};
    }
    if (item.status === "empty") {
        return {label: "待上传", tone: "warning", detail: "还没有上传材料。"};
    }
    return {label: "已上传", tone: "success", detail: "已可用于投递。"};
}

function candidateMaterialDetailText(item = {}, fallback = "") {
    const text = String(fallback || "").trim();
    if (text && !/等待后端解析|等待解析|待解析/.test(text)) return text;
    return candidateMaterialState(item).detail;
}

function adminMaterialFileUrl(app, kind, item) {
    if (!app?.id || !item?.id || !item?.storageKey || item.hasOriginalFile !== true) return "";
    return `/api/admin/applications/${encodeURIComponent(app.id)}/materials/${encodeURIComponent(kind)}/${encodeURIComponent(item.id)}/file`;
}

function portfolioRefToken(portfolio, ref, index = 0) {
    return ref?.id || ref?.uploadId || ref?.storageKey || `${portfolio?.id || "portfolio"}-${index}`;
}

function adminPortfolioRefFileUrl(app, portfolio, refKind, ref, index = 0) {
    if (!app?.id || !portfolio?.id || !ref?.storageKey) return "";
    return `/api/admin/applications/${encodeURIComponent(app.id)}/materials/${encodeURIComponent(refKind)}/${encodeURIComponent(portfolioRefToken(portfolio, ref, index))}/file`;
}

function adminMatchReportMdUrl(app) {
    return app?.id ? `/api/admin/applications/${encodeURIComponent(app.id)}/match-report.md` : "";
}

function adminApplicationReportMdUrl(app, reportKind = "prescreen") {
    if (!app?.id) return "";
    const kind = ["prescreen", "ai"].includes(reportKind) ? reportKind : "prescreen";
    return `/api/admin/applications/${encodeURIComponent(app.id)}/reports/${encodeURIComponent(kind)}.md`;
}

function adminJobReportsExportUrl(job) {
    if (!job?.id) return "";
    const visibleIds = new Set(filteredAdminApplicationsForExport(applicationsForJob(job.id)).map((app) => app.id));
    const selectedIds = state.adminApplicationExportSelectedIds.filter((id) => visibleIds.has(id));
    const filter = normalizeAdminApplicationExportFilter(state.adminApplicationExportFilter);
    const params = new URLSearchParams();
    if (filter !== "all") {
        params.set("stage", filter);
    }
    if (selectedIds.length) {
        params.set("appIds", selectedIds.join(","));
    }
    const query = params.toString();
    return `/api/admin/jobs/${encodeURIComponent(job.id)}/match-reports/export${query ? `?${query}` : ""}`;
}

function adminApplicationPackageExportUrl(app) {
    if (!app?.id || !app?.jobId) return "";
    return `/api/admin/jobs/${encodeURIComponent(app.jobId)}/match-reports/export?appIds=${encodeURIComponent(app.id)}`;
}

const adminApplicationExportOptions = [
    ["all", "全部"],
    ["prescreen_passed", "初筛通过"],
    ["ai_interview_passed", "AI 面试通过"],
];

function normalizeAdminApplicationExportFilter(filter = "all") {
    const value = String(filter || "all");
    if (["prescreen_ready", "interview_pending", "interview_done_negative", "manual_pending"].includes(value)) {
        return "prescreen_passed";
    }
    if (["ai_interview_passed", "interview_done_positive", "manual_passed"].includes(value)) return "ai_interview_passed";
    if (["all", "prescreen_passed"].includes(value)) return value;
    return "all";
}

function adminHumanDecisionState(app = {}) {
    const text = [app.humanDecision?.status, app.decision, app.status].filter(Boolean).join(" ");
    if (/通过/.test(text)) return "passed";
    if (/拒绝|淘汰/.test(text)) return "rejected";
    if (/暂缓/.test(text)) return "held";
    return "";
}

function adminApplicationHasAiInterview(app = {}) {
    const interviewStatus = String(app.interviewStatus || app.aiInterview?.status || "");
    return Boolean(
        (interviewStatus && !["none", "not_started", "idle"].includes(interviewStatus))
        || app.reviewReportRef
        || app.interviewSessionRef
        || app.aiInterview?.demo?.sessionId
        || app.aiInterview?.invitedAt
        || app.aiInterview?.expiresAt
    );
}

function adminApplicationPrescreenPassed(app = {}) {
    if (adminHumanDecisionState(app) === "rejected") return false;
    return Boolean(
        app.prescreen?.recommendation === "推荐 AI 面试"
        || app.status === "待 AI 面试"
        || app.status === "已通过"
        || adminApplicationHasAiInterview(app)
    );
}

function adminApplicationAiInterviewPassed(app = {}) {
    const decision = adminHumanDecisionState(app);
    if (decision === "passed") return true;
    if (decision === "rejected" || decision === "held") return false;
    return aiInterviewDecisionStage(app)?.label === "AI 面试通过";
}

function adminApplicationMatchesExportFilter(app, filter = state.adminApplicationExportFilter) {
    const normalized = normalizeAdminApplicationExportFilter(filter);
    if (normalized === "prescreen_passed") return adminApplicationPrescreenPassed(app);
    if (normalized === "ai_interview_passed") return adminApplicationAiInterviewPassed(app);
    return true;
}

function filteredAdminApplicationsForExport(rows) {
    const filter = normalizeAdminApplicationExportFilter(state.adminApplicationExportFilter);
    if (filter === "all") return rows;
    return rows.filter((app) => adminApplicationMatchesExportFilter(app, filter));
}

function filteredAdminJobs() {
    const query = String(state.adminJobQuery || "").trim().toLowerCase();
    if (!query) return jobs;
    return jobs.filter((job) => [
        job.title,
        job.location,
        job.mode,
        job.status,
        knowledgeSummary(job),
        adminJobVisibility(job).label,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
}

function selectedAdminPortfolioDetail() {
    const app = applicationById(state.adminPortfolioDetailAppId);
    const item = (app?.materialSnapshot?.portfolioItems || []).find((portfolio) => (
        portfolio.id === state.adminPortfolioDetailId
    ));
    return app && item ? {app, item} : null;
}

function aiInterviewResponseLabel(app) {
    const response = app?.aiInterview?.candidateResponse;
    if (response?.status === "accepted") return "候选人已接受";
    return "等待候选人确认";
}

function candidateMaterialItems(kind, item = candidate) {
    if (kind === "resume") {
        return candidateResumes(item).map((resume) => ({
            ...resume,
            kind,
            name: resume.name,
            detail: candidateMaterialDetailText(resume, resume.summary),
        }));
    }
    if (kind === "portfolio") {
        return (item?.portfolios || []).map((portfolio) => ({
            ...portfolio,
            kind,
            name: portfolio.title,
            detail: portfolio.oneLineValue || portfolio.evidence || portfolio.type || "作品证据",
        }));
    }
    return candidateKnowledge(item).map((source) => ({
        ...source,
        kind,
        detail: candidateMaterialDetailText(source, source.usage || "候选人补充资料"),
    }));
}

function materialByKey(key) {
    const [kind, ...idParts] = String(key || "").split(":");
    const id = idParts.join(":");
    return candidateMaterialItems(kind).find((item) => item.id === id) || null;
}

function materialByKindAndId(kind, materialId) {
    return candidateMaterialItems(kind).find((item) => item.id === materialId) || null;
}

function candidateFacingNotifications(jobId) {
    return applicationsForCandidate(candidate.id).filter((app) => app.jobId === jobId).flatMap((app) => {
        const job = jobById(app.jobId);
        const rows = [{
            id: `submitted:${app.id}`,
            app,
            title: `${job.title} · 投递记录`,
            who: "assistant",
            kind: "system_notice",
            text: "你已提交这个岗位的投递。本次选择的材料会固定保存，后续修改不会影响这次投递。",
            createdAt: app.createdAt,
        }];
        if (aiInterviewExpired(app)) {
            rows.unshift({
                id: `interview-expired:${app.id}`,
                app,
                title: `${job.title} · AI 面试邀请`,
                who: "assistant",
                kind: "system_notice",
                text: "这次 AI 面试邀请已过期，等待招聘者重新发送或联系你。",
                createdAt: app.aiInterview?.expiresAt || app.updatedAt || app.createdAt,
            });
        }
        else if (interviewPending(app)) {
            rows.unshift({
                id: `interview:${app.id}`,
                app,
                title: `${job.title} · AI 面试邀请`,
                who: "assistant",
                kind: "interview_invite",
                text: app.aiInterview?.expiresAt
                    ? `你收到 AI 面试邀请，有效期至 ${formatDateTime(app.aiInterview.expiresAt)}。`
                    : "你收到 AI 面试邀请，可以直接进入面试。",
                createdAt: app.aiInterview?.invitedAt || app.updatedAt || app.createdAt,
            });
        }
        return rows;
    });
}

function candidateMessageJobIds() {
    const ids = new Set(state.consultedJobIds);
    applicationsForCandidate(candidate.id).forEach((app) => ids.add(app.jobId));
    return [...ids].filter((jobId) => jobs.some((job) => job.id === jobId));
}

function mergedMessagesForJob(jobId) {
    return [
        ...candidateFacingNotifications(jobId),
        ...messagesForJob(jobId),
    ];
}

function isPinnedMessageJob(jobId, messages = mergedMessagesForJob(jobId)) {
    return messages.some(isTodoMessage)
        && !state.dismissedPinnedJobIds.includes(jobId);
}

function adminConsultationSessions(jobId) {
    return state.adminConsultationsByJob[jobId] || [];
}

function adminCommunicationUnread(jobId) {
    return adminConsultationSessions(jobId).reduce((sum, session) => (
        sum + Number(session.adminUnreadCount || 0)
    ), 0);
}

function ensureAdminConsultationsLoaded(jobId) {
    if (!jobId || state.adminConsultationLoading || state.adminConsultationsByJob[jobId]) return;
    window.setTimeout(() => {
        if (!state.adminConsultationLoading && !state.adminConsultationsByJob[jobId]) {
            loadAdminConsultations(jobId);
        }
    }, 0);
}

async function loadAdminConsultations(jobId) {
    if (!jobId) return;
    state.adminConsultationLoading = true;
    state.adminConsultationError = "";
    render();
    try {
        const result = await api.listJobConsultations(jobId);
        const sessions = result.sessions || [];
        state.adminConsultationsByJob = {
            ...state.adminConsultationsByJob,
            [jobId]: sessions,
        };
        if (!sessions.some((session) => session.id === state.adminSelectedConsultationId)) {
            state.adminSelectedConsultationId = sessions[0]?.id || "";
            if (state.adminSelectedConsultationId && state.adminChatScrollBySession[state.adminSelectedConsultationId] == null) {
                state.adminChatForceScrollSessionId = state.adminSelectedConsultationId;
            }
        }
    }
    catch (error) {
        state.adminConsultationError = error.message || "消息列表加载失败";
        state.adminConsultationsByJob = {
            ...state.adminConsultationsByJob,
            [jobId]: [],
        };
    }
    finally {
        state.adminConsultationLoading = false;
        render();
    }
}

function upsertAdminConsultationResult(result, fallbackJobId = state.selectedJobId, options = {}) {
    if (!result?.session) return;
    const jobId = result.session.jobId || fallbackJobId;
    const current = adminConsultationSessions(jobId);
    const nextSession = {...result.session, candidate: result.candidate};
    const exists = current.some((session) => session.id === nextSession.id);
    state.adminConsultationsByJob = {
        ...state.adminConsultationsByJob,
        [jobId]: exists
            ? current.map((session) => (session.id === nextSession.id ? nextSession : session))
            : [nextSession, ...current],
    };
    state.adminSelectedConsultationId = nextSession.id;
    if (options.forceScroll) {
        state.adminChatForceScrollSessionId = nextSession.id;
        state.adminChatPinnedBySession = {
            ...state.adminChatPinnedBySession,
            [nextSession.id]: true,
        };
    }
}

async function refreshAdminInterviewState({jobId = state.selectedJobId, sessionId = ""} = {}) {
    try {
        applyBootstrap(await api.bootstrap());
    }
    catch (error) {
        // Keep the optimistic invitation state if the full refresh is temporarily unavailable.
    }
    if (!jobId) return;
    try {
        const result = await api.listJobConsultations(jobId);
        state.adminConsultationsByJob = {
            ...state.adminConsultationsByJob,
            [jobId]: result.sessions || [],
        };
        if (sessionId) {
            state.adminSelectedConsultationId = sessionId;
            state.adminChatForceScrollSessionId = sessionId;
        }
    }
    catch (error) {
        state.adminConsultationError = error.message || "消息列表刷新失败";
    }
}

function defaultResume(item = candidate) {
    return candidateResumes(item).find((resume) => resume.isDefault) || candidateResumes(item)[0];
}

function statusText(status) {
    const map = {
        ready: "已就绪",
        parsing: "解析中",
        failed: "失败",
        queued: "排队中",
        pending: "等待中",
        preparing: "准备中",
        processing: "处理中",
        completed: "已完成",
        overridden: "已覆盖",
        requested: "候选人申请中",
        approved: "已同意",
        rejected: "已拒绝",
        accepted: "已接受",
        reschedule_requested: "AI 面试已邀请",
        cancelled: "已取消",
        none: "暂无",
        not_started: "未邀请",
        in_progress: "进行中",
        expired: "已过期",
        "初筛中": "评价中",
        "初筛失败": "评价失败",
        };
    return map[status] || status || "待处理";
}

function materialSnapshotSummary(app) {
    if (!app?.materialSnapshot) return app?.material || "未选择材料";
    const snapshot = app.materialSnapshot;
    const parts = [
        snapshot.resumeName && snapshot.resumeName !== "未选择简历" ? `简历：${snapshot.resumeName}` : "",
        snapshot.portfolioTitles?.length ? `作品：${snapshot.portfolioTitles.join("、")}` : "",
        snapshot.knowledgeNames?.length ? `知识库：${snapshot.knowledgeNames.join("、")}` : "",
    ].filter(Boolean);
    return parts.join(" / ") || app.material || "已投递材料";
}

function applicationMaterialSnapshotState(app) {
    if (app.status === "材料处理失败" || app.evidencePack?.status === "failed") {
        return {label: "处理失败", tone: "danger"};
    }
    if (["材料处理中", "材料重新处理中"].includes(app.status) || ["queued", "processing"].includes(app.evidencePack?.status)) {
        return {label: app.status === "材料重新处理中" ? "已更新，重新处理中" : "处理中", tone: "warning"};
    }
    if (app.evidencePack?.status === "ready") return {label: "已锁定", tone: "success"};
    return {label: "已投递", tone: "info"};
}

function prescreenTone(app) {
    const status = app?.prescreen?.status;
    const recommendation = app?.prescreen?.recommendation || "";
    if (/不建议|未通过|拒/.test(recommendation)) return "danger";
    if (/待|核验|不确定/.test(recommendation)) return "warning";
    if (status === "completed" || status === "overridden") return "success";
    if (status === "failed") return "danger";
    return "warning";
}

function prescreenLabel(app) {
    if (!app?.prescreen) return "待评价";
    if (app.prescreen.status === "processing") return "评价中";
    if (app.prescreen.status === "overridden") return "初筛通过";
    if (app.prescreen.status === "completed") {
        const recommendation = app.prescreen.recommendation || "";
        if (/推荐|面试|通过/.test(recommendation) && !/不建议|未通过/.test(recommendation)) return "初筛通过";
        if (/不建议|未通过|拒/.test(recommendation)) return "初筛未通过";
        return "初筛待核验";
    }
    return statusText(app.prescreen.status);
}

function evidenceLabel(app) {
    const status = app?.evidencePack?.status;
    if (app?.status === "材料处理失败") return "材料处理失败";
    if (status === "ready") return "证据已生成";
    if (status === "processing") return "材料处理中";
    if (status === "queued") return "排队中";
    return statusText(status || app?.status);
}

function candidateStageForApplication(app) {
    if (app.status === "材料处理中" || ["queued", "processing"].includes(app.evidencePack?.status)) {
        return {label: "材料处理中", tone: "warning", detail: "系统正在整理本次提交的材料。"};
    }
    if (app.status === "材料处理失败" || app.evidencePack?.status === "failed") {
        return {label: "材料处理异常", tone: "danger", detail: "材料暂时没有处理成功，招聘者会处理或复核。"};
    }
    if (["证据已生成", "初筛中", "待审核"].includes(app.status) || app.prescreen?.status === "processing") {
        return {label: "审核中", tone: "warning", detail: "招聘者正在查看材料，暂时不需要你操作。"};
    }
    if (app.status === "待补充") {
        return {label: "证据待核验", tone: "warning", detail: "本次投递有证据需要核验，请留意招聘者消息。"};
    }
    if (aiInterviewExpired(app)) {
        return {label: "AI 面试已过期", tone: "warning", detail: "这次邀请已过期，等待招聘者重新发送或联系你。"};
    }
    if (interviewPending(app) || app.status === "待 AI 面试") {
        const preparing = app.aiInterview?.preparationStatus === "preparing";
        return {
            label: "待 AI 面试",
            tone: "info",
            detail: preparing ? "系统正在准备 AI 面试间，准备好后会开放入口。" : "AI 面试入口已准备好，可以从消息或这里进入。",
        };
    }
    if (app.status === "已通过") return {label: "已通过", tone: "success", detail: "招聘者已记录通过。"};
    if (app.status === "已拒绝") return {label: "已结束", tone: "danger", detail: "这次投递流程已结束。"};
    if (app.status === "暂缓") return {label: "暂缓", tone: "warning", detail: "招聘者暂缓处理这次投递。"};
    return {label: statusText(app.status), tone: tone(app.status), detail: "投递已提交，等待后续处理。"};
}

function candidatePublicStageForApplication(app) {
    if (applicationAiInterviewCompleted(app)) {
        return {label: "已 AI 面试", tone: "success", detail: "AI 面试已完成，后续如有安排会通过消息通知。"};
    }
    if (candidateCanOpenInterviewEntry(app) || app.status === "待 AI 面试") {
        const preparing = app.aiInterview?.preparationStatus === "preparing";
        return {
            label: "等待 AI 面试",
            tone: "info",
            detail: preparing ? "系统正在自动生成面试计划和面试间。" : "AI 面试入口准备好后可进入。",
        };
    }
    return {label: "已投递", tone: "info", detail: "投递已提交，等待招聘团队处理。"};
}

function candidateApplicationFlowSteps(app) {
    const candidateStage = candidateStageForApplication(app);
    const interviewExpired = aiInterviewExpired(app);
    const interviewReady = interviewPending(app);
    const interviewDone = app.interview === "已完成" || app.interviewStatus === "completed" || Boolean(app.reviewReportRef);
    const ended = ["已通过", "已拒绝", "暂缓"].includes(app.status);
    const response = app.aiInterview?.candidateResponse;
    const aiText = interviewExpired
        ? "AI 面试邀请已过期，等待招聘者重新发送或联系你。"
        : interviewReady
        ? (app.aiInterview?.preparationStatus === "preparing" ? "系统正在自动准备 AI 面试间，准备好后会开放入口。" : "AI 面试入口已准备好，有效期内可以随时进入。")
        : interviewDone
            ? "AI 面试已完成，等待招聘者后续判断。"
            : "评价建议通过后，系统会自动发起 AI 面试邀请。";
    const humanText = ended
        ? (app.humanDecision?.note || candidateStage.detail)
        : interviewDone
            ? "招聘者会基于材料和 AI 面试结果推进后续沟通。"
            : "AI 面试后，如需要进一步沟通，招聘者会单独联系你。";
    return [
        {
            title: "投递成功",
            status: "done",
            text: "本次提交的材料已固定保存，后续修改不会影响这次投递。",
        },
        {
            title: "AI 面试",
            status: interviewDone ? "done" : (interviewReady || interviewExpired) ? "current" : "waiting",
            text: aiText,
        },
        {
            title: "后续状态",
            status: ended ? "done" : interviewDone ? "current" : "waiting",
            text: humanText,
        },
    ];
}

function processingAgeText(startedAt) {
    if (!startedAt) return "";
    const elapsedMs = Date.now() - new Date(startedAt).getTime();
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "";
    if (elapsedMs >= 5 * 60 * 1000) return "处理超过 5 分钟，建议重试或人工接管。";
    if (elapsedMs >= 2 * 60 * 1000) return "处理超过 2 分钟，可以稍后刷新。";
    return "";
}

function interviewLabel(app) {
    if (aiInterviewExpired(app)) return "已过期";
    if (app.interview === "已邀请") return "已邀请";
    if (app.interview === "待再次面试") return "已邀请";
    if (app.interview === "已完成") return "已完成";
    if (app.interviewStatus === "in_progress" || app.aiInterview?.status === "in_progress") return "进行中";
    if (!app.interviewStatus || app.interviewStatus === "not_started") return "未邀请";
    return statusText(app.interviewStatus || app.interview);
}

function adminInterviewPublicEntryUrl(app) {
    const url = app?.aiInterview?.publicEntryUrl
        || app?.aiInterview?.entryUrlPublic
        || app?.aiInterview?.entryUrlWithToken
        || app?.aiInterview?.invitationUrl
        || "";
    return /[?&]token=/.test(url) ? url : "";
}

function adminInterviewMissingPublicLink(app) {
    const status = app?.aiInterview?.status || app?.interviewStatus;
    return ["pending", "in_progress"].includes(status)
        && Boolean(app?.aiInterview?.entryUrl || app?.interviewSessionRef)
        && !adminInterviewPublicEntryUrl(app);
}

function reportSentenceChunks(value = "") {
    return String(value || "")
        .replace(/[#*_`>-]/g, " ")
        .split(/[\n。；;]+/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);
}

function cleanAiReportList(values = [], pattern = null, limit = 4) {
    const source = Array.isArray(values) ? values : values ? [values] : [];
    const chunks = source.flatMap((item) => {
        const text = String(item || "");
        const split = text.length > 160 ? reportSentenceChunks(text) : [text];
        return split;
    });
    const seen = new Set();
    const rows = [];
    for (const item of chunks) {
        const text = String(item || "").replace(/\s+/g, " ").trim();
        if (!text || (pattern && !pattern.test(text))) continue;
        const compact = text.slice(0, 120);
        const key = compact.replace(/\s+/g, "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(compact);
        if (rows.length >= limit) break;
    }
    return rows;
}

function compactAiReportText(value = "", fallback = "", limit = 160) {
    const raw = String(value || "")
        .replace(/---+/g, "\n")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .replace(/^好的，?这是.*?审核报告[。.]?\s*/u, "")
        .trim();
    const core = raw.match(/核心(?:判定|结论)[:：]\s*([^\n#]+)/u)?.[1] || "";
    const candidates = [
        core,
        ...reportSentenceChunks(raw),
    ].map((line) => line
        .replace(/^审核报告[:：]?.*$/u, "")
        .replace(/^面试会话ID[:：]?.*$/u, "")
        .replace(/\s+/g, " ")
        .trim())
        .filter(Boolean);
    const picked = candidates.find((line) => /建议|推荐|不建议|未完成|无效|无法|通过|不足|完成/.test(line))
        || candidates.find((line) => line.length >= 12)
        || fallback;
    return String(picked || fallback || "").slice(0, limit);
}

function normalizeHumanInterviewRecommendation(value = "") {
    const text = String(value || "");
    if (!text) return "AI 面试报告";
    if (/未通过|不建议|无效|无法|不足/.test(text)) return "AI 面试未通过";
    if (/通过|推荐|建议继续|进入下一轮/.test(text)) return "AI 面试通过";
    return text.slice(0, 24);
}

function humanRecommendationTone(value = "") {
    if (/通过/.test(value) && !/未通过/.test(value)) return "success";
    if (/未通过|不建议|拒/.test(value)) return "danger";
    if (/待核验|暂缓|不足/.test(value)) return "warning";
    return "info";
}

function normalizedAiInterviewReport(app) {
    const ai = app.aiInterview || {};
    const report = ai.report || {};
    const structured = report.structured || (report.version === "ai-interview-report-v2" ? report : null);
    const pickList = (...values) => values.find((value) => Array.isArray(value) && value.length) || [];
    const quality = structured?.interviewQuality || report.interviewQuality || ai.interviewQuality || {};
    const baseRecommendation = structured?.recommendation || report.recommendation || ai.recommendation || "";
    const recommendation = normalizeHumanInterviewRecommendation(baseRecommendation);
    const summary = compactAiReportText(structured?.summary || report.summary || ai.reportSummary || ai.summary || "", "", 160);
    const decisionReason = compactAiReportText(structured?.decisionReason || report.decisionReason || ai.decisionReason || "", "", 180);
    return {
        structured: Boolean(structured),
        recommendation,
        summary,
        decisionReason,
        interviewQuality: {
            status: quality.status || "",
            answeredQuestions: Number(quality.answeredQuestions ?? 0),
            plannedQuestions: Number(quality.plannedQuestions ?? 0),
            effectiveAnswerCount: Number(quality.effectiveAnswerCount ?? 0),
            emptyAnswerCount: Number(quality.emptyAnswerCount ?? 0),
            endedReason: quality.endedReason || "",
        },
        riskNotes: cleanAiReportList(pickList(structured?.riskNotes, report.riskNotes, ai.riskNotes), null, 4),
        bonusNotes: cleanAiReportList(pickList(structured?.bonusNotes, report.bonusNotes, ai.bonusNotes), null, 4),
        evidenceSummary: cleanAiReportList(structured?.evidenceSummary || report.evidenceSummary || ai.evidenceSummary || [], null, 4),
        followUpQuestions: cleanAiReportList(pickList(structured?.followUpQuestions, report.followUpQuestions, ai.followUpQuestions), null, 4),
        questionAssessments: pickList(structured?.questionAssessments, report.questionAssessments, ai.questionAssessments).slice(0, 8),
        reportRef: ai.reportRef || report.ref || app.reviewReportRef || "",
    };
}

function applicationAiInterviewCompleted(app = {}) {
    return app.interviewStatus === "completed"
        || app.aiInterview?.status === "completed"
        || Boolean(app.reviewReportRef);
}

function applicationHasHumanDecision(app = {}) {
    return Boolean(
        (app.humanDecision?.status && app.humanDecision.status !== "未决策")
        || (app.decision && app.decision !== "未决策")
        || ["已通过", "已拒绝", "暂缓"].includes(app.status)
    );
}

function canShowHumanDecisionPanel(app = {}) {
    return false;
}

function finalHumanInterviewRecommendation(app) {
    const aiDone = applicationAiInterviewCompleted(app);
    if (aiDone) {
        const report = normalizedAiInterviewReport(app);
        return {
            label: report.recommendation,
            tone: humanRecommendationTone(report.recommendation),
            reason: report.decisionReason || report.summary || report.recommendation,
        };
    }
    if (app.prescreen?.recommendation === "推荐 AI 面试" || app.status === "待 AI 面试") {
        return {label: "等待 AI 面试", tone: "info", reason: "初筛已通过，系统会自动发起 AI 面试补充判断。"};
    }
    if (app.prescreen?.recommendation === "不建议继续") {
        return {label: "初筛未通过", tone: "danger", reason: app.prescreen?.summary || "初筛不建议继续。"};
    }
    return {label: "初筛待核验", tone: "warning", reason: app.prescreen?.summary || adminStageForApplication(app).detail};
}

function aiInterviewDecisionStage(app) {
    const completed = applicationAiInterviewCompleted(app);
    if (!completed) return null;
    const suggestion = finalHumanInterviewRecommendation(app);
    const signal = `${suggestion.label || ""} ${suggestion.reason || ""}`;
    if (/不建议|未通过|无效|无法|不足/.test(signal)) {
        return {
            label: "AI 面试未通过",
            tone: "danger",
            detail: suggestion.reason || "AI 面试没有形成足够正向证据。",
        };
    }
    if (/建议|推荐|通过|进入|继续|真人|人工面试/.test(signal)) {
        return {
            label: "AI 面试通过",
            tone: "success",
            detail: suggestion.reason || "AI 面试形成正向补充证据。",
        };
    }
    return {
        label: "AI 面试待核验",
        tone: "warning",
        detail: suggestion.reason || "AI 面试已完成，但没有形成明确通过信号。",
    };
}

function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

function cleanConfigText(value, fallback = "") {
    const text = String(value ?? "").trim();
    return text || fallback;
}

function jobInterviewSettings(job, applicationRows = []) {
    const saved = job?.interviewSettingsConfigured ? (job?.interviewSettings || {}) : {};
    const existingPlanCount = applicationRows.find((app) => hasInterviewPlan(app))?.interviewPlan?.questionCount
        || applicationRows.find((app) => app.aiInterview?.demo?.projectSnapshot?.interviewPlan?.questionCount)?.aiInterview?.demo?.projectSnapshot?.interviewPlan?.questionCount;
    const existingFollowUps = applicationRows.find((app) => app.aiInterview?.demo?.projectSnapshot?.interviewPolicy?.maxFollowUpsPerQuestion)?.aiInterview?.demo?.projectSnapshot?.interviewPolicy?.maxFollowUpsPerQuestion;
    return {
        questionCount: clampInteger(saved.questionCount, existingPlanCount || 6, 3, 10),
        maxFollowUpsPerQuestion: clampInteger(saved.maxFollowUpsPerQuestion, existingFollowUps || 2, 0, 5),
        durationMinutes: clampInteger(saved.durationMinutes, 25, 10, 60),
        invitationValidDays: clampInteger(saved.invitationValidDays, 3, 1, 14),
        provider: saved.provider || {kind: "browser-demo", speechSynthesis: true},
    };
}

function adminInterviewPreviewUrl(job, settings) {
    const base = appMeta.interviewDemo?.publicBaseUrl || "";
    if (!base) return "";
    try {
        const url = new URL("/", `${base}/`);
        url.searchParams.set("preview", "1");
        url.searchParams.set("embed", "1");
        url.searchParams.set("jobTitle", job?.title || "AI 面试间");
        url.searchParams.set("previewText", `你好，我是招招 AI 面试官。欢迎参加${job?.title || "这个岗位"}的模拟面试。`);
        return url.toString();
    }
    catch {
        return base;
    }
}

function hasInterviewPlan(app) {
    return Boolean(app?.interviewPlan?.id || app?.interviewPlan?.questionCount);
}

function interviewPlanLabel(app) {
    if (!hasInterviewPlan(app)) return "待自动生成";
    return `${app.interviewPlan.questionCount || 0} 题 · ${app.interviewPlan.status || "ready"}`;
}

function reviewLabel(app) {
    if (app.humanDecision?.status && app.humanDecision.status !== "未决策") {
        return app.humanDecision.status;
    }
    if (!app.decision || app.decision === "未决策") return "待人工决策";
    return app.decision;
}

function publishChecklist(job) {
    return [
        {label: "JD 已填写", done: job.jd?.some((line) => line && !line.includes("请补充"))},
        {label: "岗位知识库", done: job.knowledge?.some((item) => item.status === "ready")},
        {label: "评价体系", done: job.screeningRules?.some((rule) => rule.enabled !== false)},
        {label: "候选人端可见", done: job.status === "已发布"},
    ];
}

function upsertApplication(application) {
    const index = store.applications.findIndex((item) => item.id === application.id);
    if (index >= 0) store.applications[index] = application;
    else store.applications.unshift(application);
    if (application?.id) {
        const {[application.id]: _removed, ...rest} = state.adminMatchReportsByApp;
        state.adminMatchReportsByApp = rest;
        clearApplicationReportMarkdownCache(application.id);
    }
}

function actionableApplications(apps = store.applications) {
    return apps.filter((app) => ["材料处理中", "材料处理失败", "证据已生成", "初筛中", "初筛失败", "待补充", "待 AI 面试", "待审核", "暂缓"].includes(app.status));
}

function adminStageForApplication(app) {
    if (aiInterviewExpired(app)) {
        return {
            label: "面试已过期",
            tone: "warning",
            detail: "AI 面试邀请已过期，可重新发起或联系候选人。",
        };
    }
    if (app.status === "材料处理中" || ["queued", "processing"].includes(app.evidencePack?.status)) {
        const timeoutText = processingAgeText(app.evidencePack?.updatedAt);
        return {label: "材料处理中", tone: "warning", detail: timeoutText || app.evidencePack?.summary || "等待 evidence worker 解析材料"};
    }
    if (app.status === "材料处理失败" || app.evidencePack?.status === "failed") {
        return {label: "材料失败", tone: "danger", detail: app.evidencePack?.summary || "材料处理失败，可重试解析"};
    }
    if (app.status === "证据已生成") {
        return {label: "待评价", tone: "info", detail: "证据包已准备好，等待评价 worker"};
    }
    if (app.status === "初筛中" || app.prescreen?.status === "processing") {
        const timeoutText = processingAgeText(app.prescreen?.updatedAt || app.evidencePack?.updatedAt);
        return {label: "评价中", tone: "warning", detail: timeoutText || "等待 worker 生成评价报告"};
    }
    if (app.status === "初筛失败" || app.prescreen?.status === "failed") {
        return {label: "评价失败", tone: "danger", detail: app.prescreen?.summary || "评价失败，可重跑"};
    }
    if (app.prescreen?.recommendation === "不建议继续" || app.status === "初筛完成") {
        return {
            label: "初筛不建议继续",
            tone: "danger",
            detail: app.prescreen?.summary || "报告认为本次投递证据不足或不匹配，不进入后续面试。",
        };
    }
    if ((app.status === "待补充" || app.screen === "信息不足") && app.interviewStatus === "pending") {
        return {
            label: "等待 AI 面试",
            tone: "info",
            detail: app.aiInterview?.forceReason || "证据仍有待核验，招聘者已人工强制邀请 AI 面试",
        };
    }
    if (app.status === "待补充" || app.screen === "信息不足") {
        const legacyAiMaterialResult = app.prescreen?.recommendation === "需要补材料" || /补材料|材料不足|信息不足/.test(app.screen || "");
        if (legacyAiMaterialResult) {
            return {
                label: "证据待核验",
                tone: "warning",
                detail: app.prescreen?.summary || "评价报告认为证据不足，建议在详情中复核或在面试中追问。",
            };
        }
        return {label: "待候选人更新", tone: "warning", detail: "招聘者已通过消息要求候选人更新材料。"};
    }
    if (app.interviewStatus === "in_progress" || app.aiInterview?.status === "in_progress") {
        return {
            label: "等待 AI 面试",
            tone: "info",
            detail: "候选人已进入 AI 面试间，等待完成回写报告。",
        };
    }
    if (app.status === "待 AI 面试" || app.interviewStatus === "pending") {
        if (app.interviewStatus === "pending") {
            if (app.aiInterview?.forced || app.interview === "已人工强制邀请") {
                return {
                    label: "等待 AI 面试",
                    tone: "info",
                    detail: app.aiInterview?.forceReason || "已发起 AI 面试，等待候选人完成。",
                };
            }
            return {label: "等待 AI 面试", tone: "info", detail: app.aiInterview?.expiresAt ? `邀请有效期至 ${formatDateTime(app.aiInterview.expiresAt)}` : "等待候选人进入"};
        }
        return {
            label: "待发 AI 面试",
            tone: "warning",
            detail: hasInterviewPlan(app) ? "面试计划已准备，系统正在发出邀请" : "系统正在自动生成面试计划并发出邀请",
        };
    }
    if (app.status === "待审核" || app.decision === "待定") {
        return aiInterviewDecisionStage(app) || {label: "等待 AI 面试", tone: "info", detail: app.prescreen?.summary || "初筛已完成，等待 AI 面试补充判断。"};
    }
    if (app.status === "已通过" || app.decision === "通过") {
        return {label: "已通过", tone: "success", detail: app.humanDecision?.note || "已记录通过。"};
    }
    if (app.status === "已拒绝" || app.decision === "拒绝") {
        return {label: "已拒绝", tone: "danger", detail: app.humanDecision?.note || "已记录拒绝。"};
    }
    if (app.status === "暂缓") {
        return {label: "暂缓", tone: "warning", detail: app.humanDecision?.note || "等待后续判断"};
    }
    return {label: "处理中", tone: "info", detail: app.screen || "等待系统更新"};
}

function adminActionForApplication(app) {
    const stage = adminStageForApplication(app).label;
    if (stage === "材料失败") {
        return {label: "重试材料", action: "retry-evidence"};
    }
    if (stage === "待评价") {
        return {label: "生成评价", action: "complete-prescreen"};
    }
    if (stage === "评价中") {
        return {label: "生成评价", action: "complete-prescreen"};
    }
    if (stage === "评价失败") {
        return {label: "重跑评价", action: "rerun-prescreen"};
    }
    if (stage === "已强制邀面") {
        return {label: "查看详情", action: "open-review"};
    }
    if (stage === "面试已过期") {
        return {label: "查看详情", action: "open-review"};
    }
    if (stage === "待发 AI 面试") {
        return {label: "重试邀面", action: "start-interview"};
    }
    if (stage === "等待 AI 面试" || stage === "已邀面试") {
        return {label: "查看详情", action: "open-review"};
    }
    return {label: "查看详情", action: "open-review"};
}

function adminNextStepForApplication(app) {
    const stage = adminStageForApplication(app);
    const appStatus = app.status || "";
    if (stage.label === "材料处理中") {
        return {
            label: "系统处理中",
            tone: "warning",
            detail: stage.detail || "正在解析候选人材料，完成后自动进入评价。",
        };
    }
    if (stage.label === "材料失败") {
        return {
            label: "需要处理失败",
            tone: "danger",
            detail: stage.detail || "材料解析失败，可重试解析或查看详情判断。",
        };
    }
    if (stage.label === "待评价" || stage.label === "评价中") {
        return {
            label: "等待评价报告",
            tone: stage.label === "评价中" ? "warning" : "info",
            detail: stage.label === "待评价" ? "证据包已生成，系统会继续生成评价报告。" : stage.detail,
        };
    }
    if (stage.label === "评价失败") {
        return {
            label: "需要重跑评价",
            tone: "danger",
            detail: stage.detail || "评价报告生成失败，可重跑初筛。",
        };
    }
    if (stage.label === "证据待核验" || stage.label === "待候选人更新") {
        return {
            label: stage.label,
            tone: "warning",
            detail: stage.detail,
        };
    }
    if (stage.label === "已强制邀面") {
        return {
            label: "已发起 AI 面试",
            tone: "info",
            detail: stage.detail || "AI 面试邀请已发出。",
        };
    }
    if (stage.label === "面试已过期") {
        return {
            label: "需重邀或联系",
            tone: "warning",
            detail: stage.detail || "邀请已过期，可重新发起 AI 面试或在消息中联系候选人。",
        };
    }
    if (stage.label === "待发 AI 面试") {
        return {
            label: "AI 面试自动准备中",
            tone: "warning",
            detail: hasInterviewPlan(app)
                ? "AI 面试计划已准备，系统正在发送候选人邀请。"
                : "系统正在自动生成 AI 面试计划并发送邀请。",
        };
    }
    if (stage.label === "等待 AI 面试" || stage.label === "已邀面试") {
        return {
            label: "等待候选人 AI 面试",
            tone: "info",
            detail: app.aiInterview?.expiresAt
                ? `AI 面试邀请已发出，有效期至 ${formatDateTime(app.aiInterview.expiresAt)}。`
                : "AI 面试邀请已发出，等待候选人进入。",
        };
    }
    if (app.interviewStatus === "completed") {
        return aiInterviewDecisionStage(app) || {
            label: "AI 面试已完成",
            tone: "info",
            detail: "面试报告已回写，查看综合报告和 AI 面试报告即可判断。",
        };
    }
    if (appStatus === "待审核") {
        return {
            label: "等待 AI 面试",
            tone: "info",
            detail: app.prescreen?.summary || "初筛已完成，等待 AI 面试补充判断。",
        };
    }
    if (stage.label === "初筛不建议继续") {
        return stage;
    }
    if (["已通过", "已拒绝", "暂缓"].includes(stage.label)) {
        return stage;
    }
    return {
        label: stage.label || "查看详情",
        tone: stage.tone || "info",
        detail: stage.detail || "查看候选人详情后决定后续处理。",
    };
}

function renderAdminNextStep(app) {
    const nextStep = adminNextStepForApplication(app);
    return `
        <div class="phase-cell">
            ${chip(nextStep.label, nextStep.tone)}
            <small>${escapeHtml(nextStep.detail)}</small>
        </div>
    `;
}

function adminQueueComprehensiveSummary(app) {
    const narrative = applicationReviewNarrative(app);
    const prescreenText = compactReviewText(narrative.prescreenSummary, "初筛报告尚未形成明确判断。", 120);
    const aiText = compactReviewText(narrative.aiSummary || narrative.finalSuggestion.reason, "", 110);
    const prescreenLabelText = prescreenLabel(app);
    const prescreenPositive = /通过|推荐|面试/.test(prescreenLabelText) && !/未通过|不建议/.test(prescreenLabelText);
    const aiNegative = narrative.completed
        && /未通过|不建议|无效|无法|不足/.test(`${narrative.finalSuggestion.label || ""} ${narrative.finalSuggestion.reason || ""}`);
    if (narrative.completed && aiNegative && prescreenPositive) {
        return {
            label: "",
            tone: "warning",
            text: compactReviewText(`初筛通过：${prescreenText}；AI 面试未通过：${aiText || narrative.finalSuggestion.reason || "面试表现偏弱"}。建议进入详情区分材料潜力、本人贡献和面试表达风险。`, "", 210),
        };
    }
    if (narrative.completed) {
        const riskText = narrative.aiRisks.length ? `风险：${narrative.aiRisks.join("；")}。` : "";
        return {
            label: narrative.finalSuggestion.label,
            tone: narrative.finalSuggestion.tone,
            text: compactReviewText(`初筛：${prescreenText}${aiText ? `；AI 面试：${aiText}` : ""}。${riskText}`, "", 210),
        };
    }
    return {
        label: narrative.conclusionLabel,
        tone: narrative.conclusionTone,
        text: compactReviewText(narrative.narrative, "综合评价会随初筛和 AI 面试结果自动更新。", 210),
    };
}

function adminQueueProgressChips(app, stage, summary) {
    const narrative = applicationReviewNarrative(app);
    const prescreenLabelText = prescreenLabel(app);
    const prescreenPositive = /通过|推荐|面试/.test(prescreenLabelText) && !/未通过|不建议/.test(prescreenLabelText);
    const aiNegative = narrative.completed
        && /未通过|不建议|无效|无法|不足/.test(`${narrative.finalSuggestion.label || ""} ${narrative.finalSuggestion.reason || ""}`);
    const chips = [];
    if (narrative.completed && aiNegative && prescreenPositive) {
        chips.push({label: prescreenLabelText, tone: prescreenTone(app)});
        chips.push({label: stage.label, tone: stage.tone});
    } else {
        chips.push({label: stage.label, tone: stage.tone});
        if (summary.label && summary.label !== stage.label) {
            chips.push({label: summary.label, tone: summary.tone});
        }
    }
    const seen = new Set();
    return chips.filter((item) => {
        const key = item.label;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function renderAdminProgressCell(app) {
    const stage = adminStageForApplication(app);
    const summary = adminQueueComprehensiveSummary(app);
    const statusChips = adminQueueProgressChips(app, stage, summary);
    return `
        <div class="phase-cell admin-progress-cell">
            <div class="progress-status-line">
                ${statusChips.map((item) => chip(item.label, item.tone)).join("")}
            </div>
            <small>${escapeHtml(stage.detail || app.prescreen?.summary || evidenceLabel(app))}</small>
            <div class="queue-report-summary">
                <strong>综合评价</strong>
                <span>${escapeHtml(summary.text)}</span>
            </div>
        </div>
    `;
}

function adminSecondaryActionForApplication(app) {
    const action = adminActionForApplication(app);
    if (action.action === "open-review" || action.action === "candidate-detail" || action.action === "generate-interview-plan") {
        return null;
    }
    return action;
}

function candidateHubSearchText(cand) {
    const apps = applicationsForCandidate(cand.id);
    const appText = apps.map((app) => jobs.find((item) => item.id === app.jobId)?.title);
    return [
        cand.name,
        cand.idTail,
        duplicateCandidateIndex(cand),
        candidateTailHint(cand),
        ...appText,
    ].filter(Boolean).join(" ").toLowerCase();
}

function duplicateCandidateIndex(cand) {
    if (!cand?.name) return "";
    const sameName = candidates.filter((item) => item.name === cand.name);
    if (sameName.length < 2) return "";
    const index = sameName.findIndex((item) => item.id === cand.id);
    return `同名 ${String(index + 1).padStart(2, "0")}`;
}

function candidateTailHint(cand) {
    const hint = String(cand?.idTail || "").replace(/^\*+/, "");
    return hint ? `尾号 ${hint}` : "身份已加密";
}

function candidateIdentityMeta(cand) {
    return [duplicateCandidateIndex(cand), candidateTailHint(cand)].filter(Boolean).join(" · ");
}

function renderCandidateNameCell(cand) {
    return `<strong>${escapeHtml(cand?.name || "候选人")}</strong><small>${escapeHtml(candidateIdentityMeta(cand))}</small>`;
}

function filteredCandidateHubRows() {
    const query = state.adminCandidateQuery.trim().toLowerCase();
    if (!query) return candidates;
    const terms = query.split(/\s+/).filter(Boolean);
    return candidates.filter((cand) => {
        const text = candidateHubSearchText(cand);
        return terms.every((term) => text.includes(term));
    });
}

function knowledgeSummary(job) {
    const ready = job.knowledge.filter((item) => item.status === "ready").length;
    const pending = job.knowledge.filter((item) => item.status !== "ready" && item.status !== "empty").length;
    const empty = job.knowledge.filter((item) => item.status === "empty").length;
    if (!job.knowledge.length || empty === job.knowledge.length) return "待补充";
    if (pending) return `${ready} 份可用，${pending} 份处理中`;
    return `${ready} 份可用`;
}

function knowledgeStatusLabel(status) {
    if (status === "ready") return "可用";
    if (status === "indexing") return "处理中";
    if (status === "empty") return "待上传";
    return status;
}

function adminJobVisibility(job) {
    if (job.status === "已发布") return {label: "可投递", tone: "success"};
    if (job.status === "暂停") return {label: "已停止", tone: "danger"};
    return {label: "草稿", tone: "warning"};
}

function isEditing(section) {
    return state.adminEditingSection === section;
}

function tone(value) {
    if (["已发布", "ready", "completed", "已完成", "已通过", "通过", "推荐真人面试", "推荐面试", "推荐 AI 面试", "命中"].includes(value)) return "success";
    if (["草稿", "indexing", "parsing", "queued", "processing", "材料处理中", "证据已生成", "初筛中", "待 AI 面试", "待审核", "待补充", "待定", "未决策", "暂缓", "待人工确认", "待确认", "已过期", "面试已过期"].includes(value)) return "warning";
    if (["进行中", "in_progress", "面试进行中"].includes(value)) return "info";
    if (["暂停", "failed", "材料处理失败", "初筛失败", "不建议继续", "初筛不建议继续", "已拒绝", "拒绝", "风险", "失败"].includes(value)) return "danger";
    return "info";
}

function chip(label, customTone = tone(label)) {
    return `<span class="chip chip-${customTone}">${escapeHtml(label)}</span>`;
}

function needsMaterialBeforeInterview(app) {
    return app?.status === "待补充" || /补材料|材料不足|信息不足/.test([
        app?.screen,
        app?.prescreen?.recommendation,
        app?.prescreen?.summary,
    ].filter(Boolean).join(" "));
}

function reusableForceInterviewReason(app) {
    if (!needsMaterialBeforeInterview(app)) return "";
    if (!app?.aiInterview?.forced && app?.interview !== "已人工强制邀请") return "";
    return app.aiInterview?.forceReason || "沿用上次人工强制邀请原因，保留 AI 面试邀请。";
}

function adminInterviewActionLabel(app) {
    if (app?.interviewStatus === "pending") return "AI 面试已邀请";
    if (needsMaterialBeforeInterview(app)) return "人工强制发起 AI 面试";
    return "重试邀面";
}

function helperMark(className = "") {
    return `
        <span class="helper-mark ${className}" aria-hidden="true">
            <span class="helper-card">
                <span class="helper-fold"></span>
                <span class="helper-eye left"></span>
                <span class="helper-eye right"></span>
                <span class="helper-smile"></span>
            </span>
            <span class="helper-glass"></span>
        </span>
    `;
}

function icon(name) {
    const icons = {
        briefcase: '<path d="M9 6V5a3 3 0 0 1 3-3h0a3 3 0 0 1 3 3v1"/><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 12h18"/>',
        user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
        message: '<path d="M4 5h16v10H8l-4 4z"/>',
        file: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/>',
        video: '<rect x="3" y="6" width="12" height="12" rx="3"/><path d="m15 10 5-3v10l-5-3z"/>',
        check: '<path d="m4 12 5 5L20 6"/>',
        menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
        panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
        book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/>',
        sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
        send: '<path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/>',
        upload: '<path d="M12 16V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>',
        copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
        edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
        back: '<path d="m15 18-6-6 6-6"/><path d="M9 12h12"/>',
        chevronRight: '<path d="m9 18 6-6-6-6"/>',
        refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 3v4h-4"/><path d="M6 21v-4h4"/>',
        logout: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 19V5a2 2 0 0 0-2-2h-6"/><path d="M13 21h6a2 2 0 0 0 2-2"/>',
    };
    return `<svg viewBox="0 0 24 24" class="icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.check}</svg>`;
}

function appHeader(title, subtitle, actions = "", center = "", leading = "") {
    return `
        <header class="topbar">
            ${leading || `
                <div class="brand" aria-label="招招 Recruit AI">
                    ${helperMark("brand-mark")}
                    <span>
                        <strong>招招 · Recruit AI</strong>
                        <small>把岗位、材料和证据对齐</small>
                    </span>
                </div>
            `}
            <div class="module-title">
                ${center || `
                    <strong>${escapeHtml(title)}</strong>
                    ${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}
                `}
            </div>
            ${actions ? `<nav class="route-actions" aria-label="页面操作">${actions}</nav>` : ""}
        </header>
    `;
}

function shell(title, subtitle, content, actions = "", center = "", shellClass = "", leading = "") {
    return `
        ${appHeader(title, subtitle, actions, center, leading)}
        <main class="app-shell${shellClass ? ` ${escapeHtml(shellClass)}` : ""}">${content}</main>
        ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    `;
}

function renderCandidate() {
    const content = state.loggedIn ? renderCandidateApp() : renderLogin();
    return `
        <main class="candidate-shell">${content}</main>
        ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    `;
}

function publicInterviewRoute() {
    const match = window.location.pathname.match(/^\/interview\/([^/?#]+)/);
    const params = new URLSearchParams(window.location.search);
    return {
        attemptId: match ? decodeURIComponent(match[1]) : "",
        token: params.get("token") || "",
    };
}

function cancelPublicInterviewPoll() {
    if (!publicInterviewPollTimer) return;
    window.clearTimeout(publicInterviewPollTimer);
    publicInterviewPollTimer = null;
}

function schedulePublicInterviewPoll() {
    if (publicInterviewPollTimer || state.publicInterviewStarting) return;
    publicInterviewPollTimer = window.setTimeout(() => {
        publicInterviewPollTimer = null;
        loadPublicInterviewEntry({force: true, silent: true});
    }, 1600);
}

async function loadPublicInterviewEntry(options = {}) {
    const {force = false, silent = false} = typeof options === "object" && options ? options : {};
    const route = publicInterviewRoute();
    const key = `${route.attemptId}:${route.token}`;
    if (!route.attemptId || !route.token || state.publicInterviewLoading || (!force && state.publicInterviewKey === key)) return;
    state.publicInterviewKey = key;
    state.publicInterviewLoading = !silent;
    if (!silent) state.publicInterviewEntry = null;
    state.publicInterviewError = "";
    if (!silent) render();
    try {
        state.publicInterviewEntry = await api.getPublicInterviewEntry(route.attemptId, route.token);
    }
    catch (error) {
        state.publicInterviewError = error.message || "面试链接读取失败";
    }
    finally {
        state.publicInterviewLoading = false;
        render();
    }
}

function renderPublicInterviewEntry() {
    const route = publicInterviewRoute();
    if (!route.attemptId || !route.token) {
        cancelPublicInterviewPoll();
        return shell("AI 面试邀请", "链接缺少必要信息", `
            <section class="interview-entry-page panel">
                ${helperMark("mini")}
                <h1>面试链接不完整</h1>
                <p>请使用招聘者发送的完整 AI 面试邀请链接。</p>
            </section>
        `);
    }
    if (!state.publicInterviewEntry && !state.publicInterviewError && !state.publicInterviewLoading) {
        window.requestAnimationFrame(() => loadPublicInterviewEntry());
    }
    const payload = state.publicInterviewEntry || {};
    const app = payload.application || {};
    const entry = payload.entry || null;
    const loading = state.publicInterviewLoading;
    const preparing = payload.state === "preparing";
    const invitationUrl = preparing ? "" : publicInterviewCurrentLink();
    if (preparing && !loading && !state.publicInterviewStarting) {
        schedulePublicInterviewPoll();
    }
    else if (!preparing) {
        cancelPublicInterviewPoll();
    }
    const canStart = !loading && payload.state === "ready" && entry?.status === "pending" && !state.publicInterviewStarting;
    const stateLabel = payload.state === "completed" ? "已完成"
        : payload.state === "expired" ? "已过期"
        : payload.state === "failed" ? "暂不可用"
        : payload.state === "started" ? "已开始"
        : preparing ? "准备中"
        : entry ? "可进入" : "准备中";
    const stateTone = payload.state === "completed" ? "success"
        : payload.state === "expired" ? "warning"
        : payload.state === "failed" || state.publicInterviewError ? "danger"
        : payload.state === "started" ? "warning"
        : preparing ? "info"
        : entry ? "success" : "info";
    const disabledButtonLabel = state.publicInterviewStarting
        ? "正在打开面试间"
        : preparing
            ? "面试间准备中"
            : payload.reason || entry?.note || "暂时不能进入面试";
    return shell("AI 面试邀请", app.jobTitle || "AI 面试", `
        <section class="interview-entry-page panel">
            <div class="interview-entry-hero">
                ${helperMark("mini")}
                <div>
                    <p class="eyebrow">AI Interview Invitation</p>
                    <h1>${escapeHtml(app.jobTitle || "AI 面试")}</h1>
                    <p>${escapeHtml(app.candidateName ? `${app.candidateName}，请确认设备后进入面试。` : "请确认设备后进入面试。")}</p>
                </div>
                ${chip(stateLabel, stateTone)}
            </div>
            ${state.publicInterviewError ? `<div class="form-error">${escapeHtml(state.publicInterviewError)}</div>` : ""}
            ${loading ? `
                <div class="markdown-report-note">
                    <strong>正在准备面试间</strong>
                    <p>系统正在校验邀请链接，并为你创建专属 AI 面试会话。</p>
                </div>
            ` : `
                <div class="interview-entry-summary">
                    <div><strong>投递材料</strong><span>${escapeHtml(app.material || "已锁定本次投递材料")}</span></div>
                    <div><strong>有效期</strong><span>${escapeHtml(entry?.expiresAt ? formatDateTime(entry.expiresAt) : app.aiInterview?.expiresAt ? formatDateTime(app.aiInterview.expiresAt) : "以邀请为准")}</span></div>
                    <div><strong>面试状态</strong><span>${escapeHtml(payload.reason || entry?.note || "面试间已准备好")}</span></div>
                </div>
                ${invitationUrl ? `<div class="interview-entry-linkbar">
                    <button class="interview-entry-copy" data-action="copy-interview-link" data-url="${escapeHtml(invitationUrl)}" title="复制面试链接" aria-label="复制面试链接">${icon("copy")}</button>
                    <div>
                        <strong>面试链接</strong>
                        <span>${escapeHtml(shortInterviewLink(invitationUrl))}</span>
                    </div>
                </div>` : ""}
                <div class="interview-entry-checklist">
                    <span>${icon("video")}电脑或手机都可以，请允许浏览器使用摄像头和麦克风。</span>
                    <span>${icon("clock")}建议预留 20-30 分钟，在安静、网络稳定的地方完成。</span>
                    <span>${icon("file")}系统会记录面试回答、时间和过程状态，供招聘团队评价与复核。</span>
                    <span>${icon("check")}进入面试间后，请先连接面试官；连接完成后再点击开始面试。</span>
                </div>
                ${canStart ? `
                    <button class="primary interview-entry-button" data-action="public-start-interview">${state.publicInterviewStarting ? "正在打开面试间" : "进入 AI 面试间"}</button>
                ` : `
                    <button class="ghost interview-entry-button" disabled>${escapeHtml(disabledButtonLabel)}</button>
                `}
            `}
        </section>
    `);
}

function cancelCandidateInterviewPoll() {
    if (!candidateInterviewPollTimer) return;
    window.clearTimeout(candidateInterviewPollTimer);
    candidateInterviewPollTimer = null;
}

function scheduleCandidateInterviewPoll(appId = "") {
    if (!appId || candidateInterviewPollTimer || state.candidateInterviewStartingAppId) return;
    candidateInterviewPollTimer = window.setTimeout(() => {
        candidateInterviewPollTimer = null;
        if (state.candidateInterviewEntryAppId === appId) {
            loadCandidateInterviewEntry(appId, {silent: true});
        }
    }, 1600);
}

async function loadCandidateInterviewEntry(appId = "", options = {}) {
    const {silent = false} = typeof options === "object" && options ? options : {};
    if (!appId || state.candidateInterviewEntryAppId !== appId) return;
    const app = applicationById(appId);
    if (!silent) {
        state.candidateInterviewEntry = {loading: true};
        render();
    }
    try {
        const result = await api.getInterviewEntry(appId);
        if (state.candidateInterviewEntryAppId !== appId) return;
        if (result.application) upsertApplication(result.application);
        state.candidateInterviewEntry = result;
        const invitationUrl = interviewInvitationLink(result, app);
        if (!silent && !invitationUrl && !["ready", "preparing", "started"].includes(result.state)) {
            setToast(result.reason || "当前没有可进入的面试");
        }
    }
    catch (error) {
        if (state.candidateInterviewEntryAppId !== appId) return;
        state.candidateInterviewEntry = {reason: error.message || "面试入口读取失败，请稍后重试"};
        if (!silent) setToast(state.candidateInterviewEntry.reason);
    }
    render();
}

function renderLogin() {
    const savedSession = loadCandidateSession();
    const loginName = state.candidateAuthPrefill?.name || savedSession?.name || "";
    const loginIdTail = "";
    const isRegister = state.candidateAuthMode === "register";
    const authCopy = isRegister
        ? "第一次使用先创建档案，请确认姓名和证件后 8 位；末位是 X 也可以。"
        : "输入已注册的姓名和证件后 8 位，继续查看投递、材料和通知。";
    const submitLabel = isRegister ? "创建档案" : "登录继续";
    const authTitle = isRegister ? "创建候选人档案" : "欢迎";
    return `
        <section class="candidate-app-wrap candidate-login-wrap">
            <div class="candidate-app candidate-login-app">
                <div class="candidate-app-head candidate-login-head">
                    <div class="candidate-brand-row">
                        <strong>招招</strong>
                        <span>Recruit AI</span>
                    </div>
                </div>
                <form class="candidate-auth-card" data-form="login">
                    <h1>${escapeHtml(authTitle)}</h1>
                    <p class="auth-copy">${escapeHtml(authCopy)}</p>
                    <div class="auth-tabs" aria-label="登录或注册">
                        <button type="button" class="${!isRegister ? "active" : ""}" data-action="candidate-auth-mode" data-mode="login" aria-pressed="${!isRegister}">登录</button>
                        <button type="button" class="${isRegister ? "active" : ""}" data-action="candidate-auth-mode" data-mode="register" aria-pressed="${isRegister}">注册</button>
                    </div>
                    <label>
                        姓名
                        <input name="name" value="${escapeHtml(loginName)}" autocomplete="name" />
                    </label>
                    <label>
                        证件后 8 位
                        <input name="idTail" value="${escapeHtml(loginIdTail)}" inputmode="text" maxlength="8" pattern="[0-9]{7}[0-9X]" autocapitalize="characters" />
                    </label>
                    ${state.candidateAuthError ? `<div class="form-error">${escapeHtml(state.candidateAuthError)}</div>` : ""}
                    ${state.candidateAuthNotice ? `<div class="auth-notice">${escapeHtml(state.candidateAuthNotice)}</div>` : ""}
                    <button class="primary full" type="submit">${icon("check")}${escapeHtml(submitLabel)}</button>
                    <p class="privacy-line">仅用于识别投递记录和合并材料，不展示完整证件号。</p>
                </form>
                ${state.candidateRegistrationConfirm ? renderCandidateRegistrationConfirm() : ""}
            </div>
        </section>
    `;
}

function renderCandidateRegistrationConfirm() {
    const identity = state.candidateRegistrationConfirm || {};
    return `
        <div class="candidate-modal-backdrop candidate-register-confirm-backdrop" data-action="cancel-candidate-register">
            <section class="avatar-sheet material-sheet candidate-register-confirm-sheet" role="dialog" aria-label="确认创建候选人档案">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>创建候选人档案？</h2>
                        <p>请确认姓名和证件后 8 位无误。之后会用这组信息继续登录、合并材料和查看投递。</p>
                    </div>
                    <button class="ghost small" data-action="cancel-candidate-register">取消</button>
                </div>
                ${state.candidateAuthError ? `<div class="form-error">${escapeHtml(state.candidateAuthError)}</div>` : ""}
                <div class="delete-confirm-card">
                    <strong>${escapeHtml(identity.name || "未填写姓名")}</strong>
                    <span>证件后 8 位：${escapeHtml(identity.idTail || "")}</span>
                </div>
                <div class="confirm-actions">
                    <button class="ghost" data-action="cancel-candidate-register">再检查一下</button>
                    <button class="primary" data-action="confirm-candidate-register" ${state.candidateRegistrationSubmitting ? "disabled" : ""}>
                        ${state.candidateRegistrationSubmitting ? "创建中..." : "确认创建"}
                    </button>
                </div>
            </section>
        </div>
    `;
}

function renderCandidateApp() {
    const screens = {
        jobs: renderCandidateJobs(),
        messages: renderCandidateMessages(),
        interviews: renderCandidateInterviews(),
        profile: renderCandidateProfile(),
    };
    return `
        <section class="candidate-app-wrap">
            <div class="candidate-app">
                ${screens[state.candidateTab] || screens.jobs}
                ${renderCandidateTabbar()}
                ${state.applicationSheetJobId ? renderApplicationSubmitSheet() : ""}
                ${state.applicationUpdateAppId ? renderApplicationUpdateSheet() : ""}
                ${state.candidateInterviewEntryAppId ? renderCandidateInterviewEntrySheet() : ""}
            </div>
        </section>
    `;
}

function renderCandidateJobs() {
    const visibleJobs = candidateVisibleJobs();
    const selectedJob = selectedCandidateJob();
    const feedCards = visibleJobs.length > 1
        ? [
            renderMobileJobCard(visibleJobs[visibleJobs.length - 1], {loopClone: "head"}),
            ...visibleJobs.map((job) => renderMobileJobCard(job)),
            renderMobileJobCard(visibleJobs[0], {loopClone: "tail"}),
        ]
        : visibleJobs.map((job) => renderMobileJobCard(job));
    if (state.candidateJobDetail && selectedJob) return renderCandidateJobDetail(selectedJob);
    return `
        <div class="candidate-app-head">
            <div class="candidate-brand-row">
                <strong>招招</strong>
                <span>Recruit AI</span>
            </div>
            <div class="candidate-title-row">
                <div>
                    <h1>职位</h1>
                    <p>可投岗位</p>
                </div>
            </div>
        </div>
        <div class="candidate-job-feed" data-candidate-feed data-real-count="${visibleJobs.length}" aria-label="岗位列表，共 ${visibleJobs.length} 个岗位，支持上下循环浏览">
            ${visibleJobs.length ? feedCards.join("") : `
                <div class="candidate-empty-state">
                    ${helperMark("mini")}
                    <strong>暂无可投岗位</strong>
                    <p>已停止或未发布的岗位不会出现在候选人端。</p>
                </div>
            `}
        </div>
    `;
}

function renderMobileJobCard(job, options = {}) {
    const cloneAttr = options.loopClone ? `data-loop-clone="${escapeHtml(options.loopClone)}" aria-hidden="true"` : "";
    return `
        <article class="mobile-job-card ${options.loopClone ? "loop-clone" : ""}" data-job-id="${escapeHtml(job.id)}" ${cloneAttr}>
            <div class="job-card-title">
                <div>
                    <h2>${escapeHtml(job.title)}</h2>
                </div>
                <button class="detail-arrow" data-action="open-job-detail" data-job-id="${job.id}" aria-label="查看完整 JD">
                    ${icon("chevronRight")}
                </button>
            </div>
            <div class="job-meta-row">
                <span>${icon("search")}${escapeHtml(candidateLocation(job))}</span>
                <span>${icon("briefcase")}${escapeHtml(candidateMode(job))}</span>
            </div>
            <section class="job-jd-block job-jd-preview">
                <h3>职位详情</h3>
                <div class="job-jd-markdown">${renderJobMarkdownHtml(job.jd)}</div>
                <button type="button" class="job-jd-more-hint" data-action="open-job-detail" data-job-id="${escapeHtml(job.id)}" hidden>... 查看完整 JD</button>
            </section>
            <div class="job-card-actions">
                <button class="ghost" data-action="ask-job" data-job-id="${job.id}">${icon("message")}问一问</button>
                <button class="primary" data-action="apply-job" data-job-id="${job.id}">${icon("send")}投递</button>
            </div>
        </article>
    `;
}

function renderCandidateJobDetail(job) {
    return `
        <div class="candidate-app-head compact">
            <div class="candidate-title-row detail-title-row">
                <button class="back-icon-button" data-action="close-job-detail" aria-label="返回职位列表">${icon("back")}</button>
                <div>
                    <h1>${escapeHtml(job.title)}</h1>
                    <p>${escapeHtml(candidateLocation(job))} · ${escapeHtml(candidateMode(job))}</p>
                </div>
            </div>
        </div>
        <section class="candidate-job-detail-screen">
            <article class="mobile-job-card job-detail-card">
                <section class="job-jd-block">
                    <h3>职位详情</h3>
                    <div class="job-jd-markdown">${renderJobMarkdownHtml(job.jd)}</div>
                </section>
                <div class="job-card-actions">
                    <button class="ghost" data-action="ask-job" data-job-id="${job.id}">${icon("message")}问一问</button>
                    <button class="primary" data-action="apply-job" data-job-id="${job.id}">${icon("send")}投递</button>
                </div>
            </article>
        </section>
    `;
}

function renderCandidateMessages() {
    const messageIds = new Set(candidateMessageJobIds());
    if (!state.candidateMessageJobId || !messageIds.has(state.candidateMessageJobId)) return renderCandidateMessageList();
    const job = jobById(state.candidateMessageJobId);
    const messages = mergedMessagesForJob(job.id);
    const streaming = state.consultStreamingByJob[job.id];
    return `
        <div class="candidate-app-head compact">
            <div class="candidate-title-row detail-title-row">
                <button class="back-icon-button" data-action="message-list" aria-label="返回消息列表">${icon("back")}</button>
                <div>
                    <h1>${escapeHtml(job.title)}</h1>
                    <p>岗位咨询和通知</p>
                </div>
            </div>
        </div>
        <section class="candidate-message-screen">
            <div class="chat-list app-chat-list" data-chat-job-id="${escapeHtml(job.id)}">
                ${messages.map((message) => renderCandidateChatMessage(message, job.id)).join("")}
                ${streaming ? `
                    <div class="chat-message-row assistant">
                        ${renderChatAvatar(chatSenderMeta({who: "assistant", kind: "ai_answer"}))}
                        <div class="chat-bubble assistant thinking">
                            <span class="chat-sender-line">
                                <strong>AI分身</strong>
                                <em>AI</em>
                            </span>
                            <div class="chat-markdown">${renderChatMarkdownHtml(streaming.text || "正在整理回答")}</div>
                            <span class="typing-dots">...</span>
                        </div>
                    </div>
                ` : ""}
            </div>
            <div class="chat-quick-row">
                <button class="ghost small" data-action="candidate-chat-quick" data-job-id="${escapeHtml(job.id)}" data-kind="hr_request" data-text="我想联系招聘者">联系招聘者</button>
            </div>
            <form class="chat-input candidate-chat-input" data-form="ask">
                <input name="question" placeholder="继续问这个岗位..." />
                <button class="primary" type="submit" aria-label="发送">${icon("send")}</button>
            </form>
        </section>
    `;
}

function renderCandidateMessageList() {
    const consultRows = candidateMessageJobIds()
        .map((jobId) => {
            const job = jobById(jobId);
            const messages = mergedMessagesForJob(jobId);
            if (!messages.length) return null;
            const todoMessage = messages.find(isTodoMessage);
            const newest = latestMessage(messages);
            const pinned = isPinnedMessageJob(jobId, messages);
            return {
                id: `consult:${jobId}`,
                title: job.title,
                preview: messageTextForDisplay(pinned && todoMessage ? todoMessage : newest),
                time: messageTimeText(newest),
                action: "open-message",
                jobId,
                pinned,
                unreadCount: candidateUnreadCountForJob(jobId),
                latestSort: messageTime(newest),
            };
        })
        .filter(Boolean);
    const conversations = [
        ...consultRows.filter((row) => row.pinned),
        ...consultRows.filter((row) => !row.pinned).sort((a, b) => b.latestSort - a.latestSort),
    ];
    return `
        <div class="candidate-app-head compact">
            <div class="candidate-title-row">
                <div>
                    <h1>消息</h1>
                    <p>岗位咨询和通知</p>
                </div>
            </div>
        </div>
        <section class="message-list-screen">
            ${state.candidateRefreshing ? `<p class="section-note message-refreshing">正在同步最新状态...</p>` : ""}
            ${conversations.length ? conversations.map((row) => `
                <div class="conversation-row ${row.pinned ? "pinned" : ""} ${row.unreadCount ? "unread" : ""}">
                    <button class="conversation-open" data-action="${escapeHtml(row.action)}" data-job-id="${escapeHtml(row.jobId)}">
                        <span class="conversation-main">
                            <span class="conversation-title-line">
                                <strong>${escapeHtml(row.title)}</strong>
                                ${row.pinned ? `<b class="conversation-badge">待办</b>` : ""}
                            </span>
                            <small>${escapeHtml(row.preview)}</small>
                        </span>
                        <span class="conversation-meta">
                            <em>${escapeHtml(row.time)}</em>
                            ${row.unreadCount ? `<b class="unread-badge">${row.unreadCount > 99 ? "99+" : escapeHtml(row.unreadCount)}</b>` : ""}
                        </span>
                    </button>
                    ${row.pinned ? `<button class="pin-dismiss" data-action="dismiss-pinned-message" data-job-id="${escapeHtml(row.jobId)}" aria-label="取消置顶">×</button>` : ""}
                </div>
            `).join("") : `
                <div class="empty-conversation">
                    <strong>还没有消息</strong>
                    <p>岗位咨询、投递提醒和 AI 面试邀请会出现在同一个岗位聊天里。</p>
                </div>
            `}
        </section>
    `;
}

function renderCandidateMaterialRows(kind, title) {
    const items = candidateMaterialItems(kind);
    return `
        <div class="material-group">
            <div class="material-group-head">
                <div>
                    <h3>${escapeHtml(title)}</h3>
                    <small>支持 ${escapeHtml(materialFormats(kind))}</small>
                </div>
            </div>
            ${items.map((item) => {
                const stateInfo = candidateMaterialState(item);
                return `
                    <div class="material-row">
                        <div>
                            <strong>${escapeHtml(item.name)}</strong>
                            <span>${escapeHtml(item.detail)} · ${escapeHtml(fileFormatFromName(item.name))}${item.isDefault ? " · 默认简历" : ""}</span>
                        </div>
                        ${chip(stateInfo.label, stateInfo.tone)}
                        <button class="ghost small" data-action="view-candidate-material" data-key="${escapeHtml(`${kind}:${item.id}`)}">预览</button>
                    </div>
                `;
            }).join("") || `<p class="section-note">暂无${escapeHtml(title)}，可以点击上传补充。</p>`}
        </div>
    `;
}

function renderMaterialStatusRow(kind, title, iconName, summary, statusLabel, statusTone) {
    return `
        <article class="material-status-row">
            <span class="material-status-icon">${icon(iconName)}</span>
            <div class="material-status-copy">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(summary)}</span>
            </div>
            ${chip(statusLabel, statusTone)}
            <button class="material-status-edit" data-action="open-material-manager" data-kind="${escapeHtml(kind)}" aria-label="编辑${escapeHtml(title)}">${icon("edit")}</button>
        </article>
    `;
}

function portfolioFieldValue(item, key, fallback = "") {
    return escapeHtml(item?.[key] ?? fallback);
}

function portfolioInputValue(item, key) {
    return escapeHtml(item?.[key] ?? "");
}

function portfolioPlaceholder(key) {
    const placeholders = {
        title: "例如：RAG 客服问答系统 / AI 面试房间交互稿",
        jobDirection: "例如：AI 应用 / 前端交互 / 知识库运营",
        oneLineValue: "用一句话说明这个作品解决了什么问题",
        problem: "说明问题来源，不要粘贴示例文案",
        scenario: "谁在什么场景下使用它",
        currentSolutionGap: "现有方案哪里不够好",
        solution: "你做了什么方案，边界是什么",
        coreFeatures: "列出核心功能和最能证明能力的部分",
        demoFlow: "用户如何一步步使用这个 demo",
        aiUsage: "AI/Agent/自动化能力具体在哪里进入流程",
        differentiation: "和普通表单、脚本或手工流程相比新在哪里",
        role: "例如：本人负责前端交互、接口联调和测试",
        contribution: "写清楚本人做了哪几部分，团队协作边界是什么",
        screenshotNote: "说明这张图在做什么，以及对应的技术或产品实现",
        outcome: "结果指标、用户反馈或可验证产出",
        challenge: "最大难点和你怎么处理",
        reflection: "复盘、取舍和下一步改进",
    };
    return escapeHtml(placeholders[key] || "");
}

function portfolioScreenshotSummary(ref, index) {
    return ref?.caption || ref?.tech || ref?.validation || ref?.name || `截图 ${index + 1}`;
}

function renderPortfolioScreenshotFields(item = null) {
    const existing = Array.isArray(item?.screenshots) ? item.screenshots : [];
    const slots = Array.from({length: 5}, (_, index) => index);
    return `
        <section class="portfolio-screenshot-section">
            <div>
                <strong>作品截图</strong>
                <p>每张图配一段说明即可，写清楚它在做什么、体现了什么技术或产品实现。</p>
            </div>
            ${existing.length ? `
                <div class="portfolio-existing-screenshots">
                    ${existing.map((ref, index) => `
                        <span>${escapeHtml(portfolioScreenshotSummary(ref, index))}</span>
                    `).join("")}
                </div>
            ` : ""}
            <div class="portfolio-screenshot-slots">
                ${slots.map((index) => `
                    <div class="portfolio-screenshot-card" ${index > 0 ? "hidden" : ""}>
                        <label class="portfolio-screenshot-picker">
                            <input class="portfolio-screenshot-input" type="file" name="screenshots" accept="${screenshotAccept()}" data-screenshot-index="${index}" />
                            <img class="portfolio-screenshot-preview" alt="" data-screenshot-preview hidden />
                            <span class="portfolio-screenshot-plus">+</span>
                            <strong data-screenshot-title>添加截图</strong>
                            <small data-screenshot-file>${index === 0 ? "PNG / JPG" : "可继续添加"}</small>
                        </label>
                        <label class="portfolio-screenshot-note">
                            截图说明
                            <textarea name="screenshotNotes" rows="3" placeholder="${portfolioPlaceholder("screenshotNote")}"></textarea>
                        </label>
                    </div>
                `).join("")}
            </div>
        </section>
    `;
}

function renderPortfolioSubmissionFields(item = null) {
    return `
        <label>作品名称<input name="title" value="${portfolioInputValue(item, "title")}" placeholder="${portfolioPlaceholder("title")}" /></label>
        <label>岗位关联方向<input name="jobDirection" value="${portfolioInputValue(item, "jobDirection")}" placeholder="${portfolioPlaceholder("jobDirection")}" /></label>
        <label>一句话价值<input name="oneLineValue" value="${portfolioInputValue(item, "oneLineValue")}" placeholder="${portfolioPlaceholder("oneLineValue")}" /></label>
        <label>创意背景 / 问题来源<textarea name="problem" placeholder="${portfolioPlaceholder("problem")}">${portfolioInputValue(item, "problem")}</textarea></label>
        <label>目标用户 / 使用场景<textarea name="scenario" placeholder="${portfolioPlaceholder("scenario")}">${portfolioInputValue(item, "scenario")}</textarea></label>
        <label>现有方案与不足<textarea name="currentSolutionGap" placeholder="${portfolioPlaceholder("currentSolutionGap")}">${portfolioInputValue(item, "currentSolutionGap")}</textarea></label>
        <label>解决方案简介<textarea name="solution" placeholder="${portfolioPlaceholder("solution")}">${portfolioInputValue(item, "solution")}</textarea></label>
        <label>核心功能 / 价值<textarea name="coreFeatures" placeholder="${portfolioPlaceholder("coreFeatures")}">${portfolioInputValue(item, "coreFeatures")}</textarea></label>
        <label>用户使用流程<textarea name="demoFlow" placeholder="${portfolioPlaceholder("demoFlow")}">${portfolioInputValue(item, "demoFlow")}</textarea></label>
        <label>AI / Agent / 自动化能力说明<textarea name="aiUsage" placeholder="${portfolioPlaceholder("aiUsage")}">${portfolioInputValue(item, "aiUsage")}</textarea></label>
        <label>和普通工具相比新在哪里<textarea name="differentiation" placeholder="${portfolioPlaceholder("differentiation")}">${portfolioInputValue(item, "differentiation")}</textarea></label>
        <label>本人职责<input name="role" value="${portfolioInputValue(item, "role")}" placeholder="${portfolioPlaceholder("role")}" /></label>
        <label>本人贡献<textarea name="contribution" placeholder="${portfolioPlaceholder("contribution")}">${portfolioInputValue(item, "contribution")}</textarea></label>
        <label>可验证链接<input name="evidenceUrl" value="${portfolioFieldValue(item, "evidenceUrl")}" placeholder="Demo 地址、Git 地址、录屏链接或文档链接" /></label>
        ${renderPortfolioScreenshotFields(item)}
        <label>结果指标 / 预期价值<input name="outcome" value="${portfolioInputValue(item, "outcome")}" placeholder="${portfolioPlaceholder("outcome")}" /></label>
        <label>最大难点<input name="challenge" value="${portfolioInputValue(item, "challenge")}" placeholder="${portfolioPlaceholder("challenge")}" /></label>
        <label>复盘改进<input name="reflection" value="${portfolioInputValue(item, "reflection")}" placeholder="${portfolioPlaceholder("reflection")}" /></label>
    `;
}

function renderCandidateMaterialManager() {
    const kind = state.candidateMaterialManagerKind;
    const titleMap = {
        resume: "简历库",
        portfolio: "作品",
        knowledge: "可选知识库",
    };
    const title = titleMap[kind] || "材料库";
    const items = candidateMaterialItems(kind);
    const addLabel = kind === "knowledge" ? "添加资料" : `添加${materialKindLabel(kind)}`;
    return `
        <div class="candidate-app-head compact material-manager-head">
            <div class="candidate-title-row">
                <div>
                    <h1>${escapeHtml(title)}</h1>
                    <p>支持 ${escapeHtml(materialFormats(kind))}</p>
                </div>
                <button class="ghost small" data-action="close-material-manager">返回</button>
            </div>
        </div>
        <section class="candidate-profile-screen material-manager-screen">
            <div class="profile-section material-manager-section">
                <div class="section-head">
                    <div>
                        <h2>已上传</h2>
                        <p class="section-note">提交投递后，本次选择的材料会固定保存；后续修改不会影响历史投递。</p>
                    </div>
                    ${chip(`${items.length} 份`, "info")}
                </div>
                <div class="material-library-list">
                    ${state.candidateMaterialError ? `<div class="form-error">${escapeHtml(state.candidateMaterialError)}</div>` : ""}
                    ${items.map((item) => {
                        const materialKey = `${kind}:${item.id}`;
                        const stateInfo = candidateMaterialState(item);
                        return `
                            <div class="material-row">
                                <div>
                                    <strong>${escapeHtml(item.name)}</strong>
                                    <span>${escapeHtml(item.detail)} · ${escapeHtml(fileFormatFromName(item.name))}${item.isDefault ? " · 默认简历" : ""}</span>
                                </div>
                                ${chip(stateInfo.label, stateInfo.tone)}
                                ${kind === "portfolio" ? `
                                    <button class="material-row-open" data-action="edit-candidate-portfolio" data-key="${escapeHtml(materialKey)}" aria-label="编辑作品">
                                        ${icon("chevronRight")}
                                    </button>
                                ` : `
                                    <div class="material-row-actions">
                                        <button class="ghost small" data-action="view-candidate-material" data-key="${escapeHtml(materialKey)}">预览</button>
                                        <button class="ghost small danger-lite" data-action="delete-candidate-material" data-kind="${escapeHtml(kind)}" data-material-id="${escapeHtml(item.id)}">删除</button>
                                    </div>
                                `}
                            </div>
                        `;
                    }).join("") || `<p class="section-note">暂无${escapeHtml(title)}，点击下方按钮添加一份。</p>`}
                </div>
                <button class="primary full material-manager-add" data-action="candidate-material-form" data-kind="${escapeHtml(kind)}">${icon("upload")}${escapeHtml(addLabel)}</button>
            </div>
        </section>
        ${state.candidateMaterialForm ? renderCandidateMaterialSheet() : ""}
        ${state.candidateMaterialDetailKey ? renderCandidateMaterialDetailSheet() : ""}
        ${state.candidateMaterialDeleteConfirm ? renderCandidateMaterialDeleteConfirmSheet() : ""}
    `;
}

function renderCandidateInterviewManager() {
    const interviewApps = candidateInterviewApps();
    const pendingCount = candidateTodoApps().length;
    return `
        <div class="candidate-app-head compact material-manager-head">
            <div class="candidate-title-row">
                <div>
                    <h1>面试</h1>
                    <p>${interviewApps.length ? `${interviewApps.length} 个面试记录` : "暂无面试"}</p>
                </div>
                <button class="ghost small" data-action="close-interview-manager">返回</button>
            </div>
        </div>
        <section class="candidate-profile-screen material-manager-screen">
            <div class="profile-section material-manager-section">
                <div class="section-head">
                    <div>
                        <h2>AI 面试</h2>
                        <p class="section-note">已邀请、进行中和已完成的 AI 面试都会保留在这里。</p>
                    </div>
                    ${chip(`${pendingCount} 个待办`, pendingCount ? "warning" : "success")}
                </div>
                <div class="material-library-list interview-task-list">
                    ${interviewApps.map((app) => {
                        const job = jobById(app.jobId);
                        const status = interviewLabel(app);
                        const detail = app.aiInterview?.expiresAt ? `有效期至 ${formatDateTime(app.aiInterview.expiresAt)}` : "查看 AI 面试入口";
                        const canOpen = candidateCanOpenInterviewEntry(app);
                        return `
                            <div class="material-row interview-task-row">
                                <div>
                                    <strong>${escapeHtml(job.title)}</strong>
                                    <span>${escapeHtml(detail)}</span>
                                </div>
                                ${chip(status, tone(status))}
                                <button class="${canOpen ? "primary small interview-entry-trigger" : "material-row-open"}" data-action="${canOpen ? "candidate-enter-interview" : "candidate-application-detail"}" data-app-id="${escapeHtml(app.id)}" aria-label="${canOpen ? "进入 AI 面试" : "查看面试详情"}">${canOpen ? `${icon("video")}进入面试` : icon("chevronRight")}</button>
                            </div>
                        `;
                    }).join("") || `
                        <div class="empty-conversation">
                            <strong>暂无面试</strong>
                            <p>收到 AI 面试邀请后，会在这里和消息页同步出现。</p>
                        </div>
                    `}
                </div>
            </div>
        </section>
        ${state.candidateApplicationDetailId ? renderCandidateApplicationDetail() : ""}
    `;
}

function renderCandidateInterviews() {
    const interviewApps = candidateInterviewApps();
    const pendingCount = candidateTodoApps().length;
    return `
        <div class="candidate-app-head compact material-manager-head">
            <div class="candidate-title-row">
                <div>
                    <h1>面试</h1>
                    <p>${pendingCount ? `${pendingCount} 个待处理` : "面试入口和记录"}</p>
                </div>
            </div>
        </div>
        <section class="candidate-profile-screen material-manager-screen interview-center-screen">
            <div class="profile-section material-manager-section">
                <div class="section-head">
                    <div>
                        <h2>AI 面试</h2>
                        <p>邀请链接、有效期和完成状态会一直保留在这里。</p>
                    </div>
                    ${chip(`${interviewApps.length} 条记录`, interviewApps.length ? "info" : "success")}
                </div>
                <div class="material-library-list interview-task-list">
                    ${interviewApps.map((app) => {
                        const job = jobById(app.jobId);
                        const stage = candidateStageForApplication(app);
                        const canOpen = candidateCanOpenInterviewEntry(app);
                        const detail = app.aiInterview?.expiresAt
                            ? `有效期至 ${formatDateTime(app.aiInterview.expiresAt)}`
                            : stage.detail;
                        return `
                            <div class="material-row interview-task-row interview-center-row">
                                <div>
                                    <strong>${escapeHtml(job.title)}</strong>
                                    <span>${escapeHtml(detail)}</span>
                                </div>
                                ${chip(interviewLabel(app), tone(interviewLabel(app)))}
                                <button class="${canOpen ? "primary small interview-entry-trigger" : "ghost small interview-secondary-action"}" data-action="${canOpen ? "candidate-enter-interview" : "candidate-application-detail"}" data-app-id="${escapeHtml(app.id)}">${canOpen ? `${icon("video")}进入面试` : "详情"}</button>
                            </div>
                        `;
                    }).join("") || `
                        <div class="empty-conversation">
                            <strong>还没有面试邀请</strong>
                            <p>通过初筛后，招聘者发起的 AI 面试会显示在这里。</p>
                        </div>
                    `}
                </div>
            </div>
        </section>
        ${state.candidateApplicationDetailId ? renderCandidateApplicationDetail() : ""}
    `;
}

function renderCandidateProfile() {
    const ownApps = applicationsForCandidate(candidate.id);
    const waiting = candidatePendingApps().length;
    const resumes = candidateResumes(candidate);
    const knowledge = candidateKnowledge(candidate);
    if (state.candidateMaterialManagerKind) return renderCandidateMaterialManager();
    if (state.candidateInterviewManagerOpen) return renderCandidateInterviewManager();
    return `
        <div class="candidate-app-head profile-head">
            <div class="profile-hero">
                <div class="profile-avatar-wrap">
                    <button class="profile-avatar-button" data-action="open-avatar-preview" aria-label="预览头像">
                        ${renderCandidateAvatar(candidate, "profile-avatar")}
                    </button>
                </div>
                <div>
                    <h1>${escapeHtml(candidate.name)}</h1>
                </div>
            </div>
            <div class="profile-metrics">
                <div><strong>${ownApps.length}</strong><span>已投递</span></div>
                <div><strong>${waiting}</strong><span>流程中</span></div>
                <div><strong>${candidate.completeness}%</strong><span>材料完整度</span></div>
            </div>
        </div>
        <section class="candidate-profile-screen">
            <div class="profile-section">
                <div class="section-head">
                    <div>
                        <h2>材料库</h2>
                        <p>管理投递时可选择的简历、作品和补充资料。</p>
                    </div>
                    ${chip(`完整度 ${candidate.completeness}%`, "success")}
                </div>
                <div class="material-status-list">
                    ${renderMaterialStatusRow(
                        "resume",
                        "简历库",
                        "file",
                        `${resumes.length} 份，默认 ${defaultResume(candidate)?.name || "未设置"}`,
                        resumes.length ? "已上传" : "待补",
                        resumes.length ? "success" : "warning",
                    )}
                    ${renderMaterialStatusRow(
                        "portfolio",
                        "作品",
                        "briefcase",
                        `${candidate.portfolios.length} 个项目`,
                        candidate.portfolios.length ? "已上传" : "可补充",
                        candidate.portfolios.length ? "success" : "info",
                    )}
                    ${renderMaterialStatusRow(
                        "knowledge",
                        "可选知识库",
                        "search",
                        `${knowledge.length} 份补充`,
                        knowledge.length ? "已上传" : "可选",
                        knowledge.length ? "success" : "info",
                    )}
                </div>
            </div>
            <div class="profile-section">
                <div class="section-head">
                    <div>
                        <h2>投递状态</h2>
                        <p>查看每个岗位的投递进度和面试入口。</p>
                    </div>
                    ${chip(`${ownApps.length} 个投递`, "info")}
                </div>
                <div class="status-list app-status-list">
                    ${ownApps.length ? ownApps.map((app) => {
                        const publicStage = candidatePublicStageForApplication(app);
                        return `
                            <div class="status-item">
                                <strong>${escapeHtml(jobById(app.jobId).title)}</strong>
                                <span>${escapeHtml(materialSnapshotSummary(app))}</span>
                                <div>${chip(publicStage.label, publicStage.tone)}</div>
                                <button class="ghost small" data-action="candidate-application-detail" data-app-id="${app.id}">查看投递详情</button>
                            </div>
                        `;
                    }).join("") : `
                        <div class="empty-inline">
                            ${helperMark("mini")}
                            <strong>还没有投递记录</strong>
                            <span>看到合适岗位后，提交一次投递就会出现在这里。</span>
                        </div>
                    `}
                </div>
            </div>
            <div class="profile-section account-section">
                <div class="section-head">
                    <div>
                        <h2>账号</h2>
                        <p>当前候选人身份只用于识别投递记录和材料。</p>
                    </div>
                </div>
                <div class="profile-account-card">
                    <div>
                        <strong>${escapeHtml(candidate.name)}</strong>
                        <span>候选人档案已保存</span>
                    </div>
                    <button class="ghost small danger-lite" data-action="candidate-logout">${icon("logout")}退出登录</button>
                </div>
            </div>
        </section>
        ${state.avatarPreviewOpen ? renderAvatarPreview() : ""}
        ${state.avatarEditorOpen ? renderAvatarEditor() : ""}
        ${state.candidateMaterialForm ? renderCandidateMaterialSheet() : ""}
        ${state.candidateMaterialDetailKey ? renderCandidateMaterialDetailSheet() : ""}
        ${state.candidateMaterialDeleteKind ? renderCandidateMaterialDeleteSheet() : ""}
        ${state.candidateMaterialDeleteConfirm ? renderCandidateMaterialDeleteConfirmSheet() : ""}
        ${state.candidateApplicationDetailId ? renderCandidateApplicationDetail() : ""}
    `;
}

function renderCandidateMaterialSheet() {
    const titleMap = {
        resume: "添加简历",
        portfolio: "添加作品",
        knowledge: "添加可选知识库",
    };
    const kind = state.candidateMaterialForm;
    return `
        <div class="candidate-modal-backdrop" data-action="close-candidate-sheet">
            <section class="avatar-sheet material-sheet ${kind === "portfolio" ? "portfolio-editor-sheet" : ""}" role="dialog" aria-label="${escapeHtml(titleMap[kind])}">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>${escapeHtml(titleMap[kind])}</h2>
                        <p>支持 ${escapeHtml(materialFormats(kind))}。保存后会出现在材料库，投递时再选择是否用于本次申请。</p>
                    </div>
                    <button class="ghost small" data-action="close-candidate-sheet">关闭</button>
                </div>
                <form class="admin-edit-form" data-form="candidate-material">
                    <input type="hidden" name="kind" value="${escapeHtml(kind)}" />
                    ${state.candidateMaterialError ? `<div class="form-error">${escapeHtml(state.candidateMaterialError)}</div>` : ""}
                    ${kind === "portfolio" ? renderPortfolioSubmissionFields() : `
                        <label>选择文件
                            <input type="file" name="file" accept="${escapeHtml(materialAccept(kind))}" />
                        </label>
                    `}
                    <p class="section-note">${kind === "portfolio" ? "作品会按统一创意 demo 模板保存，截图走对象存储引用；投递时会固定保存本次选择的版本。" : "保存时直接使用文件名，不需要额外填写名称和说明；真实上传会走对象存储直传。"}</p>
                    <button class="primary" type="submit">${icon("upload")}${kind === "portfolio" ? "保存作品" : "保存到材料库"}</button>
                </form>
            </section>
        </div>
    `;
}

function renderCandidateMaterialDetailSheet() {
    const item = materialByKey(state.candidateMaterialDetailKey);
    if (!item) return "";
    if (item.kind === "portfolio") return renderPortfolioEditorSheet(item);
    const previewUrl = materialPreviewUrl(item);
    const canInline = previewUrl && canInlinePreviewMaterial(item);
    const format = fileFormatFromName(item.name);
    return `
        <div class="candidate-modal-backdrop" data-action="close-candidate-sheet">
            <section class="avatar-sheet material-sheet" role="dialog" aria-label="材料详情">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>${escapeHtml(item.name)}</h2>
                        <p>${escapeHtml(materialKindLabel(item.kind))}原文件预览。PDF、图片和文本可以直接查看。</p>
                    </div>
                    <button class="ghost small" data-action="close-candidate-sheet">关闭</button>
                </div>
                <div class="file-preview-shell">
                    ${previewUrl ? `
                        <div class="file-preview-toolbar">
                            <span>${escapeHtml(format)}</span>
                            <a href="${escapeHtml(previewUrl)}" target="_blank" rel="noopener">新窗口打开</a>
                        </div>
                        ${canInline ? `
                            <iframe class="file-preview-frame" src="${escapeHtml(previewUrl)}" title="${escapeHtml(item.name)}"></iframe>
                        ` : `
                            <div class="file-preview-empty">
                                <strong>这个格式暂不支持内嵌预览</strong>
                                <p>可以点“新窗口打开”查看原文件。后续接入服务端文档解析后，会在这里展示正文摘要。</p>
                            </div>
                        `}
                    ` : `
                        <div class="file-preview-empty">
                            <strong>这份旧材料暂时没有原文件</strong>
                            <p>它是在之前只保存文件名的版本里添加的。重新上传后，就可以在这里预览正文内容。</p>
                        </div>
                    `}
                </div>
                <button class="ghost" data-action="close-candidate-sheet">知道了</button>
            </section>
        </div>
    `;
}

function renderPortfolioEditorSheet(item) {
    return `
        <div class="candidate-modal-backdrop" data-action="close-candidate-sheet">
            <section class="avatar-sheet material-sheet portfolio-editor-sheet" role="dialog" aria-label="编辑作品">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>${escapeHtml(item.title || item.name)}</h2>
                        <p>按创意 Demo 模板修改。已提交投递会继续保留当时选择的版本。</p>
                    </div>
                    <button class="ghost small" data-action="close-candidate-sheet">关闭</button>
                </div>
                <form class="admin-edit-form portfolio-edit-form" data-form="candidate-portfolio-edit">
                    <input type="hidden" name="portfolioId" value="${escapeHtml(item.id)}" />
                    ${renderPortfolioSubmissionFields(item)}
                    <p class="section-note">当前已保存 ${escapeHtml(`${item.screenshots?.length || 0} 张截图`)}；如果不重新选择截图，会保留原截图记录。</p>
                    <div class="portfolio-editor-footer">
                        <button class="primary" type="submit">保存修改</button>
                        <button class="ghost danger-lite" type="button" data-action="delete-candidate-material" data-kind="portfolio" data-material-id="${escapeHtml(item.id)}">删除作品</button>
                    </div>
                </form>
            </section>
        </div>
    `;
}

function renderCandidateMaterialDeleteSheet() {
    const kind = state.candidateMaterialDeleteKind;
    const items = candidateMaterialItems(kind);
    const title = `删除${materialKindLabel(kind)}`;
    return `
        <div class="candidate-modal-backdrop" data-action="close-candidate-sheet">
            <section class="avatar-sheet material-sheet" role="dialog" aria-label="${escapeHtml(title)}">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>${escapeHtml(title)}</h2>
                    <p>请选择要删除的具体材料。已投递岗位会继续保留当时提交的材料版本。</p>
                    </div>
                    <button class="ghost small" data-action="close-candidate-sheet">关闭</button>
                </div>
                <div class="material-delete-list">
                    ${items.map((item) => {
                        const stateInfo = candidateMaterialState(item);
                        return `
                            <div class="material-row">
                                <div>
                                    <strong>${escapeHtml(item.name)}</strong>
                                    <span>${escapeHtml(fileFormatFromName(item.name))} · ${escapeHtml(stateInfo.label)}${item.isDefault ? " · 默认简历" : ""}</span>
                                </div>
                                <button class="ghost small danger-lite" data-action="delete-candidate-material" data-kind="${escapeHtml(kind)}" data-material-id="${escapeHtml(item.id)}">删除</button>
                            </div>
                        `;
                    }).join("") || `<p class="section-note">暂无可删除材料。</p>`}
                </div>
            </section>
        </div>
    `;
}

function renderCandidateMaterialDeleteConfirmSheet() {
    const confirm = state.candidateMaterialDeleteConfirm || {};
    const item = materialByKindAndId(confirm.kind, confirm.materialId);
    const title = `删除${materialKindLabel(confirm.kind)}`;
    const deleting = state.candidateMaterialDeletingId === confirm.materialId;
    return `
        <div class="candidate-modal-backdrop confirm-modal-backdrop" data-action="cancel-delete-candidate-material">
            <section class="avatar-sheet material-sheet material-confirm-sheet" role="dialog" aria-label="${escapeHtml(title)}">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>${escapeHtml(title)}</h2>
                        <p>删除后，这份材料不会再出现在材料库里；已提交的历史投递仍保留当时的材料版本。</p>
                    </div>
                    <button class="ghost small" data-action="cancel-delete-candidate-material">取消</button>
                </div>
                ${state.candidateMaterialError ? `<div class="form-error">${escapeHtml(state.candidateMaterialError)}</div>` : ""}
                <div class="delete-confirm-card">
                    <strong>${escapeHtml(item?.name || confirm.name || "这份材料")}</strong>
                    <span>${escapeHtml(materialKindLabel(confirm.kind))} · ${escapeHtml(fileFormatFromName(item?.name || confirm.name || ""))}</span>
                </div>
                <div class="confirm-actions">
                    <button class="ghost" data-action="cancel-delete-candidate-material">再想想</button>
                    <button class="danger" data-action="confirm-delete-candidate-material" ${deleting ? "disabled" : ""}>${deleting ? "删除中..." : "确认删除"}</button>
                </div>
            </section>
        </div>
    `;
}

function renderCandidateApplicationDetail() {
    const app = applicationById(state.candidateApplicationDetailId);
    const job = jobById(app.jobId);
    const interviewExpired = aiInterviewExpired(app);
    const canEnterInterview = candidateCanOpenInterviewEntry(app);
    const steps = candidateApplicationFlowSteps(app);
    const materialState = applicationMaterialSnapshotState(app);
    return `
        <div class="candidate-modal-backdrop" data-action="close-candidate-sheet">
            <section class="avatar-sheet application-detail-sheet" role="dialog" aria-label="投递详情">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>${escapeHtml(job.title)}</h2>
                        <p>你只需要关注投递材料、AI 面试入口和后续状态。</p>
                    </div>
                    <button class="ghost small" data-action="close-candidate-sheet">关闭</button>
                </div>
                <div class="application-three-step">
                    ${steps.map((step, index) => `
                        <div class="application-flow-card ${escapeHtml(step.status)}">
                            <span>${index + 1}</span>
                            <div>
                                <strong>${escapeHtml(step.title)}</strong>
                                <p>${escapeHtml(step.text)}</p>
                            </div>
                        </div>
                    `).join("")}
                </div>
                <div class="application-detail-note">
                    <strong>已投递材料</strong>
                    ${chip(materialState.label, materialState.tone)}
                    <span>${escapeHtml(materialSnapshotSummary(app))}</span>
                </div>
                ${interviewExpired ? `
                    <div class="application-detail-note warning">
                        <strong>AI 面试邀请已过期</strong>
                        ${chip("已过期", "warning")}
                        <span>等待招聘者重新发送邀请，或从消息里联系招聘者。</span>
                    </div>
                ` : ""}
                ${canEnterInterview ? `
                    <div class="application-detail-note info">
                        <strong>AI 面试已开放</strong>
                        ${chip("请先确认入口", "info")}
                        <span>请先阅读面试注意事项；进入面试间后先连接面试官，连接完成后再开始。</span>
                    </div>
                    <button class="primary full interview-entry-trigger" data-action="candidate-enter-interview" data-app-id="${escapeHtml(app.id)}">进入 AI 面试</button>
                ` : ""}
            </section>
        </div>
    `;
}

function renderCandidateInterviewEntrySheet() {
    const entry = state.candidateInterviewEntry;
    const app = applicationById(state.candidateInterviewEntryAppId);
    const loading = entry?.loading;
    const entryInfo = entry?.entry || app?.aiInterview || {};
    const entryStatus = entryInfo.status || app?.interviewStatus || app?.aiInterview?.status || "pending";
    const alreadyStarted = entryStatus === "in_progress" || entry?.state === "started";
    const preparing = entry?.state === "preparing" || entryInfo.prepared === false;
    const invitationUrl = loading || preparing ? "" : interviewInvitationLink(entry, app);
    if (preparing && !loading && app?.id) {
        scheduleCandidateInterviewPoll(app.id);
    }
    else if (!preparing) {
        cancelCandidateInterviewPoll();
    }
    const starting = state.candidateInterviewStartingAppId === (app?.id || state.candidateInterviewEntryAppId);
    const canStart = !loading && !preparing && !alreadyStarted && entryStatus === "pending" && !aiInterviewExpired(app) && !state.candidateInterviewStartingAppId;
    const entryActionLabel = loading
        ? "正在准备入口"
        : starting
            ? "正在打开面试间"
            : preparing
            ? "面试间准备中"
            : alreadyStarted
            ? "本次面试已开始，不能重新开始"
            : canStart
                ? "进入 AI 面试间"
                : entry?.reason || "面试入口未准备";
    const entryStatusLabel = loading ? "准备中"
        : preparing ? "面试间准备中"
        : entry?.state === "ready" ? "可进入"
        : statusText(entryStatus);
    return `
        <div class="candidate-modal-backdrop" data-action="close-interview-entry">
            <section class="avatar-sheet material-sheet" role="dialog" aria-label="AI 面试入口">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>AI 面试入口</h2>
                        <p>${escapeHtml(entry?.entry?.note || entry?.reason || "进入 AI 面试间后，请先连接面试官；连接完成后再开始。")}</p>
                    </div>
                    <button class="ghost small" data-action="close-interview-entry">关闭</button>
                </div>
                <div class="mini-list compact">
                    <div><strong>状态</strong><span>${escapeHtml(entryStatusLabel)}</span></div>
                    <div><strong>面试次数</strong><span>${escapeHtml(entryInfo.attemptNo || entryInfo.attempt || 0)}</span></div>
                    <div><strong>有效期</strong><span>${escapeHtml(entryInfo.expiresAt ? formatDateTime(entryInfo.expiresAt) : "等待管理员重新邀请")}</span></div>
                </div>
                ${invitationUrl ? `
                    <div class="interview-entry-linkbar compact">
                        <button class="interview-entry-copy" data-action="copy-interview-link" data-url="${escapeHtml(invitationUrl)}" title="复制面试链接" aria-label="复制面试链接">${icon("copy")}</button>
                        <div>
                            <strong>面试链接</strong>
                            <span>${escapeHtml(shortInterviewLink(invitationUrl))}</span>
                        </div>
                    </div>
                ` : ""}
                <div class="interview-entry-checklist compact">
                    <span>${icon("video")}电脑或手机都可以，请允许摄像头和麦克风。</span>
                    <span>${icon("clock")}尽量在安静、网络稳定的地方完成。</span>
                    <span>${icon("file")}系统会记录面试回答、时间和过程状态，用于评价与复核。</span>
                    <span>${icon("check")}进入面试间后，请先连接面试官；连接完成后再点击开始面试。</span>
                </div>
                ${canStart
                    ? `<button class="primary full interview-entry-trigger" data-action="candidate-start-interview" data-app-id="${escapeHtml(app?.id || state.candidateInterviewEntryAppId)}">${escapeHtml(entryActionLabel)}</button>`
                    : `<button class="primary full interview-entry-trigger" disabled>${escapeHtml(entryActionLabel)}</button>`}
            </section>
        </div>
    `;
}

function checkedAttr(value) {
    return value ? "checked" : "";
}

function normalizeApplicationSelection(defaults = {}) {
    const resumeIds = new Set(candidateResumes(candidate).map((item) => item.id));
    const portfolioIds = new Set((candidate?.portfolios || []).map((item) => item.id));
    const knowledgeIds = new Set(candidateKnowledge(candidate).map((item) => item.id));
    const resumeId = defaults.resumeId && resumeIds.has(defaults.resumeId)
        ? defaults.resumeId
        : defaultResume(candidate)?.id || candidateResumes(candidate)[0]?.id || "";
    return {
        resumeId,
        portfolioIds: (defaults.portfolioIds || []).filter((id) => portfolioIds.has(id)),
        knowledgeIds: (defaults.knowledgeIds || []).filter((id) => knowledgeIds.has(id)),
    };
}

function applicationSelectionDefaults(app, draftKey = "") {
    if (draftKey && state.applicationMaterialDrafts[draftKey]) {
        return normalizeApplicationSelection(state.applicationMaterialDrafts[draftKey]);
    }
    const snapshot = app?.materialSnapshot || {};
    return normalizeApplicationSelection({
        resumeId: snapshot.resumeId || defaultResume(candidate)?.id || candidateResumes(candidate)[0]?.id || "",
        portfolioIds: snapshot.portfolioIds?.length
            ? snapshot.portfolioIds
            : (candidate.portfolios || []).map((item) => item.id),
        knowledgeIds: snapshot.knowledgeIds || [],
    });
}

function renderApplicationMaterialChoices({app = null, includeEmptyResumeAction = true, draftKey = ""} = {}) {
    const resumes = candidateResumes(candidate);
    const knowledge = candidateKnowledge(candidate);
    const defaults = applicationSelectionDefaults(app, draftKey);
    return `
        <div class="choice-list">
            <h3>简历</h3>
            ${resumes.map((resume) => `
                <label class="choice-row">
                    <input type="radio" name="resumeId" value="${escapeHtml(resume.id)}" ${checkedAttr(defaults.resumeId === resume.id)} />
                    <span><strong>${escapeHtml(resume.name)}</strong><small>${escapeHtml(candidateMaterialDetailText(resume, resume.summary))}</small></span>
                </label>
            `).join("") || `
                <div class="candidate-empty-state compact">
                    ${helperMark("mini")}
                    <strong>还没有可用于投递的简历</strong>
                    <p>先添加简历，再回到职位确认投递。</p>
                    ${includeEmptyResumeAction ? `<button class="ghost small" type="button" data-action="application-add-resume">${icon("upload")}去添加简历</button>` : ""}
                </div>
            `}
        </div>
        <div class="choice-list">
            <h3>作品</h3>
            ${(candidate.portfolios || []).map((item) => `
                <label class="choice-row">
                    <input type="checkbox" name="portfolioIds" value="${escapeHtml(item.id)}" ${checkedAttr(defaults.portfolioIds.includes(item.id))} />
                    <span><strong>${escapeHtml(item.title || item.name || "未命名作品")}</strong><small>${escapeHtml(item.oneLineValue || item.jobDirection || item.evidence || item.type || "作品材料")}</small></span>
                </label>
            `).join("") || `<p class="section-note">暂无作品，仍可先提交简历。</p>`}
        </div>
        <div class="choice-list">
            <h3>可选知识库</h3>
            ${knowledge.map((item) => `
                <label class="choice-row">
                    <input type="checkbox" name="knowledgeIds" value="${escapeHtml(item.id)}" ${checkedAttr(defaults.knowledgeIds.includes(item.id))} />
                    <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(candidateMaterialDetailText(item, item.usage))}</small></span>
                </label>
            `).join("") || `<p class="section-note">暂无可选知识库。</p>`}
        </div>
    `;
}

function renderApplicationSubmitSheet() {
    const job = jobById(state.applicationSheetJobId);
    if (!job) return "";
    const resumes = candidateResumes(candidate);
    const submitting = state.applicationSubmitting;
    return `
        <div class="candidate-modal-backdrop" data-action="close-application-sheet">
            <section class="avatar-sheet application-submit-sheet" role="dialog" aria-label="确认投递">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>投递 ${escapeHtml(job.title)}</h2>
                        <p>选择这次要提交的材料。提交后，本次材料会固定保存，后续修改不会影响这次投递。</p>
                    </div>
                    <button class="ghost small" data-action="close-application-sheet">关闭</button>
                </div>
                <form class="admin-edit-form" data-form="application-submit">
                    <input type="hidden" name="jobId" value="${escapeHtml(job.id)}" />
                    <div class="submit-confirm-note">
                        <strong>提交前确认</strong>
                        <span>本次投递会固定保存所选简历、作品和资料；你之后仍可更新材料库，但不会改动这次投递记录。</span>
                    </div>
                    ${state.applicationSubmitError ? `<div class="form-error">${escapeHtml(state.applicationSubmitError)}</div>` : ""}
                    ${renderApplicationMaterialChoices({draftKey: activeApplicationSheetKey()})}
                    <button class="primary" type="submit" ${submitting || !resumes.length ? "disabled" : ""}>${icon("send")}${submitting ? "提交中..." : "提交投递"}</button>
                </form>
            </section>
        </div>
    `;
}

function renderApplicationUpdateSheet() {
    const app = applicationById(state.applicationUpdateAppId);
    if (!app) return "";
    const job = jobById(app.jobId);
    const resumes = candidateResumes(candidate);
    const submitting = state.applicationSubmitting;
    return `
        <div class="candidate-modal-backdrop" data-action="close-application-sheet">
            <section class="avatar-sheet application-submit-sheet" role="dialog" aria-label="更新投递材料">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>更新 ${escapeHtml(job.title)} 材料</h2>
                        <p>和投递一样选择这次要提交的材料。确认后会替换本次投递快照，并重新进入材料解析。</p>
                    </div>
                    <button class="ghost small" data-action="close-application-sheet">关闭</button>
                </div>
                <form class="admin-edit-form" data-form="application-material-update">
                    <input type="hidden" name="applicationId" value="${escapeHtml(app.id)}" />
                    <input type="hidden" name="materialUpdateRequestId" value="${escapeHtml(state.applicationUpdateRequestId || currentMaterialUpdateRequestId(app))}" />
                    <div class="submit-confirm-note">
                        <strong>更新前确认</strong>
                        <span>你可以先在材料库添加或修改材料，再回到这里选择。本次确认后，招聘者会看到新的投递材料快照。</span>
                    </div>
                    ${state.applicationSubmitError ? `<div class="form-error">${escapeHtml(state.applicationSubmitError)}</div>` : ""}
                    ${renderApplicationMaterialChoices({app, draftKey: activeApplicationSheetKey()})}
                    <button class="primary" type="submit" ${submitting || !resumes.length ? "disabled" : ""}>${icon("upload")}${submitting ? "更新中..." : "确认更新材料"}</button>
                </form>
            </section>
        </div>
    `;
}

function renderAvatarPreview() {
    return `
        <div class="candidate-modal-backdrop avatar-preview-backdrop" data-action="close-avatar-preview">
            <section class="avatar-sheet avatar-preview-sheet" role="dialog" aria-label="头像预览">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>头像预览</h2>
                        <p>候选人头像会用于材料、投递和消息展示。</p>
                    </div>
                    <button class="ghost small" data-action="close-avatar-preview">关闭</button>
                </div>
                <div class="avatar-preview-stage">
                    ${renderCandidateAvatarPreview(candidate)}
                </div>
                <div class="avatar-option-grid avatar-preview-actions">
                    <label class="avatar-upload-option">
                        <input type="file" accept="image/*" data-input="candidate-avatar-file" />
                        ${icon("upload")}
                        <span>上传头像</span>
                    </label>
                    <button type="button" data-action="avatar-default">
                        <span class="generated-avatar avatar-option-mark" style="${escapeHtml(candidateAvatarStyle(candidate))}">${escapeHtml(candidateAvatarInitial(candidate))}</span>
                        默认头像
                    </button>
                </div>
            </section>
        </div>
    `;
}

function renderAvatarEditor() {
    const crop = state.avatarCrop;
    return `
        <div class="candidate-modal-backdrop avatar-editor-backdrop" data-action="close-avatar-editor">
            <section class="avatar-sheet avatar-crop-sheet" role="dialog" aria-label="修改头像">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>${crop ? "调整头像" : "修改头像"}</h2>
                        <p>${crop ? "拖动图片调整位置，双指或滑杆缩放。" : "候选人头像只用于本人材料和投递状态展示。"}</p>
                    </div>
                    <button class="ghost small" data-action="close-avatar-editor">关闭</button>
                </div>
                ${crop ? `
                    <div class="avatar-crop-stage">
                        <img class="avatar-crop-image" src="${escapeHtml(crop.objectUrl)}" alt="待裁剪头像" draggable="false" />
                    </div>
                    <label class="avatar-crop-zoom">
                        <span>缩放</span>
                        <input type="range" min="1" max="4" step="0.01" value="${escapeHtml(crop.zoom)}" data-input="avatar-crop-zoom" />
                    </label>
                    ${crop.error ? `<p class="form-error">${escapeHtml(crop.error)}</p>` : ""}
                    <div class="avatar-crop-actions">
                        <label class="ghost avatar-repick">
                            <input type="file" accept="image/*" data-input="candidate-avatar-file" />
                            换一张
                        </label>
                        <button type="button" class="ghost" data-action="avatar-default">默认头像</button>
                        <button type="button" class="primary" data-action="save-avatar-crop" ${crop.saving ? "disabled" : ""}>${crop.saving ? "保存中..." : "保存头像"}</button>
                    </div>
                ` : `
                    <div class="avatar-option-grid">
                        <label class="avatar-upload-option">
                            <input type="file" accept="image/*" data-input="candidate-avatar-file" />
                            ${icon("upload")}
                            <span>上传头像</span>
                        </label>
                        <button type="button" data-action="avatar-default">
                            <span class="generated-avatar avatar-option-mark" style="${escapeHtml(candidateAvatarStyle(candidate))}">${escapeHtml(candidateAvatarInitial(candidate))}</span>
                            默认头像
                        </button>
                    </div>
                `}
            </section>
        </div>
    `;
}

function renderCandidateTabbar() {
    const messageUnreadCount = candidateTotalUnreadCount();
    const interviewTodoCount = candidateTodoApps().length;
    const shouldAnimateSwitch = state.candidateTabTransitionFrom
        && state.candidateTabTransitionFrom !== state.candidateTab
        && state.candidateTabTransitionRenderedId !== state.candidateTabTransitionId;
    const switchClass = shouldAnimateSwitch
        ? ` is-switching from-${escapeHtml(state.candidateTabTransitionFrom)}`
        : "";
    const items = [
        ["jobs", "职位", "briefcase", 0],
        ["messages", "消息", "message", messageUnreadCount],
        ["interviews", "面试", "video", interviewTodoCount],
        ["profile", "我的", "user", 0],
    ];
    return `
        <nav class="candidate-tabbar tab-${escapeHtml(state.candidateTab)}${switchClass}" aria-label="候选人端导航">
            ${items.map(([id, label, iconName, badgeCount]) => `
                <button class="${state.candidateTab === id ? "active" : ""}" data-action="candidate-tab" data-tab="${id}">
                    ${icon(iconName)}
                    <span>${label}</span>
                    ${badgeCount ? `<b class="tab-unread-badge">${badgeCount > 99 ? "99+" : escapeHtml(badgeCount)}</b>` : ""}
                </button>
            `).join("")}
        </nav>
    `;
}

function adminBackLabel() {
    if (state.adminPage === "candidateDetail") return "返回候选人索引";
    if (state.adminPage === "jobDetail" && state.selectedJobTab === "applications" && state.activeApplicationId) return "返回候选人队列";
    if (state.adminPage === "jobDetail") return "返回岗位工作台";
    return "";
}

function renderAdminTopbarLeading() {
    const label = adminBackLabel();
    if (!label) return "";
    const selectedJob = state.adminPage === "jobDetail" ? jobById(state.selectedJobId) : null;
    return `
        <div class="topbar-leading">
            <button class="topbar-back-button" data-action="admin-back" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
                ${icon("back")}
            </button>
            ${selectedJob ? `
                <div class="topbar-job-context">
                    <strong>${escapeHtml(selectedJob.title)}</strong>
                </div>
            ` : ""}
        </div>
    `;
}

function handleAdminBack() {
    state.adminEditingSection = "";
    if (state.adminPage === "candidateDetail") {
        state.adminPage = "candidateHub";
        state.selectedCandidateId = "";
        window.history.replaceState({}, "", "/admin");
        return;
    }
    if (state.adminPage === "jobDetail" && state.selectedJobTab === "applications" && state.activeApplicationId) {
        state.activeApplicationId = "";
        state.routeAppIdApplied = "";
        window.history.replaceState({}, "", adminJobUrl(state.selectedJobId, {tab: "applications"}));
        return;
    }
    if (state.adminPage === "jobDetail") {
        showAdminJobList();
    }
}

function renderAdmin() {
    const active = state.adminPage === "candidateHub" || state.adminPage === "candidateDetail" ? "candidateHub" : "jobs";
    const title = active === "candidateHub" ? "候选人索引" : "岗位工作台";
    const selectedJob = state.adminPage === "jobDetail" ? jobById(state.selectedJobId) : null;
    const shellClass = state.adminPage === "jobDetail" ? "admin-shell-job-detail" : "";
    const pageClass = state.adminPage === "jobDetail" ? "admin-page admin-job-page" : "admin-page";
    const moduleSwitch = `
        <nav class="topbar-admin-switch admin-module-switch" aria-label="管理员页面">
            <span class="admin-module-tabs">
                <button class="${active === "jobs" ? "active" : ""}" data-action="admin-module" data-module="jobs">岗位工作台</button>
                <button class="${active === "candidateHub" ? "active" : ""}" data-action="admin-module" data-module="candidateHub">候选人索引</button>
            </span>
        </nav>
    `;
    const actions = state.adminPage === "jobs"
        ? `<button class="primary admin-topbar-create" data-action="new-job">${icon("briefcase")}新建岗位</button>`
        : selectedJob
            ? `
                ${selectedJob.status === "已发布" ? `<button class="danger admin-topbar-job-action" data-action="stop-job" data-job-id="${escapeHtml(selectedJob.id)}">停止招聘</button>` : `<button class="primary admin-topbar-job-action" data-action="publish-job" data-job-id="${escapeHtml(selectedJob.id)}">${selectedJob.status === "草稿" ? "发布岗位" : "重新发布"}</button>`}
                <button class="ghost danger-lite admin-danger-link admin-topbar-job-action" data-action="delete-job" data-job-id="${escapeHtml(selectedJob.id)}">删除岗位</button>
            `
            : "";
    return shell(title, "", `
        <section class="${pageClass}">
            ${state.adminPage === "jobDetail" ? renderJobDetail() : ""}
            ${state.adminPage === "candidateHub" ? renderCandidateHub() : ""}
            ${state.adminPage === "candidateDetail" ? renderCandidateDetail() : ""}
            ${state.adminPage === "jobs" ? renderJobWorkbench() : ""}
            ${state.adminDeleteJobId ? renderAdminJobDeleteConfirm() : ""}
            ${state.adminForceInterviewAppId ? renderAdminForceInterviewConfirm() : ""}
            ${selectedAdminPortfolioDetail() ? renderAdminPortfolioDetailModal() : ""}
            ${state.adminApplicationReportModal ? renderApplicationReportModal() : ""}
        </section>
    `, actions, moduleSwitch, shellClass, renderAdminTopbarLeading());
}

function renderAdminJobDeleteConfirm() {
    const job = jobById(state.adminDeleteJobId);
    const deleting = state.adminDeletingJobId === state.adminDeleteJobId;
    return `
        <div class="candidate-modal-backdrop admin-modal-backdrop confirm-modal-backdrop" data-action="cancel-delete-job">
            <section class="avatar-sheet material-sheet admin-confirm-sheet" role="dialog" aria-label="删除岗位确认">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>删除岗位</h2>
                        <p>本地 MVP 会同时移除这个岗位下的投递和咨询记录。正式上线前建议改成软删除并保留审计。</p>
                    </div>
                    <button class="ghost small" data-action="cancel-delete-job">取消</button>
                </div>
                ${state.adminDeleteJobError ? `<div class="form-error">${escapeHtml(state.adminDeleteJobError)}</div>` : ""}
                <div class="delete-confirm-card">
                    <strong>${escapeHtml(job?.title || "这个岗位")}</strong>
                    <span>${escapeHtml(job?.location || "")} · ${escapeHtml(job?.mode || "")}</span>
                </div>
                <div class="confirm-actions">
                    <button class="ghost" data-action="cancel-delete-job">再想想</button>
                    <button class="danger" data-action="confirm-delete-job" ${deleting ? "disabled" : ""}>${deleting ? "删除中..." : "确认删除"}</button>
                </div>
            </section>
        </div>
    `;
}

function renderAdminForceInterviewConfirm() {
    const app = applicationById(state.adminForceInterviewAppId);
    const cand = app ? candidateById(app.candidateId) : null;
    const job = app ? jobById(app.jobId) : null;
    return `
        <div class="candidate-modal-backdrop admin-modal-backdrop confirm-modal-backdrop" data-action="cancel-force-interview">
            <section class="avatar-sheet material-sheet admin-confirm-sheet" role="dialog" aria-label="人工强制发起 AI 面试">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>人工强制发起 AI 面试</h2>
                        <p>该候选人当前仍有证据需要核验。若仍要先发 AI 面试，请记录原因，后续会进入审计日志。</p>
                    </div>
                    <button class="ghost small" data-action="cancel-force-interview">取消</button>
                </div>
                ${state.adminForceInterviewError ? `<div class="form-error">${escapeHtml(state.adminForceInterviewError)}</div>` : ""}
                <div class="delete-confirm-card">
                    <strong>${escapeHtml(cand?.name || "候选人")}</strong>
                    <span>${escapeHtml(job?.title || "岗位")} · ${escapeHtml(app?.prescreen?.summary || app?.screen || "证据待核验")}</span>
                </div>
                <form class="admin-edit-form" data-form="admin-force-interview">
                    <input type="hidden" name="applicationId" value="${escapeHtml(app?.id || "")}" />
                    <label>强制发起原因
                        <textarea name="forceReason" rows="3" placeholder="例如：作品较强，先通过 AI 面试核验本人贡献；缺失材料由面试后补齐。">${escapeHtml(state.adminForceInterviewReason || "")}</textarea>
                    </label>
                    ${state.adminForceInterviewBusy ? `<p class="section-note">正在生成面试计划并创建邀请，模型较慢时可能需要几十秒。</p>` : ""}
                    <div class="confirm-actions">
                        <button class="ghost" type="button" data-action="cancel-force-interview">取消</button>
                        <button class="primary" type="submit" ${state.adminForceInterviewBusy ? "disabled" : ""}>${state.adminForceInterviewBusy ? "发送中..." : "确认并发送邀请"}</button>
                    </div>
                </form>
            </section>
        </div>
    `;
}

function renderJobWorkbench() {
    const pending = actionableApplications().length;
    const visibleJobs = jobs.filter((job) => job.status === "已发布").length;
    const draftJobs = jobs.filter((job) => job.status === "草稿").length;
    const rows = filteredAdminJobs();
    const hasQuery = Boolean(String(state.adminJobQuery || "").trim());
    return `
        <div class="admin-workbench-toolbar admin-index-toolbar">
            <div class="workbench-metric-strip" aria-label="岗位概览">
                <div><strong>${visibleJobs}</strong><span>已发布</span></div>
                <div><strong>${pending}</strong><span>待处理</span></div>
                <div><strong>${draftJobs}</strong><span>草稿</span></div>
            </div>
            <label class="search-box admin-job-search">
                ${icon("search")}
                <input data-input="admin-job-search" value="${escapeHtml(state.adminJobQuery)}" placeholder="搜索岗位" />
                ${hasQuery ? `<button type="button" data-action="clear-job-search" aria-label="清空岗位搜索">×</button>` : ""}
            </label>
        </div>
        <div class="data-table job-table">
            <div class="table-row table-head">
                <span>岗位</span><span>候选人端</span><span>候选人</span><span>待处理</span><span>操作</span>
            </div>
            ${rows.length ? rows.map((job) => {
                const apps = applicationsForJob(job.id);
                const todo = actionableApplications(apps).length;
                const visibility = adminJobVisibility(job);
                return `
                    <div class="table-row">
                        <span><strong>${escapeHtml(job.title)}</strong><small>${escapeHtml(job.location)} · ${escapeHtml(job.mode)} · JD 知识库 ${escapeHtml(knowledgeSummary(job))}</small></span>
                        <span>${chip(visibility.label, visibility.tone)}</span>
                        <span>${apps.length}</span>
                        <span class="${todo ? "warn-text" : ""}">${todo}</span>
                        <span>
	                            <div class="row-actions">
	                                <button class="ghost small" data-action="enter-job" data-job-id="${job.id}">管理</button>
	                            </div>
                        </span>
                    </div>
                `;
            }).join("") : `
            <div class="job-empty-state">
                    ${helperMark("mini")}
                    <strong>${hasQuery ? "没有匹配的岗位" : "还没有岗位"}</strong>
                    <span>${hasQuery ? "换一个岗位名、地点、状态或知识库关键词试试。" : "点击右上角“新建岗位”，先补 JD、知识库和评价体系，再发布到候选人端。"}</span>
                    ${hasQuery ? `<button class="ghost small" data-action="clear-job-search">清空搜索</button>` : `<button class="primary small" data-action="new-job">新建岗位</button>`}
                </div>
            `}
        </div>
    `;
}

function renderJobDetail() {
    const job = jobById(state.selectedJobId);
    const communicationUnread = adminCommunicationUnread(job.id);
    const tabs = [
        {id: "jd", label: "JD", icon: "file"},
        {id: "knowledge", label: "知识库", icon: "book"},
        {id: "rubric", label: "评价体系", icon: "sliders"},
        {id: "applications", label: "候选人", icon: "user"},
        {id: "interviews", label: "面试", icon: "video"},
        {id: "communication", label: "消息", icon: "message", badge: communicationUnread},
    ];
    const collapsedClass = state.adminJobSidebarCollapsed ? " collapsed" : "";
    return `
        <div class="admin-job-layout${collapsedClass}">
            <aside class="admin-job-sidebar" aria-label="岗位详情导航">
                <div class="admin-job-sidebar-top">
                    <button class="admin-sidebar-icon-button" data-action="toggle-admin-job-sidebar" aria-label="${state.adminJobSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}" title="${state.adminJobSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}">${icon(state.adminJobSidebarCollapsed ? "panel" : "menu")}</button>
                </div>
                <nav class="admin-side-nav" aria-label="岗位模块">
                    ${tabs.map((item) => `
                        <button
                            class="admin-side-nav-item ${state.selectedJobTab === item.id ? "active" : ""}"
                            data-action="job-tab"
                            data-tab="${escapeHtml(item.id)}"
                            title="${escapeHtml(item.label)}"
                        >
                            ${icon(item.icon)}
                            <span>${escapeHtml(item.label)}</span>
                            ${item.badge ? `<b>${escapeHtml(item.badge)}</b>` : ""}
                        </button>
                    `).join("")}
                </nav>
            </aside>
            <main class="admin-job-content">
                ${renderJobTab(job)}
            </main>
        </div>
    `;
}

function renderJobTab(job) {
    if (state.selectedJobTab === "jd") {
        const editing = isEditing("jd");
        return `
            <div class="panel jd-workspace-panel">
                <div class="section-head">
                    <div>
                        <h2>岗位 JD</h2>
                    </div>
                    ${editing ? `
                        <div class="action-row">
                            <button class="ghost small" data-action="cancel-admin-edit">取消</button>
                            <button class="primary small" type="submit" form="admin-jd-form">保存岗位</button>
                        </div>
                    ` : `
                        <button class="ghost small" data-action="edit-admin-section" data-section="jd">编辑岗位</button>
                    `}
                </div>
                ${editing ? `
                    <form class="admin-edit-form jd-edit-form" id="admin-jd-form" data-form="admin-jd">
                        <div class="form-grid three compact-fields">
                            <label>岗位名称<input name="title" value="${escapeHtml(job.title)}" /></label>
                            <label>地点<input name="location" value="${escapeHtml(job.location)}" placeholder="例如：北京/线上" /></label>
                            <label>岗位类型<input name="mode" value="${escapeHtml(job.mode)}" placeholder="例如：实习/全职" /></label>
                        </div>
                        <label>岗位 JD<textarea name="jd" rows="12">${escapeHtml(job.jd.join("\n"))}</textarea></label>
                    </form>
                ` : `
                    <div class="jd-meta-row">
                        <span>${escapeHtml(job.location || "地点未填写")}</span>
                        <span>${escapeHtml(job.mode || "类型未填写")}</span>
                    </div>
                    <div class="jd-readable-body job-jd-markdown">
                        ${renderJobMarkdownHtml(job.jd)}
                    </div>
                `}
            </div>
        `;
    }
    if (state.selectedJobTab === "knowledge") {
        const editing = isEditing("knowledge");
        return `
            <div class="panel knowledge-workspace-panel">
                <div class="section-head">
                    <h2>JD 知识库</h2>
                    ${editing ? `
                        <div class="action-row">
                            <button class="ghost small" data-action="cancel-admin-edit">取消</button>
                            <button class="primary small" type="submit" form="admin-knowledge-form">保存知识库</button>
                        </div>
                    ` : `
                        <div class="action-row">
                            <button class="ghost small" data-action="edit-admin-section" data-section="knowledge">编辑知识库</button>
                            <input class="hidden-file-input" type="file" data-input="job-knowledge-file" data-job-id="${escapeHtml(job.id)}" accept=".pdf,.doc,.docx,.md,.txt,.xlsx,.csv" />
                            <button class="primary small" data-action="upload-job-knowledge" data-job-id="${job.id}">${icon("upload")}上传资料</button>
                        </div>
                    `}
                </div>
                ${editing ? `
                    <form class="admin-edit-form knowledge-edit-form" id="admin-knowledge-form" data-form="admin-knowledge">
                        ${job.knowledge.map((item, index) => `
                            <div class="knowledge-edit-row">
                                <label>资料名称<input name="knowledgeName_${index}" value="${escapeHtml(item.name)}" /></label>
                                <label>用途说明<input name="knowledgeUsage_${index}" value="${escapeHtml(item.usage)}" /></label>
                                ${chip(knowledgeStatusLabel(item.status), tone(item.status))}
                                <button class="ghost small danger-lite" type="button" data-action="delete-job-knowledge" data-source-id="${escapeHtml(item.id)}">删除</button>
                            </div>
                        `).join("") || `
                            <div class="empty-inline">
                                <strong>还没有岗位资料</strong>
                                <span>先上传资料，解析完成后可在这里调整名称和用途。</span>
                            </div>
                        `}
                    </form>
                ` : job.knowledge.length ? `
                    <div class="mini-list">
                        ${job.knowledge.map((item) => `
                            <div>
                                <strong>${escapeHtml(item.name)}</strong>
                                ${chip(knowledgeStatusLabel(item.status), tone(item.status))}
                                <span>${item.chunks ? `${item.chunks} 个片段` : "待处理"} · ${escapeHtml(item.usage)}</span>
                            </div>
                        `).join("")}
                    </div>
                ` : `
                    <div class="empty-inline">
                        <strong>还没有岗位资料</strong>
                        <span>上传岗位资料后，候选人问答、AI 面试追问和审核报告都可以引用它。</span>
                    </div>
                `}
            </div>
        `;
    }
    if (state.selectedJobTab === "rubric") return renderScreeningRules(job);
    if (state.selectedJobTab === "applications") {
        return state.activeApplicationId ? renderReviewWorkspace(job) : renderApplicationsTable(job);
    }
    if (state.selectedJobTab === "interviews") return renderJobInterviewManager(job);
    if (state.selectedJobTab === "communication") return renderAdminCommunication(job);
    state.selectedJobTab = "jd";
    return renderJobTab(job);
}

function reorderRecentTemplate(templates = []) {
    if (!state.adminRecentTemplateId) return templates;
    const recent = templates.find((template) => template.id === state.adminRecentTemplateId);
    if (!recent) return templates;
    return [recent, ...templates.filter((template) => template.id !== recent.id)];
}

function templateLabelKey(value = "") {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function renderScreeningRules(job) {
    const templates = reorderRecentTemplate(store.screeningRuleTemplates || []);
    const rules = job.screeningRules || [];
    const editingRule = rules.find((rule) => rule.id === state.adminEditingRuleId);
    const editingTemplates = state.adminEditingRuleTemplates;
    const ruleTone = (type) => type === "硬性门槛" || type === "硬性要求" ? "danger" : type === "风险核验" || type === "风险项" ? "warning" : "info";
    return `
        <div class="panel rubric-workspace-panel">
            <div class="section-head">
                <div>
                    <h2>评价体系</h2>
                </div>
                ${chip(`${(job.screeningRules || []).length} 条评价项`, "info")}
            </div>
            <div class="rubric-list">
                ${rules.map((rule) => `
                    <div class="rubric-row">
                        ${chip(rule.type, ruleTone(rule.type))}
                        <div>
                            <strong>${escapeHtml(rule.label)}</strong>
                            <span>${escapeHtml(rule.value)}</span>
                        </div>
                        <div class="rubric-actions">
                            <button class="ghost small" data-action="edit-rubric-rule" data-rule-id="${escapeHtml(rule.id)}">编辑</button>
                            <button class="ghost small danger-lite" data-action="delete-rubric-rule" data-rule-id="${escapeHtml(rule.id)}">删除</button>
                        </div>
                    </div>
                `).join("") || `
                    <div class="empty-inline">
                        <strong>还没有评价项</strong>
                        <span>从标准维度里选择，或在下方添加自定义评价项。</span>
                    </div>
                `}
            </div>
            <form class="admin-edit-form rubric-form" data-form="admin-rubric">
                <input type="hidden" name="ruleId" value="${escapeHtml(editingRule?.id || "")}" />
                <div class="rubric-template-head">
                    <div>
                        <strong>标准维度</strong>
                        <span>点击维度会加入当前岗位；自定义项可以沉淀成全局标准。</span>
                    </div>
                    <button class="ghost small" type="button" data-action="toggle-rubric-template-edit">${editingTemplates ? "完成" : "编辑标准"}</button>
                </div>
                <div class="preset-row rubric-template-row ${editingTemplates ? "editing" : ""}">
                    ${templates.map((template) => {
                        const exists = rules.some((rule) => rule.label === template.label);
                        return `
                            <span class="template-chip-wrap">
                                <button type="button" class="ghost small ${exists ? "active" : ""} ${template.id === state.adminRecentTemplateId ? "recent" : ""}" data-action="add-rubric-preset" data-template-id="${escapeHtml(template.id)}" data-type="${escapeHtml(template.type)}" data-label="${escapeHtml(template.label)}" data-value="${escapeHtml(template.value)}" ${exists || editingTemplates ? "disabled" : ""}>
                                    ${escapeHtml(template.label)}
                                </button>
                                ${editingTemplates ? `<button type="button" class="template-remove" data-action="delete-rubric-template" data-template-id="${escapeHtml(template.id)}" aria-label="删除 ${escapeHtml(template.label)}">×</button>` : ""}
                            </span>
                        `;
                    }).join("") || `<span class="section-note">还没有全局标准，先在下方填写并沉淀为标准。</span>`}
                </div>
                <label>规则类型
                    <select name="type">
                        <option ${editingRule?.type === "硬性门槛" || editingRule?.type === "硬性要求" ? "selected" : ""}>硬性门槛</option>
                        <option ${editingRule?.type === "评价维度" || editingRule?.type === "加分项" ? "selected" : ""}>评价维度</option>
                        <option ${editingRule?.type === "风险核验" || editingRule?.type === "风险项" ? "selected" : ""}>风险核验</option>
                    </select>
                </label>
                <label>评价项名称<input name="label" value="${escapeHtml(editingRule?.label || "业务实用性")}" /></label>
                <label>补充说明<input name="value" value="${escapeHtml(editingRule?.value || "请写清楚模型应如何判断、哪些情况需要重点核验。")}" /></label>
                <div class="action-row">
                    <button class="primary" type="submit">${editingRule ? "保存评价项" : "添加评价项"}</button>
                    <button class="ghost" type="button" data-action="save-rubric-template" data-form="admin-rubric">沉淀为标准</button>
                    ${editingRule ? `<button class="ghost" type="button" data-action="cancel-rubric-edit">取消编辑</button>` : ""}
                </div>
            </form>
        </div>
    `;
}

function consultationCandidateName(session) {
    return session.candidate?.name || "候选人";
}

function consultationCandidateTail(session) {
    return session.candidate?.idTail ? `****${String(session.candidate.idTail).slice(-4)}` : "";
}

function messageKindLabel(kind) {
    const map = {
        ai_answer: "AI 咨询",
        candidate_question: "候选人",
        admin_reply: "招聘者",
        system_notice: "系统",
        interview_invite: "AI 面试",
        material_request: "补材料",
        hr_request: "联系招聘者",
    };
    return map[kind] || "消息";
}

function formatMessageTime(value) {
    return formatDateTime(value);
}

function adminMessageClass(message) {
    if (isSystemNoticeMessage(message)) return "notice";
    if (message.who === "candidate") return "candidate";
    return "admin";
}

function adminMessageToneClass(message) {
    if (isSystemNoticeMessage(message)) return "notice";
    if (message.who === "candidate") return "candidate";
    if (message.who === "admin") return "admin";
    return "assistant";
}

function adminSenderMeta(message = {}, session = {}) {
    if (message.who === "candidate") {
        const cand = session.candidate || {id: session.candidateId || session.id, name: consultationCandidateName(session)};
        return {
            label: consultationCandidateName(session),
            badge: messageKindLabel(message.kind),
            ...candidateAvatarMeta(cand),
        };
    }
    if (message.who === "admin") {
        return {
            label: "招聘者",
            badge: message.kind === "interview_invite" ? "AI 面试" : message.kind === "material_request" ? "补材料" : "招聘者",
            avatarClass: "recruiter",
            avatar: "招",
        };
    }
    if (["system_notice", "interview_invite", "material_request"].includes(message.kind)) {
        return {
            label: "系统",
            badge: messageKindLabel(message.kind),
            avatarClass: "system",
            avatar: icon("message"),
        };
    }
    return {
        label: "AI分身",
        badge: "AI",
        avatarClass: "assistant",
        avatar: "AI",
    };
}

function renderAdminChatAvatar(meta) {
    const style = meta.avatarStyle ? ` style="${escapeHtml(meta.avatarStyle)}"` : "";
    return `<span class="admin-chat-avatar ${escapeHtml(meta.avatarClass)}"${style}>${meta.avatar}</span>`;
}

function renderAdminChatMessage(message, session) {
    const meta = adminSenderMeta(message, session);
    const rowClass = adminMessageClass(message);
    if (rowClass === "notice") {
        return `
            <div class="admin-message-row notice">
                <div class="admin-system-notice">
                    <small>${escapeHtml(messageKindLabel(message.kind))} · ${escapeHtml(formatMessageTime(message.createdAt))}</small>
                    <div class="chat-markdown admin-message-text">${renderChatMarkdownHtml(adminMessageTextForDisplay(message, session))}</div>
                    ${message.needsAdmin && !message.resolvedAt ? `<span>等待招聘者处理</span>` : ""}
                </div>
            </div>
        `;
    }
    const toneClass = adminMessageToneClass(message);
    return `
        <div class="admin-message-row ${rowClass}">
            ${renderAdminChatAvatar(meta)}
            <div class="admin-message-bubble ${toneClass}">
                <small>
                    <strong>${escapeHtml(meta.label)}</strong>
                    <em>${escapeHtml(meta.badge)}</em>
                    <span>${escapeHtml(formatMessageTime(message.createdAt))}</span>
                </small>
                <div class="chat-markdown admin-message-text">${renderChatMarkdownHtml(adminMessageTextForDisplay(message, session))}</div>
                ${message.needsAdmin && !message.resolvedAt ? `<span>等待招聘者处理</span>` : ""}
            </div>
        </div>
    `;
}

function applicationForConsultation(session) {
    if (!session?.candidateId || !session?.jobId) return null;
    return applicationsForCandidate(session.candidateId).find((app) => app.jobId === session.jobId) || null;
}

function renderAdminMessageActions(selected) {
    const app = applicationForConsultation(selected);
    const open = state.adminMessageActionMenuId === selected.id;
    if (!app) {
        return `
            <div class="admin-chat-action-wrap">
                <button type="button" class="ghost admin-chat-plus" data-action="toggle-admin-message-actions" data-session-id="${escapeHtml(selected.id)}" aria-label="更多消息动作">+</button>
                ${open ? `
                    <div class="admin-chat-action-menu">
                        <span class="admin-chat-action-note">候选人投递后，可在这里发送补材料或 AI 面试。</span>
                    </div>
                ` : ""}
            </div>
        `;
    }
    const sending = state.adminSendingInterviewAppId === app.id;
    const interviewActionLabel = app.aiInterview?.status && app.aiInterview.status !== "not_started"
        ? "重发 AI 面试"
        : "发送 AI 面试";
    return `
        <div class="admin-chat-action-wrap">
            <button type="button" class="ghost admin-chat-plus" data-action="toggle-admin-message-actions" data-session-id="${escapeHtml(selected.id)}" aria-label="更多消息动作">+</button>
            ${open ? `
                <div class="admin-chat-action-menu">
                    <button type="button" data-action="admin-chat-request-materials" data-session-id="${escapeHtml(selected.id)}" data-app-id="${escapeHtml(app.id)}">${icon("upload")}要求补材料</button>
                    <button type="button" data-action="admin-chat-send-interview" data-session-id="${escapeHtml(selected.id)}" data-app-id="${escapeHtml(app.id)}" ${sending ? "disabled" : ""}>${icon("video")}${escapeHtml(sending ? "发送中..." : interviewActionLabel)}</button>
                </div>
            ` : ""}
        </div>
    `;
}

function renderAdminCommunication(job) {
    ensureAdminConsultationsLoaded(job.id);
    const sessions = adminConsultationSessions(job.id);
    const selected = sessions.find((session) => session.id === state.adminSelectedConsultationId)
        || sessions[0];
    const messages = selected?.messages || [];
    return `
        <div class="admin-communication-grid">
            <section class="panel communication-list-panel">
                <div class="message-workbench-head">
                    <h2>消息</h2>
                    <button class="ghost small icon-button" data-action="refresh-admin-consultations" data-job-id="${escapeHtml(job.id)}" aria-label="刷新消息" title="刷新消息">${icon("refresh")}</button>
                </div>
                ${state.adminConsultationError ? `<div class="form-error">${escapeHtml(state.adminConsultationError)}</div>` : ""}
                ${state.adminConsultationLoading ? `<p class="section-note">正在同步消息记录...</p>` : ""}
                <div class="consultation-session-list">
                    ${sessions.map((session) => {
                        const last = session.messages?.[session.messages.length - 1] || {};
                        const active = selected?.id === session.id;
                        const avatarCandidate = session.candidate || {
                            id: session.candidateId || session.id,
                            name: consultationCandidateName(session),
                        };
                        return `
                            <button class="consultation-session-row ${active ? "active" : ""}" data-action="open-admin-consultation" data-session-id="${escapeHtml(session.id)}">
                                ${renderCandidateAvatar(avatarCandidate, "session-avatar")}
                                <span class="session-main">
                                    <strong>${escapeHtml(consultationCandidateName(session))}</strong>
                                    <small>${escapeHtml(last.text ? adminMessageTextForDisplay(last, session) : "暂无消息")}</small>
                                </span>
                                <span class="session-side">
                                    <em>${escapeHtml(formatMessageTime(last.createdAt || session.lastMessageAt))}</em>
                                    ${session.adminUnreadCount ? `<b>${session.adminUnreadCount}</b>` : ""}
                                </span>
                            </button>
                        `;
                    }).join("") || `
                        <div class="admin-chat-empty-note">还没有聊天哦，去和候选人聊聊吧😊</div>
                    `}
                </div>
            </section>
            <section class="panel admin-chat-panel">
                ${selected ? `
                    <div class="section-head">
                        <div>
                            <h2>${escapeHtml(consultationCandidateName(selected))}</h2>
                            <p>${escapeHtml(job.title)} · ${escapeHtml(consultationCandidateTail(selected) || "候选人消息记录")}</p>
                        </div>
                        <button class="ghost small" data-action="mark-admin-consultation-read" data-session-id="${escapeHtml(selected.id)}">标记已读</button>
                    </div>
                    <div class="admin-chat-log" data-admin-session-id="${escapeHtml(selected.id)}">
                        ${messages.map((message) => renderAdminChatMessage(message, selected)).join("") || `<p class="section-note">暂无消息内容。</p>`}
                    </div>
                    <form class="admin-edit-form admin-reply-form" data-form="admin-consultation-reply">
                        <input type="hidden" name="sessionId" value="${escapeHtml(selected.id)}" />
                        <div class="admin-chat-composer">
                            ${renderAdminMessageActions(selected)}
                            <textarea name="text" rows="2" placeholder="回复候选人..."></textarea>
                            <button class="primary" type="submit">${icon("send")}发送</button>
                        </div>
                    </form>
                ` : `
                    <div class="admin-chat-empty-note">还没有聊天哦，去和候选人聊聊吧😊</div>
                `}
            </section>
        </div>
    `;
}

function renderApplicationsTable(job) {
    const rows = applicationsForJob(job.id);
    const visibleRows = filteredAdminApplicationsForExport(rows);
    const visibleIds = new Set(visibleRows.map((app) => app.id));
    const selectedIds = state.adminApplicationExportSelectedIds.filter((id) => visibleIds.has(id));
    const exportCount = selectedIds.length || visibleRows.length;
    const exportFilter = normalizeAdminApplicationExportFilter(state.adminApplicationExportFilter);
    return `
        <div class="panel">
            <div class="section-head">
                <h2>候选人队列</h2>
                <div class="app-export-toolbar">
                    <label>
                        <span class="sr-only">筛选候选人进度</span>
                        <select data-input="admin-export-filter">
                            ${adminApplicationExportOptions.map(([value, label]) => `
                                <option value="${escapeHtml(value)}" ${exportFilter === value ? "selected" : ""}>${escapeHtml(label)}</option>
                            `).join("")}
                        </select>
                    </label>
                    <button class="ghost small" data-action="select-visible-export-apps">选择全部</button>
                    <button class="ghost small" data-action="clear-export-apps">清空选择</button>
                    <a class="ghost small" href="${escapeHtml(adminJobReportsExportUrl(job))}" download>导出 ${escapeHtml(exportCount)} 人资料和报告</a>
                </div>
            </div>
            <div class="data-table app-table app-export-table">
                <div class="table-row table-head">
                    <span>选择</span><span>候选人</span><span>投递快照</span><span>进度</span><span>操作</span>
                </div>
                ${visibleRows.map((app) => {
                    const cand = candidateById(app.candidateId);
                    const checked = selectedIds.includes(app.id);
                    const secondaryAction = adminSecondaryActionForApplication(app);
                    return `
                        <div class="table-row">
                            <span><input type="checkbox" data-input="admin-export-app" value="${escapeHtml(app.id)}" ${checked ? "checked" : ""} aria-label="选择${escapeHtml(cand?.name || "候选人")}导出" /></span>
                            <span>${renderCandidateNameCell(cand)}</span>
                            <span>${escapeHtml(materialSnapshotSummary(app))}<small>${escapeHtml(app.materialSnapshot?.lockedAt || "投递时锁定")}</small></span>
                            <span>${renderAdminProgressCell(app)}</span>
                            <span>
                                <div class="row-actions">
                                    <button class="ghost small" data-action="open-review" data-app-id="${escapeHtml(app.id)}" data-candidate-id="${escapeHtml(cand?.id || "")}">查看详情</button>
                                    <button class="ghost small" data-action="open-admin-message-for-app" data-app-id="${escapeHtml(app.id)}" data-candidate-id="${escapeHtml(cand?.id || "")}">发消息</button>
                                    ${secondaryAction ? `
                                        <button class="ghost small" data-action="${escapeHtml(secondaryAction.action)}" data-app-id="${escapeHtml(app.id)}" data-candidate-id="${escapeHtml(cand?.id || "")}">
                                            ${escapeHtml(secondaryAction.label)}
                                        </button>
                                    ` : ""}
                                </div>
                            </span>
                        </div>
                    `;
                }).join("") || `
                    <div class="empty-inline">
                        ${helperMark("mini")}
                        <strong>当前筛选下没有候选人</strong>
                        <span>换一个筛选条件再导出。</span>
                    </div>
                `}
            </div>
        </div>
    `;
}

function renderJobInterviewManager(job) {
    const rows = applicationsForJob(job.id);
    const aiRows = rows.filter((app) => (
        hasInterviewPlan(app)
        || app.interviewStatus !== "not_started"
        || app.aiInterview
        || ["待 AI 面试", "待审核", "已通过", "已拒绝", "暂缓"].includes(app.status)
    ));
    const settings = jobInterviewSettings(job, aiRows);
    const settingsSaved = Boolean(job.interviewSettingsConfigured);
    const demoPreviewUrl = adminInterviewPreviewUrl(job, settings);
    return `
        <div class="panel interview-admin-panel">
            <div class="section-head">
                <div>
                    <h2>面试配置</h2>
                </div>
                ${chip(settingsSaved ? "已保存" : "未保存", settingsSaved ? "success" : "info")}
            </div>
            <form class="interview-settings-form" data-form="admin-interview-settings">
                <div class="interview-config-strip editable interview-config-single-row">
                    <label>
                        <span>正式面试题量</span>
                        <input type="number" name="questionCount" min="3" max="10" step="1" value="${escapeHtml(settings.questionCount)}" />
                    </label>
                    <label>
                        <span>每题追问上限</span>
                        <input type="number" name="maxFollowUpsPerQuestion" min="0" max="5" step="1" value="${escapeHtml(settings.maxFollowUpsPerQuestion)}" />
                    </label>
                    <label>
                        <span>邀请有效期（天）</span>
                        <input type="number" name="invitationValidDays" min="1" max="14" step="1" value="${escapeHtml(settings.invitationValidDays)}" />
                    </label>
                </div>
                <div class="interview-settings-actions">
                    <span>${escapeHtml(settingsSaved ? "保存后的配置会用于后续新生成的 AI 面试邀请；已完成会话不回改。" : "公共版默认使用浏览器演示面试服务，可通过 Provider 接口替换。")}</span>
                    <button class="primary small" type="submit">保存面试配置</button>
                </div>
            </form>
            <div class="interview-admin-preview">
                <div class="interview-preview-toolbar">
                    <div>
                        <h3>AI 面试间预览</h3>
                        <p class="section-note">这里直接嵌入候选人会看到的面试间；候选人需先连接面试官，连接完成后才能开始。</p>
                    </div>
                    ${demoPreviewUrl ? `<a class="ghost small" href="${escapeHtml(demoPreviewUrl)}" target="_blank" rel="noopener">单独打开</a>` : ""}
                </div>
                ${demoPreviewUrl ? `
                    <iframe
                        class="interview-preview-frame"
                        title="AI 面试间预览"
                        src="${escapeHtml(demoPreviewUrl)}"
                        allow="microphone; camera; autoplay; fullscreen"
                        scrolling="no"
                        data-admin-interview-preview-frame
                    ></iframe>
                ` : `
                    <div class="empty-inline">
                        <strong>demo 服务未配置</strong>
                        <span>启动独立浏览器面试服务后，这里会显示合成候选人预览。</span>
                    </div>
                `}
            </div>
        </div>
    `;
}

function renderReviewWorkspace(job) {
    const rows = applicationsForJob(job.id);
    const selected = rows.find((app) => app.id === state.activeApplicationId) || rows[0];
    if (!selected) {
        return `
            <div class="panel assistant-panel">
                ${helperMark("mini")}
                <h2>暂无投递</h2>
                <p>候选人投递后，这里会展示材料快照、评价报告、AI 面试引用和人工决策。</p>
            </div>
        `;
    }
    state.activeApplicationId = selected.id;
    return `
        <div class="application-detail-shell">
            <header class="application-candidate-heading">
                <h2>${escapeHtml(candidateById(selected.candidateId)?.name || "候选人")}</h2>
            </header>
            ${renderApplicationDossier(selected)}
        </div>
    `;
}

function renderMaterialFileActions(app, kind, item) {
    const fileUrl = adminMaterialFileUrl(app, kind, item);
    if (!fileUrl) {
        return `<span class="section-note">${item?.storageKey ? "快照文件暂无原件标记" : "本项没有可打开原文件"}</span>`;
    }
    return `
        <a class="ghost small" href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener">查看</a>
        <a class="ghost small" href="${escapeHtml(fileUrl)}" download>下载</a>
    `;
}

function renderPortfolioResourceActions(app, portfolio) {
    const attachments = portfolio?.attachmentRefs || [];
    const screenshots = portfolio?.screenshots || [];
    const links = [
        ...attachments.map((item, index) => ({
            label: item.name || item.fileName || `附件 ${index + 1}`,
            url: adminPortfolioRefFileUrl(app, portfolio, "portfolio-attachment", item, index),
        })),
        ...screenshots.map((item, index) => ({
            label: item.name || `截图 ${index + 1}`,
            url: adminPortfolioRefFileUrl(app, portfolio, "portfolio-screenshot", item, index),
        })),
    ].filter((item) => item.url);
    if (!links.length) return `<span class="section-note">结构化作品详情</span>`;
    return links.slice(0, 3).map((item) => `
        <a class="ghost small" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.label)}</a>
    `).join("");
}

function renderAdminMaterialPackItem(app, kind, item, fallbackName = "") {
    const name = materialDisplayName(item) || fallbackName;
    const isPortfolio = kind === "portfolio";
    const stateInfo = candidateMaterialState(item);
    const detail = candidateMaterialDetailText(
        item,
        item?.summary || item?.detail || item?.oneLineValue || item?.usage || item?.evidence || "随投递快照固定保存",
    );
    return `
        <div class="material-pack-item ${isPortfolio ? "portfolio-pack-item" : ""}">
            <div>
                <strong>${escapeHtml(name || fallbackName || "未选择材料")}</strong>
                <span>${escapeHtml(detail)}</span>
            </div>
            <div class="material-pack-meta">
                ${chip(stateInfo.label, stateInfo.tone)}
                <small>${escapeHtml(fileFormatFromName(item?.name || item?.fileName || item?.title || ""))}</small>
            </div>
            <div class="material-link-actions">
                ${isPortfolio ? `
                    <button class="ghost small" data-action="open-admin-portfolio-detail" data-app-id="${escapeHtml(app.id)}" data-portfolio-id="${escapeHtml(item.id)}">查看作品详情</button>
                    ${renderPortfolioResourceActions(app, item)}
                ` : renderMaterialFileActions(app, kind, item)}
            </div>
        </div>
    `;
}

function renderApplicationMaterialPack(app) {
    const snapshot = app.materialSnapshot || {};
    const resumeItems = snapshot.resumeItem ? [snapshot.resumeItem] : [];
    const portfolioItems = snapshot.portfolioItems || [];
    const knowledgeItems = snapshot.knowledgeItems || [];
    const snapshotState = applicationMaterialSnapshotState(app);
    return `
        <section class="dossier-section material-pack-panel">
            <div class="section-head">
                <div>
                    <h3>材料快照</h3>
                </div>
                ${chip(snapshotState.label, snapshotState.tone)}
            </div>
            <div class="material-pack-grid">
                <section>
                    <h4>简历</h4>
                    ${resumeItems.length
                        ? resumeItems.map((item) => renderAdminMaterialPackItem(app, "resume", item, snapshot.resumeName)).join("")
                        : `<div class="material-pack-empty">未选择简历</div>`}
                </section>
                <section>
                    <h4>作品</h4>
                    ${portfolioItems.length
                        ? portfolioItems.map((item) => renderAdminMaterialPackItem(app, "portfolio", item)).join("")
                        : `<div class="material-pack-empty">未选择作品</div>`}
                </section>
                <section>
                    <h4>可选知识库</h4>
                    ${knowledgeItems.length
                        ? knowledgeItems.map((item) => renderAdminMaterialPackItem(app, "knowledge", item)).join("")
                        : `<div class="material-pack-empty">未选择可选知识库</div>`}
                </section>
            </div>
        </section>
    `;
}

function adminApplicationProgressSteps(app) {
    const stage = adminStageForApplication(app);
    const materialState = applicationMaterialSnapshotState(app);
    const prescreenDone = ["completed", "overridden"].includes(app.prescreen?.status)
        || ["初筛完成", "待 AI 面试", "待审核", "已通过", "已拒绝", "暂缓"].includes(app.status)
        || Boolean(app.interviewStatus && app.interviewStatus !== "not_started");
    const interviewDone = applicationAiInterviewCompleted(app);

    let prescreenStep = {
        title: "初筛",
        status: "waiting",
        tone: "info",
        label: "待初筛",
        detail: "材料整理完成后进入初筛。",
    };
    if (stage.label === "材料处理中") {
        prescreenStep = {title: "初筛", status: "waiting", tone: "warning", label: "待材料", detail: stage.detail};
    }
    else if (stage.label === "材料失败") {
        prescreenStep = {title: "初筛", status: "current", tone: "danger", label: "材料失败", detail: stage.detail};
    }
    else if (app.status === "证据已生成") {
        prescreenStep = {title: "初筛", status: "current", tone: "info", label: "待初筛", detail: "证据已生成，等待评价报告。"};
    }
    else if (app.status === "初筛中" || app.prescreen?.status === "processing") {
        prescreenStep = {title: "初筛", status: "current", tone: "warning", label: "初筛中", detail: stage.detail};
    }
    else if (app.status === "初筛失败" || app.prescreen?.status === "failed") {
        prescreenStep = {title: "初筛", status: "current", tone: "danger", label: "初筛失败", detail: stage.detail};
    }
    else if (prescreenDone || app.prescreen) {
        const warningStage = ["证据待核验", "待候选人更新"].includes(stage.label);
        const failedStage = stage.label === "初筛不建议继续";
        prescreenStep = {
            title: "初筛",
            status: "done",
            tone: failedStage ? "danger" : warningStage ? "warning" : prescreenTone(app),
            label: failedStage ? "未通过" : warningStage ? "待核验" : prescreenLabel(app),
            detail: app.prescreen?.summary || stage.detail || "初筛报告已生成。",
        };
    }

    let interviewStep = {
        title: "AI 面试",
        status: "waiting",
        tone: "info",
        label: prescreenStep.status === "done" ? "自动准备中" : "未邀请",
        detail: prescreenStep.status === "done" ? "初筛通过后系统会自动发送邀请。" : "等待初筛结果。",
    };
    if (aiInterviewExpired(app)) {
        interviewStep = {
            title: "AI 面试",
            status: "current",
            tone: "warning",
            label: "已过期",
            detail: "邀请已过期，可重新发起或联系候选人。",
        };
    }
    else if (app.interviewStatus === "failed") {
        interviewStep = {title: "AI 面试", status: "current", tone: "danger", label: "失败", detail: app.aiInterview?.error || "AI 面试状态异常，可重新发起。"};
    }
    else if (interviewDone) {
        const aiStage = aiInterviewDecisionStage(app);
        interviewStep = {
            title: "AI 面试",
            status: "done",
            tone: aiStage?.tone || "success",
            label: aiStage?.label || "已完成",
            detail: aiStage?.detail || app.reviewReportRef || app.aiInterview?.reportRef || (app.aiInterview?.completedAt ? `完成于 ${formatDateTime(app.aiInterview.completedAt)}` : "报告已回写。"),
        };
    }
    else if (app.interviewStatus === "in_progress") {
        interviewStep = {title: "AI 面试", status: "current", tone: "info", label: "进行中", detail: "候选人正在进行 AI 面试。"};
    }
    else if (app.interviewStatus === "pending") {
        interviewStep = {
            title: "AI 面试",
            status: "current",
            tone: "info",
            label: app.aiInterview?.forced ? "已强制邀请" : "已邀请",
            detail: app.aiInterview?.expiresAt
                ? `有效期至 ${formatDateTime(app.aiInterview.expiresAt)}。`
                : aiInterviewResponseLabel(app),
        };
    }
    else if (stage.label === "待发 AI 面试" || app.status === "待 AI 面试") {
        interviewStep = {
            title: "AI 面试",
            status: "current",
            tone: "warning",
            label: "自动准备中",
            detail: hasInterviewPlan(app) ? "面试计划已准备，正在发送邀请。" : "系统正在生成面试计划并发送邀请。",
        };
    }
    else if (stage.label === "初筛不建议继续") {
        interviewStep = {title: "AI 面试", status: "waiting", tone: "danger", label: "未进入", detail: "初筛未建议继续。"};
    }

    return [
        {
            title: "投递",
            status: "done",
            tone: materialState.tone,
            label: materialState.label,
            detail: app.materialSnapshot?.lockedAt ? `投递于 ${formatDateTime(app.materialSnapshot.lockedAt)}。` : materialSnapshotSummary(app),
        },
        prescreenStep,
        interviewStep,
    ];
}

function renderApplicationProgressPanel(app) {
    const steps = adminApplicationProgressSteps(app);
    return `
        <section class="dossier-section progress-panel">
            <div class="section-head">
                <div>
                    <h3>流程进度</h3>
                </div>
                ${chip(adminStageForApplication(app).label, adminStageForApplication(app).tone)}
            </div>
            <div class="application-progress-list">
                ${steps.map((step, index) => `
                    <div class="application-progress-step ${escapeHtml(step.status)}">
                        <span class="progress-index">${index + 1}</span>
                        <div>
                            <div class="progress-step-head">
                                <strong>${escapeHtml(step.title)}</strong>
                                ${chip(step.label || (step.status === "done" ? "已完成" : step.status === "current" ? "当前" : "等待"), step.tone)}
                            </div>
                            <p>${escapeHtml(step.detail || "暂无")}</p>
                        </div>
                    </div>
                `).join("")}
            </div>
        </section>
    `;
}

function applicationReviewStages(app) {
    const [, prescreenStep, aiStep] = adminApplicationProgressSteps(app);
    const aiDone = applicationAiInterviewCompleted(app);
    return [
        {
            ...prescreenStep,
            reportKind: "prescreen",
            reportLabel: "查看初筛报告",
        },
        {
            ...aiStep,
            reportKind: "ai",
            reportLabel: aiDone ? "查看完整面评" : "查看 AI 报告",
        },
    ];
}

function compactReviewText(text = "", fallback = "暂无", limit = 150) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return fallback;
    return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function applicationReviewNarrative(app) {
    const completed = applicationAiInterviewCompleted(app);
    const finalSuggestion = finalHumanInterviewRecommendation(app);
    const aiReport = normalizedAiInterviewReport(app);
    const quality = aiReport.interviewQuality || {};
    const prescreenSummary = app.prescreen?.summary || app.screen || "初筛还没有形成明确结论";
    const prescreenRisks = cleanAiReportList([...(app.prescreen?.risks || []), ...(app.prescreen?.gaps || [])], null, 3);
    const qualityText = [
        quality.answeredQuestions || quality.plannedQuestions ? `有效覆盖 ${quality.answeredQuestions || 0}/${quality.plannedQuestions || 0} 题` : "",
        quality.status || "",
        quality.emptyAnswerCount ? `空白/过短 ${quality.emptyAnswerCount} 轮` : "",
        quality.endedReason || "",
    ].filter(Boolean).join("；");
    const aiSummary = aiReport.summary || finalSuggestion.reason || "";
    const aiRisks = cleanAiReportList(aiReport.riskNotes, null, 3);
    const prescreenPassed = /通过|推荐|面试/.test(prescreenLabel(app)) && !/未通过|不建议/.test(prescreenLabel(app));
    const conclusionLabel = completed ? finalSuggestion.label : prescreenLabel(app);
    const conclusionTone = completed ? finalSuggestion.tone : prescreenTone(app);
    const narrative = completed
        ? `已完成初筛和 AI 面试。初筛判断：${prescreenSummary}${aiSummary ? `；AI 面试补充：${aiSummary}` : ""}。当前综合结论为「${finalSuggestion.label}」。${aiRisks.length ? `重点风险：${aiRisks.join("；")}` : ""}`
        : app.prescreen?.recommendation === "不建议继续"
            ? `目前停留在初筛阶段，结论为「初筛未通过」。${prescreenSummary}。${prescreenRisks.length ? `主要风险：${prescreenRisks.join("；")}` : "现有材料不足以支撑进入 AI 面试。"}`
            : app.prescreen
                ? `已完成初筛，结论为「${prescreenLabel(app)}」。${prescreenSummary}。${prescreenPassed ? "后续适合通过 AI 面试继续核验本人贡献、项目真实性和岗位匹配细节。" : "如果继续推进，需要先补足初筛暴露的关键证据。"}${prescreenRisks.length ? `重点关注：${prescreenRisks.join("；")}` : ""}`
                : "候选人已提交本次投递材料，系统正在整理证据并生成初筛判断。";
    return {
        completed,
        finalSuggestion,
        aiReport,
        quality,
        qualityText,
        prescreenSummary,
        prescreenRisks,
        aiSummary,
        aiRisks,
        conclusionLabel,
        conclusionTone,
        narrative,
    };
}

function renderApplicationStageRail(app) {
    const stages = applicationReviewStages(app);
    return `
        <aside class="review-stage-rail" aria-label="候选人阶段进度">
            <div class="review-stage-list">
                ${stages.map((step, index) => `
                    <div class="review-stage-item ${escapeHtml(step.status)}">
                        <span class="review-stage-dot">${index + 1}</span>
                        <div>
                            <div class="review-stage-title">
                                <strong>${escapeHtml(step.title)}</strong>
                                ${chip(step.label || "等待", step.tone)}
                            </div>
                            <p>${escapeHtml(compactReviewText(step.detail, "暂无", 92))}</p>
                            ${renderApplicationStageActions(app, step)}
                        </div>
                    </div>
                `).join("")}
            </div>
        </aside>
    `;
}

function renderApplicationStageActions(app, step) {
    const actions = [
        `<button class="ghost small review-stage-report" data-action="open-application-report" data-report="${escapeHtml(step.reportKind)}" data-app-id="${escapeHtml(app.id)}">${escapeHtml(step.reportLabel)}</button>`,
    ];
    const primary = adminPrimaryApplicationAction(app);
    if (step.reportKind === "ai") {
        if (primary.action === "start-interview") {
            actions.push(`<button class="primary small" data-action="${escapeHtml(primary.action)}" data-app-id="${escapeHtml(app.id)}">${escapeHtml(primary.label)}</button>`);
        }
    }
    return `<div class="review-stage-actions">${actions.join("")}</div>`;
}

function renderReviewMaterialStatusRow(label, value, stateInfo) {
    return `
        <div class="review-material-row">
            <span class="review-material-label">${escapeHtml(label)}</span>
            <span>${escapeHtml(value || "未选择")}</span>
            ${chip(stateInfo.label, stateInfo.tone)}
        </div>
    `;
}

function renderApplicationMaterialSummary(app) {
    return renderApplicationMaterialPack(app);
}

function applicationReportButtonState(app, reportKind) {
    const narrative = applicationReviewNarrative(app);
    if (reportKind === "prescreen") {
        return {
            title: "初筛报告",
            meta: prescreenLabel(app),
            tone: prescreenTone(app),
            detail: compactReviewText(narrative.prescreenSummary, "查看匹配判断、关键依据和继续核验点。", 86),
            iconName: "file",
        };
    }
    if (reportKind === "ai") {
        const completed = narrative.completed;
        return {
            title: "AI 面试综合报告",
            meta: completed ? narrative.finalSuggestion.label : interviewLabel(app),
            tone: completed ? narrative.finalSuggestion.tone : tone(interviewLabel(app)),
            detail: completed
                ? compactReviewText(narrative.aiSummary, "含综合面评、能力观察、追问和完整记录。", 86)
                : "面试完成后自动补充面评和完整记录。",
            iconName: "video",
        };
    }
    return applicationReportButtonState(app, "prescreen");
}

function renderApplicationReportButton(app, reportKind) {
    const config = applicationReportButtonState(app, reportKind);
    return `
        <button class="report-launch-button ${escapeHtml(reportKind)}" data-action="open-application-report" data-report="${escapeHtml(reportKind)}" data-app-id="${escapeHtml(app.id)}">
            <span class="report-launch-icon">${icon(config.iconName)}</span>
            <span class="report-launch-copy">
                <strong>${escapeHtml(config.title)}</strong>
                <small>${escapeHtml(config.detail)}</small>
            </span>
            ${chip(config.meta, config.tone)}
        </button>
    `;
}

function renderApplicationReportsDock(app) {
    const primary = adminPrimaryApplicationAction(app);
    const secondary = adminApplicationSecondaryActions(app);
    const isLoading = state.adminMatchReportLoadingAppId === app.id;
    return `
        <section class="review-report-dock panel">
            <div class="review-card-head compact">
                <div>
                    <span class="eyebrow">报告</span>
                    <h3>报告与面评</h3>
                </div>
            </div>
            <div class="review-report-buttons">
                ${renderApplicationReportButton(app, "prescreen")}
                ${renderApplicationReportButton(app, "ai")}
            </div>
            <div class="review-card-actions report-dock-actions">
                ${primary.action
                    ? `<button class="primary small" data-action="${escapeHtml(primary.action)}" data-app-id="${escapeHtml(app.id)}">${escapeHtml(primary.label)}</button>`
                    : chip(primary.label, primary.tone)}
                ${secondary.map((item) => `<button class="${escapeHtml(item.variant)} small" data-action="${escapeHtml(item.action)}" data-app-id="${escapeHtml(app.id)}">${escapeHtml(item.label)}</button>`).join("")}
                <button class="ghost small" data-action="refresh-match-report" data-app-id="${escapeHtml(app.id)}" ${isLoading ? "disabled" : ""}>${isLoading ? "生成中..." : "刷新初筛"}</button>
            </div>
            ${state.adminMatchReportError && state.adminMatchReportLoadingAppId !== app.id ? `<div class="form-error">${escapeHtml(state.adminMatchReportError)}</div>` : ""}
        </section>
    `;
}

function renderPrescreenSummaryCard(app) {
    const cached = state.adminMatchReportsByApp[app.id];
    const isLoading = state.adminMatchReportLoadingAppId === app.id;
    const markdown = cached?.markdown || "";
    const narrative = applicationReviewNarrative(app);
    const risks = narrative.prescreenRisks;
    const rows = reportItemsFromRules(app).slice(0, 3);
    const primary = adminPrimaryApplicationAction(app);
    const prescreenPrimary = ["override-prescreen-pass", "rerun-prescreen", "retry-evidence"].includes(primary.action)
        ? primary
        : null;
    const prescreenSecondary = adminApplicationSecondaryActions(app)
        .filter((item) => !["start-interview", "generate-interview-plan"].includes(item.action));
    return `
        <section class="review-summary-card panel">
            <div class="review-card-head">
                <div>
                    <span class="eyebrow">初筛</span>
                    <h3>初筛摘要</h3>
                </div>
            </div>
            <p class="review-card-lead">${escapeHtml(compactReviewText(narrative.prescreenSummary, "等待初筛报告。", 180))}</p>
            <div class="review-mini-list">
                ${risks.length ? risks.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : rows.map((item) => `<span>${escapeHtml(item.title || item.text)}</span>`).join("") || "<span>暂无额外风险提示</span>"}
            </div>
            <div class="review-card-actions">
                ${prescreenPrimary ? `<button class="primary small" data-action="${escapeHtml(prescreenPrimary.action)}" data-app-id="${escapeHtml(app.id)}">${escapeHtml(prescreenPrimary.label)}</button>` : ""}
                ${prescreenSecondary.map((item) => `<button class="${escapeHtml(item.variant)} small" data-action="${escapeHtml(item.action)}" data-app-id="${escapeHtml(app.id)}">${escapeHtml(item.label)}</button>`).join("")}
                <button class="ghost small" data-action="open-application-report" data-report="prescreen" data-app-id="${escapeHtml(app.id)}">${markdown ? "查看完整初筛" : "查看初筛详情"}</button>
                <button class="ghost small" data-action="refresh-match-report" data-app-id="${escapeHtml(app.id)}" ${isLoading ? "disabled" : ""}>${isLoading ? "生成中..." : "刷新报告"}</button>
                <a class="ghost small" href="${escapeHtml(adminMatchReportMdUrl(app))}" download>导出 Markdown</a>
            </div>
            ${state.adminMatchReportError && state.adminMatchReportLoadingAppId !== app.id ? `<div class="form-error">${escapeHtml(state.adminMatchReportError)}</div>` : ""}
        </section>
    `;
}

function renderInterviewTraceSummary(app) {
    const fullTrace = app.aiInterview?.fullTrace || app.aiInterview?.demo?.fullTrace;
    const traceTurns = fullTrace?.turns || [];
    if (!fullTrace) {
        return `<p class="section-note">暂无完整面试记录。</p>`;
    }
    return `
        <div class="mini-list compact">
            <div><strong>会话</strong><span>${escapeHtml(fullTrace.sessionId || app.aiInterview?.demo?.sessionId || app.interviewSessionRef || "已回写")}</span></div>
            <div><strong>轮次</strong><span>${escapeHtml(traceTurns.length || fullTrace.turnCount || 0)}</span></div>
            <div><strong>完成时间</strong><span>${escapeHtml(fullTrace.completedAt ? formatDateTime(fullTrace.completedAt) : app.aiInterview?.completedAt ? formatDateTime(app.aiInterview.completedAt) : "已完成")}</span></div>
        </div>
        <div class="interview-trace-list">
            ${traceTurns.length ? traceTurns.slice(0, 20).map((turn, index) => `
                <div class="interview-trace-turn">
                    ${chip(`Q${index + 1}`, "info")}
                    <div>
                        <strong>${escapeHtml(turn.questionText || turn.question || "面试问题")}</strong>
                        <p>${escapeHtml(turn.answerText || turn.answer || "未记录回答文本")}</p>
                    </div>
                </div>
            `).join("") : `<p class="section-note">完整 session 已保存，可按会话引用回看。</p>`}
        </div>
    `;
}

function renderAiInterviewSummaryCard(app) {
    const narrative = applicationReviewNarrative(app);
    const report = narrative.aiReport;
    const completed = narrative.completed;
    const primary = adminPrimaryApplicationAction(app);
    const aiPrimary = primary.action === "start-interview" ? primary : null;
    const aiSecondary = adminApplicationSecondaryActions(app)
        .filter((item) => ["start-interview", "generate-interview-plan"].includes(item.action));
    return `
        <section class="review-summary-card review-ai-card panel">
            <div class="review-card-head">
                <div>
                    <span class="eyebrow">AI 面试</span>
                    <h3>面试概况</h3>
                </div>
            </div>
            ${completed ? `
                <p class="review-card-lead">${escapeHtml(compactReviewText(report.decisionReason || report.summary || "AI 面试报告已回写。", "AI 面试报告已回写。", 180))}</p>
                <div class="review-mini-list">
                    <span>${escapeHtml(narrative.qualityText || "已完成面试")}</span>
                    ${(report.followUpQuestions || []).slice(0, 2).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
                </div>
                <div class="review-card-actions">
                    <button class="ghost small" data-action="open-application-report" data-report="ai" data-app-id="${escapeHtml(app.id)}">查看完整面评</button>
                    ${aiSecondary.map((item) => `<button class="${escapeHtml(item.variant)} small" data-action="${escapeHtml(item.action)}" data-app-id="${escapeHtml(app.id)}">${escapeHtml(item.label)}</button>`).join("")}
                </div>
            ` : `
                <p class="review-card-lead">${escapeHtml(aiInterviewExpired(app) ? "邀请已过期，重新发起后才会生成面试报告。" : app.interviewStatus === "pending" ? aiInterviewResponseLabel(app) : "AI 面试完成后会在这里形成面评摘要。")}</p>
                <div class="review-card-actions">
                    ${aiPrimary ? `<button class="primary small" data-action="${escapeHtml(aiPrimary.action)}" data-app-id="${escapeHtml(app.id)}">${escapeHtml(aiPrimary.label)}</button>` : ""}
                    ${aiSecondary.map((item) => `<button class="${escapeHtml(item.variant)} small" data-action="${escapeHtml(item.action)}" data-app-id="${escapeHtml(app.id)}">${escapeHtml(item.label)}</button>`).join("")}
                </div>
            `}
            <details class="review-full-detail interview-record-detail">
                <summary>完整面试记录</summary>
                ${renderInterviewTraceSummary(app)}
            </details>
        </section>
    `;
}

function reportItemsFromRules(app) {
    const matched = app.prescreen?.matchedRequirements || [];
    const positiveItem = (item = {}) => {
        const text = `${item.title || item.requirement || ""} ${item.text || item.result || ""}`;
        if (/命中\/待确认|待确认|待验证|需核验|未明确|未提供|未写|缺少|缺失|不足|无法|不满足|风险|模板|占位/.test(text)) return false;
        return /命中|符合|具备|明确|完成|有/.test(item.text || item.result || "");
    };
    if (matched.length) {
        return matched.map((item) => ({
            title: item.requirement,
            text: item.result || "命中要求",
            tone: /风险|不足|缺/.test(item.result || "") ? "warning" : "success",
        })).filter(positiveItem);
    }
    return (app.prescreen?.rules || []).map((rule) => ({
        title: rule.label,
        text: rule.result || rule.reason,
        tone: rule.tone || tone(rule.result),
    })).filter(positiveItem);
}

function compactReportItems(items = []) {
    return items
        .flatMap((item) => Array.isArray(item) ? item : [item])
        .filter(Boolean)
        .map((item) => typeof item === "string" ? {title: item, text: "", tone: "info"} : item)
        .filter((item) => item.title || item.text)
        .slice(0, 12);
}

function renderReportList(title, items, emptyText, customClass = "") {
    const rows = compactReportItems(items);
    return `
        <section class="match-report-card ${escapeHtml(customClass)}">
            <h4>${escapeHtml(title)}</h4>
            ${rows.length ? rows.map((item) => `
                <div class="match-report-row">
                    ${chip(item.badge || (item.tone === "danger" ? "风险" : item.tone === "warning" ? "待核验" : "命中"), item.tone || "info")}
                    <div>
                        <strong>${escapeHtml(item.title || "证据")}</strong>
                        ${item.text ? `<p>${escapeHtml(item.text)}</p>` : ""}
                    </div>
                </div>
            `).join("") : `<p class="section-note">${escapeHtml(emptyText)}</p>`}
        </section>
    `;
}

function renderComprehensiveReport(app) {
    const completed = applicationAiInterviewCompleted(app);
    const finalSuggestion = finalHumanInterviewRecommendation(app);
    const aiReport = normalizedAiInterviewReport(app);
    const prescreenSummary = app.prescreen?.summary || app.screen || "初筛还没有形成明确结论";
    const prescreenRisks = narrativeText([...(app.prescreen?.risks || []), ...(app.prescreen?.gaps || [])], "");
    const aiSummary = aiReport.summary || finalSuggestion.reason || "AI 面试报告已回写";
    const aiRisks = narrativeText(aiReport.riskNotes, "");
    const prescreenPassed = /通过|推荐|面试/.test(prescreenLabel(app)) && !/未通过|不建议/.test(prescreenLabel(app));
    const conclusionLabel = completed ? finalSuggestion.label : prescreenLabel(app);
    const conclusionTone = completed ? finalSuggestion.tone : prescreenTone(app);
    const narrative = completed
        ? `候选人已完成初筛和 AI 面试。初筛阶段的主要判断是：${prescreenSummary}；AI 面试阶段的补充判断是：${aiSummary}。综合来看，当前结论为「${finalSuggestion.label}」。${aiRisks ? `需要注意的是，${aiRisks}` : "目前没有额外高风险补充。"}`
        : app.prescreen?.recommendation === "不建议继续"
            ? `候选人目前停留在初筛阶段，结论为「初筛未通过」。${prescreenSummary}。${prescreenRisks ? `主要风险是：${prescreenRisks}` : "现有材料还不足以支撑进入 AI 面试。"}`
            : app.prescreen
                ? `候选人目前已完成初筛，结论为「${prescreenLabel(app)}」。${prescreenSummary}。${prescreenPassed ? "后续适合通过 AI 面试继续核验本人贡献、项目真实性和岗位匹配细节。" : "如果要继续推进，需要先补足初筛中暴露的关键证据。"}${prescreenRisks ? `重点关注：${prescreenRisks}` : ""}`
                : "候选人已提交本次投递材料，系统正在整理证据并生成初筛判断。综合报告会随着初筛和 AI 面试结果自动更新。";
    return `
        <section class="dossier-section match-report-panel comprehensive-report-panel">
            <div class="section-head">
                <div>
                    <h3>综合报告</h3>
                    <p class="section-note">把初筛和 AI 面试结果合在一起，形成阶段性候选人画像。</p>
                </div>
                ${chip(conclusionLabel, conclusionTone)}
            </div>
            <div class="comprehensive-summary">
                <strong>${escapeHtml(completed ? "最终综合判断" : "阶段综合判断")}</strong>
                <span>${escapeHtml(narrative)}</span>
            </div>
        </section>
    `;
}

function renderMarkdownInline(text = "") {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function markdownHeadingTone(text = "") {
    const normalized = String(text || "").replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
    if (/初筛面评|AI面试面评|综合报告|面试综合报告/.test(normalized)) return "title";
    if (/评分|总览|总分|得分/.test(normalized)) return "score";
    if (/综合评价|整体评价|综合判断|结论/.test(normalized)) return "summary";
    if (/维度|自我介绍|学历学业|学历|学业|实习|项目|比赛|作品|产品职能|开放性|课外生活|综合素质/.test(normalized)) return "dimension";
    if (/优势|亮点|加分|正向|有效信号/.test(normalized)) return "strength";
    if (/风险|缺口|短板|不足|待核验|问题/.test(normalized)) return "risk";
    if (/建议|核验|追问|后续/.test(normalized)) return "suggestion";
    if (/完整|问答|记录|系统记录/.test(normalized)) return "record";
    return "neutral";
}

function markdownHeadingAttrs(text = "") {
    const tone = markdownHeadingTone(text);
    return ` class="markdown-heading markdown-heading-${tone}"`;
}

function renderJobMarkdownHtml(linesOrText = "", fallback = "还没有填写岗位 JD。") {
    const markdown = Array.isArray(linesOrText)
        ? linesOrText.join("\n")
        : String(linesOrText || "");
    return renderChatMarkdownHtml(markdown.trim() || fallback);
}

function parseMarkdownTableRow(line = "") {
    const trimmed = String(line || "").trim();
    if (!trimmed.includes("|")) return [];
    return trimmed
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line = "") {
    const cells = parseMarkdownTableRow(line);
    return Boolean(cells.length) && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function renderMarkdownTableHtml(headers = [], rows = []) {
    const normalizedHeaders = headers.map((header) => String(header || "").replace(/\s+/g, ""));
    const scoreIndex = normalizedHeaders.findIndex((header) => /得分|分数|评分/.test(header));
    const dimensionIndex = normalizedHeaders.findIndex((header) => /维度|项目|能力/.test(header));
    const isScoreTable = scoreIndex >= 0 && dimensionIndex >= 0;
    const cellValue = (row, index) => row[index] || "";
    const tableClass = `markdown-report-table${isScoreTable ? " markdown-score-table" : ""}`;
    return `
        <div class="markdown-report-table-wrap">
            <table class="${tableClass}">
                <thead>
                    <tr>${headers.map((header) => `<th>${renderMarkdownInline(header)}</th>`).join("")}</tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            ${headers.map((header, index) => {
                                const raw = cellValue(row, index);
                                const content = renderMarkdownInline(raw);
                                if (isScoreTable && index === scoreIndex) {
                                    return `<td><span class="markdown-score-pill">${content}</span></td>`;
                                }
                                if (isScoreTable && index === dimensionIndex) {
                                    return `<td><strong>${content}</strong></td>`;
                                }
                                return `<td>${content}</td>`;
                            }).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function renderChatMarkdownHtml(markdown = "") {
    const lines = String(markdown || "").split(/\r?\n/);
    const html = [];
    let listType = "";
    const closeList = () => {
        if (!listType) return;
        html.push(`</${listType}>`);
        listType = "";
    };
    const openList = (type) => {
        if (listType === type) return;
        closeList();
        html.push(`<${type}>`);
        listType = type;
    };
    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const markerLine = line.trimStart();
        if (!line.trim()) {
            closeList();
            continue;
        }
        if (markerLine.startsWith("### ")) {
            closeList();
            html.push(`<h4>${renderMarkdownInline(markerLine.slice(4))}</h4>`);
            continue;
        }
        if (markerLine.startsWith("## ")) {
            closeList();
            html.push(`<h4>${renderMarkdownInline(markerLine.slice(3))}</h4>`);
            continue;
        }
        if (markerLine.startsWith("# ")) {
            closeList();
            html.push(`<h4>${renderMarkdownInline(markerLine.slice(2))}</h4>`);
            continue;
        }
        if (markerLine.startsWith("> ")) {
            closeList();
            html.push(`<blockquote>${renderMarkdownInline(markerLine.slice(2))}</blockquote>`);
            continue;
        }
        if (/^[-*]\s+/.test(markerLine)) {
            openList("ul");
            html.push(`<li>${renderMarkdownInline(markerLine.replace(/^[-*]\s+/, ""))}</li>`);
            continue;
        }
        if (/^\d+\.\s+/.test(markerLine)) {
            openList("ol");
            html.push(`<li>${renderMarkdownInline(markerLine.replace(/^\d+\.\s+/, ""))}</li>`);
            continue;
        }
        closeList();
        html.push(`<p>${renderMarkdownInline(line)}</p>`);
    }
    closeList();
    return html.join("") || "<p></p>";
}

function renderMarkdownReportHtml(markdown = "") {
    const lines = String(markdown || "").split(/\r?\n/);
    const html = [];
    let listType = "";
    let collapsedSectionOpen = false;
    const isCollapsedReportSection = (line = "") => /^##\s+(?:[^\u4e00-\u9fffA-Za-z0-9]+\s*)?完整(?:面试|问答)记录/.test(line);
    const closeList = () => {
        if (!listType) return;
        html.push(`</${listType}>`);
        listType = "";
    };
    const openList = (type) => {
        if (listType === type) return;
        closeList();
        html.push(`<${type}>`);
        listType = type;
    };
    const closeCollapsedSection = () => {
        if (!collapsedSectionOpen) return;
        closeList();
        html.push("</div></details>");
        collapsedSectionOpen = false;
    };
    for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index];
        const line = rawLine.trimEnd();
        const markerLine = line.trimStart();
        if (!line.trim()) {
            closeList();
            continue;
        }
        if (collapsedSectionOpen && markerLine.startsWith("## ") && !isCollapsedReportSection(markerLine)) {
            closeCollapsedSection();
        }
        if (markerLine.startsWith("### ")) {
            closeList();
            const heading = markerLine.slice(4);
            html.push(`<h4${markdownHeadingAttrs(heading)}>${renderMarkdownInline(heading)}</h4>`);
            continue;
        }
        if (markerLine.startsWith("## ")) {
            closeList();
            if (isCollapsedReportSection(markerLine)) {
                html.push(`<details class="markdown-report-collapse"><summary>${renderMarkdownInline(markerLine.slice(3))}</summary><div class="markdown-report-collapse-body">`);
                collapsedSectionOpen = true;
                continue;
            }
            const heading = markerLine.slice(3);
            html.push(`<h3${markdownHeadingAttrs(heading)}>${renderMarkdownInline(heading)}</h3>`);
            continue;
        }
        if (markerLine.startsWith("# ")) {
            closeList();
            const heading = markerLine.slice(2);
            html.push(`<h2${markdownHeadingAttrs(heading)}>${renderMarkdownInline(heading)}</h2>`);
            continue;
        }
        if (markerLine.startsWith("> ")) {
            closeList();
            html.push(`<blockquote>${renderMarkdownInline(markerLine.slice(2))}</blockquote>`);
            continue;
        }
        if (parseMarkdownTableRow(markerLine).length >= 2 && isMarkdownTableSeparator(lines[index + 1] || "")) {
            closeList();
            const headers = parseMarkdownTableRow(markerLine);
            const rows = [];
            index += 2;
            for (; index < lines.length; index += 1) {
                const rowLine = lines[index].trim();
                if (!rowLine || parseMarkdownTableRow(rowLine).length < 2) {
                    index -= 1;
                    break;
                }
                rows.push(parseMarkdownTableRow(rowLine));
            }
            html.push(renderMarkdownTableHtml(headers, rows));
            continue;
        }
        if (/^[-*]\s+/.test(markerLine)) {
            openList("ul");
            html.push(`<li>${renderMarkdownInline(markerLine.replace(/^[-*]\s+/, ""))}</li>`);
            continue;
        }
        if (/^\d+\.\s+/.test(markerLine)) {
            openList("ol");
            html.push(`<li>${renderMarkdownInline(markerLine.replace(/^\d+\.\s+/, ""))}</li>`);
            continue;
        }
        closeList();
        html.push(`<p>${renderMarkdownInline(line)}</p>`);
    }
    closeList();
    closeCollapsedSection();
    return html.join("");
}

function hasFullInterviewTraceSection(markdown = "") {
    return /^##\s+(?:[^\u4e00-\u9fffA-Za-z0-9]+\s*)?完整(?:面试|问答)记录/m.test(String(markdown || ""));
}

function aiInterviewTraceMarkdown(app = {}, existingMarkdown = "") {
    if (hasFullInterviewTraceSection(existingMarkdown)) return "";
    const fullTrace = app.aiInterview?.fullTrace || app.aiInterview?.demo?.fullTrace;
    const traceTurns = Array.isArray(fullTrace?.turns) ? fullTrace.turns : [];
    if (!fullTrace && !traceTurns.length) return "";
    const meta = [
        "- 完整问答用于复核原始回答，不替代上面的面评摘要。",
        `- 轮次：${traceTurns.length || fullTrace?.turnCount || 0}`,
        fullTrace?.completedAt
            ? `- 完成时间：${formatDateTime(fullTrace.completedAt)}`
            : app.aiInterview?.completedAt
                ? `- 完成时间：${formatDateTime(app.aiInterview.completedAt)}`
                : "",
        fullTrace?.sessionId ? `- 会话 ID：${fullTrace.sessionId}` : "",
    ].filter(Boolean);
    const turns = traceTurns.length
        ? traceTurns.slice(0, 50).flatMap((turn, index) => [
            `### Q${index + 1}`,
            `**面试官：** ${turn.questionText || turn.question || "面试问题"}`,
            "",
            `**候选人：** ${turn.answerText || turn.answer || "未记录回答文本"}`,
            "",
        ])
        : ["- 完整 session 已保存，但当前快照未带逐轮问答文本。"];
    return [
        "## 🗂 完整问答记录",
        ...meta,
        "",
        ...turns,
    ].join("\n");
}

function appendAiInterviewTraceMarkdown(markdown = "", app = {}) {
    const traceMarkdown = aiInterviewTraceMarkdown(app, markdown);
    if (!traceMarkdown) return markdown;
    return `${String(markdown || "").trim()}\n\n${traceMarkdown}`.trim();
}

function renderInformationMatchReport(app) {
    const cached = state.adminMatchReportsByApp[app.id];
    const isLoading = state.adminMatchReportLoadingAppId === app.id;
    const markdown = cached?.markdown || "";
    return `
        <section class="dossier-section match-report-panel">
            <div class="section-head">
                <div>
                    <h3>初筛报告</h3>
                    <p class="section-note">材料匹配、证据可信度和风险缺口。</p>
                </div>
                <div class="report-export-actions">
                    ${chip(prescreenLabel(app), prescreenTone(app))}
                    <button class="ghost small" data-action="refresh-match-report" data-app-id="${escapeHtml(app.id)}" ${isLoading ? "disabled" : ""}>${isLoading ? "生成中..." : "刷新报告"}</button>
                    <a class="ghost small" href="${escapeHtml(adminMatchReportMdUrl(app))}" download>导出 Markdown</a>
                </div>
            </div>
            ${state.adminMatchReportError && state.adminMatchReportLoadingAppId !== app.id ? `<div class="form-error">${escapeHtml(state.adminMatchReportError)}</div>` : ""}
            ${markdown ? `
                <article class="markdown-report-body">
                    ${renderMarkdownReportHtml(markdown)}
                </article>
            ` : `
                <div class="markdown-report-note">
                    ${helperMark("mini")}
                    <strong>${isLoading ? "正在生成 Markdown 报告" : "报告等待生成"}</strong>
                    <p>${isLoading ? "正在读取 Application 快照、证据包和 AI 面试状态。" : "打开详情后会自动生成；也可以手动刷新。"}</p>
                </div>
            `}
        </section>
    `;
}

function narrativeText(parts = [], fallback = "暂无") {
    const rows = cleanAiReportList(parts.filter(Boolean), null, 3);
    if (!rows.length) return fallback;
    const text = rows.join("；");
    return /[。.!？?]$/.test(text) ? text : `${text}。`;
}

function renderNarrativeBullets(items = [], emptyText = "暂无", limit = 3) {
    const rows = cleanAiReportList(items, null, limit);
    return rows.length
        ? `<ul>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : `<p>${escapeHtml(emptyText)}</p>`;
}

function renderAiInterviewSupplementReport(app) {
    const completed = applicationAiInterviewCompleted(app);
    const report = normalizedAiInterviewReport(app);
    const fullTrace = app.aiInterview?.fullTrace || app.aiInterview?.demo?.fullTrace;
    const traceTurns = fullTrace?.turns || [];
    const quality = report.interviewQuality || {};
    const questionRows = (report.questionAssessments || []).map((item, index) => ({
        title: item.dimension || item.competency || item.question || item.title || `问题 ${index + 1}`,
        question: item.question || item.title || item.dimension || `问题 ${index + 1}`,
        signal: item.signal || item.summary || item.assessment || item.evaluation || item.comment || item.answerQuality || "暂未形成明确有效信号",
        risk: item.risk || item.gap || "暂无明确风险",
        score: item.score,
        tone: item.tone || "info",
        badge: item.status || "评价",
    }));
    const qualityText = [
        quality.answeredQuestions || quality.plannedQuestions ? `有效覆盖 ${quality.answeredQuestions || 0}/${quality.plannedQuestions || 0} 题` : "",
        quality.status || "",
        quality.emptyAnswerCount ? `空白/过短 ${quality.emptyAnswerCount} 轮` : "",
        quality.endedReason || "",
    ].filter(Boolean).join("；");
    const performanceText = narrativeText([report.summary, qualityText, ...report.bonusNotes.slice(0, 2)], "");
    const riskText = narrativeText([report.decisionReason, ...report.riskNotes.slice(0, 3)], "");
    return `
        <section class="dossier-section match-report-panel ai-interview-report-panel">
            <div class="section-head">
                <div>
                    <h3>AI 面试报告</h3>
                    <p class="section-note">面试后的结论、质量、风险核验和人工追问建议。</p>
                </div>
                ${chip(completed ? "已完成" : interviewLabel(app), completed ? "success" : tone(interviewLabel(app)))}
            </div>
            ${completed ? `
                <div class="ai-supplement-report narrative-report">
                    <div class="narrative-summary">
                        ${chip(report.recommendation, humanRecommendationTone(report.recommendation))}
                        <strong>${escapeHtml(report.decisionReason || report.summary || report.recommendation)}</strong>
                        <span>${escapeHtml([
                            qualityText,
                            report.reportRef ? `引用：${report.reportRef}` : "",
                            app.aiInterview?.completedAt ? `完成于 ${formatDateTime(app.aiInterview.completedAt)}` : "",
                        ].filter(Boolean).join(" · "))}</span>
                    </div>
                    ${performanceText ? `<section class="narrative-section">
                        <h4>表现评价</h4>
                        <p>${escapeHtml(performanceText)}</p>
                    </section>` : ""}
                    ${riskText ? `<section class="narrative-section">
                        <h4>风险判断</h4>
                        <p>${escapeHtml(riskText)}</p>
                    </section>` : ""}
                    ${report.followUpQuestions.length ? `<section class="narrative-section">
                        <h4>建议人工追问</h4>
                        ${renderNarrativeBullets(report.followUpQuestions, "", 3)}
                    </section>` : ""}
                    ${questionRows.length ? `<section class="narrative-section">
                        <h4>逐题摘要</h4>
                        <div class="question-assessment-list">
                            ${questionRows.slice(0, 5).map((item, index) => `
                                <div class="question-assessment-card">
                                    <div class="question-assessment-head">
                                        ${chip(`Q${index + 1}`, "info")}
                                        <strong>${escapeHtml(item.title)}</strong>
                                        ${item.score != null ? `<span>${escapeHtml(`${item.score} 分`)}</span>` : ""}
                                    </div>
                                    <dl>
                                        <div><dt>问题</dt><dd>${escapeHtml(item.question)}</dd></div>
                                        <div><dt>信号</dt><dd>${escapeHtml(item.signal)}</dd></div>
                                        <div><dt>风险</dt><dd>${escapeHtml(item.risk)}</dd></div>
                                    </dl>
                                </div>
                            `).join("")}
                        </div>
                    </section>` : ""}
                    ${fullTrace ? `
                        <details class="interview-trace-panel">
                            <summary>面试全量留痕</summary>
                            <div class="mini-list compact">
                                <div><strong>会话</strong><span>${escapeHtml(fullTrace.sessionId || app.aiInterview?.demo?.sessionId || app.interviewSessionRef || "已回写")}</span></div>
                                <div><strong>轮次</strong><span>${escapeHtml(traceTurns.length || fullTrace.turnCount || 0)}</span></div>
                                <div><strong>完成时间</strong><span>${escapeHtml(fullTrace.completedAt ? formatDateTime(fullTrace.completedAt) : app.aiInterview?.completedAt ? formatDateTime(app.aiInterview.completedAt) : "已完成")}</span></div>
                            </div>
                            <div class="interview-trace-list">
                                ${traceTurns.length ? traceTurns.slice(0, 20).map((turn, index) => `
                                    <div class="interview-trace-turn">
                                        ${chip(`Q${index + 1}`, "info")}
                                        <div>
                                            <strong>${escapeHtml(turn.questionText || turn.question || "面试问题")}</strong>
                                            <p>${escapeHtml(turn.answerText || turn.answer || "未记录回答文本")}</p>
                                        </div>
                                    </div>
                                `).join("") : `<p class="section-note">完整 session 已保存，可按会话引用回看。</p>`}
                            </div>
                        </details>
                    ` : ""}
                </div>
            ` : `
                <div class="markdown-report-note">
                    ${helperMark("mini")}
                    <strong>尚未完成 AI 面试</strong>
                    <p>${escapeHtml(aiInterviewExpired(app) ? "邀请已过期，重新发起后才会生成面试报告。" : app.interviewStatus === "pending" ? aiInterviewResponseLabel(app) : "完成后会在这里显示面试报告。")}</p>
                </div>
            `}
        </section>
    `;
}

function adminPrimaryApplicationAction(app) {
    const stage = adminStageForApplication(app);
    if (stage.label === "材料失败") return {label: "重试材料解析", action: "retry-evidence"};
    if (stage.label === "评价失败") return {label: "重跑初筛", action: "rerun-prescreen"};
    if (stage.label === "面试已过期") return {label: "重新发起 AI 面试", action: "start-interview"};
    if (stage.label === "待发 AI 面试") return {label: adminInterviewActionLabel(app), action: "start-interview"};
    if (app.interviewStatus === "pending" || stage.label === "等待 AI 面试" || stage.label === "已强制邀面") {
        return {label: app.aiInterview?.forced ? "已强制邀面" : "AI 面试已邀请", tone: "info"};
    }
    if (applicationAiInterviewCompleted(app)) {
        const aiStage = aiInterviewDecisionStage(app);
        return {label: aiStage?.label || "AI 面试已完成", tone: aiStage?.tone || "info"};
    }
    if (stage.label === "待人审") return {label: "初筛待核验", tone: "warning"};
    if (stage.label === "初筛不建议继续") return {label: "初筛未通过", tone: "danger"};
    return {label: stage.label, tone: stage.tone};
}

function adminApplicationSecondaryActions(app) {
    const stage = adminStageForApplication(app);
    const primary = adminPrimaryApplicationAction(app);
    const actions = [];
    const add = (label, action, when = true, variant = "ghost") => {
        if (!when || primary.action === action || actions.some((item) => item.action === action)) return;
        actions.push({label, action, variant});
    };
    add("通过初筛", "override-prescreen-pass", canOverridePrescreen(app), "primary");
    add("重新生成邀请链接", "start-interview", adminInterviewMissingPublicLink(app));
    return actions;
}

function canOverridePrescreen(app) {
    const stage = adminStageForApplication(app);
    if (["材料处理中", "待评价", "评价中", "等待 AI 面试", "待发 AI 面试"].includes(stage.label)) return false;
    return ["初筛不建议继续", "证据待核验", "待候选人更新", "评价失败", "待人审"].includes(stage.label)
        || /不建议|未通过|待核验|失败|补材料|信息不足/.test(prescreenLabel(app));
}

function renderApplicationActionStrip(app) {
    const stage = adminStageForApplication(app);
    const primary = adminPrimaryApplicationAction(app);
    const secondary = adminApplicationSecondaryActions(app);
    return `
        <section class="application-action-strip panel">
            <div>
                <span class="eyebrow">当前进度</span>
                <strong>${escapeHtml(stage.label)}</strong>
                <p>${escapeHtml(stage.detail)}</p>
            </div>
            <div class="application-action-buttons">
                <div class="action-row compact">
                    ${primary.action
                        ? `<button class="primary small" data-action="${escapeHtml(primary.action)}" data-app-id="${escapeHtml(app.id)}">${escapeHtml(primary.label)}</button>`
                        : chip(primary.label, primary.tone || stage.tone)}
                </div>
                ${secondary.length ? `
                    <div class="action-row compact secondary-actions">
                        ${secondary.map((item) => `<button class="${escapeHtml(item.variant)} small" data-action="${escapeHtml(item.action)}" data-app-id="${escapeHtml(app.id)}">${escapeHtml(item.label)}</button>`).join("")}
                    </div>
                ` : ""}
            </div>
        </section>
    `;
}

function renderApplicationDecisionPanel(app) {
    return `
        <section class="dossier-section match-report-panel human-decision-panel">
            <div class="section-head">
                <div>
                    <h3>人工决定</h3>
                    <p class="section-note">记录这次投递的最终处理结果。</p>
                </div>
                ${chip(reviewLabel(app), tone(reviewLabel(app)))}
            </div>
            <form class="admin-edit-form decision-form" data-form="human-decision">
                <input type="hidden" name="applicationId" value="${escapeHtml(app.id)}" />
                <label>人工备注<input name="note" value="${escapeHtml(app.humanDecision?.note || "")}" placeholder="记录通过、拒绝或暂缓的原因" /></label>
                <div class="action-row">
                    <button class="primary small" name="decision" value="通过" data-decision="通过" type="submit">通过</button>
                    <button class="danger small" name="decision" value="拒绝" data-decision="拒绝" type="submit">拒绝</button>
                    <button class="ghost small" name="decision" value="暂缓" data-decision="暂缓" type="submit">暂缓</button>
                </div>
            </form>
        </section>
    `;
}

function renderPrescreenFullReport(app) {
    const cached = state.adminMatchReportsByApp[app.id];
    const isLoading = state.adminMatchReportLoadingAppId === app.id;
    const markdown = cached?.markdown
        || state.adminApplicationReportMarkdownByKey[applicationReportCacheKey(app.id, "prescreen")]
        || "";
    if (markdown) {
        return `<article class="markdown-report-body">${renderMarkdownReportHtml(markdown)}</article>`;
    }
    return `
        <div class="markdown-report-note">
            ${helperMark("mini")}
            <strong>${isLoading ? "正在生成 Markdown 报告" : "模型报告还没有返回"}</strong>
            <p>${escapeHtml(isLoading ? "正在读取 Application 快照、证据包和模型初筛结果。" : "请稍后刷新，或检查初筛 worker / 大模型调用日志。")}</p>
        </div>
    `;
}

function renderApplicationMarkdownReport(app, reportKind = "prescreen") {
    const kind = ["prescreen", "ai"].includes(reportKind) ? reportKind : "prescreen";
    const key = applicationReportCacheKey(app.id, kind);
    const fallbackMarkdown = kind === "prescreen" ? state.adminMatchReportsByApp[app.id]?.markdown : "";
    const markdown = fallbackMarkdown || state.adminApplicationReportMarkdownByKey[key] || "";
    const isLoading = state.adminApplicationReportLoadingKey === key;
    if (markdown) {
        const reportMarkdown = kind === "ai" ? appendAiInterviewTraceMarkdown(markdown, app) : markdown;
        return `<article class="markdown-report-body">${renderMarkdownReportHtml(reportMarkdown)}</article>`;
    }
    if (state.adminApplicationReportError && !isLoading) {
        return `
            <div class="markdown-report-note">
                ${helperMark("mini")}
                <strong>报告读取失败</strong>
                <p>${escapeHtml(state.adminApplicationReportError)}</p>
            </div>
        `;
    }
    return `
        <div class="markdown-report-note">
            ${helperMark("mini")}
            <strong>${isLoading ? "正在读取 Markdown 报告" : "报告等待生成"}</strong>
            <p>${escapeHtml(isLoading ? "正在同步最新面试状态和报告正文。" : "打开后会自动读取；如果长时间没有内容，可以刷新后重试。")}</p>
        </div>
    `;
}

function renderAiInterviewFullReview(app) {
    return renderApplicationMarkdownReport(app, "ai");
}

function renderApplicationReportModal() {
    const app = applicationById(state.activeApplicationId);
    if (!app) return "";
    const reportKind = ["prescreen", "ai"].includes(state.adminApplicationReportModal)
        ? state.adminApplicationReportModal
        : "prescreen";
    const config = {
        prescreen: {
            title: "初筛报告",
            subtitle: "匹配判断、关键依据和继续核验点。",
            exportUrl: adminApplicationReportMdUrl(app, "prescreen"),
            content: renderPrescreenFullReport(app),
        },
        ai: {
            title: "AI 面试综合报告",
            subtitle: "二阶段面评、能力观察、继续核验点和完整记录。",
            exportUrl: adminApplicationReportMdUrl(app, "ai"),
            content: renderAiInterviewFullReview(app),
        },
    }[reportKind];
    return `
        <div class="candidate-modal-backdrop admin-modal-backdrop application-report-backdrop" data-action="close-application-report">
            <section class="avatar-sheet application-report-modal" role="dialog" aria-label="${escapeHtml(config.title)}">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>${escapeHtml(config.title)}</h2>
                        <p>${escapeHtml(config.subtitle)}</p>
                    </div>
                    <div class="report-modal-actions">
                        ${reportKind === "prescreen" && canOverridePrescreen(app) ? `
                            <button class="primary small" data-action="override-prescreen-pass" data-app-id="${escapeHtml(app.id)}">通过初筛</button>
                        ` : ""}
                        <a class="ghost small" href="${escapeHtml(config.exportUrl)}" download>导出 Markdown</a>
                        <button class="ghost small" data-action="close-application-report">关闭</button>
                    </div>
                </div>
                ${config.content}
            </section>
        </div>
    `;
}

function renderAdminPortfolioDetailModal() {
    const detail = selectedAdminPortfolioDetail();
    if (!detail) return "";
    const {app, item} = detail;
    const evaluation = (app.evidencePack?.portfolioEvaluations || []).find((row) => (
        row.sourceId === item.id || row.title === item.title || row.title === item.name
    ));
    const fields = [
        ["岗位关联方向", item.jobDirection],
        ["一句话价值", item.oneLineValue || item.summary],
        ["创意背景 / 问题来源", item.problem],
        ["使用场景", item.scenario],
        ["现有方案与不足", item.currentSolutionGap],
        ["解决方案简介", item.solution],
        ["核心功能 / 价值", item.coreFeatures],
        ["Demo 使用流程", item.demoFlow],
        ["AI/Agent/自动化能力说明", item.aiUsage],
        ["差异化", item.differentiation],
        ["本人职责", item.role],
        ["本人贡献", item.contribution],
        ["证据链接", item.evidenceUrl || item.evidence],
        ["结果指标", item.outcome],
        ["最大难点", item.challenge],
        ["复盘", item.reflection],
    ].filter(([, value]) => value);
    const attachments = item.attachmentRefs || [];
    const screenshots = item.screenshots || [];
    return `
        <div class="candidate-modal-backdrop admin-modal-backdrop portfolio-detail-backdrop" data-action="close-admin-portfolio-detail">
            <section class="avatar-sheet portfolio-detail-sheet" role="dialog" aria-label="作品详情">
                <div class="sheet-handle"></div>
                <div class="section-head">
                    <div>
                        <h2>${escapeHtml(item.title || item.name || "作品详情")}</h2>
                        <p>${escapeHtml(item.oneLineValue || item.summary || "候选人提交的结构化作品快照。")}</p>
                    </div>
                    <button class="ghost small" data-action="close-admin-portfolio-detail">关闭</button>
                </div>
                <div class="portfolio-detail-grid">
                    <div class="portfolio-detail-main">
                        ${fields.map(([label, value]) => `
                            <div class="detail-kv">
                                <strong>${escapeHtml(label)}</strong>
                                <p>${escapeHtml(value)}</p>
                            </div>
                        `).join("")}
                    </div>
                    <div class="portfolio-resource-panel">
                        <h3>原始附件 / 截图</h3>
                        ${attachments.length ? attachments.map((ref, index) => {
                            const url = adminPortfolioRefFileUrl(app, item, "portfolio-attachment", ref, index);
                            return `
                                <div class="resource-row">
                                    <span>${escapeHtml(ref.name || ref.fileName || `附件 ${index + 1}`)}</span>
                                    ${url ? `<a class="ghost small" href="${escapeHtml(url)}" target="_blank" rel="noopener">查看</a>` : `<small>暂无文件</small>`}
                                </div>
                            `;
                        }).join("") : `<p class="section-note">没有原始附件。</p>`}
                        ${screenshots.length ? screenshots.map((ref, index) => {
                            const url = adminPortfolioRefFileUrl(app, item, "portfolio-screenshot", ref, index);
                            return `
                                <div class="resource-row screenshot-row">
                                    <span>${escapeHtml(ref.caption || ref.name || `截图 ${index + 1}`)}</span>
                                    ${url ? `<a class="ghost small" href="${escapeHtml(url)}" target="_blank" rel="noopener">查看</a>` : `<small>暂无文件</small>`}
                                    ${ref.validation ? `<small>${escapeHtml(ref.validation)}</small>` : ""}
                                </div>
                            `;
                        }).join("") : `<p class="section-note">没有截图。</p>`}
                    </div>
                </div>
                ${evaluation ? `
                    <div class="portfolio-evaluation-panel">
                        <h3>worker 作品评价</h3>
                        <div class="match-report-row">
                            ${chip(`评分 ${evaluation.score ?? 0}/10`, Number(evaluation.score || 0) >= 7 ? "success" : "warning")}
                            <div>
                                <strong>${escapeHtml((evaluation.highlights || []).join("；") || "已有作品评价")}</strong>
                                ${(evaluation.risks || []).length ? `<p>${escapeHtml(`风险：${evaluation.risks.join("；")}`)}</p>` : ""}
                            </div>
                        </div>
                        ${(evaluation.dimensions || []).length ? `
                            <div class="report-dimension-list">
                                ${evaluation.dimensions.map((item) => `
                                    <div>
                                        ${chip(`${item.score ?? 0}/10`, Number(item.score || 0) >= 7 ? "success" : "warning")}
                                        <strong>${escapeHtml(item.label || item.key || "评价维度")}</strong>
                                        <span>${escapeHtml(item.reason || "暂无说明")}</span>
                                    </div>
                                `).join("")}
                            </div>
                        ` : ""}
                    </div>
                ` : ""}
            </section>
        </div>
    `;
}

function renderApplicationDossier(app) {
    return `
        <div class="dossier-v2 application-review-v2">
            <div class="application-review-layout">
                ${renderApplicationStageRail(app)}
                <main class="application-review-main">
                    <div class="review-summary-grid">
                        ${renderApplicationMaterialSummary(app)}
                    </div>
                </main>
            </div>
        </div>
    `;
}

function renderCandidateHub() {
    const query = state.adminCandidateQuery;
    const rows = filteredCandidateHubRows();
    return `
        <div class="candidate-hub-toolbar admin-index-toolbar">
            <div class="candidate-hub-summary" aria-label="候选人概览">
                <strong>${rows.length}</strong>
                <span>${query.trim() ? `匹配 / 共 ${candidates.length}` : "候选人"}</span>
            </div>
            <label class="search-box candidate-hub-search">
                ${icon("search")}
                <input data-input="admin-candidate-search" value="${escapeHtml(query)}" placeholder="搜索姓名、岗位" />
                ${query.trim() ? `<button type="button" data-action="clear-candidate-search" aria-label="清空搜索">×</button>` : ""}
            </label>
        </div>
        <div class="data-table hub-table">
            <div class="table-row table-head">
                <span>候选人</span><span>投递岗位</span><span>入口</span>
            </div>
            ${rows.length ? rows.map((cand) => {
                const apps = applicationsForCandidate(cand.id);
                return `
                    <div class="table-row">
                        <span>${renderCandidateNameCell(cand)}</span>
                        <span>${apps.map((app) => jobById(app.jobId).title).join(" / ") || "暂无"}</span>
                        <span><button class="ghost" data-action="candidate-detail" data-candidate-id="${cand.id}">查看详情</button></span>
                    </div>
                `;
            }).join("") : `
                <div class="job-empty-state">
                    <strong>没有匹配的候选人</strong>
                    <span>换一个姓名或岗位关键词试试。</span>
                    ${query.trim() ? `<button class="ghost small" data-action="clear-candidate-search">清空搜索</button>` : ""}
                </div>
            `}
        </div>
    `;
}

function renderCandidateDetail() {
    const cand = candidateById(state.selectedCandidateId);
    const apps = applicationsForCandidate(cand.id);
    const firstApplication = apps[0] || null;
    const packageUrl = adminApplicationPackageExportUrl(firstApplication);
    return `
        <div class="admin-detail-toolbar candidate-detail-toolbar">
            <div class="admin-detail-toolbar-title">
                <strong>${escapeHtml(cand.name)}</strong>
                <span>候选人索引 / ${escapeHtml(candidateIdentityMeta(cand))} · 材料完整度 ${cand.completeness}%</span>
            </div>
            ${packageUrl ? `<a class="ghost small" href="${escapeHtml(packageUrl)}" download>导出资料包</a>` : `<button class="ghost small" disabled>导出资料包</button>`}
        </div>
        <div class="candidate-detail-grid candidate-detail-grid-two">
            <div class="panel">
                <div class="candidate-material-head">
                    <h2>材料概览</h2>
                </div>
                <div class="mini-list">
                    <div><strong>简历</strong>${chip("已解析", "success")}<span>${cand.resume}</span></div>
                    <div><strong>作品</strong>${chip(`${cand.portfolios.length} 个`, "info")}<span>${cand.portfolios.map((item) => item.title).join("、") || "暂无"}</span></div>
                    <div><strong>可选知识库</strong>${chip(`${candidateKnowledge(cand).length} 份`, "warning")}<span>${candidateKnowledge(cand).map((item) => item.name).join("、") || "未上传"}</span></div>
                </div>
            </div>
            <div class="panel">
                <h2>投递记录</h2>
                <div class="status-list">
                    ${apps.map((app) => {
                        const stage = adminStageForApplication(app);
                        const action = adminActionForApplication(app);
                        return `
                            <div class="status-item">
                                <strong>${jobById(app.jobId).title}</strong>
                                <span>${app.material}</span>
                                <div>${chip(stage.label, stage.tone)} <small>${escapeHtml(stage.detail)}</small></div>
                                <button class="ghost small" data-action="${action.action}" data-app-id="${app.id}" data-candidate-id="${cand.id}">
                                    ${escapeHtml(action.label)}
                                </button>
                            </div>
                        `;
                    }).join("")}
                </div>
            </div>
        </div>
    `;
}

function render() {
    captureCandidateViewState();
    captureAdminChatViewState();
    syncRouteState();
    if (!state.ready) {
        root.innerHTML = `
            <main class="candidate-shell">
                <section class="candidate-launch-screen" aria-label="招招正在启动">
                    <div class="candidate-launch-card">
                        ${helperMark("large")}
                        <div>
                            <strong>招招</strong>
                            <span>Recruit AI</span>
                        </div>
                        <p>正在准备你的岗位和材料</p>
                    </div>
                </section>
            </main>
        `;
        return;
    }
    const route = routeName();
    if (route === "admin") {
        ensureCandidateMessageSync();
        root.innerHTML = renderAdmin();
        window.requestAnimationFrame(attachAdminChatScroll);
        requestVisibleAdminMatchReport();
    }
    else if (route === "interview") {
        root.innerHTML = renderPublicInterviewEntry();
    }
    else {
        root.innerHTML = renderCandidate();
        ensureCandidateMessageSync();
        window.requestAnimationFrame(() => {
            animateCandidateTabbar();
            attachCandidateFeedLoop();
            attachCandidateJobPreviews();
            attachAvatarCropper();
            restoreApplicationSheetState();
        });
        if (state.loggedIn && state.candidateTab === "messages" && state.candidateMessageJobId) {
            window.requestAnimationFrame(attachCandidateChatScroll);
        }
        window.requestAnimationFrame(syncCandidateChatKeyboard);
    }
}

function attachCandidateFeedLoop() {
    const feed = document.querySelector("[data-candidate-feed]");
    if (!feed) return;
    const cards = [...feed.querySelectorAll(".mobile-job-card")];
    if (!cards.length) return;
    const realCards = cards.filter((card) => !card.dataset.loopClone);
    const headClone = cards.find((card) => card.dataset.loopClone === "head");
    const tailClone = cards.find((card) => card.dataset.loopClone === "tail");

    const styles = window.getComputedStyle(feed);
    const bottomSafe = Number.parseFloat(styles.getPropertyValue("--feed-bottom-safe")) || 0;
    const visibleHeight = feed.clientHeight - bottomSafe;
    const cardTop = (card) => card.getBoundingClientRect().top - feed.getBoundingClientRect().top + feed.scrollTop;
    const snapTop = (card) => Math.max(0, cardTop(card) - ((visibleHeight - card.offsetHeight) / 2));

    const updateActiveJobFromScroll = () => {
        const viewportCenter = feed.scrollTop + (visibleHeight / 2);
        const activeCard = cards.reduce((closest, card) => {
            const cardCenter = cardTop(card) + (card.offsetHeight / 2);
            const distance = Math.abs(cardCenter - viewportCenter);
            return !closest || distance < closest.distance ? {card, distance} : closest;
        }, null)?.card;
        if (activeCard?.dataset.jobId) {
            state.selectedJobId = activeCard.dataset.jobId;
        }
    };
    const closestCardToViewport = () => {
        const viewportCenter = feed.scrollTop + (visibleHeight / 2);
        return cards.reduce((closest, card) => {
            const cardCenter = cardTop(card) + (card.offsetHeight / 2);
            const distance = Math.abs(cardCenter - viewportCenter);
            return !closest || distance < closest.distance ? {card, distance} : closest;
        }, null)?.card || null;
    };
    const equivalentScrollTop = (source, target) => {
        if (!source) return snapTop(target);
        const nextTop = feed.scrollTop - cardTop(source) + cardTop(target);
        const maxTop = Math.max(0, feed.scrollHeight - feed.clientHeight);
        return Math.min(Math.max(0, nextTop), maxTop);
    };
    const jumpToRealCard = (target, source = null) => {
        if (feed.dataset.loopResetting === "true") return;
        if (!target) return;
        feed.dataset.loopResetting = "true";
        window.clearTimeout(feed._candidateLoopTimer);
        const nextScrollTop = equivalentScrollTop(source, target);
        const previousBehavior = feed.style.scrollBehavior;
        const previousSnapType = feed.style.scrollSnapType;
        feed.style.scrollBehavior = "auto";
        feed.style.scrollSnapType = "none";
        feed.scrollTop = nextScrollTop;
        state.candidateFeedScrollTop = feed.scrollTop;
        state.selectedJobId = target.dataset.jobId || state.selectedJobId;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (!document.body.contains(feed)) return;
                feed.style.scrollSnapType = previousSnapType;
                feed.style.scrollBehavior = previousBehavior;
                feed.dataset.loopResetting = "false";
            });
        });
    };
    const syncLoopClonePosition = () => {
        if (feed.dataset.loopResetting === "true") return;
        const activeCard = closestCardToViewport();
        const target = activeCard === headClone
            ? realCards[realCards.length - 1]
            : activeCard === tailClone
                ? realCards[0]
                : null;
        jumpToRealCard(target, activeCard);
    };
    const scheduleLoopSync = () => {
        if (!headClone && !tailClone) return;
        if ("onscrollend" in window) return;
        window.clearTimeout(feed._candidateLoopTimer);
        feed._candidateLoopTimer = window.setTimeout(() => {
            feed._candidateLoopTimer = 0;
            syncLoopClonePosition();
        }, 420);
    };

    if (!feed.dataset.feedReady) {
        feed.dataset.feedReady = "true";
        const selectedIndex = realCards.findIndex((card) => card.dataset.jobId === state.selectedJobId);
        feed.scrollTop = snapTop(realCards[Math.max(0, selectedIndex)]);
        state.candidateFeedScrollTop = feed.scrollTop;
        updateActiveJobFromScroll();
    }

    feed.addEventListener("scroll", () => {
        state.candidateFeedScrollTop = feed.scrollTop;
        updateActiveJobFromScroll();
        scheduleLoopSync();
    }, {passive: true});
    if ("onscrollend" in window) {
        feed.addEventListener("scrollend", () => {
            window.clearTimeout(feed._candidateLoopTimer);
            feed._candidateLoopTimer = 0;
            syncLoopClonePosition();
        }, {passive: true});
    }
}

function animateCandidateTabbar() {
    if (!state.candidateTabTransitionFrom || state.candidateTabTransitionRenderedId === state.candidateTabTransitionId) return;
    const fromTab = state.candidateTabTransitionFrom;
    const transitionId = state.candidateTabTransitionId;
    state.candidateTabTransitionRenderedId = transitionId;
    window.clearTimeout(candidateTabTransitionTimer);
    candidateTabTransitionTimer = window.setTimeout(() => {
        const tabbar = document.querySelector(".candidate-tabbar.is-switching");
        tabbar?.classList.remove("is-switching", `from-${fromTab}`);
        if (state.candidateTabTransitionId === transitionId) {
            state.candidateTabTransitionFrom = "";
            state.candidateTabTransitionRenderedId = 0;
        }
    }, 420);
}

function renderAfterCandidateTabbarSettles() {
    if (state.candidateTabTransitionFrom && state.candidateTabTransitionRenderedId === state.candidateTabTransitionId) {
        const transitionId = state.candidateTabTransitionId;
        window.clearTimeout(candidateTabDeferredRenderTimer);
        candidateTabDeferredRenderTimer = window.setTimeout(() => {
            if (state.candidateTabTransitionId === transitionId) render();
        }, 430);
        return;
    }
    render();
}

function setToast(message) {
    state.toast = message;
    window.clearTimeout(setToast.timer);
    setToast.timer = window.setTimeout(() => {
        state.toast = "";
        render();
    }, 2200);
}

async function uploadPortfolioScreenshots(formData) {
    const rawFiles = formData.getAll("screenshots");
    const notes = formData.getAll("screenshotNotes").map((value) => String(value || "").trim());
    const screenshots = [];
    const files = rawFiles
        .map((file, slotIndex) => ({file, slotIndex}))
        .filter(({file}) => file && file.name)
        .slice(0, 5);
    for (const [index, {file, slotIndex}] of files.entries()) {
        const note = notes[slotIndex] || `关键截图 ${index + 1}`;
        const base = {
            name: file.name,
            caption: note,
            tech: "",
            contribution: "",
            validation: "",
            sizeBytes: file.size || 0,
            mimeType: file.type || "",
        };
        try {
            const presign = await api.presignUpload({
                ownerType: "candidate",
                ownerId: candidate.id,
                kind: "portfolio-screenshot",
                fileName: file.name,
                mimeType: file.type || "",
                sizeBytes: file.size || 0,
            });
            if (presign.uploadId) {
                await api.uploadLocal(presign.uploadId, file);
            } else if (presign.uploadUrl && !presign.uploadUrl.startsWith("local-file://")) {
                await fetch(presign.uploadUrl, {method: "PUT", body: file});
            }
            const completed = await api.completeUpload({
                uploadId: presign.uploadId,
                ownerType: "candidate",
                ownerId: candidate.id,
                kind: "portfolio-screenshot",
                fileName: file.name,
                mimeType: file.type || "",
                sizeBytes: file.size || 0,
                storageKey: presign.storageKey,
                metadata: base,
            });
            screenshots.push({...base, storageKey: completed.storageKey, storageRef: completed.storageRef});
        }
        catch (error) {
            screenshots.push({...base, uploadWarning: error.message});
        }
    }
    return screenshots;
}

async function uploadCandidateOriginal(kind, file) {
    const presign = await api.presignUpload({
        ownerType: "candidate",
        ownerId: candidate.id,
        kind,
        fileName: file.name,
        mimeType: file.type || "",
        sizeBytes: file.size || 0,
    });
    if (presign.uploadId) {
        await api.uploadLocal(presign.uploadId, file);
    } else if (presign.uploadUrl && !presign.uploadUrl.startsWith("local-file://")) {
        await fetch(presign.uploadUrl, {method: "PUT", body: file});
    }
    return {
        uploadId: presign.uploadId,
        storageKey: presign.storageKey,
        storageRef: presign.storageRef,
        mimeType: file.type || "",
        sizeBytes: file.size || 0,
    };
}

async function uploadJobKnowledgeFile(jobId, file) {
    const presign = await api.presignUpload({
        ownerType: "job",
        ownerId: jobId,
        kind: "knowledge",
        fileName: file.name,
        mimeType: file.type || "",
        sizeBytes: file.size || 0,
    });
    if (presign.uploadId) {
        await api.uploadLocal(presign.uploadId, file);
    } else if (presign.uploadUrl && !presign.uploadUrl.startsWith("local-file://")) {
        await fetch(presign.uploadUrl, {method: "PUT", body: file});
    }
    const completed = await api.completeUpload({
        uploadId: presign.uploadId,
        ownerType: "job",
        ownerId: jobId,
        kind: "knowledge",
        fileName: file.name,
        mimeType: file.type || "",
        sizeBytes: file.size || 0,
        storageKey: presign.storageKey,
        metadata: {
            source: "admin-job-knowledge",
            fileName: file.name,
        },
    });
    const result = await api.addKnowledgeSource(jobId, {
        uploadId: completed.uploadId,
        name: file.name,
        fileName: file.name,
        status: "indexing",
        usage: `${file.name}，等待 worker 解析索引。`,
        storageKey: completed.storageKey,
        storageRef: completed.storageRef,
        mimeType: file.type || "",
        sizeBytes: file.size || 0,
        hasOriginalFile: true,
    });
    return result.source;
}

async function uploadCandidateAvatar(file) {
    validateCandidateAvatarFile(file);
    const fileName = file.name || "avatar.png";
    const mimeType = file.type || "image/png";
    const presign = await api.presignUpload({
        ownerType: "candidate",
        ownerId: candidate.id,
        kind: "avatar",
        fileName,
        mimeType,
        sizeBytes: file.size || 0,
    });
    if (presign.uploadId) {
        await api.uploadLocal(presign.uploadId, file);
    } else if (presign.uploadUrl && !presign.uploadUrl.startsWith("local-file://")) {
        await fetch(presign.uploadUrl, {method: "PUT", body: file});
    }
    const completed = await api.completeUpload({
        uploadId: presign.uploadId,
        ownerType: "candidate",
        ownerId: candidate.id,
        kind: "avatar",
        fileName,
        mimeType,
        sizeBytes: file.size || 0,
        storageKey: presign.storageKey,
        metadata: {profileField: "avatar"},
    });
    const result = await api.updateCandidateProfile({
        avatar: {
            mode: "image",
            storageKey: completed.storageKey,
            storageRef: completed.storageRef,
            fileName,
            mimeType,
            sizeBytes: file.size || 0,
            updatedAt: new Date().toISOString(),
        },
    });
    return result.candidate;
}

function portfolioPayloadFromForm(formData, screenshots) {
    const screenshotCaption = formData.getAll("screenshotNotes")
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join("\n");
    const payload = {
        title: formData.get("title"),
        jobDirection: formData.get("jobDirection"),
        oneLineValue: formData.get("oneLineValue"),
        scenario: formData.get("scenario"),
        currentSolutionGap: formData.get("currentSolutionGap"),
        problem: formData.get("problem"),
        demoFlow: formData.get("demoFlow"),
        solution: formData.get("solution"),
        coreFeatures: formData.get("coreFeatures"),
        role: formData.get("role"),
        contribution: formData.get("contribution"),
        aiUsage: formData.get("aiUsage"),
        differentiation: formData.get("differentiation"),
        evidenceUrl: formData.get("evidenceUrl"),
        screenshotCaption,
        screenshotTech: "",
        screenshotContribution: "",
        screenshotValidation: "",
        outcome: formData.get("outcome"),
        challenge: formData.get("challenge"),
        reflection: formData.get("reflection"),
    };
    if (Array.isArray(screenshots) && screenshots.length) payload.screenshots = screenshots;
    return payload;
}

async function sendCandidateChat(jobId, text, kind = "candidate_question") {
    if (!state.loggedIn || !candidate?.id) {
        setToast("请先登录后再继续咨询");
        render();
        return;
    }
    const value = String(text || "").trim();
    if (!value) return;
    markJobConsulted(jobId);
    const localId = appendLocalMessage(jobId, {
        who: "candidate",
        kind,
        text: value,
    });
    state.consultStreamingByJob = {
        ...state.consultStreamingByJob,
        [jobId]: {text: ""},
    };
    state.candidateChatForceScrollJobId = jobId;
    state.candidateChatPinnedByJob = {
        ...state.candidateChatPinnedByJob,
        [jobId]: true,
    };
    render();
    try {
        const session = await api.consultStream(jobId, {question: value, kind, clientMessageId: localId}, {
            candidate_message(message) {
                updateLocalMessage(jobId, localId, message);
            },
            assistant_delta(payload) {
                const current = state.consultStreamingByJob[jobId] || {text: ""};
                state.consultStreamingByJob = {
                    ...state.consultStreamingByJob,
                    [jobId]: {...current, text: `${current.text || ""}${payload.delta || ""}`},
                };
                if (state.candidateChatPinnedByJob[jobId] !== false) {
                    state.candidateChatForceScrollJobId = jobId;
                }
                render();
            },
            session(consultations) {
                state.consultMessagesByJob = consultations.consultMessagesByJob || state.consultMessagesByJob;
                state.consultedJobIds = consultations.consultedJobIds || state.consultedJobIds;
                state.consultVisitsByJob = consultations.consultVisitsByJob || state.consultVisitsByJob;
            },
            error(payload) {
                throw new Error(payload.message || "回答失败，可重试");
            },
        });
        if (session?.consultMessagesByJob) {
            state.consultMessagesByJob = session.consultMessagesByJob;
            state.consultedJobIds = session.consultedJobIds || state.consultedJobIds;
            state.consultVisitsByJob = session.consultVisitsByJob || state.consultVisitsByJob;
            state.candidateMessageLastSync = Date.now();
        }
    }
    catch (error) {
        if (error.status === 401) {
            clearCandidateSession();
            candidate = null;
            state.loggedIn = false;
        }
        appendLocalMessage(jobId, {
            who: "assistant",
            kind: "system_notice",
            text: error.status === 401 ? "请先登录后再继续咨询。" : "回答失败，可重试。",
        });
        setToast(error.message || "回答失败，可重试");
    }
    finally {
        const nextStreaming = {...state.consultStreamingByJob};
        delete nextStreaming[jobId];
        state.consultStreamingByJob = nextStreaming;
        if (state.candidateChatPinnedByJob[jobId] !== false) {
            state.candidateChatForceScrollJobId = jobId;
        }
        render();
    }
}

function setAdminSearchQuery(inputName, value) {
    if (inputName === "admin-candidate-search") {
        state.adminCandidateQuery = value;
    }
    if (inputName === "admin-job-search") {
        state.adminJobQuery = value;
    }
}

function adminSearchSelector(inputName) {
    return `[data-input='${inputName}']`;
}

function renderAndRefocusInput(selector, cursor) {
    render();
    window.requestAnimationFrame(() => {
        const nextInput = document.querySelector(selector);
        if (!nextInput) return;
        nextInput.focus();
        nextInput.setSelectionRange(cursor, cursor);
    });
}

function renderAdminSearchInput(inputName, cursor) {
    renderAndRefocusInput(adminSearchSelector(inputName), cursor);
}

function scheduleAdminSearchRender(inputName, input) {
    window.clearTimeout(adminSearchRenderTimer);
    const cursor = input.selectionStart ?? input.value.length;
    adminSearchRenderTimer = window.setTimeout(() => {
        renderAdminSearchInput(inputName, cursor);
    }, 140);
}

function adminSearchTargetFromEvent(event) {
    const target = event.target?.closest?.("[data-input]");
    return target && adminSearchInputs.has(target.dataset.input) ? target : null;
}

document.addEventListener("compositionstart", (event) => {
    const target = adminSearchTargetFromEvent(event);
    if (target) target.dataset.composing = "true";
});

document.addEventListener("compositionend", (event) => {
    const target = adminSearchTargetFromEvent(event);
    if (!target) return;
    target.dataset.composing = "false";
    setAdminSearchQuery(target.dataset.input, target.value);
    renderAdminSearchInput(target.dataset.input, target.selectionStart ?? target.value.length);
});

document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!state.adminApplicationReportModal) return;
    state.adminApplicationReportModal = "";
    render();
});

document.addEventListener("input", (event) => {
    const target = event.target.closest("[data-input]");
    if (!target) return;
    if (adminSearchInputs.has(target.dataset.input)) {
        setAdminSearchQuery(target.dataset.input, target.value);
        if (event.isComposing || target.dataset.composing === "true") return;
        scheduleAdminSearchRender(target.dataset.input, target);
        return;
    }
    if (target.dataset.input === "avatar-crop-zoom") {
        updateAvatarCrop({zoom: target.value});
    }
});

document.addEventListener("pointerdown", (event) => {
    const stage = event.target.closest?.(".avatar-crop-stage");
    if (!stage || !state.avatarCrop) return;
    event.preventDefault();
    stage.setPointerCapture?.(event.pointerId);
    avatarCropPointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    resetAvatarCropGesture();
});

document.addEventListener("pointermove", (event) => {
    if (!avatarCropPointers.has(event.pointerId)) return;
    avatarCropPointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    moveAvatarCropGesture();
});

function endAvatarCropPointer(event) {
    if (!avatarCropPointers.has(event.pointerId)) return;
    avatarCropPointers.delete(event.pointerId);
    resetAvatarCropGesture();
}

document.addEventListener("pointerup", endAvatarCropPointer);
document.addEventListener("pointercancel", endAvatarCropPointer);

document.addEventListener("wheel", (event) => {
    const stage = event.target.closest?.(".avatar-crop-stage");
    if (!stage || !state.avatarCrop) return;
    event.preventDefault();
    updateAvatarCrop({zoom: state.avatarCrop.zoom * Math.exp(-event.deltaY * 0.001)});
}, {passive: false});

document.addEventListener("change", async (event) => {
    const applicationChoiceTarget = event.target.closest('form[data-form="application-submit"], form[data-form="application-material-update"]');
    if (applicationChoiceTarget) {
        captureApplicationSheetState();
    }
    const screenshotTarget = event.target.closest(".portfolio-screenshot-input");
    if (screenshotTarget) {
        updatePortfolioScreenshotSlot(screenshotTarget);
        return;
    }
    const avatarTarget = event.target.closest("[data-input='candidate-avatar-file']");
    if (avatarTarget) {
        const file = avatarTarget.files?.[0];
        if (!file) return;
        try {
            candidate = await uploadCandidateAvatar(file);
            state.avatarPreviewOpen = false;
            state.avatarEditorOpen = false;
            clearAvatarCrop();
            setToast("头像已保存");
        }
        catch (error) {
            setToast(error.message || "头像保存失败，请换一张图片");
        }
        render();
        return;
    }
    const jobKnowledgeTarget = event.target.closest("[data-input='job-knowledge-file']");
    if (jobKnowledgeTarget) {
        const file = jobKnowledgeTarget.files?.[0];
        const job = jobById(jobKnowledgeTarget.dataset.jobId);
        if (!file || !job?.id) return;
        try {
            setToast("正在上传岗位资料...");
            const source = await uploadJobKnowledgeFile(job.id, file);
            job.knowledge = [...(job.knowledge || []), source];
            setToast("岗位资料已上传，等待 worker 解析索引");
        }
        catch (error) {
            setToast(error.message || "岗位资料上传失败");
        }
        jobKnowledgeTarget.value = "";
        render();
        return;
    }
    const exportFilterTarget = event.target.closest("[data-input='admin-export-filter']");
    if (exportFilterTarget) {
        state.adminApplicationExportFilter = normalizeAdminApplicationExportFilter(exportFilterTarget.value || "all");
        state.adminApplicationExportSelectedIds = [];
        render();
        return;
    }
    const exportAppTarget = event.target.closest("[data-input='admin-export-app']");
    if (exportAppTarget) {
        const next = new Set(state.adminApplicationExportSelectedIds);
        if (exportAppTarget.checked) next.add(exportAppTarget.value);
        else next.delete(exportAppTarget.value);
        state.adminApplicationExportSelectedIds = [...next];
        render();
    }
});

document.addEventListener("submit", async (event) => {
    const form = event.target.closest("form");
    if (!form) return;
    event.preventDefault();
    if (form.dataset.form === "login") {
        const formData = new FormData(form);
        const identity = {
            name: String(formData.get("name") || "").trim(),
            idTail: normalizeIdTailInput(formData.get("idTail")),
        };
        state.candidateAuthError = "";
        state.candidateAuthNotice = "";
        if (!identity.name || !/^\d{7}[\dX]$/.test(identity.idTail)) {
            state.candidateAuthError = "请输入姓名和证件后 8 位；末位可为大写 X。";
            render();
            return;
        }
        if (state.candidateAuthMode === "register") {
            state.candidateRegistrationConfirm = identity;
            render();
            return;
        }
        try {
            const result = await api.login({
                name: identity.name,
                idTail: identity.idTail,
            });
            candidate = result.candidate;
            saveCandidateSession(candidate, identity);
            state.candidateAuthPrefill = null;
            state.selectedCandidateId = candidate.id;
            state.loggedIn = true;
            state.candidatePanel = "materials";
            state.candidateTab = "jobs";
            state.candidateJobDetail = false;
            state.candidateMessageJobId = "";
            setToast("已进入候选人端");
        }
        catch (error) {
            state.candidateAuthError = error.message || "登录失败，请确认信息";
            setToast(state.candidateAuthError);
        }
        render();
        return;
    }
    if (form.dataset.form === "ask") {
        const input = form.querySelector("input[name='question']");
        const value = input.value.trim();
        if (!value) return;
        const jobId = state.candidateMessageJobId || state.selectedJobId;
        input.value = "";
        await sendCandidateChat(jobId, value);
    }
    if (form.dataset.form === "candidate-material") {
        const formData = new FormData(form);
        const kind = formData.get("kind");
        const file = formData.get("file");
        const name = file?.name || formData.get("name");
        let result;
        state.candidateMaterialError = "";
        if (kind !== "portfolio" && !file?.name) {
            state.candidateMaterialError = "请先选择一个文件。";
            render();
            return;
        }
        try {
            if (kind === "resume") {
                const upload = await uploadCandidateOriginal(kind, file);
                result = await api.addResume({
                    fileName: name,
                    summary: `${name} 已上传，后台解析中；仍可先用于投递。`,
                    isDefault: true,
                    ...upload,
                });
            }
            if (kind === "portfolio") {
                const screenshots = await uploadPortfolioScreenshots(formData);
                result = await api.createPortfolioSubmission(portfolioPayloadFromForm(formData, screenshots));
            }
            if (kind === "knowledge") {
                const upload = await uploadCandidateOriginal(kind, file);
                result = await api.addCandidateKnowledge({
                    fileName: name,
                    usage: `${name} 已上传，后台解析中；仍可先用于投递。`,
                    ...upload,
                });
            }
        }
        catch (error) {
            state.candidateMaterialError = `保存失败：${error.message || "请稍后重试"}`;
            setToast(state.candidateMaterialError);
            render();
            return;
        }
        if (result?.candidate) candidate = result.candidate;
        state.candidateMaterialForm = "";
        state.candidateMaterialError = "";
        setToast("材料已上传，可先用于投递；后台会继续解析");
        render();
    }
    if (form.dataset.form === "candidate-portfolio-edit") {
        const formData = new FormData(form);
        const portfolioId = formData.get("portfolioId");
        const uploadedScreenshots = await uploadPortfolioScreenshots(formData);
        const currentPortfolio = (candidate.portfolios || []).find((item) => item.id === portfolioId);
        const screenshots = uploadedScreenshots.length
            ? [...(currentPortfolio?.screenshots || []), ...uploadedScreenshots].slice(0, 5)
            : null;
        const result = await api.updatePortfolioSubmission(portfolioId, portfolioPayloadFromForm(formData, screenshots));
        if (result?.candidate) candidate = result.candidate;
        state.candidateMaterialDetailKey = "";
        setToast("作品已更新；已提交投递仍保留当时版本");
        render();
    }
    if (form.dataset.form === "application-submit") {
        const formData = new FormData(form);
        const jobId = formData.get("jobId");
        const existedBefore = store.applications.some((app) => app.jobId === jobId && app.candidateId === candidate.id);
        state.applicationSubmitting = true;
        state.applicationSubmitError = "";
        render();
        try {
            const result = await api.submitApplication({
                jobId,
                candidateId: candidate.id,
                resumeId: formData.get("resumeId"),
                portfolioIds: formData.getAll("portfolioIds"),
                knowledgeIds: formData.getAll("knowledgeIds"),
            });
            upsertApplication(result.application);
            clearApplicationSheetDraft(`submit:${jobId}`);
            state.applicationSheetJobId = "";
            state.candidateApplicationDetailId = result.application.id;
            state.candidatePanel = "status";
            state.candidateTab = "profile";
            state.candidateJobDetail = false;
            state.applicationSubmitError = "";
            setToast(result.alreadyApplied || existedBefore
                ? "你已投递该岗位，已打开投递详情"
                : "已提交投递，本次材料已固定保存");
        }
        catch (error) {
            state.applicationSubmitError = error.message || "投递失败，请稍后重试";
            setToast("投递失败，请查看提示");
        }
        finally {
            state.applicationSubmitting = false;
        }
        render();
        return;
    }
    if (form.dataset.form === "application-material-update") {
        const formData = new FormData(form);
        const applicationId = formData.get("applicationId");
        state.applicationSubmitting = true;
        state.applicationSubmitError = "";
        render();
        try {
            const result = await api.updateApplicationMaterials(applicationId, {
                resumeId: formData.get("resumeId"),
                portfolioIds: formData.getAll("portfolioIds"),
                knowledgeIds: formData.getAll("knowledgeIds"),
                materialUpdateRequestId: formData.get("materialUpdateRequestId"),
            });
            upsertApplication(result.application);
            clearApplicationSheetDraft(activeApplicationSheetKey());
            state.applicationUpdateAppId = "";
            state.applicationUpdateRequestId = "";
            state.candidateApplicationDetailId = result.application.id;
            state.candidatePanel = "status";
            state.candidateTab = "profile";
            state.applicationSubmitError = "";
            setToast("材料已更新，正在重新解析");
        }
        catch (error) {
            state.applicationSubmitError = error.message || "更新失败，请稍后重试";
            setToast("更新失败，请查看提示");
        }
        finally {
            state.applicationSubmitting = false;
        }
        render();
        return;
    }
    if (form.dataset.form === "admin-jd") {
        const job = jobById(state.selectedJobId);
        const raw = form.querySelector("textarea[name='jd']").value;
        const lines = raw.replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd());
        while (lines.length && !lines[0].trim()) lines.shift();
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        if (lines.some((line) => line.trim())) {
            const result = await api.updateJob(job.id, {
                title: form.querySelector("input[name='title']").value.trim() || job.title,
                location: form.querySelector("input[name='location']").value.trim() || job.location,
                mode: form.querySelector("input[name='mode']").value.trim() || job.mode,
                jd: lines,
            });
            Object.assign(job, result.job);
        }
        state.adminEditingSection = "";
        setToast("岗位信息已保存，候选人端职位流会同步更新");
        render();
    }
    if (form.dataset.form === "admin-knowledge") {
        const job = jobById(state.selectedJobId);
        const knowledge = job.knowledge.map((item, index) => ({
            ...item,
            name: form.querySelector(`[name="knowledgeName_${index}"]`)?.value.trim() || item.name,
            usage: form.querySelector(`[name="knowledgeUsage_${index}"]`)?.value.trim() || item.usage,
        }));
        const result = await api.updateJob(job.id, {knowledge});
        Object.assign(job, result.job);
        state.adminEditingSection = "";
        setToast("知识库信息已保存");
        render();
    }
    if (form.dataset.form === "admin-interview-settings") {
        const job = jobById(state.selectedJobId);
        const formData = new FormData(form);
        const payload = {
            interviewSettings: {
                questionCount: clampInteger(formData.get("questionCount"), 6, 3, 10),
                maxFollowUpsPerQuestion: clampInteger(formData.get("maxFollowUpsPerQuestion"), 2, 0, 5),
                durationMinutes: job?.interviewSettings?.durationMinutes || 25,
                invitationValidDays: clampInteger(formData.get("invitationValidDays"), 3, 1, 14),
                provider: {kind: "browser-demo", speechSynthesis: true},
            },
        };
        const result = await api.updateJob(job.id, payload);
        Object.assign(job, result.job);
        state.selectedJobTab = "interviews";
        window.history.replaceState({}, "", adminJobUrl(job.id, {tab: "interviews"}));
        setToast("面试配置已保存；重新生成面试计划后会按新配置出题");
        render();
    }
    if (form.dataset.form === "admin-rubric") {
        const job = jobById(state.selectedJobId);
        const formData = new FormData(form);
        const ruleId = formData.get("ruleId");
        const payload = {
            type: formData.get("type"),
            label: formData.get("label"),
            value: formData.get("value"),
        };
        const result = ruleId
            ? await api.updateScreeningRule(job.id, ruleId, payload)
            : await api.addScreeningRule(job.id, payload);
        Object.assign(job, result.job);
        state.adminEditingRuleId = "";
        setToast(ruleId ? "评价项已保存" : "评价项已添加");
        render();
    }
    if (form.dataset.form === "admin-consultation-reply") {
        const formData = new FormData(form);
        const sessionId = formData.get("sessionId");
        const text = String(formData.get("text") || "").trim();
        if (!sessionId || !text) return;
        try {
            const result = await api.sendAdminConsultationMessage(sessionId, {text});
            upsertAdminConsultationResult(result, state.selectedJobId, {forceScroll: true});
            state.adminMessageActionMenuId = "";
            setToast("已回复候选人，候选人端会在同一个岗位聊天里看到");
        }
        catch (error) {
            setToast(error.message || "发送失败，请稍后重试");
        }
        render();
    }
    if (form.dataset.form === "admin-force-interview") {
        const formData = new FormData(form);
        const appId = formData.get("applicationId");
        const forceReason = String(formData.get("forceReason") || "").trim();
        state.adminForceInterviewReason = forceReason;
        if (!forceReason) {
            state.adminForceInterviewError = "请先填写人工强制发起 AI 面试的原因。";
            render();
            return;
        }
        state.adminForceInterviewBusy = true;
        state.adminForceInterviewError = "";
        render();
        try {
            const sessionId = state.adminForceInterviewSessionId;
            let notificationFailed = false;
            const result = await api.createInterviewInvitation(appId, {
                force: true,
                forceReason,
            });
            upsertApplication(result.application);
            if (result.publicEntryUrl && navigator.clipboard) {
                await navigator.clipboard.writeText(result.publicEntryUrl).catch(() => null);
            }
            if (sessionId) {
                try {
                    const message = await api.sendAdminConsultationMessage(sessionId, {
                        kind: "interview_invite",
                        applicationId: appId,
                        text: "AI 面试邀请已准备好，你可以在有效期内随时进入。",
                    });
                    upsertAdminConsultationResult(message, state.selectedJobId, {forceScroll: true});
                }
                catch (messageError) {
                    notificationFailed = true;
                    setToast(`AI 面试已发起，但消息通知失败：${messageError.message || "请稍后重试"}`);
                }
            }
            state.adminForceInterviewAppId = "";
            state.adminForceInterviewReason = "";
            state.adminForceInterviewError = "";
            state.adminForceInterviewSessionId = "";
            if (!notificationFailed) setToast(result.publicEntryUrl ? "已生成 AI 面试邀请，链接已复制" : "已人工强制发起 AI 面试，并记录原因");
        }
        catch (error) {
            state.adminForceInterviewError = error.message || "AI 面试邀请失败";
            setToast(state.adminForceInterviewError);
        }
        finally {
            state.adminForceInterviewBusy = false;
        }
        render();
    }
    if (form.dataset.form === "human-decision") {
        const formData = new FormData(form);
        const app = applicationById(formData.get("applicationId"));
        const decision = event.submitter?.value || event.submitter?.dataset?.decision || formData.get("decision");
        if (!app) {
            setToast("没有找到这条投递记录");
            return;
        }
        if (!decision) {
            setToast("请选择通过、拒绝或暂缓");
            return;
        }
        const result = await api.updateApplication(app.id, {
            humanDecision: decision,
            note: formData.get("note"),
        });
        upsertApplication(result.application);
        setToast("人工决策已记录");
        render();
    }
});

document.addEventListener("focusin", (event) => {
    if (event.target?.matches?.(".candidate-chat-input input")) {
        scheduleCandidateChatKeyboardSync();
    }
});

document.addEventListener("focusout", (event) => {
    if (event.target?.matches?.(".candidate-chat-input input")) {
        scheduleCandidateChatKeyboardSync();
    }
});

window.visualViewport?.addEventListener("resize", scheduleCandidateChatKeyboardSync);
window.visualViewport?.addEventListener("scroll", scheduleCandidateChatKeyboardSync);
window.addEventListener("resize", scheduleCandidateChatKeyboardSync);

document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.classList.contains("candidate-modal-backdrop") && event.target !== button) return;
    const {action} = button.dataset;

    if (action === "close-avatar-editor" && button.classList.contains("candidate-modal-backdrop") && event.target !== button) return;
    if (action === "close-avatar-preview" && button.classList.contains("candidate-modal-backdrop") && event.target !== button) return;
    if (action === "close-candidate-sheet" && button.classList.contains("candidate-modal-backdrop") && event.target !== button) return;
    if (action === "close-application-sheet" && button.classList.contains("candidate-modal-backdrop") && event.target !== button) return;
    if (action === "candidate-auth-mode") {
        state.candidateAuthMode = button.dataset.mode === "register" ? "register" : "login";
        state.candidateAuthError = "";
        state.candidateAuthNotice = "";
        state.candidateAuthPrefill = null;
        state.candidateRegistrationConfirm = null;
        render();
        return;
    }
    if (action === "cancel-candidate-register") {
        state.candidateRegistrationConfirm = null;
        state.candidateRegistrationSubmitting = false;
        state.candidateAuthError = "";
        render();
        return;
    }
    if (action === "confirm-candidate-register") {
        const identity = state.candidateRegistrationConfirm;
        if (!identity) return;
        state.candidateRegistrationSubmitting = true;
        state.candidateAuthError = "";
        state.candidateAuthNotice = "";
        render();
        try {
            await api.register(identity);
            clearCandidateSession();
            document.cookie = "candidateId=; Path=/; Max-Age=0; SameSite=Lax";
            candidate = null;
            state.selectedCandidateId = "";
            state.loggedIn = false;
            state.candidateAuthMode = "login";
            state.candidateAuthPrefill = {name: identity.name};
            state.candidateAuthNotice = "档案已创建，请登录继续。";
            state.candidateTab = "jobs";
            state.candidateJobDetail = false;
            state.candidateMessageJobId = "";
            state.candidateRegistrationConfirm = null;
            setToast("档案已创建，请登录继续");
        }
        catch (error) {
            state.candidateAuthError = error.message || "创建失败，请确认信息";
            setToast(state.candidateAuthError);
        }
        finally {
            state.candidateRegistrationSubmitting = false;
        }
        render();
        return;
    }
    if (action === "candidate-logout") {
        try {
            await api.logout();
        }
        catch (error) {
            console.warn("candidate logout failed, clearing local session", error);
        }
        clearCandidateSession();
        document.cookie = "candidateId=; Path=/; Max-Age=0; SameSite=Lax";
        candidate = null;
        state.loggedIn = false;
        state.candidateAuthError = "";
        state.candidateAuthNotice = "";
        state.candidateAuthPrefill = null;
        state.candidateTab = "jobs";
        state.candidateMessageJobId = "";
        state.candidateJobDetail = false;
        state.candidateMaterialManagerKind = "";
        state.candidateInterviewManagerOpen = false;
        state.candidateApplicationDetailId = "";
        state.applicationSheetJobId = "";
        state.selectedCandidateId = "";
        state.consultMessagesByJob = {};
        window.history.replaceState({}, "", "/candidate");
        state.toast = "";
        await loadBootstrap();
        render();
        return;
    }
    if (action === "candidate-tab") {
        const nextTab = button.dataset.tab;
        if (nextTab && nextTab !== state.candidateTab) {
            state.candidateTabTransitionFrom = state.candidateTab;
            state.candidateTabTransitionId += 1;
            state.candidateTabTransitionRenderedId = 0;
        }
        state.candidateTab = nextTab;
        if (button.dataset.tab === "messages") state.candidateMessageJobId = "";
        if (button.dataset.tab === "jobs") state.candidateJobDetail = false;
        if (button.dataset.tab !== "profile") state.candidateMaterialManagerKind = "";
        if (button.dataset.tab !== "profile") state.candidateInterviewManagerOpen = false;
        if (["jobs", "messages", "interviews", "profile"].includes(button.dataset.tab) && state.loggedIn) {
            state.candidateRefreshing = true;
            render();
            try {
                await refreshCandidateState();
                if (button.dataset.tab === "messages") state.candidateMessageLastSync = Date.now();
            }
            catch (error) {
                setToast(`同步状态失败：${error.message}`);
            }
            state.candidateRefreshing = false;
        }
    }
    if (action === "open-avatar-preview") {
        state.avatarPreviewOpen = true;
        render();
        return;
    }
    if (action === "close-avatar-preview") {
        state.avatarPreviewOpen = false;
        render();
        return;
    }
    if (action === "open-avatar-editor") {
        state.avatarPreviewOpen = false;
        state.avatarEditorOpen = true;
        render();
        return;
    }
    if (action === "close-avatar-editor") {
        state.avatarEditorOpen = false;
        clearAvatarCrop();
        render();
        return;
    }
    if (action === "candidate-material-form") {
        state.candidateMaterialForm = button.dataset.kind;
        state.candidateMaterialError = "";
        state.candidateMaterialDetailKey = "";
        state.candidateMaterialDeleteKind = "";
        state.candidateMaterialDeleteConfirm = null;
    }
    if (action === "open-material-manager") {
        state.candidateMaterialManagerKind = button.dataset.kind;
        state.candidateInterviewManagerOpen = false;
        state.candidateMaterialDetailKey = "";
        state.candidateMaterialDeleteKind = "";
        state.candidateMaterialDeleteConfirm = null;
    }
    if (action === "close-material-manager") {
        state.candidateMaterialManagerKind = "";
        state.candidateMaterialDetailKey = "";
        state.candidateMaterialDeleteKind = "";
        state.candidateMaterialDeleteConfirm = null;
    }
    if (action === "close-interview-manager") {
        state.candidateInterviewManagerOpen = false;
        state.candidateApplicationDetailId = "";
    }
    if (action === "close-candidate-sheet") {
        state.candidateMaterialForm = "";
        state.candidateMaterialError = "";
        state.candidateApplicationDetailId = "";
        state.candidateMaterialDetailKey = "";
        state.candidateMaterialDeleteKind = "";
        state.candidateMaterialDeleteConfirm = null;
    }
    if (action === "close-interview-entry") {
        cancelCandidateInterviewPoll();
        state.candidateInterviewEntryAppId = "";
        state.candidateInterviewEntry = null;
    }
    if (action === "view-material-kind") {
        const firstItem = candidateMaterialItems(button.dataset.kind)[0];
        if (firstItem) {
            state.candidateMaterialDetailKey = `${button.dataset.kind}:${firstItem.id}`;
        }
    }
    if (action === "open-material-delete") {
        if (candidateMaterialItems(button.dataset.kind).length) {
            state.candidateMaterialDeleteKind = button.dataset.kind;
        }
    }
    if (action === "delete-candidate-material") {
        event.preventDefault();
        event.stopPropagation();
        state.candidateMaterialError = "";
        const item = materialByKindAndId(button.dataset.kind, button.dataset.materialId);
        state.candidateMaterialDeleteConfirm = {
            kind: button.dataset.kind,
            materialId: button.dataset.materialId,
            name: item?.name || "",
        };
        render();
        return;
    }
    if (action === "cancel-delete-candidate-material") {
        if (button.classList.contains("candidate-modal-backdrop") && event.target !== button) return;
        state.candidateMaterialDeleteConfirm = null;
        state.candidateMaterialError = "";
    }
    if (action === "confirm-delete-candidate-material") {
        event.preventDefault();
        event.stopPropagation();
        const confirm = state.candidateMaterialDeleteConfirm;
        if (!confirm?.kind || !confirm?.materialId) return;
        state.candidateMaterialError = "";
        state.candidateMaterialDeletingId = confirm.materialId;
        render();
        try {
            const result = await api.deleteCandidateMaterial(confirm.kind, confirm.materialId);
            if (result?.candidate) candidate = result.candidate;
            await refreshCandidateState();
            state.candidateMaterialDeleteKind = "";
            state.candidateMaterialDetailKey = "";
            state.candidateMaterialDeleteConfirm = null;
            state.candidateMaterialError = "";
            setToast("材料已删除；已提交投递仍保留当时的材料版本");
        }
        catch (error) {
            state.candidateMaterialError = `删除失败：${error.message || "请稍后重试"}`;
            setToast(state.candidateMaterialError);
        }
        finally {
            state.candidateMaterialDeletingId = "";
        }
        render();
        return;
    }
    if (action === "view-candidate-material") state.candidateMaterialDetailKey = button.dataset.key;
    if (action === "edit-candidate-portfolio") state.candidateMaterialDetailKey = button.dataset.key;
    if (action === "candidate-application-detail") state.candidateApplicationDetailId = button.dataset.appId;
    if (action === "candidate-update-materials") {
        const appId = button.dataset.appId;
        const app = appId ? applicationById(appId) : null;
        const requestId = button.dataset.requestId || currentMaterialUpdateRequestId(app);
        if (app && applicationMaterialUpdateUsed(app, requestId)) {
            setToast("这次补材料机会已使用，等待招聘者处理新材料");
            render();
            return;
        }
        if (appId && app) {
            state.applicationUpdateAppId = appId;
            state.applicationUpdateRequestId = requestId || "";
            clearApplicationSheetDraft(activeApplicationSheetKey());
            state.candidateApplicationDetailId = "";
            state.candidateInterviewManagerOpen = false;
            state.candidateMaterialManagerKind = "";
            state.candidateMaterialForm = "";
            state.candidateMaterialDetailKey = "";
            state.applicationSubmitError = "";
            setToast("请选择这次要更新的投递材料");
        }
        else {
            state.candidateApplicationDetailId = "";
            state.candidateInterviewManagerOpen = false;
            state.candidateTab = "profile";
            state.candidateMaterialManagerKind = button.dataset.kind || "portfolio";
            state.candidateMaterialForm = button.dataset.kind || "portfolio";
            state.candidateMaterialDetailKey = "";
            setToast("先更新材料库，招聘者会继续处理");
        }
        render();
        return;
    }
    if (action === "candidate-accept-interview") {
        if (aiInterviewExpired(applicationById(button.dataset.appId))) {
            setToast("这次 AI 面试邀请已过期，等待招聘者重新发送");
            render();
            return;
        }
        const result = await api.acceptInterview(button.dataset.appId, {});
        upsertApplication(result.application);
        setToast("AI 面试入口已确认");
    }
    if (action === "candidate-enter-interview") {
        const app = applicationById(button.dataset.appId);
        if (aiInterviewExpired(app)) {
            setToast("这次 AI 面试邀请已过期，等待招聘者重新发送");
            render();
            return;
        }
        state.candidateInterviewEntryAppId = button.dataset.appId;
        await loadCandidateInterviewEntry(button.dataset.appId);
        return;
    }
    if (action === "copy-interview-link") {
        const url = button.dataset.url;
        if (navigator.clipboard && isOpenableInterviewUrl(url)) {
            await navigator.clipboard.writeText(url).catch(() => null);
            setToast("面试链接已复制");
        }
        else {
            setToast("面试链接暂时无法复制，请长按或手动复制");
        }
        return;
    }
    if (action === "candidate-start-interview") {
        const appId = button.dataset.appId;
        if (!appId || state.candidateInterviewStartingAppId) return;
        cancelCandidateInterviewPoll();
        state.candidateInterviewStartingAppId = appId;
        render();
        try {
            const result = await api.startInterviewEntry(appId);
            if (result.application) upsertApplication(result.application);
            state.candidateInterviewEntry = result;
            const opened = openStartedInterviewUrl(result);
            setToast(opened ? "AI 面试间已打开" : result.reason || "当前不能进入 AI 面试");
        }
        catch (error) {
            state.candidateInterviewEntry = {reason: error.message || "AI 面试启动失败，请稍后重试"};
            setToast(state.candidateInterviewEntry.reason);
        }
        finally {
            state.candidateInterviewStartingAppId = "";
            render();
        }
        return;
    }
    if (action === "public-start-interview") {
        const route = publicInterviewRoute();
        if (!route.attemptId || !route.token || state.publicInterviewStarting) return;
        cancelPublicInterviewPoll();
        state.publicInterviewStarting = true;
        state.publicInterviewError = "";
        render();
        try {
            const result = await api.startPublicInterviewEntry(route.attemptId, route.token);
            state.publicInterviewEntry = result;
            const opened = openStartedInterviewUrl(result);
            setToast(opened ? "AI 面试间已打开" : result.reason || "当前不能进入 AI 面试");
        }
        catch (error) {
            state.publicInterviewError = error.message || "AI 面试启动失败，请稍后重试";
            setToast(state.publicInterviewError);
        }
        finally {
            state.publicInterviewStarting = false;
            render();
        }
        return;
    }
    if (action === "copy-interview-entry") {
        const url = button.dataset.url;
        if (isOpenableInterviewUrl(url)) {
            window.open(url, "_blank", "noopener");
        }
        if (navigator.clipboard && isOpenableInterviewUrl(url)) {
            await navigator.clipboard.writeText(url).catch(() => null);
        }
        setToast(isOpenableInterviewUrl(url) ? "面试入口已打开" : "面试入口地址无效，请重新获取");
    }
    if (action === "application-add-resume") {
        state.applicationSheetJobId = "";
        state.applicationUpdateAppId = "";
        state.applicationUpdateRequestId = "";
        state.applicationSubmitError = "";
        state.candidateTab = "profile";
        state.candidatePanel = "materials";
        state.candidateMaterialManagerKind = "resume";
        state.candidateInterviewManagerOpen = false;
        state.candidateJobDetail = false;
        setToast("先添加简历，之后再回到职位投递");
    }
    if (action === "close-application-sheet") {
        clearApplicationSheetDraft();
        state.applicationSheetJobId = "";
        state.applicationUpdateAppId = "";
        state.applicationUpdateRequestId = "";
        state.applicationSubmitting = false;
        state.applicationSubmitError = "";
    }
    if (action === "avatar-default") {
        try {
            const result = await api.updateCandidateProfile({avatar: {mode: "generated"}});
            candidate = result.candidate;
            state.avatarEditorOpen = false;
            state.avatarPreviewOpen = false;
            clearAvatarCrop();
            setToast("已恢复默认头像");
        }
        catch (error) {
            setToast(error.message || "恢复默认头像失败");
        }
    }
    if (action === "save-avatar-crop") {
        try {
            const croppedFile = await createCroppedAvatarFile();
            state.avatarCrop.saving = true;
            render();
            candidate = await uploadCandidateAvatar(croppedFile);
            state.avatarEditorOpen = false;
            clearAvatarCrop();
            setToast("头像已保存");
        }
        catch (error) {
            if (state.avatarCrop) {
                state.avatarCrop.saving = false;
                state.avatarCrop.error = error.message || "头像保存失败，请换一张图片";
            }
            setToast(error.message || "头像保存失败，请换一张图片");
        }
    }
    if (action === "candidate-panel") state.candidatePanel = button.dataset.panel;
    if (action === "open-job-detail") {
        state.selectedJobId = button.dataset.jobId;
        state.candidateJobDetail = true;
    }
    if (action === "close-job-detail") state.candidateJobDetail = false;
    if (action === "ask-job") {
        if (!state.loggedIn || !candidate?.id) {
            setToast("请先登录后再咨询岗位");
            render();
            return;
        }
        state.selectedJobId = button.dataset.jobId;
        state.candidateMessageJobId = button.dataset.jobId;
        state.candidatePanel = "consult";
        state.candidateTab = "messages";
        state.candidateJobDetail = false;
        state.candidateChatForceScrollJobId = button.dataset.jobId;
        markJobConsulted(button.dataset.jobId);
        const messages = messagesForJob(button.dataset.jobId);
        addConsultGreeting(button.dataset.jobId);
        const greeting = messages[messages.length - 1]?.text || "";
        try {
            const result = await api.markConsulted(button.dataset.jobId, greeting);
            state.consultMessagesByJob = result.consultations.consultMessagesByJob;
            state.consultedJobIds = result.consultations.consultedJobIds;
            state.consultVisitsByJob = result.consultations.consultVisitsByJob;
            state.candidateMessageLastSync = Date.now();
            await markCandidateConversationRead(button.dataset.jobId);
        }
        catch (error) {
            setToast(error.status === 401 ? "请先登录后再咨询岗位" : `打开聊天失败：${error.message}`);
        }
    }
    if (action === "candidate-chat-quick") {
        await sendCandidateChat(button.dataset.jobId, button.dataset.text, button.dataset.kind);
        return;
    }
    if (action === "message-list") state.candidateMessageJobId = "";
    if (action === "open-message") {
        state.selectedJobId = button.dataset.jobId;
        state.candidateMessageJobId = button.dataset.jobId;
        if (state.candidateChatScrollByJob[button.dataset.jobId] == null) {
            state.candidateChatForceScrollJobId = button.dataset.jobId;
        }
        markJobConsulted(button.dataset.jobId);
        await markCandidateConversationRead(button.dataset.jobId);
    }
    if (action === "dismiss-pinned-message") {
        if (!state.dismissedPinnedJobIds.includes(button.dataset.jobId)) {
            state.dismissedPinnedJobIds = [...state.dismissedPinnedJobIds, button.dataset.jobId];
        }
        setToast("已取消置顶，消息仍保留在岗位聊天里");
    }
    if (action === "apply-job") {
        state.selectedJobId = button.dataset.jobId;
        const exists = store.applications.some((app) => app.jobId === state.selectedJobId && app.candidateId === candidate.id);
        if (exists) {
            const existing = store.applications.find((app) => app.jobId === state.selectedJobId && app.candidateId === candidate.id);
            state.candidateApplicationDetailId = existing.id;
            state.candidateTab = "profile";
            state.candidateJobDetail = false;
            setToast("你已经投递过这个岗位，已打开投递详情");
        }
        else {
            state.applicationSheetJobId = state.selectedJobId;
            state.applicationSubmitError = "";
        }
    }
    if (action === "open-interview-todo") {
        state.candidateInterviewManagerOpen = true;
        state.candidateMaterialManagerKind = "";
        state.candidateApplicationDetailId = "";
    }
    if (action === "admin-page") {
        state.adminEditingSection = "";
        if (button.dataset.page === "jobs") {
            showAdminJobList();
        }
        else {
            rememberAdminWorkbenchUrl();
            state.adminPage = button.dataset.page;
            window.history.replaceState({}, "", "/admin");
        }
    }
    if (action === "admin-back") {
        handleAdminBack();
    }
    if (action === "admin-module") {
        state.adminEditingSection = "";
        if (button.dataset.module === "jobs") {
            restoreAdminWorkbench();
        }
        if (button.dataset.module === "candidateHub") {
            rememberAdminWorkbenchUrl();
            state.adminPage = "candidateHub";
            window.history.replaceState({}, "", "/admin");
        }
    }
    if (action === "toggle-admin-job-sidebar") {
        state.adminJobSidebarCollapsed = !state.adminJobSidebarCollapsed;
    }
    if (action === "clear-candidate-search") {
        state.adminCandidateQuery = "";
    }
    if (action === "clear-job-search") {
        state.adminJobQuery = "";
    }
    if (action === "select-visible-export-apps") {
        state.adminApplicationExportSelectedIds = filteredAdminApplicationsForExport(applicationsForJob(state.selectedJobId))
            .map((app) => app.id);
    }
    if (action === "clear-export-apps") {
        state.adminApplicationExportSelectedIds = [];
    }
    if (action === "new-job") {
        const result = await api.createJob({
            title: `新岗位 ${jobs.filter((job) => job.status === "草稿").length + 1}`,
            mode: "实习/全职",
            location: "北京/线上",
            jd: ["请补充岗位 JD。"],
        });
        const draft = result.job;
        jobs.unshift(draft);
        state.adminPage = "jobDetail";
        state.selectedJobId = draft.id;
        state.selectedJobTab = "jd";
        state.adminEditingSection = "jd";
        window.history.replaceState({}, "", adminJobUrl(state.selectedJobId, {tab: "jd"}));
        setToast("已创建草稿岗位，请先补 JD、知识库和评价体系");
    }
    if (action === "publish-job") {
        const job = jobById(button.dataset.jobId);
        const result = await api.updateJob(job.id, {status: "已发布"});
        Object.assign(job, result.job);
        state.adminPage = "jobDetail";
        state.selectedJobId = job.id;
        state.selectedJobTab = "jd";
        state.adminEditingSection = "";
        window.history.replaceState({}, "", adminJobUrl(state.selectedJobId, {tab: "jd"}));
        setToast("岗位已发布，候选人端可以看到");
    }
    if (action === "stop-job") {
        const job = jobById(button.dataset.jobId);
        const result = await api.updateJob(job.id, {status: "暂停"});
        Object.assign(job, result.job);
        state.adminPage = "jobDetail";
        state.selectedJobId = job.id;
        state.selectedJobTab = "jd";
        state.adminEditingSection = "";
        window.history.replaceState({}, "", adminJobUrl(state.selectedJobId, {tab: "jd"}));
        setToast("已停止招聘，候选人端不再展示");
    }
    if (action === "delete-job") {
        const job = jobById(button.dataset.jobId);
        state.adminDeleteJobId = job.id;
        state.adminDeleteJobError = "";
    }
    if (action === "cancel-delete-job") {
        if (button.classList.contains("candidate-modal-backdrop") && event.target !== button) {
            render();
            return;
        }
        state.adminDeleteJobId = "";
        state.adminDeleteJobError = "";
        state.adminDeletingJobId = "";
    }
    if (action === "cancel-force-interview") {
        if (button.classList.contains("candidate-modal-backdrop") && event.target !== button) {
            render();
            return;
        }
        state.adminForceInterviewAppId = "";
        state.adminForceInterviewReason = "";
        state.adminForceInterviewError = "";
        state.adminForceInterviewBusy = false;
        state.adminForceInterviewSessionId = "";
    }
    if (action === "open-admin-portfolio-detail") {
        state.adminPortfolioDetailAppId = button.dataset.appId;
        state.adminPortfolioDetailId = button.dataset.portfolioId;
    }
    if (action === "open-application-report") {
        state.activeApplicationId = button.dataset.appId || state.activeApplicationId;
        state.adminApplicationReportModal = ["prescreen", "ai"].includes(button.dataset.report)
            ? button.dataset.report
            : "prescreen";
        loadAdminApplicationReportMarkdown(state.activeApplicationId, state.adminApplicationReportModal);
    }
    if (action === "close-application-report") {
        if (button.classList.contains("candidate-modal-backdrop") && event.target !== button) {
            render();
            return;
        }
        state.adminApplicationReportModal = "";
    }
    if (action === "close-admin-portfolio-detail") {
        if (button.classList.contains("candidate-modal-backdrop") && event.target !== button) {
            render();
            return;
        }
        state.adminPortfolioDetailAppId = "";
        state.adminPortfolioDetailId = "";
    }
    if (action === "refresh-match-report") {
        const appId = button.dataset.appId;
        const {[appId]: _removed, ...rest} = state.adminMatchReportsByApp;
        state.adminMatchReportsByApp = rest;
        clearApplicationReportMarkdownCache(appId);
        await loadAdminMatchReport(appId);
        setToast("Markdown 匹配报告已刷新");
        return;
    }
    if (action === "confirm-delete-job") {
        const job = jobById(state.adminDeleteJobId);
        if (!job) {
            state.adminDeleteJobId = "";
            render();
            return;
        }
        state.adminDeletingJobId = job.id;
        try {
            await api.deleteJob(job.id);
        }
        catch (error) {
            state.adminDeleteJobError = error.message || "删除岗位失败";
            state.adminDeletingJobId = "";
            render();
            return;
        }
        jobs = jobs.filter((item) => item.id !== job.id);
        store.applications = store.applications.filter((app) => app.jobId !== job.id);
        if (state.selectedJobId === job.id) {
            state.selectedJobId = jobs[0]?.id || "";
        }
        state.adminDeleteJobId = "";
        state.adminDeleteJobError = "";
        state.adminDeletingJobId = "";
        showAdminJobList();
        state.selectedJobTab = "jd";
        state.adminEditingSection = "";
        setToast("岗位已删除；正式上线前可改为软删除留痕");
    }
    if (action === "enter-job") {
        state.adminPage = "jobDetail";
        state.selectedJobId = button.dataset.jobId;
        state.selectedJobTab = "jd";
        state.adminEditingSection = "";
        window.history.replaceState({}, "", adminJobUrl(state.selectedJobId, {tab: "jd"}));
    }
    if (action === "job-tab") {
        state.selectedJobTab = button.dataset.tab;
        state.adminEditingSection = "";
        state.routeAppIdApplied = "";
        state.activeApplicationId = "";
        if (routeName() === "admin" && state.selectedJobId) {
            const target = adminJobUrl(state.selectedJobId);
            state.adminWorkbenchReturnUrl = target;
            window.history.replaceState({}, "", target);
        }
        if (state.selectedJobTab === "communication") {
            await loadAdminConsultations(state.selectedJobId);
            return;
        }
    }
    if (action === "refresh-admin-consultations") {
        await loadAdminConsultations(button.dataset.jobId || state.selectedJobId);
        return;
    }
    if (action === "open-admin-consultation") {
        state.adminSelectedConsultationId = button.dataset.sessionId;
        state.adminMessageActionMenuId = "";
        if (state.adminChatScrollBySession[button.dataset.sessionId] == null) {
            state.adminChatForceScrollSessionId = button.dataset.sessionId;
        }
        try {
            const result = await api.markAdminConsultationRead(button.dataset.sessionId);
            upsertAdminConsultationResult(result);
        }
        catch (error) {
            setToast(`标记已读失败：${error.message}`);
        }
        render();
        return;
    }
    if (action === "open-admin-message-for-app") {
        const app = applicationById(button.dataset.appId);
        if (!app?.id) {
            setToast("没有找到这个候选人的投递记录");
            render();
            return;
        }
        try {
            const result = await api.ensureAdminConsultation(app.id);
            upsertAdminConsultationResult(result, app.jobId, {forceScroll: true});
            state.adminPage = "jobDetail";
            state.selectedJobId = app.jobId;
            state.selectedJobTab = "communication";
            state.activeApplicationId = "";
            state.adminEditingSection = "";
            window.history.replaceState({}, "", adminJobUrl(app.jobId, {tab: "communication"}));
            setToast("已打开候选人消息");
        }
        catch (error) {
            setToast(error.message || "打开消息失败");
        }
        render();
        return;
    }
    if (action === "mark-admin-consultation-read") {
        try {
            const result = await api.markAdminConsultationRead(button.dataset.sessionId);
            upsertAdminConsultationResult(result);
            setToast("已标记为已读");
        }
        catch (error) {
            setToast(`标记已读失败：${error.message}`);
        }
        render();
        return;
    }
    if (action === "toggle-admin-message-actions") {
        state.adminMessageActionMenuId = state.adminMessageActionMenuId === button.dataset.sessionId
            ? ""
            : button.dataset.sessionId;
        render();
        return;
    }
    if (action === "admin-chat-send-interview") {
        const app = applicationById(button.dataset.appId);
        const sessionId = button.dataset.sessionId;
        if (!app?.id) {
            setToast("没有找到这个候选人的投递记录");
            return;
        }
        if (state.adminSendingInterviewAppId === app.id) return;
        state.adminSendingInterviewAppId = app.id;
        render();
        try {
            const result = await api.createInterviewInvitation(app.id, {
                force: true,
                forceReason: "招聘者从消息中手动发送或重发 AI 面试邀请。",
            });
            upsertApplication(result.application);
            if (result.publicEntryUrl && navigator.clipboard) {
                await navigator.clipboard.writeText(result.publicEntryUrl).catch(() => null);
            }
            let notificationFailed = false;
            try {
                const message = await api.sendAdminConsultationMessage(sessionId, {
                    kind: "interview_invite",
                    applicationId: app.id,
                    text: "AI 面试邀请已准备好，你可以在有效期内随时进入。",
                });
                upsertAdminConsultationResult(message, state.selectedJobId, {forceScroll: true});
            }
            catch (messageError) {
                notificationFailed = true;
                setToast(`AI 面试已发起，但消息通知失败：${messageError.message || "请稍后重试"}`);
            }
            await refreshAdminInterviewState({jobId: app.jobId, sessionId});
            state.adminMessageActionMenuId = "";
            if (!notificationFailed) setToast(result.publicEntryUrl ? "已发送 AI 面试邀请，公开链接已复制" : "已发送 AI 面试邀请");
        }
        catch (error) {
            setToast(error.message || "AI 面试邀请发送失败");
        }
        finally {
            state.adminSendingInterviewAppId = "";
            render();
        }
        return;
    }
    if (action === "admin-chat-request-materials") {
        const app = applicationById(button.dataset.appId);
        if (!app?.id) {
            setToast("没有找到这个候选人的投递记录");
            return;
        }
        try {
            const materialKind = suggestedMaterialKindForApp(app);
            const updated = await api.updateApplication(app.id, {
                materialUpdateAction: "request",
                materialKind,
                note: "招聘者从消息中要求候选人更新或补充材料。",
            });
            upsertApplication(updated.application);
            const materialUpdateRequestId = currentMaterialUpdateRequestId(updated.application);
            const result = await api.sendAdminConsultationMessage(button.dataset.sessionId, {
                kind: "material_request",
                applicationId: app.id,
                materialKind,
                materialUpdateRequestId,
                text: "请更新或补充材料。你可以先在材料库里增加/更改，再回到这个岗位继续查看进度。",
            });
            upsertAdminConsultationResult(result, state.selectedJobId, {forceScroll: true});
            state.adminMessageActionMenuId = "";
            setToast("已发送补材料通知");
        }
        catch (error) {
            setToast(error.message || "补材料通知发送失败");
        }
        render();
        return;
    }
    if (action === "upload-job-knowledge") {
        Array.from(document.querySelectorAll("[data-input='job-knowledge-file']"))
            .find((input) => input.dataset.jobId === button.dataset.jobId)
            ?.click();
        return;
    }
    if (action === "delete-job-knowledge") {
        const job = jobById(state.selectedJobId);
        try {
            const result = await api.deleteKnowledgeSource(job.id, button.dataset.sourceId);
            job.knowledge = (job.knowledge || []).filter((source) => source.id !== result.source.id);
            setToast("岗位资料已删除");
        }
        catch (error) {
            setToast(error.message || "岗位资料删除失败");
        }
    }
    if (action === "add-rubric-preset") {
        const job = jobById(state.selectedJobId);
        const result = await api.addScreeningRule(job.id, {
            type: button.dataset.type,
            label: button.dataset.label,
            value: button.dataset.value,
        });
        Object.assign(job, result.job);
        state.adminEditingRuleId = "";
        setToast("评价项已加入当前岗位；已有同名评价项不会重复添加");
    }
    if (action === "toggle-rubric-template-edit") {
        state.adminEditingRuleTemplates = !state.adminEditingRuleTemplates;
    }
    if (action === "save-rubric-template") {
        const form = button.closest("form");
        const formData = new FormData(form);
        try {
            const label = String(formData.get("label") || "").trim();
            const existedBefore = store.screeningRuleTemplates.some((template) => templateLabelKey(template.label) === templateLabelKey(label));
            const result = await api.createScreeningRuleTemplate({
                type: formData.get("type"),
                label,
                value: formData.get("value"),
            });
            const latest = await api.listScreeningRuleTemplates();
            const templates = latest.templates || [];
            store.screeningRuleTemplates = templates.length
                ? templates
                : [
                    ...store.screeningRuleTemplates.filter((template) => template.id !== result.template?.id),
                    result.template,
                ].filter(Boolean);
            state.adminRecentTemplateId = result.template?.id || "";
            const existsInStore = store.screeningRuleTemplates.some((template) => template.id === result.template?.id || template.label === label);
            const wasCreated = result.created ?? !existedBefore;
            setToast(wasCreated
                ? `已沉淀为全局评价标准：${label || result.template?.label || "自定义评价项"}`
                : existsInStore
                    ? `这个评价标准已经存在：${result.template?.label || label || "自定义评价项"}`
                    : "标准已保存，刷新后会显示");
        }
        catch (error) {
            setToast(error.message || "沉淀标准失败，请稍后重试");
        }
    }
    if (action === "delete-rubric-template") {
        try {
            const result = await api.deleteScreeningRuleTemplate(button.dataset.templateId);
            store.screeningRuleTemplates = store.screeningRuleTemplates.filter((template) => template.id !== result.template.id);
            setToast("已删除全局评价标准，不影响已配置岗位");
        }
        catch (error) {
            setToast(error.message || "删除标准失败");
        }
    }
    if (action === "edit-rubric-rule") {
        state.adminEditingRuleId = button.dataset.ruleId;
    }
    if (action === "cancel-rubric-edit") {
        state.adminEditingRuleId = "";
    }
    if (action === "delete-rubric-rule") {
        const job = jobById(state.selectedJobId);
        const result = await api.deleteScreeningRule(job.id, button.dataset.ruleId);
        Object.assign(job, result.job);
        if (state.adminEditingRuleId === button.dataset.ruleId) {
            state.adminEditingRuleId = "";
        }
        setToast("评价项已删除");
    }
    if (action === "edit-admin-section") state.adminEditingSection = button.dataset.section;
    if (action === "cancel-admin-edit") state.adminEditingSection = "";
    if (action === "complete-prescreen") {
        const app = applicationById(button.dataset.appId);
        const result = await api.updateApplication(app.id, {prescreenAction: "complete"});
        upsertApplication(result.application);
        setToast("评价报告已生成，等待管理员确认下一步");
    }
    if (action === "retry-evidence") {
        const app = applicationById(button.dataset.appId);
        const result = await api.updateApplication(app.id, {evidenceAction: "retry"});
        upsertApplication(result.application);
        setToast("已重新提交材料解析 worker");
    }
    if (action === "rerun-prescreen") {
        const app = applicationById(button.dataset.appId);
        const result = await api.updateApplication(app.id, {prescreenAction: "rerun"});
        upsertApplication(result.application);
        setToast("已重新提交评价 worker");
    }
    if (action === "override-prescreen-pass") {
        const app = applicationById(button.dataset.appId);
        const result = await api.updateApplication(app.id, {
            overrideScreen: "人工通过评价",
            note: "招聘者已人工通过初筛。",
        });
        upsertApplication(result.application);
        try {
            const invitation = await api.createInterviewInvitation(app.id, {manualPrescreenPass: true});
            upsertApplication(invitation.application);
            setToast("已通过初筛，AI 面试邀请已自动生成");
        }
        catch (error) {
            setToast(`已通过初筛，但自动邀面失败：${error.message || "请稍后重试"}`);
        }
    }
    if (action === "candidate-detail") {
        state.adminPage = "candidateDetail";
        state.selectedCandidateId = button.dataset.candidateId;
    }
    if (action === "copy-admin-interview-link") {
        const url = button.dataset.url || "";
        if (!url) {
            setToast("这条面试邀请还没有可复制的公开链接");
        }
        else if (navigator.clipboard) {
            await navigator.clipboard.writeText(url).catch(() => null);
            setToast("面试公开链接已复制");
        }
        else {
            setToast("浏览器暂不支持自动复制，请手动选中链接");
        }
    }
    if (action === "start-interview") {
        const app = applicationById(button.dataset.appId);
        if (state.adminSendingInterviewAppId === app?.id) return;
        const forceReason = reusableForceInterviewReason(app);
        const force = needsMaterialBeforeInterview(app);
        if (force && !forceReason) {
            state.adminForceInterviewAppId = app.id;
            state.adminForceInterviewReason = "";
            state.adminForceInterviewError = "";
            state.adminForceInterviewBusy = false;
            state.adminForceInterviewSessionId = "";
            render();
            return;
        }
        state.adminSendingInterviewAppId = app.id;
        render();
        try {
            const result = await api.createInterviewInvitation(app.id, forceReason ? {
                force: true,
                forceReason,
            } : {});
            upsertApplication(result.application);
            if (result.publicEntryUrl && navigator.clipboard) {
                await navigator.clipboard.writeText(result.publicEntryUrl).catch(() => null);
            }
            await refreshAdminInterviewState({jobId: app.jobId});
            setToast(result.publicEntryUrl ? "AI 面试邀请已生成，公开链接已复制" : "AI 面试邀请已生成，候选人端会看到进入入口");
        }
        catch (error) {
            setToast(error.message || "AI 面试邀请失败");
        }
        finally {
            state.adminSendingInterviewAppId = "";
            render();
        }
        return;
    }
    if (action === "generate-interview-plan") {
        const app = applicationById(button.dataset.appId);
        const result = await api.generateInterviewPlan(app.id, {force: hasInterviewPlan(app)});
        upsertApplication(result.application);
        state.selectedJobTab = "interviews";
        window.history.replaceState({}, "", adminJobUrl(app.jobId, {tab: "interviews"}));
        setToast("面试计划已生成；初筛通过后的邀面会自动发起");
    }
    if (action === "open-review") {
        const app = applicationById(button.dataset.appId);
        state.adminPage = "jobDetail";
        state.selectedJobId = app.jobId;
        state.selectedJobTab = "applications";
        state.activeApplicationId = app.id;
        window.history.replaceState({}, "", adminJobUrl(app.jobId, {tab: "applications", appId: app.id}));
    }
    if (action === "pick-review-app") {
        state.activeApplicationId = button.dataset.appId;
    }
    renderAfterCandidateTabbarSettles();
});

function handlePopState() {
    const wasAdmin = state.lastRouteName === "admin";
    if (wasAdmin && routeName() === "candidate") {
        window.history.replaceState({}, "", state.lastAdminRoute || "/admin");
    }
    render();
}

window.addEventListener("popstate", handlePopState);

await loadBootstrap();
render();
