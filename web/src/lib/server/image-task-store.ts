import { randomUUID } from "crypto";

import type { LogicalModelCapabilityProfile, SystemChannelAdvancedConfig } from "@/lib/auth/store";
import type { GenerationAttempt } from "@/lib/server/generation-attempt";
import type { GenerationLogSource } from "@/lib/server/generation-log-store";
import { countActiveStoredGenerationTasks, createStoredGenerationTask, getStoredGenerationTask, mutateStoredGenerationTask, touchStoredGenerationTask, transitionStoredGenerationTask, type GenerationTaskContext } from "@/lib/server/generation-task-store";

type ImageTaskKind = "generation" | "edit";
type ImageTaskStatus = "pending" | "running" | "success" | "error" | "cancelled";

export type ImageTaskConfig = {
    apiSource?: "system" | "custom";
    baseUrl: string;
    apiKey: string;
    apiFormat: "openai" | "gemini";
    model: string;
    channelId?: string;
    logicalModel?: string;
    capabilityProfile?: LogicalModelCapabilityProfile;
    quality?: string;
    size?: string;
    systemPrompt?: string;
    advancedConfig?: SystemChannelAdvancedConfig;
};

export type ImageTaskReference = {
    id?: string;
    name?: string;
    type?: string;
    dataUrl: string;
    url?: string;
    remoteUrl?: string;
    serverUrl?: string;
};

export type ImageTask = GenerationTaskContext & {
    id: string;
    userId: string;
    username: string;
    displayName: string;
    kind: ImageTaskKind;
    source: GenerationLogSource;
    title?: string;
    status: ImageTaskStatus;
    createdAt: number;
    updatedAt: number;
    config: ImageTaskConfig;
    prompt: string;
    references: ImageTaskReference[];
    mask?: ImageTaskReference;
    result?: { dataUrl: string; remoteUrl?: string; serverUrl?: string; width?: number; height?: number; bytes?: number; mimeType?: string };
    error?: string;
    pointsRemaining?: number;
    candidateConfigs?: ImageTaskConfig[];
    attempts?: GenerationAttempt[];
    attemptNo?: number;
};

const TASK_TTL_MS = 60 * 60 * 1000;
const TASK_STALE_MS = 3 * 60 * 1000;
export async function createImageTask(input: Omit<ImageTask, "id" | "status" | "createdAt" | "updatedAt">) {
    const now = Date.now();
    const task: ImageTask = {
        ...input,
        id: randomUUID(),
        status: "pending",
        createdAt: now,
        updatedAt: now,
    };
    return createStoredGenerationTask("image", task, TASK_TTL_MS);
}

export async function getImageTask(id: string) {
    const task = await getStoredGenerationTask<ImageTask>("image", id);
    if (!task || !isStale(task)) return task;
    return (await transitionImageTask(task, ["pending", "running"], { status: "error", error: "生成任务已中断，请重新生成。" })) || getStoredGenerationTask<ImageTask>("image", id);
}

export function countActiveImageTasksForUser(userId: string) {
    return countActiveStoredGenerationTasks(userId, "image", TASK_STALE_MS);
}

export function transitionImageTask(task: ImageTask, allowedStatuses: ImageTaskStatus[], patch: Partial<Pick<ImageTask, "result" | "error" | "pointsRemaining">> & { status: ImageTaskStatus }) {
    return transitionStoredGenerationTask<ImageTask>("image", task.id, task.userId, allowedStatuses, patch, TASK_TTL_MS);
}

export function touchImageTask(id: string) {
    return touchStoredGenerationTask("image", id, Date.now(), TASK_TTL_MS);
}

export async function updateImageTask(id: string, patch: Partial<Pick<ImageTask, "config" | "candidateConfigs" | "attempts" | "attemptNo">>) {
    return mutateStoredGenerationTask<ImageTask>("image", id, TASK_TTL_MS, (task) => ({ ...task, ...patch }));
}

function isStale(task: ImageTask) {
    return (task.status === "pending" || task.status === "running") && task.updatedAt < Date.now() - TASK_STALE_MS;
}
