import { after, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings, refundUserPoints } from "@/lib/auth/store";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { fetchInternalApi, isInternalApiBaseUrl, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolveGeneratedMediaUrl } from "@/lib/media-url";
import { isQingyanProvider } from "@/lib/provider-compatibility";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { generationModelId, toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { finishGenerationAttempt, startGenerationAttempt } from "@/lib/server/generation-attempt";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { assertReferenceCapabilities } from "@/lib/server/provider-task-config";
import { countActiveImageTasksForUser, createImageTask, getImageTask, touchImageTask, transitionImageTask, type ImageTask, type ImageTaskConfig, type ImageTaskReference, updateImageTask } from "@/lib/server/image-task-store";
import { isGenerationSource, recordGenerationLog } from "@/lib/server/generation-log-store";
import { writeReferenceImageDataUrl } from "@/lib/server/reference-asset-store";
import { resolveImageTaskOptions } from "@/lib/server/image-task-config";
import { linkStoredGenerationTask, type GenerationTaskContext } from "@/lib/server/generation-task-store";
import { registerGenerationTaskAssetsForUser } from "@/lib/server/creative-runtime-service";
import { createSignedReferenceAssetUrl, signReferenceAssetInputUrl } from "@/lib/server/reference-asset-access";
import { assertCapabilityConstraints } from "@/lib/server/capability-constraints";

import {
    type CreateImageTaskBody,
    type ImageApiResponse,
    type ImageTaskResult,
    type ImageTaskRunResult,
    type GeminiPart,
    type GeminiPayload,
    QUALITY_BASE,
    QUALITY_ALIASES,
    DEFAULT_IMAGE_SHORT_SIDE,
    IMAGE_SIZE_STEP,
    IMAGE_MIN_PIXELS,
    IMAGE_MAX_PIXELS,
    IMAGE_MAX_EDGE,
    IMAGE_MAX_RATIO,
    IMAGE_OUTPUT_FORMAT,
    TASK_HEARTBEAT_MS,
    MODEL_REQUEST_TIMEOUT_MS,
    IMAGE_TASK_POLL_INTERVAL_MS,
    IMAGE_TASK_POLL_ATTEMPTS,
    MAX_INLINE_IMAGE_BYTES,
    INLINE_IMAGE_TIMEOUT_MS,
    IMAGE_RESPONSE_FORMATS,
    IMAGE_URL_KEYS,
    IMAGE_BASE64_KEYS,
    IMAGE_CONTAINER_KEYS,
    IMAGE_TASK_ID_KEYS,
    IMAGE_STATUS_KEYS,
    IMAGE_POLL_URL_KEYS,
    type ImageEditReferenceMode,
} from "./image-task-types";
import {
    runOpenAiImageTask,
    runOpenAiJsonImageEditTask,
    runOpenAiImageTaskWithBase64Response,
    runOpenAiResponsesImageTask,
    buildResponsesImageBodies,
    buildJsonImageEditBodies,
    buildSub2ApiImageEditPrompt,
    referenceRequestUrl,
    jsonImageReferenceRequestUrl,
    publicImageReferenceRequestUrl,
    referenceRequestUrlCandidates,
    rawReferenceRequestUrlCandidates,
    uniqueStrings,
    normalizeReferenceRequestUrl,
    requestPublicOrigin,
    normalizePublicOrigin,
    isExternalPublicOrigin,
    isExternalPublicMediaUrl,
    isExternalPublicHost,
} from "./image-task-openai";
import { runGeminiImageTask } from "./image-task-gemini";
import {
    publicTask,
    sanitizeConfigs,
    sanitizeAdvancedConfig,
    textOrEmpty,
    preferredImageResponseFormat,
    openAiImageTaskPath,
    shouldUseJsonImageEdit,
    configuredImageEditReferenceMode,
    resolveConfiguredApiBaseUrl,
    readSystemChannelId,
    shouldUseSub2ApiImageEdit,
    isCode2AlitaApiBase,
    matchesApiHost,
    taskUrl,
    normalizeApiBaseUrl,
    isInternalSystemProxyBase,
    taskHeaders,
    taskFetch,
    geminiHeaders,
    geminiApiUrl,
    withSystemPrompt,
    parseImagePayloadOrPoll,
    pollOpenAiImageTask,
    parseImagePayloadCompat,
    findImageResult,
    resolveImageUrlLike,
    resolveImageBase64Like,
    isLikelyImageUrl,
    readImagePayloadError,
    readImageTaskId,
    readImageTaskStatus,
    readImagePollUrl,
    findStringByKeys,
    isPendingImageStatus,
    imageTaskPollUrls,
    resolveTaskMediaUrl,
    shouldRetryInternalImageUrlAsBase64,
    isInternalGeneratedImageUrl,
    inlineRemoteImageResult,
    directRemoteImageResult,
    resolveProxiedMediaSource,
    shouldFallbackToJsonImageEdit,
    shouldTryNextImageResponseFormat,
    shouldRetryJsonImageEditPayload,
    shouldFallbackToResponsesImage,
    stringField,
    delay,
    parseGeminiImagePayload,
    toGeminiImagePart,
    buildImageEditFormData,
    imageReferenceToFile,
    dataUrlToFile,
    readFetchError,
    readPointsRemaining,
    readBilling,
    parseChargedImageResponse,
    refundChargedImageResponse,
    imageUnits,
    isRemoteMediaUrl,
    normalizeQuality,
    resolveRequestSize,
    resolveSize,
    parseImageRatio,
    parseImageDimensions,
    validateImageSize,
} from "./image-task-support";

export async function runImageTask(task: ImageTask, origin: string, publicOrigin: string, cookie: string) {
    const running = await transitionImageTask(task, ["pending"], { status: "running" });
    if (!running) return;
    const heartbeat = setInterval(() => {
        void touchImageTask(task.id);
    }, TASK_HEARTBEAT_MS);
    const candidates = [task.config, ...(task.candidateConfigs || [])];
    let attempts = task.attempts || [];
    let lastError: unknown;
    try {
        for (const [index, config] of candidates.entries()) {
            const started = startGenerationAttempt(attempts, { channelId: config.channelId, model: generationModelId(config), capability: "image" });
            attempts = started.attempts;
            const candidateTask = { ...task, config, candidateConfigs: candidates.slice(index + 1), attempts, attemptNo: started.attempt.attemptNo };
            await updateImageTask(task.id, { config, candidateConfigs: candidateTask.candidateConfigs, attempts, attemptNo: candidateTask.attemptNo });
            let chargedResult: ImageTaskRunResult | undefined;
            try {
                const result = (chargedResult = config.apiFormat === "gemini" ? await runGeminiImageTask(candidateTask, origin, cookie) : await runOpenAiImageTask(candidateTask, origin, publicOrigin, cookie));
                const resultRemoteUrl = (result as { remoteUrl?: unknown }).remoteUrl;
                const safeResult =
                    directRemoteImageResult(typeof resultRemoteUrl === "string" ? resultRemoteUrl : undefined) || (await inlineRemoteImageResult(result.dataUrl, origin, cookie, typeof resultRemoteUrl === "string" ? resultRemoteUrl : undefined));
                const log = await writeImageGenerationLog(candidateTask, "success", safeResult, Date.now() - task.createdAt).catch((error) => {
                    console.error("Image generation log write failed", error);
                    return null;
                });
                const asset = log?.assets[0];
                const settings = await getAuthSettings().catch(() => null);
                const current = await getImageTask(task.id);
                if (current?.status === "cancelled") {
                    if (result.pointsCost && result.pointsRecordId && settings)
                        await refundUserPoints(task.userId, generationModelId(config), result.pointsCost, "image", imageUnits(config.quality, settings.generationPointMultipliers.imageQuality), undefined, result.pointsRecordId);
                    return;
                }
                const completed = await transitionImageTask(candidateTask, ["running"], {
                    status: "success",
                    result: { dataUrl: safeResult.dataUrl, remoteUrl: asset?.remoteUrl || safeResult.remoteUrl, serverUrl: asset?.serverUrl },
                    pointsRemaining: result.pointsRemaining,
                });
                attempts = finishGenerationAttempt(attempts, started.attempt.attemptNo, { status: "succeeded", pointsCost: result.pointsCost, pointsRecordId: result.pointsRecordId });
                await updateImageTask(task.id, { config: { ...config, apiKey: "system" }, candidateConfigs: [], attempts, attemptNo: started.attempt.attemptNo });
                if (completed) {
                    const context = completed as ImageTask & GenerationTaskContext;
                    const url = completed.result?.serverUrl || completed.result?.remoteUrl || stableMediaUrl(completed.result?.dataUrl);
                    if (url)
                        await registerGenerationTaskAssetsForUser(task.userId, {
                            ...context,
                            taskId: task.id,
                            title: task.title || task.prompt.slice(0, 80),
                            assets: [{ type: "image", url }],
                        }).catch((error) => console.error("Creative image asset registration failed", error));
                }
                if (!completed && result.pointsCost && result.pointsRecordId && settings)
                    await refundUserPoints(task.userId, generationModelId(config), result.pointsCost, "image", imageUnits(config.quality, settings.generationPointMultipliers.imageQuality), undefined, result.pointsRecordId);
                return;
            } catch (error) {
                lastError = error;
                const current = await getImageTask(task.id);
                const settings = await getAuthSettings().catch(() => null);
                if (chargedResult?.pointsCost && chargedResult.pointsRecordId && current?.status !== "success" && settings)
                    await refundUserPoints(
                        task.userId,
                        generationModelId(config),
                        chargedResult.pointsCost,
                        "image",
                        imageUnits(config.quality, settings.generationPointMultipliers.imageQuality),
                        `image-task:${task.id}:attempt:${started.attempt.attemptNo}`,
                        chargedResult.pointsRecordId,
                    );
                attempts = finishGenerationAttempt(attempts, started.attempt.attemptNo, {
                    status: "failed",
                    error: toSafeGenerationErrorMessage(error, "图片生成失败"),
                    pointsCost: chargedResult?.pointsCost,
                    pointsRecordId: chargedResult?.pointsRecordId,
                });
                await updateImageTask(task.id, { attempts, attemptNo: started.attempt.attemptNo });
                if (current?.status === "cancelled" || current?.status === "success") return;
            }
        }
        throw lastError instanceof Error ? lastError : new Error("没有可用的图片渠道");
    } catch (error) {
        const current = await getImageTask(task.id);
        if (current?.status === "cancelled") return;
        const message = toSafeGenerationErrorMessage(error, "图片生成失败");
        await transitionImageTask(current || task, ["running"], { status: "error", error: message });
        await updateImageTask(task.id, { candidateConfigs: [], attempts, attemptNo: attempts.at(-1)?.attemptNo });
        await writeImageGenerationLog(task, "failed", "", Date.now() - task.createdAt, message).catch((logError) => {
            console.error("Image generation failure log write failed", logError);
        });
    } finally {
        clearInterval(heartbeat);
    }
}

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
        assets: resultUrl ? [{ type: "image", url: resultUrl, remoteUrl: typeof result === "string" ? undefined : result.remoteUrl }] : [],
        error,
        createdAt: task.createdAt,
        completedAt: Date.now(),
    });
}
