const TECHNICAL_ERROR_PATTERN = /\{\s*"error"|request id|new_api_error|convert_request_failed|not available|backend-anon\/conversation failed/i;
const ACTIONABLE_ERROR_PATTERN = /积分不足|余额不足|请先登录|登录(?:状态)?(?:已)?失效|没有权限|无权访问|请求过于频繁|内容(?:不符合|未通过).*审核/;

export function friendlyAgentError(value: unknown, fallback = "Agent 暂时无法完成这次任务，请切换模型或稍后重试。") {
    const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
    const actionable = actionableErrorMessage(message);
    if (actionable) return actionable;
    if (!message || TECHNICAL_ERROR_PATTERN.test(message)) return fallback;
    if (/任务依赖无法继续执行/.test(message)) return "部分创作任务未能完成，请调整需求后重试。";
    return message;
}

export function formatAgentMessageText(text: string) {
    const actionable = actionableErrorMessage(text);
    if (actionable) return actionable;
    if (TECHNICAL_ERROR_PATTERN.test(text)) return "当前模型暂不可用，请切换模型或稍后重试。";
    const legacyTextResult = text.match(/^已完成 1 个创作任务。\s*「[^」]+」已完成：\s*\*\*(.+?)\*\*/s);
    if (legacyTextResult?.[1]) return legacyTextResult[1].trim();
    if (/^正在执行任务 task-[^（]+（第 \d+ 次）…?$/.test(text.trim())) return "正在执行创作任务…";
    if (text.trim() === "任务依赖无法继续执行") return "部分创作任务未能完成，请调整需求后重试。";
    if (text.trim() === "创作计划与后台生成任务已全部完成。") return "创作任务已完成。";
    return text
        .split("\n")
        .filter((line) => !/^「[^」]+」已生成(?:并返回画布)?。$/.test(line.trim()))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function actionableErrorMessage(value: string) {
    const text = value.trim();
    if (!text.startsWith("{")) return normalizeActionableError(text);
    try {
        const payload = JSON.parse(text) as Record<string, unknown>;
        const error = payload.error;
        const response = payload.response && typeof payload.response === "object" ? (payload.response as Record<string, unknown>) : undefined;
        const responseError = response?.error;
        const candidates = [payload.msg, payload.message, error, objectMessage(error), response?.msg, responseError, objectMessage(responseError)];
        return candidates.map((candidate) => (typeof candidate === "string" ? normalizeActionableError(candidate.trim()) : "")).find(Boolean) || normalizeActionableError(text);
    } catch {
        return "";
    }
}

function objectMessage(value: unknown) {
    return value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string" ? String((value as { message: string }).message) : "";
}

function normalizeActionableError(message: string) {
    if (/积分不足|余额不足/.test(message)) return "积分不足";
    return ACTIONABLE_ERROR_PATTERN.test(message) ? message : "";
}
