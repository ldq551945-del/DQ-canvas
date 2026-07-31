import { nanoid } from "nanoid";
import type { CreativeFoundation, CreativeReview } from "@/lib/creative-agent-contract";
import type { CreativeProjectHandoffPlan, CreativeRunRequest, CreativeSurface } from "@/lib/creative-runtime-contract";
import { extractImageSizeFromPrompt } from "@/lib/image-size";
import { createCreativeRunBundle, getCreativeRunByClientRequestId, mutateCreativeRun } from "./creative-runtime-store";
import { getStoredGenerationTask, listStoredGenerationTasks } from "./generation-task-store";
import { cancelledRunCanvasOps, taskCanvasEventOps } from "./agent-run-canvas-ops";
import { agentRequirementAcknowledgement } from "@/lib/agent-requirement-acknowledgement";
import { agentTaskCompletionMessage } from "./agent-run-messages";

export type AgentRunStatus = "planning" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type AgentRunReviewStatus = "review_pending" | "reviewing" | "review_completed" | "review_unavailable";
export type AgentRunReference = {
    assetId?: string;
    sourceTaskId?: string;
    url: string;
    type: "image" | "video" | "audio";
};
export type AgentRunChildTask = {
    id: string;
    status: "pending" | "completed" | "failed" | "cancelled";
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
    status: "ready" | "running" | "completed" | "failed" | "cancelled";
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
    reviewStatus?: AgentRunReviewStatus;
    reviewAttempts?: number;
    timings?: AgentRunTimings;
    createdAt: number;
    updatedAt: number;
};
export type AgentRunTimings = {
    requestAcceptedAt: number;
    planningStartedAt?: number;
    planningCompletedAt?: number;
    firstTaskSubmittedAt?: number;
    firstResultReadyAt?: number;
    allResultsReadyAt?: number;
    reviewCompletedAt?: number;
    runCompletedAt?: number;
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
        timings: { requestAcceptedAt: now },
        createdAt: now,
        updatedAt: now,
    };
    return createCreativeRunBundle(userId, {
        run,
        conversationId: input.conversationId,
        prompt: input.prompt,
        title: input.prompt.slice(0, 48),
        assetIds: input.assetIds,
        acknowledgement: agentRequirementAcknowledgement(input.prompt, input.surface, input.assetIds.length > 0 || selectedCanvasNodeIds(input.snapshot).length > 0),
        ttlMs: TTL,
    });
}

function selectedCanvasNodeIds(snapshot: unknown) {
    const ids = snapshot && typeof snapshot === "object" ? (snapshot as { selectedNodeIds?: unknown }).selectedNodeIds : undefined;
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id.trim()) : [];
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
        (current) => {
            if (current.userId !== run.userId || current.status !== run.status) return null;
            const tasks = status === "cancelled" ? cancelActiveTasks(current.tasks) : current.tasks;
            const ops = status === "cancelled" && current.surface === "canvas" ? cancelledRunCanvasOps(current.id, tasks) : [];
            return {
                run: { ...current, status, tasks, executionId: undefined },
                event: { type: `run.${status}`, ...(ops.length ? { data: { ops } } : {}) },
                assistant: terminalAssistant(status),
            };
        },
        [run.status],
    );
}

function cancelActiveTasks(tasks: AgentRunTask[]) {
    return tasks.map((task): AgentRunTask =>
        task.status === "ready" || task.status === "running"
            ? {
                  ...task,
                  status: "cancelled",
                  error: "任务已取消",
                  childTasks: task.childTasks?.map((child) => (child.status === "pending" ? { ...child, status: "cancelled" as const, error: "任务已取消" } : child)),
              }
            : task,
    );
}

export async function updateAgentRunById(
    id: string,
    patch: Partial<Pick<AgentRun, "status" | "executionId" | "tasks" | "foundation" | "projectHandoff" | "projectHandoffEmitted" | "review" | "reviewed" | "reviewStatus" | "reviewAttempts" | "assetIds" | "timings">>,
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

export async function updateAgentRunTaskById(id: string, taskId: string, patch: Partial<AgentRunTask>, eventType: string, expectedExecutionId: string) {
    return mutateCreativeRun<AgentRun>(
        id,
        TTL,
        (current) => {
            const tasks = current.tasks.map((task) => (task.id === taskId ? mergeAgentTaskPatch(task, patch) : task));
            const taskIndex = tasks.findIndex((item) => item.id === taskId);
            const task = tasks[taskIndex];
            if (!task) return null;
            const output = current.surface === "canvas" ? taskCanvasEventOps(id, taskIndex, task, eventType, patch.childTasks?.[0]?.id) : null;
            const assetIds = Array.from(new Set([...current.assetIds, ...(task.assetIds || [])]));
            const now = Date.now();
            const completed = tasks.filter((item) => item.status === "completed");
            const completedChildren = task.childTasks?.filter((child) => child.status === "completed").length || 0;
            const failedChildren = task.childTasks?.filter((child) => child.status === "failed").length || 0;
            const totalChildren = Math.max(resolveAgentTaskCountForEvent(task), task.childTasks?.length || 0);
            const timings: AgentRunTimings = {
                ...(current.timings || { requestAcceptedAt: current.createdAt }),
                ...(eventType === "task.created" && !current.timings?.firstTaskSubmittedAt ? { firstTaskSubmittedAt: now } : {}),
                ...((eventType === "task.completed" || eventType === "task.child.completed") && !current.timings?.firstResultReadyAt ? { firstResultReadyAt: now } : {}),
                ...(eventType === "task.completed" && completed.length === tasks.length ? { allResultsReadyAt: now } : {}),
            };
            return {
                run: { ...current, tasks, assetIds, timings },
                event: {
                    type: eventType,
                    data: {
                        taskId,
                        taskNodeId: `task-${id}-${taskIndex}`,
                        outputNodeIds: output?.nodeIds,
                        ops: output?.ops,
                        assetIds: task.assetIds,
                        title: task.title,
                        type: task.type,
                        status: task.status,
                        attempts: task.attempts,
                        error: task.error,
                        completedCount: completedChildren,
                        failedCount: failedChildren,
                        totalCount: totalChildren,
                        message: eventType === "task.completed" ? agentTaskCompletionMessage(task, current.surface) : undefined,
                    },
                },
            };
        },
        ["running"],
        expectedExecutionId,
    );
}

function resolveAgentTaskCountForEvent(task: AgentRunTask) {
    const count = Number(task.count);
    return Number.isFinite(count) && count > 0 ? Math.min(10, Math.floor(count)) : 1;
}

function mergeAgentTaskPatch(task: AgentRunTask, patch: Partial<AgentRunTask>): AgentRunTask {
    const childTasks = patch.childTasks ? mergeChildTasks(task.childTasks || [], patch.childTasks) : task.childTasks;
    return {
        ...task,
        ...patch,
        ...(childTasks ? { childTasks } : {}),
        ...(patch.taskIds ? { taskIds: Array.from(new Set([...(task.taskIds || []), ...patch.taskIds])) } : {}),
        ...(patch.assetIds ? { assetIds: Array.from(new Set([...(task.assetIds || []), ...patch.assetIds])) } : {}),
    };
}

function mergeChildTasks(current: AgentRunChildTask[], incoming: AgentRunChildTask[]) {
    const merged = new Map(current.map((child) => [child.id, child]));
    for (const child of incoming) {
        const existing = merged.get(child.id);
        if (!existing || existing.status === "pending" || child.status !== "pending") merged.set(child.id, child);
    }
    return Array.from(merged.values()).slice(0, 10);
}

function assistantUpdate(run: AgentRun, event?: { type: string; data?: unknown }) {
    const data = event?.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
    if (event?.type.startsWith("run.review.")) return undefined;
    if (event?.type === "run.retry.requested") return { status: "running" as const, content: "正在重新分析并执行这次请求…" };
    if (run.status === "running" && event?.type === "task.retry.requested") return { status: "running" as const, content: "正在重新生成失败任务…" };
    if (run.status === "completed") {
        return {
            status: "completed" as const,
            content: typeof data.reply === "string" && data.reply.trim() ? data.reply.trim() : "创作任务已完成。",
            metadata: {
                assetIds: run.assetIds,
                taskIds: Array.from(new Set(run.tasks.flatMap((task) => task.taskIds || (task.taskId ? [task.taskId] : [])))),
                projectHandoff: data.projectHandoff,
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
