import { randomUUID } from "node:crypto";

import type { LogicalModelCapabilityProfile, SystemChannelAdvancedConfig } from "@/lib/auth/store";
import type { AiTextMessage } from "@/types/ai";
import { createStoredGenerationTask, getStoredGenerationTask, mutateStoredGenerationTask, touchStoredGenerationTask, transitionStoredGenerationTask } from "@/lib/server/generation-task-store";
import type { GenerationAttempt } from "@/lib/server/generation-attempt";

type TextTaskStatus = "pending" | "running" | "success" | "error" | "cancelled";

export type TextTaskConfig = {
    apiSource?: "system" | "custom";
    baseUrl: string;
    apiKey: string;
    apiFormat: "openai" | "gemini";
    model: string;
    channelId?: string;
    logicalModel?: string;
    capabilityProfile?: LogicalModelCapabilityProfile;
    advancedConfig?: SystemChannelAdvancedConfig;
    systemPrompt?: string;
};

export type TextTask = {
    id: string;
    userId: string;
    status: TextTaskStatus;
    createdAt: number;
    updatedAt: number;
    config: TextTaskConfig;
    messages: AiTextMessage[];
    result?: { content: string };
    error?: string;
    pointsRemaining?: number;
    candidateConfigs?: TextTaskConfig[];
    attempts?: GenerationAttempt[];
    attemptNo?: number;
};

const TASK_TTL_MS = 60 * 60 * 1000;
const TASK_STALE_MS = 3 * 60 * 1000;
export async function createTextTask(input: Omit<TextTask, "id" | "status" | "createdAt" | "updatedAt">) {
    const now = Date.now();
    const task: TextTask = {
        ...input,
        id: randomUUID(),
        status: "pending",
        createdAt: now,
        updatedAt: now,
    };
    return createStoredGenerationTask("text", task, TASK_TTL_MS);
}

export async function getTextTask(id: string) {
    const task = await getStoredGenerationTask<TextTask>("text", id);
    if (!task || !isStale(task)) return task;
    return (await transitionTextTask(task, ["pending", "running"], { status: "error", error: "生成任务已中断，请重新生成。", messages: [], config: { ...task.config, apiKey: "" } })) || getStoredGenerationTask<TextTask>("text", id);
}

export function transitionTextTask(task: TextTask, allowedStatuses: TextTaskStatus[], patch: Partial<Pick<TextTask, "config" | "messages" | "result" | "error" | "pointsRemaining">> & { status: TextTaskStatus }) {
    return transitionStoredGenerationTask<TextTask>("text", task.id, task.userId, allowedStatuses, patch, TASK_TTL_MS);
}

export function touchTextTask(id: string) {
    return touchStoredGenerationTask("text", id, Date.now(), TASK_TTL_MS);
}

export function updateTextTask(id: string, patch: Partial<Pick<TextTask, "config" | "candidateConfigs" | "attempts" | "attemptNo">>) {
    return mutateStoredGenerationTask<TextTask>("text", id, TASK_TTL_MS, (task) => ({ ...task, ...patch }));
}

function isStale(task: TextTask) {
    return (task.status === "pending" || task.status === "running") && task.updatedAt < Date.now() - TASK_STALE_MS;
}
