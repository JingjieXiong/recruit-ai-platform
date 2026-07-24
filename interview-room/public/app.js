const params = new URLSearchParams(window.location.search);
const sessionId = params.get("sessionId") || "";
const returnUrl = params.get("returnUrl") || "";
const isPreview = params.get("preview") === "1";

const elements = {
    loading: document.querySelector("#loading-state"),
    preview: document.querySelector("#preview-state"),
    interview: document.querySelector("#interview-state"),
    complete: document.querySelector("#complete-state"),
    roomTitle: document.querySelector("#room-title"),
    roomSubtitle: document.querySelector("#room-subtitle"),
    previewTitle: document.querySelector("#preview-title"),
    previewText: document.querySelector("#preview-text"),
    questionNumber: document.querySelector("#question-number"),
    questionCompetency: document.querySelector("#question-competency"),
    questionText: document.querySelector("#question-text"),
    answerInput: document.querySelector("#answer-input"),
    submitButton: document.querySelector("#submit-button"),
    speakButton: document.querySelector("#speak-button"),
    error: document.querySelector("#error-message"),
    progressBar: document.querySelector("#progress-bar"),
    progressLabel: document.querySelector("#progress-label"),
    completeSummary: document.querySelector("#complete-summary"),
    returnLink: document.querySelector("#return-link"),
};

let session = null;

function show(name) {
    for (const key of ["loading", "preview", "interview", "complete"]) {
        elements[key].hidden = key !== name;
    }
}

function currentQuestion() {
    return session?.questionBank?.[session.currentQuestionIndex] || null;
}

function renderSession() {
    if (!session) return;
    const total = session.questionBank.length;
    const current = Math.min(session.currentQuestionIndex, total);
    const percent = total ? Math.round((current / total) * 100) : 0;
    elements.progressBar.style.width = `${percent}%`;
    elements.progressLabel.textContent = session.status === "closed"
        ? `${total}/${total} 已完成`
        : `${current + 1}/${total} 进行中`;
    elements.roomTitle.textContent = session.projectSnapshot?.interviewPlan?.title || "AI 面试间";
    elements.roomSubtitle.textContent = session.projectSnapshot?.source?.jobTitle
        ? `岗位：${session.projectSnapshot.source.jobTitle}`
        : "问题基于岗位、合成材料与初筛待核验点生成。";

    if (session.status === "closed") {
        elements.completeSummary.textContent = session.report?.summary || "结构化报告已经生成并尝试回写招聘平台。";
        elements.returnLink.href = returnUrl || "/";
        elements.returnLink.hidden = !returnUrl;
        show("complete");
        return;
    }
    const question = currentQuestion();
    if (!question) {
        show("complete");
        return;
    }
    elements.questionNumber.textContent = `问题 ${session.currentQuestionIndex + 1}`;
    elements.questionCompetency.textContent = question.competency || question.type || "结构化问答";
    elements.questionText.textContent = question.prompt || "请回答当前问题。";
    elements.answerInput.value = "";
    elements.answerInput.focus();
    show("interview");
}

async function loadSession() {
    const response = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "会话不存在");
    session = body.session;
    renderSession();
}

async function submitAnswer() {
    const answerText = elements.answerInput.value.trim();
    if (!answerText) {
        elements.error.textContent = "请先输入一段合成回答。";
        return;
    }
    elements.error.textContent = "";
    elements.submitButton.disabled = true;
    try {
        const response = await fetch(`/api/agent-sessions/${encodeURIComponent(sessionId)}/answers`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({answerText}),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "提交失败");
        session = body.session;
        renderSession();
    }
    catch (error) {
        elements.error.textContent = error.message;
    }
    finally {
        elements.submitButton.disabled = false;
    }
}

function speakQuestion() {
    if (!("speechSynthesis" in window)) {
        elements.error.textContent = "当前浏览器不支持语音朗读。";
        return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(elements.questionText.textContent);
    utterance.lang = "zh-CN";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
}

elements.submitButton.addEventListener("click", submitAnswer);
elements.speakButton.addEventListener("click", speakQuestion);
elements.answerInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        void submitAnswer();
    }
});

if (isPreview) {
    elements.roomTitle.textContent = params.get("jobTitle") || "AI 面试间";
    elements.previewTitle.textContent = "浏览器面试 Provider";
    elements.previewText.textContent = params.get("previewText")
        || "浏览器朗读题目、记录合成回答，并通过状态回调回写结构化报告。";
    elements.progressBar.style.width = "68%";
    elements.progressLabel.textContent = "招聘者预览";
    show("preview");
}
else if (!sessionId) {
    elements.previewTitle.textContent = "等待主系统创建会话";
    elements.previewText.textContent = "请从招聘平台的 AI 面试邀请进入。";
    show("preview");
}
else {
    loadSession().catch((error) => {
        elements.previewTitle.textContent = "会话无法打开";
        elements.previewText.textContent = error.message;
        show("preview");
    });
}
