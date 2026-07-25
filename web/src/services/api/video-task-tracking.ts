import type { AiConfig } from "@/stores/use-config-store";
import type { VideoGenerationTask, VideoGenerationTaskState } from "@/services/api/video";

export async function registerVideoTask(config: AiConfig, task: VideoGenerationTask) {
    if (config.apiSource !== "system" || !config.baseUrl.startsWith("/api/ai/system/")) return task;
    const response = await fetch("/api/video-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, upstream: task }),
    });
    if (!response.ok) return task;
    const payload = (await response.json().catch(() => ({}))) as { task?: { id?: string } };
    return payload.task?.id ? { ...task, serverTaskId: payload.task.id } : task;
}

export async function syncVideoTask(task: VideoGenerationTask, state: VideoGenerationTaskState) {
    if (!task.serverTaskId || state.status === "pending") return;
    await fetch(`/api/video-tasks/${encodeURIComponent(task.serverTaskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.status === "completed" ? { status: "success", result: { url: state.result.url, remoteUrl: state.result.remoteUrl, mimeType: state.result.mimeType } } : { status: "error", error: state.error }),
    }).catch(() => undefined);
}
