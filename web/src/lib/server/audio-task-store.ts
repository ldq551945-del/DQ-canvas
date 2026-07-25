import { randomUUID } from "node:crypto";
import { createStoredGenerationTask, getStoredGenerationTask, mutateStoredGenerationTask, touchStoredGenerationTask, transitionStoredGenerationTask, type GenerationTaskContext } from "@/lib/server/generation-task-store";
import type { SystemChannelAdvancedConfig } from "@/lib/auth/store";
import type { GenerationAttempt } from "@/lib/server/generation-attempt";

export type AudioTaskConfig = {
    apiSource?: "system" | "custom";
    baseUrl: string;
    apiKey: string;
    apiFormat: "openai" | "gemini";
    model: string;
    channelId?: string;
    logicalModel?: string;
    advancedConfig?: SystemChannelAdvancedConfig;
    voice?: string;
    format?: string;
    speed?: string;
    instructions?: string;
};
export type AudioTask = GenerationTaskContext & {
    id: string;
    userId: string;
    status: "pending" | "running" | "success" | "error" | "cancelled";
    createdAt: number;
    updatedAt: number;
    config: AudioTaskConfig;
    prompt: string;
    source?: string;
    upstream?: { id: string; createPath: string };
    result?: { url: string; mimeType: string };
    billing?: { pointsCost: number; pointsRecordId?: string; refunded: boolean };
    error?: string;
    candidateConfigs?: AudioTaskConfig[];
    attempts?: GenerationAttempt[];
    attemptNo?: number;
};

const TTL = 60 * 60 * 1000;
const TASK_STALE_MS = 5 * 60 * 1000;

export function createAudioTask(input: Omit<AudioTask, "id" | "status" | "createdAt" | "updatedAt">) {
    const now = Date.now();
    return createStoredGenerationTask("audio", { ...input, id: randomUUID(), status: "pending", createdAt: now, updatedAt: now } satisfies AudioTask, TTL);
}

export async function getAudioTask(id: string) {
    const task = await getStoredGenerationTask<AudioTask>("audio", id);
    if (!task || !isStale(task)) return task;
    return (await transitionAudioTask(task, ["pending", "running"], { status: "error", error: "音频任务已中断，请重新生成。", config: { ...task.config, apiKey: "" } })) || getStoredGenerationTask<AudioTask>("audio", id);
}

export async function updateAudioTask(id: string, patch: Partial<Pick<AudioTask, "status" | "config" | "upstream" | "result" | "billing" | "error" | "candidateConfigs" | "attempts" | "attemptNo">>) {
    return mutateStoredGenerationTask<AudioTask>("audio", id, TTL, (task) => ({ ...task, ...patch }));
}

export function transitionAudioTask(task: AudioTask, allowedStatuses: Array<AudioTask["status"]>, patch: Partial<Pick<AudioTask, "config" | "upstream" | "result" | "billing" | "error">> & { status: AudioTask["status"] }) {
    return transitionStoredGenerationTask<AudioTask>("audio", task.id, task.userId, allowedStatuses, patch, TTL);
}

export function touchAudioTask(id: string) {
    return touchStoredGenerationTask("audio", id, Date.now(), TTL);
}

function isStale(task: AudioTask) {
    return (task.status === "pending" || task.status === "running") && task.updatedAt < Date.now() - TASK_STALE_MS;
}
