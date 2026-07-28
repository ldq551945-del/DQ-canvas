import { nanoid } from "nanoid";
import type { CreativeFoundation, CreativeReview } from "@/lib/creative-agent-contract";
import type { CreativeProjectHandoffPlan, CreativeRunRequest, CreativeSurface } from "@/lib/creative-runtime-contract";
import { extractImageSizeFromPrompt } from "@/lib/image-size";
import { createCreativeRunBundle, getCreativeRunByClientRequestId, mutateCreativeRun } from "./creative-runtime-store";
import { getStoredGenerationTask, listStoredGenerationTasks } from "./generation-task-store";

export type AgentRunStatus = "planning" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type AgentRunReference = {
    assetId?: string;
    sourceTaskId?: string;
    url: string;
    type: "image" | "video" | "audio";
};
export type AgentRunChildTask = {
    id: string;
    status: "pending" | "completed" | "failed";
    attempt: number;
    result?: unknown;
    error?: string;
};
export type AgentRunTask = {
    id: string;
    targetNodeId?: string;
    referenceAssetId?: string;
    referenceUrl?: string;
    referenceType?: "image" | "video" | "audio";
    references?: AgentRunReference[];
    title: string;
    type: "text" | "image" | "video" | "audio";
    model?: string;
    prompt: string;
    count: number;
    ratio?: string;
    quality?: string;
    seconds?: number;
    voice?: string;
    format?: string;
    dependencies: string[];
    status: "ready" | "running" | "completed" | "failed";
    attempts: number;
    taskId?: string;
    taskIds?: string[];
    childTasks?: AgentRunChildTask[];
    assetIds?: string[];
    result?: unknown;
    error?: string;
};
export type AgentRun = {
    id: string;
    userId: string;
    conversationId: string;
    clientRequestId: string;
    surface: CreativeSurface;
    projectId?: string;
    inputMessageId: string;
    assistantMessageId: string;
    prompt: string;
    snapshot?: unknown;
    referencedAssetIds: string[];
    selectedSkillIds?: string[];
    requestedModelIds?: string[];
    requestedImageSize?: string;
    assetIds: string[];
    status: AgentRunStatus;
    executionId?: string;
    tasks: AgentRunTask[];
    foundation?: CreativeFoundation;
    projectHandoff?: CreativeProjectHandoffPlan;
    projectHandoffEmitted?: boolean;
    review?: CreativeReview;
    reviewed: boolean;
    createdAt: number;
    updatedAt: number;
};
const TTL = 365 * 24 * 60 * 60 * 1000;

export async function createAgentRun(userId: string, input: CreativeRunRequest) {
    const now = Date.now();
    const conversationId = input.conversationId || `conversation-${nanoid()}`;
    const run: AgentRun = {
        id: `agent-${nanoid()}`,
        userId,
        conversationId,
        clientRequestId: input.clientRequestId,
        surface: input.surface,
        projectId: input.projectId,
        inputMessageId: `message-${nanoid()}`,
        assistantMessageId: `message-${nanoid()}`,
        prompt: input.prompt,
        snapshot: input.snapshot,
        referencedAssetIds: input.assetIds,
        selectedSkillIds: input.skillIds,
        ...(input.modelIds.length ? { requestedModelIds: input.modelIds } : {}),
        requestedImageSize: extractImageSizeFromPrompt(input.prompt) || undefined,
        assetIds: [],
        status: "planning",
        tasks: [],
        reviewed: false,
        createdAt: now,
        updatedAt: now,
    };
    return createCreativeRunBundle(userId, { run, conversationId: input.conversationId, prompt: input.prompt, title: input.prompt.slice(0, 48), assetIds: input.assetIds, ttlMs: TTL });
}

export const getAgentRun = (id: string) => getStoredGenerationTask<AgentRun>("agent", id);
export const listAgentRuns = (userId: string, limit?: number) => listStoredGenerationTasks<AgentRun>("agent", userId, limit);
export async function getAgentRunByClientRequestId(userId: string, clientRequestId: string) {
    return getCreativeRunByClientRequestId<AgentRun>(userId, clientRequestId);
}

export async function setAgentRunStatus(run: AgentRun, status: AgentRunStatus) {
    return mutateCreativeRun<AgentRun>(
        run.id,
        TTL,
        (current) =>
            current.userId === run.userId && current.status === run.status
                ? {
                      run: { ...current, status, executionId: undefined },
                      event: { type: `run.${status}` },
                      assistant: terminalAssistant(status),
                  }
                : null,
        [run.status],
    );
}

export async function updateAgentRunById(
    id: string,
    patch: Partial<Pick<AgentRun, "status" | "executionId" | "tasks" | "foundation" | "projectHandoff" | "projectHandoffEmitted" | "review" | "reviewed" | "assetIds">>,
    event?: { type: string; data?: unknown },
    allowedStatuses?: AgentRunStatus[],
    expectedExecutionId?: string,
) {
    return mutateCreativeRun<AgentRun>(
        id,
        TTL,
        (current) => {
            const next = { ...current, ...patch, status: patch.status || current.status };
            return { run: next, event, assistant: assistantUpdate(next, event) };
        },
        allowedStatuses,
        expectedExecutionId,
    );
}

function assistantUpdate(run: AgentRun, event?: { type: string; data?: unknown }) {
    const data = event?.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
    if (run.status === "running" && event?.type === "task.retry.requested") return { status: "running" as const, content: "正在重新生成失败任务…" };
    if (run.status === "completed") {
        return {
            status: "completed" as const,
            content: typeof data.reply === "string" && data.reply.trim() ? data.reply.trim() : "创作任务已完成。",
            metadata: {
                assetIds: run.assetIds,
                taskIds: Array.from(new Set(run.tasks.flatMap((task) => task.taskIds || (task.taskId ? [task.taskId] : [])))),
                foundation: run.foundation,
                projectHandoff: data.projectHandoff,
                review: run.review,
            },
        };
    }
    if (run.status === "failed") return { status: "failed" as const, content: typeof data.message === "string" ? data.message : "Agent 执行失败" };
    if (run.status === "cancelled") return { status: "cancelled" as const, content: "Agent 任务已取消。" };
    return undefined;
}

function terminalAssistant(status: AgentRunStatus) {
    if (status === "cancelled") return { status: "cancelled" as const, content: "Agent 任务已取消。" };
    return undefined;
}
