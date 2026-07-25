import { randomUUID } from "node:crypto";

import { createStoredGenerationTask, getStoredGenerationTask, mutateStoredGenerationTask, touchStoredGenerationTask, transitionStoredGenerationTask, type GenerationTaskContext } from "@/lib/server/generation-task-store";
import type { SystemGenerationChannelConfig } from "@/lib/server/generation-channel";
import type { GenerationAttempt } from "@/lib/server/generation-attempt";

export type VideoTaskStatus = "running" | "success" | "error" | "cancelled";

export type VideoTask = GenerationTaskContext & {
    id: string;
    userId: string;
    status: VideoTaskStatus;
    createdAt: number;
    updatedAt: number;
    config: SystemGenerationChannelConfig;
    upstream: { id: string; provider: "openai" | "seedance" | "generation"; model: string; pollPath?: string; resultUrl?: string; pointsCost?: number; pointsUnits?: number; pointsRecordId?: string };
    requestedDurationSeconds?: number;
    source?: string;
    prompt?: string;
    attempts?: GenerationAttempt[];
    result?: { url?: string; remoteUrl?: string; mimeType?: string; durationMs?: number };
    error?: string;
};

const TASK_TTL_MS = 24 * 60 * 60 * 1000;
const TASK_STALE_MS = 5 * 60 * 1000;

export async function createVideoTask(input: Omit<VideoTask, "id" | "status" | "createdAt" | "updatedAt">) {
    const now = Date.now();
    return createStoredGenerationTask("video", { ...input, id: randomUUID(), status: "running" as const, createdAt: now, updatedAt: now }, TASK_TTL_MS);
}

export async function getVideoTask(id: string) {
    const task = await getStoredGenerationTask<VideoTask>("video", id);
    if (!task || task.status !== "running" || task.updatedAt >= Date.now() - TASK_STALE_MS) return task;
    return (await transitionVideoTask(task, { status: "error", error: "视频任务长时间未更新，请重新查询或生成。" })) || getStoredGenerationTask<VideoTask>("video", id);
}

export function transitionVideoTask(task: VideoTask, patch: Partial<Pick<VideoTask, "result" | "error">> & { status: "success" | "error" | "cancelled" }) {
    return transitionStoredGenerationTask<VideoTask>("video", task.id, task.userId, ["running"], patch, TASK_TTL_MS);
}

export function updateVideoTask(id: string, patch: Partial<Pick<VideoTask, "attempts">>) {
    return mutateStoredGenerationTask<VideoTask>("video", id, TASK_TTL_MS, (task) => ({ ...task, ...patch }));
}

export function touchVideoTask(id: string) {
    return touchStoredGenerationTask("video", id, Date.now(), TASK_TTL_MS);
}
