import { generationModelId } from "@/lib/server/generation-channel";
import { recordGenerationTaskLogResult } from "@/lib/server/generation-log-task-service";
import type { ImageTask } from "@/lib/server/image-task-store";

export function stableMediaUrl(value?: string) {
    return value && !value.startsWith("data:") && !value.startsWith("blob:") ? value : "";
}

export async function writeImageGenerationLog(task: ImageTask, status: "success" | "failed", result: { dataUrl?: string; remoteUrl?: string } | string, durationMs: number, error?: string, canRetry = status === "failed") {
    // Prefer verified inline bytes so authenticated system-channel media is persisted locally.
    const resultUrl = typeof result === "string" ? result : result.dataUrl || result.remoteUrl || "";
    return recordGenerationTaskLogResult({
        logId: task.generationLogId,
        slotId: task.generationSlotId,
        clientRequestId: task.clientRequestId,
        taskId: task.id,
        userId: task.userId,
        username: task.username,
        displayName: task.displayName,
        kind: "image",
        source: task.source || "image-workbench",
        status,
        title: task.title || task.prompt.slice(0, 36) || "图片生成",
        prompt: task.prompt,
        model: generationModelId(task.config),
        summary: status === "success" ? (task.kind === "edit" ? "图生图调用完成" : "文生图调用完成") : "图片生成失败",
        durationMs,
        asset: resultUrl ? { type: "image", url: resultUrl, remoteUrl: typeof result === "string" ? undefined : result.remoteUrl, targetSize: task.config.size } : undefined,
        error,
        canRetry,
        taskKind: task.kind,
        createdAt: task.createdAt,
    });
}
