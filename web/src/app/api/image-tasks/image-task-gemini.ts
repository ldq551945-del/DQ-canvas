import { referenceRequestUrl } from "./image-task-reference-urls";
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
    imagePointsIdempotencyKey,
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

export async function runGeminiImageTask(task: ImageTask, origin: string, cookie: string): Promise<ImageTaskRunResult> {
    if (task.mask) throw new Error("Gemini 暂不支持蒙版编辑");
    const config = task.config;
    const parts: GeminiPart[] = [{ text: withSystemPrompt(config, buildImageReferencePromptText(task.prompt, task.references)) }];
    task.references.forEach((reference) => parts.push(toGeminiImagePart(referenceRequestUrl(reference, origin), reference.type)));
    const response = await taskFetch(config, `${geminiApiUrl(config, "generateContent", origin)}`, {
        method: "POST",
        headers: geminiHeaders(config, cookie, imagePointsIdempotencyKey(task)),
        body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        cache: "no-store",
    });
    if (!response.ok) throw new Error(await readFetchError(response, "图片生成失败"));
    const payload = (await response.json()) as GeminiPayload;
    return parseChargedImageResponse(task, response, async () => ({ dataUrl: parseGeminiImagePayload(payload) }));
}
