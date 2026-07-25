import { isCreativeProjectHandoff, type CreativeAsset, type CreativeConversation, type CreativeConversationSource, type CreativeMessage, type CreativeProjectHandoff, type CreativeRunRequest } from "@/lib/creative-runtime-contract";
import { refreshUserPointsIfSystem } from "@/services/api/points";

export type CreativeAgentRun = {
    id: string;
    conversationId: string;
    inputMessageId: string;
    assistantMessageId: string;
    status: "planning" | "running" | "paused" | "completed" | "failed" | "cancelled";
    assetIds: string[];
    tasks: Array<{ id: string; title: string; status: "ready" | "running" | "completed" | "failed"; error?: string }>;
};

type ApiResponse<T> = { code: number; data: T; msg: string };

export function listCreativeConversationPage(input: { source?: CreativeConversationSource; offset?: number; limit?: number } = {}) {
    const query = new URLSearchParams({ surface: "chat", source: input.source || "agent", status: "active", limit: String(input.limit || 50), offset: String(input.offset || 0) });
    return request<{ conversations: CreativeConversation[]; hasMore: boolean }>(`/api/creative/conversations?${query}`);
}

export function listCreativeConversations(source: CreativeConversationSource = "agent") {
    return listCreativeConversationPage({ source, limit: 100 }).then((data) => data.conversations);
}

export function getCreativeConversation(conversationId: string) {
    return request<{ conversation: CreativeConversation }>(`/api/creative/conversations/${encodeURIComponent(conversationId)}`).then((data) => data.conversation);
}

export function listCreativeMessages(conversationId: string, beforeSequence?: number) {
    const query = new URLSearchParams({ limit: "200" });
    if (beforeSequence) query.set("beforeSequence", String(beforeSequence));
    return request<{ messages: CreativeMessage[] }>(`/api/creative/conversations/${encodeURIComponent(conversationId)}/messages?${query}`).then((data) => data.messages);
}

export function listCreativeAssets(conversationId: string) {
    return request<{ assets: CreativeAsset[] }>(`/api/creative/conversations/${encodeURIComponent(conversationId)}/assets`).then((data) => data.assets);
}

export function createCreativeConversation(input: { surface: "chat" | "canvas" | "drama"; source?: CreativeConversation["source"]; projectId?: string; title?: string }) {
    return request<{ conversation: CreativeConversation }>("/api/creative/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    }).then((data) => data.conversation);
}

export function uploadCreativeAsset(conversationId: string, file: File) {
    const body = new FormData();
    body.set("conversationId", conversationId);
    body.set("file", file);
    return request<{ asset: CreativeAsset }>("/api/creative/assets", { method: "POST", body }).then((data) => data.asset);
}

export function createCreativeAgentRun(input: CreativeRunRequest) {
    return request<{ run: CreativeAgentRun; conversation?: CreativeConversation; created: boolean }>("/api/agent/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export function controlCreativeAgentRun(runId: string, action: "cancel" | "pause" | "resume") {
    return request<{ run: CreativeAgentRun }>(`/api/agent/runs/${encodeURIComponent(runId)}/${action}`, { method: "POST" });
}

export function getCreativeAgentRun(runId: string) {
    return request<{ run: CreativeAgentRun }>(`/api/agent/runs/${encodeURIComponent(runId)}`).then((data) => data.run);
}

export function retryCreativeAgentTask(runId: string, taskId: string) {
    return request<{ run: CreativeAgentRun }>(`/api/agent/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/retry`, { method: "POST" }).then((data) => data.run);
}

export function updateCreativeConversation(conversationId: string, patch: { title?: string; status?: CreativeConversation["status"] }) {
    return request<{ conversation: CreativeConversation }>(`/api/creative/conversations/${encodeURIComponent(conversationId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    }).then((data) => data.conversation);
}

export function archiveCreativeConversation(conversationId: string) {
    return updateCreativeConversation(conversationId, { status: "archived" });
}

type CreativeRunHandlers = {
    onProgress: (text: string) => void;
    onTerminal: (status: "completed" | "failed" | "cancelled", text?: string) => void;
    onConnectionError: (message: string) => void;
    onProjectHandoff?: (handoff: CreativeProjectHandoff) => void;
    onStatus?: (status: CreativeAgentRun["status"]) => void;
    onTaskCompleted?: () => void;
};

export function watchCreativeAgentRun(runId: string, handlers: CreativeRunHandlers) {
    const source = new EventSource(`/api/agent/runs/${encodeURIComponent(runId)}/events`);
    let settled = false;
    let connectionErrors = 0;
    const read = (event: Event) => {
        let parsed: { data?: Record<string, unknown>; status?: string };
        try {
            parsed = JSON.parse((event as MessageEvent<string>).data) as { data?: Record<string, unknown>; status?: string };
        } catch {
            return null;
        }
        return parsed;
    };
    const finish = (status: "completed" | "failed" | "cancelled", text?: string) => {
        if (settled) return;
        settled = true;
        source.close();
        void refreshUserPointsIfSystem("system");
        handlers.onTerminal(status, text);
    };
    const listen = (type: string, callback: (payload: { data?: Record<string, unknown>; status?: string }) => void) =>
        source.addEventListener(type, (event) => {
            const payload = read(event);
            if (payload) callback(payload);
        });

    listen("run.planning", () => handlers.onProgress("正在理解需求并选择合适的创作能力"));
    listen("skills.selected", () => handlers.onProgress("正在匹配创作技能与模型"));
    listen("run.planned", ({ data }) => {
        void refreshUserPointsIfSystem("system");
        handlers.onProgress(text(data?.reply) || "方案已确定，正在创建任务");
    });
    listen("task.running", ({ data }) => handlers.onProgress(`正在处理「${text(data?.title) || "创作任务"}」`));
    listen("task.completed", ({ data }) => {
        void refreshUserPointsIfSystem("system");
        handlers.onProgress(text(data?.message) || `「${text(data?.title) || "创作任务"}」已完成`);
        handlers.onTaskCompleted?.();
    });
    listen("project.handoff", ({ data }) => {
        if (isCreativeProjectHandoff(data?.projectHandoff || data)) handlers.onProjectHandoff?.((data?.projectHandoff || data) as CreativeProjectHandoff);
    });
    listen("run.review.retry", () => handlers.onProgress("正在优化生成结果"));
    listen("run.review.passed", () => {
        void refreshUserPointsIfSystem("system");
        handlers.onProgress("检查完成，正在整理结果");
    });
    listen("run.review.unavailable", () => {
        void refreshUserPointsIfSystem("system");
        handlers.onProgress("正在整理已完成的创作结果");
    });
    listen("run.completed", ({ data }) => finish("completed", text(data?.reply)));
    listen("run.failed", ({ data }) => finish("failed", text(data?.message) || "Agent 执行失败"));
    listen("run.cancelled", () => finish("cancelled", "任务已取消"));
    listen("run.snapshot", (payload) => {
        if (payload.status && ["planning", "running", "paused", "completed", "failed", "cancelled"].includes(payload.status)) handlers.onStatus?.(payload.status as CreativeAgentRun["status"]);
        if (payload.status === "completed") finish("completed");
        if (payload.status === "failed") finish("failed", "Agent 执行失败");
        if (payload.status === "cancelled") finish("cancelled", "任务已取消");
        if (payload.status === "paused") handlers.onProgress("任务已暂停");
    });
    source.onopen = () => {
        connectionErrors = 0;
    };
    source.onerror = () => {
        if (settled) return;
        connectionErrors += 1;
        if (connectionErrors >= 5) {
            settled = true;
            source.close();
            handlers.onConnectionError("事件连接多次重试后仍无法恢复");
        } else {
            handlers.onProgress(`连接暂时中断，正在进行第 ${connectionErrors} 次恢复`);
        }
    };
    return () => {
        settled = true;
        source.close();
    };
}

async function request<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
    if (!response.ok || !payload || payload.code !== 0) throw new Error(payload?.msg || "请求失败");
    return payload.data;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
