import { createHash } from "node:crypto";

import { normalizeBackgroundRemovalOptions, serializeBackgroundRemovalOptions } from "@/lib/background-removal-options";
import { backgroundRemovalProgressSnapshot } from "@/lib/background-removal-progress";
import { deleteUserLocalMediaAssets } from "@/lib/server/local-media-storage";
import { writePersistentReferenceImageBuffer } from "@/lib/server/reference-asset-store";
import { BackgroundRemovalProviderError, removeBackgroundWithRembg } from "@/lib/server/background-removal-provider";
import { readRegisteredImageBytes, BACKGROUND_REMOVAL_MAX_BYTES } from "@/lib/server/registered-media-reader";
import { getBackgroundRemovalTask, transitionBackgroundRemovalTask, updateBackgroundRemovalTask, type BackgroundRemovalTask } from "@/lib/server/background-removal-task-store";

const MAX_PROVIDER_ATTEMPTS = 3;

export type BackgroundRemovalTaskStep = { state: "completed" } | { state: "cancelled" } | { state: "failed"; error: string } | { state: "retry"; error: string; attempt: number; nextPollAt: number };

export async function runBackgroundRemovalTaskStep(task: BackgroundRemovalTask): Promise<BackgroundRemovalTaskStep> {
    const current = await getBackgroundRemovalTask(task.id);
    if (!current || current.status === "cancelled") return { state: "cancelled" };
    if (current.status === "success") return { state: "completed" };
    if (current.status === "error") return { state: "failed", error: current.error || "抠图失败" };

    const readingProgress = backgroundRemovalProgressSnapshot("reading_source");
    const running =
        current.status === "pending"
            ? await transitionBackgroundRemovalTask(current, ["pending"], { status: "running", progressStage: readingProgress.stage, progress: readingProgress.progress })
            : await updateBackgroundRemovalTask(current.id, { progressStage: readingProgress.stage, progress: readingProgress.progress });
    if (!running) return { state: "retry", error: "抠图任务状态发生变化", attempt: current.providerAttempt, nextPollAt: Date.now() + 5_000 };

    try {
        const options = { ...normalizeBackgroundRemovalOptions(running.options), outputMode: "transparent" as const };
        const source = await readRegisteredImageBytes({
            storageKey: running.sourceStorageKey,
            ownerUserId: running.userId,
            maxBytes: BACKGROUND_REMOVAL_MAX_BYTES,
        });
        const inferenceProgress = backgroundRemovalProgressSnapshot("inference");
        if (!(await updateBackgroundRemovalTask(running.id, { progressStage: inferenceProgress.stage, progress: inferenceProgress.progress }))) return { state: "cancelled" };
        const output = await removeBackgroundWithRembg({ taskId: running.id, bytes: source.bytes, mimeType: source.mimeType, width: source.width, height: source.height, options });
        const executionOptions = normalizeBackgroundRemovalOptions({ ...options, model: output.model });
        const executionOptionsHash = createHash("sha256").update(serializeBackgroundRemovalOptions(executionOptions)).digest("hex");
        const latest = await getBackgroundRemovalTask(running.id);
        if (!latest || latest.status === "cancelled") return { state: "cancelled" };
        const savingProgress = backgroundRemovalProgressSnapshot("saving");
        if (!(await updateBackgroundRemovalTask(running.id, { progressStage: savingProgress.stage, progress: savingProgress.progress }))) return { state: "cancelled" };
        const asset = await writePersistentReferenceImageBuffer(output.bytes, {
            ownerUserId: running.userId,
            source: "canvas",
            originalName: "background-removed.png",
            taskId: running.id,
            projectId: running.projectId,
            maxBytes: BACKGROUND_REMOVAL_MAX_BYTES,
        });
        const result = {
            storageKey: asset.token,
            serverUrl: referenceAssetServerUrl(asset.token),
            mimeType: "image/png" as const,
            bytes: asset.bytes,
            width: output.width,
            height: output.height,
            options: executionOptions,
            optionsHash: executionOptionsHash,
            model: output.model,
        };
        const beforeCommit = await getBackgroundRemovalTask(running.id);
        if (!beforeCommit || beforeCommit.status === "cancelled") {
            await deleteUserLocalMediaAssets(running.userId, [asset.token]).catch(() => undefined);
            return { state: "cancelled" };
        }
        const completedProgress = backgroundRemovalProgressSnapshot("completed");
        const completed = await transitionBackgroundRemovalTask(beforeCommit, ["pending", "running"], { status: "success", result, model: output.model, error: "", progressStage: completedProgress.stage, progress: completedProgress.progress });
        if (!completed) {
            await deleteUserLocalMediaAssets(running.userId, [asset.token]).catch(() => undefined);
            return { state: "cancelled" };
        }
        return { state: "completed" };
    } catch (error) {
        const message = publicBackgroundRemovalError(error);
        const transient = error instanceof BackgroundRemovalProviderError ? error.transient : !(error && typeof error === "object" && "status" in error);
        const latest = (await getBackgroundRemovalTask(running.id)) || running;
        if (latest.status === "cancelled") return { state: "cancelled" };
        const attempt = latest.providerAttempt + 1;
        console.warn("Background removal task step failed", {
            taskId: running.id,
            attempt,
            error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            name: error instanceof Error ? error.name : typeof error,
        });
        if (transient && attempt < MAX_PROVIDER_ATTEMPTS) {
            const queuedProgress = backgroundRemovalProgressSnapshot("queued");
            await updateBackgroundRemovalTask(running.id, { providerAttempt: attempt, error: message, progressStage: queuedProgress.stage, progress: queuedProgress.progress });
            return { state: "retry", error: message, attempt, nextPollAt: Date.now() + Math.min(60_000, 5_000 * 2 ** Math.max(0, attempt - 1)) };
        }
        const failedProgress = backgroundRemovalProgressSnapshot("failed", latest.progress);
        const failed = await transitionBackgroundRemovalTask(latest, ["pending", "running"], { status: "error", error: message, providerAttempt: attempt, progressStage: failedProgress.stage, progress: failedProgress.progress });
        if (!failed) {
            const settled = await getBackgroundRemovalTask(running.id);
            if (!settled || settled.status === "cancelled") return { state: "cancelled" };
            if (settled.status === "success") return { state: "completed" };
            if (settled.status !== "error") return { state: "retry", error: message, attempt, nextPollAt: Date.now() + 5_000 };
        }
        return { state: "failed", error: message };
    }
}

function publicBackgroundRemovalError(error: unknown) {
    if (error instanceof BackgroundRemovalProviderError) return error.message.slice(0, 500);
    if (error && typeof error === "object" && "status" in error && typeof (error as { message?: unknown }).message === "string") return String((error as unknown as { message: string }).message).slice(0, 500);
    return "抠图处理失败，请稍后重试";
}

function referenceAssetServerUrl(storageKey: string) {
    return `/api/reference-assets/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}
