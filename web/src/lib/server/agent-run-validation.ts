import type { CreativeFoundation } from "@/lib/creative-agent-contract";
import type { CreativeProjectHandoffPlan } from "@/lib/creative-runtime-contract";

export type AgentPlan = {
    intent?: "conversation" | "generation";
    objective: string;
    audience?: string;
    reply?: string;
    skillIds?: string[];
    decisions?: Array<{ label: string; value: string; reason: string }>;
    foundation: CreativeFoundation;
    brand?: { summary?: string; colors?: string[]; visualKeywords?: string[] };
    projectHandoff?: CreativeProjectHandoffPlan;
    deliverables: Array<{
        id?: string;
        targetNodeId?: string;
        title: string;
        type: "text" | "image" | "video" | "audio";
        model?: string;
        prompt: string;
        count?: number;
        ratio?: string;
        quality?: string;
        seconds?: number;
        voice?: string;
        format?: string;
        dependencies?: string[];
        assetIds?: string[];
    }>;
};

export function validateAgentPlan(value: unknown): asserts value is AgentPlan {
    const plan = value as AgentPlan;
    if (!plan?.objective?.trim() || !Array.isArray(plan.deliverables) || plan.deliverables.length > 50) throw new Error("模型返回的创作计划无效");
    if (plan.skillIds !== undefined && (!Array.isArray(plan.skillIds) || plan.skillIds.length > 6 || plan.skillIds.some((id) => typeof id !== "string" || !id.trim()))) throw new Error("模型返回的技能选择无效");
    if (plan.intent === "conversation") {
        if (!plan.reply?.trim() || plan.deliverables.length || plan.projectHandoff) throw new Error("模型返回的对话结果无效");
        return;
    }
    if (!plan.deliverables.length && !plan.projectHandoff) throw new Error("模型返回的创作计划无效");
    if (
        plan.projectHandoff &&
        (!["canvas", "drama"].includes(plan.projectHandoff.surface) ||
            !plan.projectHandoff.title?.trim() ||
            (plan.projectHandoff.ratio !== undefined && plan.projectHandoff.ratio !== "9:16" && plan.projectHandoff.ratio !== "16:9") ||
            (plan.projectHandoff.assetIds !== undefined && (!Array.isArray(plan.projectHandoff.assetIds) || plan.projectHandoff.assetIds.some((id) => typeof id !== "string" || !id.trim()))))
    )
        throw new Error("模型返回的项目交接参数无效");
    if (
        plan.deliverables.some(
            (item) =>
                !item?.title?.trim() ||
                !item?.prompt?.trim() ||
                !["text", "image", "video", "audio"].includes(item.type) ||
                (item.assetIds !== undefined && (!Array.isArray(item.assetIds) || item.assetIds.some((id) => typeof id !== "string" || !id.trim()))),
        )
    )
        throw new Error("模型返回的任务参数无效");
    if (plan.decisions && (!Array.isArray(plan.decisions) || plan.decisions.length > 8 || plan.decisions.some((item) => !item?.label?.trim() || !item?.value?.trim() || !item?.reason?.trim()))) throw new Error("模型返回的决策摘要无效");
    const ids = new Set(plan.deliverables.map((item, index) => item.id?.trim() || `task-${index}`));
    if (ids.size !== plan.deliverables.length || plan.deliverables.some((item) => item.dependencies?.some((dependency) => !ids.has(dependency)))) throw new Error("模型返回的任务依赖无效");
}

export function validateAgentTaskResult(type: AgentPlan["deliverables"][number]["type"], value: unknown) {
    if (!value || typeof value !== "object") throw new Error("生成任务完成但没有返回有效产物");
    const record = value as Record<string, unknown>;
    const list = [record.results, record.images, record.outputs, record.items].find((item) => Array.isArray(item) && item.length > 0) as unknown[] | undefined;
    if (list) {
        if (list.some((item) => !validMediaRecord(item))) throw new Error("图片任务包含无效产物");
        return;
    }
    if (type === "text" && !(typeof record.content === "string" && record.content.trim())) throw new Error("文本任务没有返回有效内容");
    if (type !== "text" && !validMediaRecord(record)) throw new Error(`${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}任务没有返回有效媒体地址`);
}

export function agentTaskCopies(type: AgentPlan["deliverables"][number]["type"], count: number) {
    return type === "image" ? Math.max(1, Math.min(10, Math.floor(Number(count) || 1))) : 1;
}

export function resolveAgentTaskCount(type: AgentPlan["deliverables"][number]["type"], planned: unknown, skillDefault: unknown, canvasDefault: unknown) {
    if (type !== "image") return 1;
    const value = Number(planned) || Number(skillDefault) || Number(canvasDefault) || 1;
    return Math.max(1, Math.min(10, Math.floor(value)));
}

export function resolveAgentVideoSeconds(type: AgentPlan["deliverables"][number]["type"], planned: unknown, skillDefault: unknown, backendDefault: unknown) {
    if (type !== "video") return undefined;
    const value = [planned, skillDefault, backendDefault].map(Number).find((item) => Number.isFinite(item) && item > 0) || 5;
    return Math.max(1, Math.min(20, Math.floor(value)));
}

export function agentChildTaskTerminal(status: unknown): "success" | "error" | "cancelled" | null {
    const value = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (value === "success") return "success";
    if (value === "error") return "error";
    if (value === "cancelled" || value === "canceled") return "cancelled";
    return null;
}

function validMediaRecord(value: unknown) {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return [record.dataUrl, record.url, record.remoteUrl, record.serverUrl].some((item) => typeof item === "string" && item.trim());
}
