import { runCustomImageTask, pollCustomImageTask } from "@/app/api/image-tasks/image-task-custom";
import { runGeminiImageTask } from "@/app/api/image-tasks/image-task-gemini";
import { runOpenAiImageTask } from "@/app/api/image-tasks/image-task-openai";
import { directRemoteImageResult, imageUnits, ImageUpstreamTerminalError, inlineRemoteImageResult, pollOpenAiImageTask } from "@/app/api/image-tasks/image-task-support";
import type { ImageTaskResult, ImageTaskRunResult } from "@/app/api/image-tasks/image-task-types";
import { stableMediaUrl, writeImageGenerationLog } from "@/app/api/image-tasks/image-task-runner";
import { getAuthSettings, refundUserPoints } from "@/lib/auth/store";
import { registerGenerationTaskAssetsForUser } from "@/lib/server/creative-runtime-service";
import { finishGenerationAttempt, startGenerationAttempt } from "@/lib/server/generation-attempt";
import { generationModelId } from "@/lib/server/generation-channel";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { GenerationSubmissionSafeFailure, generationSubmissionUncertainError } from "@/lib/server/generation-submission-error";
import { getImageTask, transitionImageTask, updateImageTask, type ImageTask } from "@/lib/server/image-task-store";
import { maintenanceWorkerContext } from "@/lib/server/maintenance-auth";

export type ImageUpstreamStep =
    { state: "pending"; upstream: NonNullable<ImageTask["upstream"]>; status: string } | { state: "result_ready"; resultUrl: string; status: string } | { state: "completed" } | { state: "failed"; error: string; status: string };

export async function createImageTaskUpstreamStep(task: ImageTask, origin: string, publicOrigin: string, cookie = "", workerUserId = ""): Promise<ImageUpstreamStep> {
    const current = await getImageTask(task.id);
    if (!current || current.status === "cancelled") return { state: "failed", error: "任务已取消", status: "cancelled" };
    const running = current.status === "pending" ? await transitionImageTask(current, ["pending"], { status: "running" }) : current;
    if (!running) return { state: "failed", error: "图片任务状态已变化", status: "conflict" };
    if (running.upstream?.id) return queryImageTaskUpstreamStep(running, origin, cookie, workerUserId);

    const authContext = cookie || maintenanceWorkerContext(workerUserId || task.userId);
    const candidates = [running.config, ...(running.candidateConfigs || [])];
    let attempts = running.attempts || [];
    let latestError = "没有可用的图片渠道";
    for (const [index, config] of candidates.entries()) {
        const started = startGenerationAttempt(attempts, { channelId: config.channelId, model: generationModelId(config), capability: "image" });
        attempts = started.attempts;
        const candidate = { ...running, config, candidateConfigs: candidates.slice(index + 1), attempts, attemptNo: started.attempt.attemptNo, upstream: undefined, billing: undefined };
        await updateImageTask(task.id, { config, candidateConfigs: candidate.candidateConfigs, attempts, attemptNo: candidate.attemptNo, upstream: undefined, billing: undefined });
        await scheduleGenerationTask("image", task.id, {
            executionPhase: "submitting",
            nextPollAt: Date.now(),
            channelId: config.channelId,
            provider: config.advancedConfig?.protocol || config.apiFormat,
            lastUpstreamStatus: "submitting",
        });
        try {
            const result =
                config.advancedConfig?.protocol === "custom" || config.advancedConfig?.protocol === "stable-diffusion"
                    ? await runCustomImageTask(candidate, origin, publicOrigin, authContext, true)
                    : config.apiFormat === "gemini"
                      ? await runGeminiImageTask(candidate, origin, authContext)
                      : await runOpenAiImageTask(candidate, origin, publicOrigin, authContext, true);
            return await handleImageProviderResult(candidate, result, origin, authContext);
        } catch (error) {
            if (!(error instanceof GenerationSubmissionSafeFailure)) throw generationSubmissionUncertainError(error, "图片任务创建结果未知");
            latestError = error.message;
            attempts = finishGenerationAttempt(attempts, candidate.attemptNo, { status: "failed", error: latestError });
            await refundImageCandidate(candidate);
            await updateImageTask(task.id, { attempts, attemptNo: candidate.attemptNo, upstream: undefined, billing: undefined });
        }
    }
    return { state: "failed", error: latestError, status: "failed" };
}

export async function queryImageTaskUpstreamStep(task: ImageTask, origin: string, cookie = "", workerUserId = ""): Promise<ImageUpstreamStep> {
    const upstream = task.upstream;
    if (!upstream?.id) return { state: "failed", error: "图片任务缺少上游任务 ID", status: "missing_upstream_id" };
    const authContext = cookie || maintenanceWorkerContext(workerUserId || task.userId);
    try {
        const result =
            task.config.advancedConfig?.protocol === "custom" || task.config.advancedConfig?.protocol === "stable-diffusion"
                ? await pollCustomImageTask(task, upstream.id, upstream.pollBaseUrl, authContext, true)
                : await pollOpenAiImageTask(task.config, upstream.id, upstream.mediaBaseUrl, upstream.pollBaseUrl, authContext, upstream.explicitPollUrl || "", true);
        return await handleImageProviderResult(task, { ...result, pointsCost: task.billing?.pointsCost, pointsRecordId: task.billing?.pointsRecordId }, origin, authContext);
    } catch (error) {
        if (error instanceof ImageUpstreamTerminalError) return { state: "failed", error: error.message, status: "failed" };
        if (error instanceof GenerationSubmissionSafeFailure) return { state: "failed", error: error.message, status: "failed" };
        throw error;
    }
}

export async function persistImageTaskResult(task: ImageTask, origin: string, resultUrl: string, cookie = "", workerUserId = "") {
    const authContext = cookie || maintenanceWorkerContext(workerUserId || task.userId);
    return completeImageResult(task, { dataUrl: resultUrl, remoteUrl: /^https?:\/\//i.test(resultUrl) ? resultUrl : undefined, pointsCost: task.billing?.pointsCost, pointsRecordId: task.billing?.pointsRecordId }, origin, authContext);
}

export async function markImageTaskFailed(task: ImageTask, error: string) {
    const current = (await getImageTask(task.id)) || task;
    if (current.status === "success" || current.status === "cancelled") return current;
    if (current.billing?.pointsRecordId && !current.billing.refunded) {
        const settings = await getAuthSettings();
        await refundUserPoints(
            current.userId,
            generationModelId(current.config),
            current.billing.pointsCost,
            "image",
            imageUnits(current.config.quality, settings.generationPointMultipliers.imageQuality),
            `image-task:${current.id}:attempt:${current.attemptNo || 1}:refund`,
            current.billing.pointsRecordId,
        );
        await updateImageTask(current.id, { billing: { ...current.billing, refunded: true } });
    }
    const attempts = finishGenerationAttempt(current.attempts || [], current.attemptNo || current.attempts?.at(-1)?.attemptNo || 1, {
        status: "failed",
        error,
        pointsCost: current.billing?.pointsCost,
        pointsRecordId: current.billing?.pointsRecordId,
    });
    await updateImageTask(current.id, { attempts, candidateConfigs: [], attemptNo: attempts.at(-1)?.attemptNo });
    const failed = await transitionImageTask(current, ["pending", "running"], { status: "error", error: error.slice(0, 500) });
    await writeImageGenerationLog(current, "failed", "", Date.now() - current.createdAt, error).catch((logError) => console.error("Image generation failure log write failed", logError));
    return failed;
}

async function handleImageProviderResult(task: ImageTask, result: ImageTaskRunResult, origin: string, authContext: string): Promise<ImageUpstreamStep> {
    const billing = result.pointsRecordId ? { pointsCost: result.pointsCost ?? 0, pointsRecordId: result.pointsRecordId, refunded: false } : undefined;
    if (billing) await updateImageTask(task.id, { billing });
    if (result.pending) {
        await updateImageTask(task.id, { upstream: result.pending, billing });
        return { state: "pending", upstream: result.pending, status: "submitted" };
    }
    const resultUrl = stableMediaUrl(result.remoteUrl || result.dataUrl);
    if (resultUrl) return { state: "result_ready", resultUrl, status: "completed" };
    try {
        await completeImageResult(task, result, origin, authContext);
    } catch (error) {
        if (error instanceof GenerationSubmissionSafeFailure) throw error;
        console.warn("Image result validation or persistence failed", { taskId: task.id, error: error instanceof Error ? error.message : String(error) });
        throw new GenerationSubmissionSafeFailure("上游返回的图片文件无效或保存失败");
    }
    return { state: "completed" };
}

async function refundImageCandidate(task: ImageTask) {
    const current = await getImageTask(task.id);
    const billing = current?.billing;
    if (!billing?.pointsRecordId || billing.refunded) return;
    const settings = await getAuthSettings();
    await refundUserPoints(
        task.userId,
        generationModelId(task.config),
        billing.pointsCost,
        "image",
        imageUnits(task.config.quality, settings.generationPointMultipliers.imageQuality),
        `image-task:${task.id}:attempt:${task.attemptNo || 1}:refund`,
        billing.pointsRecordId,
    );
}

async function completeImageResult(task: ImageTask, result: ImageTaskRunResult, origin: string, authContext: string) {
    const remoteUrl = typeof result.remoteUrl === "string" ? result.remoteUrl : undefined;
    const safeResult: ImageTaskResult = directRemoteImageResult(remoteUrl) || (await inlineRemoteImageResult(result.dataUrl, origin, authContext, remoteUrl));
    const log = await writeImageGenerationLog(task, "success", safeResult, Date.now() - task.createdAt);
    const asset = log?.assets[0];
    const current = await getImageTask(task.id);
    if (!current || current.status === "cancelled") return current;
    const completed = await transitionImageTask(current, ["pending", "running"], {
        status: "success",
        result: {
            dataUrl: safeResult.dataUrl,
            remoteUrl: asset?.remoteUrl || safeResult.remoteUrl,
            serverUrl: asset?.serverUrl,
            width: asset?.width,
            height: asset?.height,
            bytes: asset?.bytes,
            mimeType: asset?.mimeType,
        },
        pointsRemaining: result.pointsRemaining,
    });
    if (!completed) return getImageTask(task.id);
    const attempts = finishGenerationAttempt(completed.attempts || [], completed.attemptNo || completed.attempts?.at(-1)?.attemptNo || 1, {
        status: "succeeded",
        pointsCost: result.pointsCost ?? completed.billing?.pointsCost,
        pointsRecordId: result.pointsRecordId || completed.billing?.pointsRecordId,
    });
    await updateImageTask(task.id, { config: { ...completed.config, apiKey: "system" }, candidateConfigs: [], attempts, attemptNo: attempts.at(-1)?.attemptNo });
    const url = completed.result?.serverUrl || completed.result?.remoteUrl || stableMediaUrl(completed.result?.dataUrl);
    if (url)
        await registerGenerationTaskAssetsForUser(completed.userId, {
            ...completed,
            taskId: completed.id,
            title: completed.title || completed.prompt.slice(0, 80),
            assets: [{ type: "image", url }],
        }).catch((error) => console.error("Creative image asset registration failed", error));
    return completed;
}
