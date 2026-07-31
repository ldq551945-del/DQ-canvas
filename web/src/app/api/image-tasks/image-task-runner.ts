import { generationModelId } from "@/lib/server/generation-channel";
import { recordGenerationLog } from "@/lib/server/generation-log-store";
import type { ImageTask } from "@/lib/server/image-task-store";

export function stableMediaUrl(value?: string) {
    return value && !value.startsWith("data:") && !value.startsWith("blob:") ? value : "";
}

export async function writeImageGenerationLog(task: ImageTask, status: "success" | "failed", result: { dataUrl?: string; remoteUrl?: string } | string, durationMs: number, error?: string) {
    const resultUrl = typeof result === "string" ? result : result.remoteUrl || result.dataUrl || "";
    return recordGenerationLog({
        id: `image-task:${task.id}`,
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
        count: 1,
        successCount: status === "success" ? 1 : 0,
        failCount: status === "failed" ? 1 : 0,
        assets: resultUrl ? [{ type: "image", url: resultUrl, remoteUrl: typeof result === "string" ? undefined : result.remoteUrl, targetSize: task.config.size }] : [],
        error,
        createdAt: task.createdAt,
        completedAt: Date.now(),
    });
}
