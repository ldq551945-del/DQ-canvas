import type { BackgroundRemovalOptionsV1 } from "@/lib/background-removal-options";
import type { BackgroundRemovalProgressStage } from "@/lib/background-removal-progress";
import { cancelBackgroundRemovalTask } from "@/services/api/background-removal";

export type CanvasGenerationTaskStatus = "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled";

export type CanvasGenerationTask = {
    id: string;
    type: string;
    status: CanvasGenerationTaskStatus;
    progress?: number;
    stage?: string;
    prompt?: string;
    model?: string;
    kind?: "generation" | "edit";
    provider?: "openai" | "seedance" | "generation";
    pollPath?: string;
    serverTaskId?: string;
    durationSeconds?: number;
    sourceStorageKey?: string;
    options?: BackgroundRemovalOptionsV1;
    optionsHash?: string;
    progressStage?: BackgroundRemovalProgressStage;
    projectId?: string;
    sourceNodeId?: string;
    /** The canvas node that receives this task's result. */
    targetNodeId?: string;
    executionPhase?: string;
    upstreamTaskId?: string;
    lastUpstreamStatus?: string;
    error?: string;
    billing?: { pointsCost: number; refunded?: boolean };
    createdAt: number;
    updatedAt: number;
};

type GenerationTasksResponse = {
    code?: number;
    data?: { tasks?: CanvasGenerationTask[]; total?: number };
    tasks?: CanvasGenerationTask[];
};

export async function listCanvasGenerationTasks(projectId: string, options?: { activeOnly?: boolean; limit?: number; signal?: AbortSignal }) {
    const query = new URLSearchParams({ surface: "canvas", projectId });
    if (options?.activeOnly !== undefined) query.set("activeOnly", String(options.activeOnly));
    if (options?.limit !== undefined) query.set("limit", String(options.limit));
    const response = await fetch(`/api/generation-tasks?${query.toString()}`, { cache: "no-store", signal: options?.signal });
    const payload = (await response.json().catch(() => ({}))) as GenerationTasksResponse & { msg?: string; error?: string };
    if (!response.ok) throw new Error(payload.msg || payload.error || "获取生成任务失败");
    return payload.data?.tasks || payload.tasks || [];
}

const CANVAS_TASK_CANCEL_PATHS: Record<string, string> = {
    image: "/api/image-tasks",
    text: "/api/text-tasks",
    video: "/api/video-tasks",
    audio: "/api/audio-tasks",
    image_process: "/api/background-removal-tasks",
};

/** Cancels a persisted task. A terminal task is treated as already cancelled. */
export async function cancelCanvasGenerationTask(task: { id: string; type: string }) {
    if (task.type === "image_process") {
        await cancelBackgroundRemovalTask(task.id);
        return;
    }
    const basePath = CANVAS_TASK_CANCEL_PATHS[task.type];
    if (!basePath || !task.id) return;
    const response = await fetch(`${basePath}/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
        cache: "no-store",
    });
    if (!response.ok && response.status !== 409 && response.status !== 404) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string; msg?: string };
        throw new Error(payload.error || payload.msg || `取消${task.type}任务失败`);
    }
}
