import type { AgentRun, AgentRunTask } from "./agent-run-store";

export function agentTaskCompletionMessage(task: AgentRunTask, surface: AgentRun["surface"] = "canvas") {
    if (task.type === "text") {
        const summary = resultSummary(task.result);
        return summary ? `「${task.title}」已完成：\n${summary.slice(0, 1600)}` : `「${task.title}」已完成。`;
    }
    return surface === "canvas" ? `「${task.title}」已生成并返回画布。` : `「${task.title}」已生成。`;
}

export function agentRunCompletionReply(run: AgentRun) {
    const completed = run.tasks.filter((task) => task.status === "completed");
    if (!completed.length && run.projectHandoff) return "项目资料已整理完成。";
    if (wantsTextOnly(run.prompt) && completed.length === 1 && completed[0].type === "text") {
        return enforceRequestedLength(conciseTextResult(resultSummary(completed[0].result)), run.prompt) || `「${completed[0].title}」已完成。`;
    }
    const details = completed.map((task) => agentTaskCompletionMessage(task, run.surface)).join("\n\n");
    if (run.surface === "chat" && completed.length === 1 && completed[0].type !== "text") return details;
    return `已完成 ${completed.length} 个创作任务。${details ? `\n\n${details}` : ""}`;
}

export function agentRunFailureMessage(tasks: AgentRunTask[]) {
    const failed = tasks.find((task) => task.status === "failed" && task.error?.trim());
    return failed ? `「${failed.title}」失败：${failed.error!.trim()}` : "创作任务执行失败";
}

function wantsTextOnly(prompt: string) {
    return /只需要(?:最终)?文本(?:产物|结果)?|只(?:返回|输出)(?:最终)?(?:文案|文本|结果)|不要解释|直接(?:给|说|返回|输出)(?:我)?(?:答案|结果|文案)|别(?:解释|啰嗦|展开)/.test(prompt);
}

function conciseTextResult(value: string) {
    const paragraph =
        value
            .split(/\n\s*\n/)
            .map((item) => item.trim())
            .find(Boolean) || "";
    const line =
        paragraph
            .split("\n")
            .map((item) => item.trim())
            .find((item) => item && !/^[-*]\s/.test(item)) || "";
    return line
        .replace(/^#{1,6}\s*/, "")
        .replace(/^「[^」]+」(?:已完成)?[:：]?\s*/, "")
        .replace(/^\*\*(.+)\*\*$/, "$1")
        .trim()
        .slice(0, 500);
}

function enforceRequestedLength(value: string, prompt: string) {
    const limit = Number(prompt.match(/(?:不超过|最多|控制在|限|)(\d{1,3})\s*字(?:以内|以下|之内)?/)?.[1] || 0);
    if (!limit || !value) return value;
    return Array.from(value).slice(0, limit).join("");
}

export function resultSummary(value: unknown) {
    if (!value) return "";
    if (typeof value === "string") return value.slice(0, 4000);
    if (typeof value !== "object") return String(value).slice(0, 1000);
    const record = value as Record<string, unknown>;
    const content = typeof record.content === "string" ? record.content : "";
    if (content) return content.slice(0, 4000);
    const url = [record.remoteUrl, record.serverUrl, record.url, record.dataUrl].find((item) => typeof item === "string" && item);
    return typeof url === "string" ? (url.startsWith("data:") ? "已生成可用媒体产物" : `媒体地址：${url.slice(0, 2000)}`) : JSON.stringify(value).slice(0, 2000);
}
