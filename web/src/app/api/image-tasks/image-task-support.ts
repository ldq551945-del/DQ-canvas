import { rawReferenceRequestUrlCandidates } from "./image-task-reference-urls";
import { after, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings, refundUserPoints } from "@/lib/auth/store";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { fetchInternalApi, isInternalApiBaseUrl, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolveGeneratedMediaUrl } from "@/lib/media-url";
import { closestImageAspectRatio, parseImageDimensions } from "@/lib/image-size";
import { isQingyanProvider } from "@/lib/provider-compatibility";
import { resolveGlobalAiOpcPreset } from "@/lib/globalaiopc-catalog";
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
import { resolveModelPollingAttempts, resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";

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

export function publicTask(task: ImageTask) {
    return {
        id: task.id,
        kind: task.kind,
        status: task.status,
        model: generationModelId(task.config),
    };
}

export function sanitizeConfigs(config: ImageTaskConfig | undefined, settings: Awaited<ReturnType<typeof getAuthSettings>>): ImageTaskConfig[] {
    const requestedModel = config?.model || settings.defaultModels.imageModel;
    return resolveLogicalModelCandidates(settings, "image", requestedModel).map((resolved) => {
        const channel = toSystemGenerationChannel(resolved);
        return {
            ...channel,
            channelId: resolved.channelId,
            ...resolveImageTaskOptions(config || {}, settings.generationDefaults),
            systemPrompt: "",
            advancedConfig: sanitizeAdvancedConfig(channel.advancedConfig),
        };
    });
}

export function sanitizeAdvancedConfig(config?: ImageTaskConfig["advancedConfig"]) {
    if (!config || typeof config !== "object") return undefined;
    return {
        protocol: config.protocol || "auto",
        globalAiOpcPreset: config.globalAiOpcPreset,
        globalAiOpcPresets: config.globalAiOpcPresets,
        textModel: textOrEmpty(config.textModel),
        imageModel: textOrEmpty(config.imageModel),
        videoModel: textOrEmpty(config.videoModel),
        createPath: textOrEmpty(config.createPath),
        queryPath: textOrEmpty(config.queryPath),
        requestTemplate: textOrEmpty(config.requestTemplate),
        resultField: textOrEmpty(config.resultField),
        statusField: textOrEmpty(config.statusField),
        durationRange: textOrEmpty(config.durationRange),
        referenceRule: textOrEmpty(config.referenceRule),
        supportsReferenceImage: Boolean(config.supportsReferenceImage),
        supportsReferenceVideo: Boolean(config.supportsReferenceVideo),
        supportsReferenceAudio: Boolean(config.supportsReferenceAudio),
    };
}

export function textOrEmpty(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

export async function preferredImageResponseFormat(config: ImageTaskConfig): Promise<(typeof IMAGE_RESPONSE_FORMATS)[number]> {
    const apiBase = await resolveConfiguredApiBaseUrl(config.baseUrl).catch(() => config.baseUrl);
    return isQingyanProvider({ baseUrl: apiBase, model: config.model, protocol: config.advancedConfig?.protocol }) ? "b64_json" : "url";
}

export async function openAiImageTaskPath(config: ImageTaskConfig, kind: ImageTask["kind"]) {
    const configured = (config.advancedConfig?.createPath || "").trim();
    const configuredPath = configured ? normalizeImageTaskPath(configured) : "";
    if (kind !== "edit") return configuredPath || "/images/generations";
    const apiBase = await resolveConfiguredApiBaseUrl(config.baseUrl).catch(() => config.baseUrl);
    if (shouldUseSub2ApiImageEdit(config, apiBase)) return configuredPath || "/images/generations";

    const ruleEditPath = configuredImageEditPath(config);
    if (ruleEditPath) return ruleEditPath;
    if (!configuredPath) return isQingyanProvider({ baseUrl: apiBase, model: config.model, protocol: config.advancedConfig?.protocol }) ? "/images/generations" : "/images/edits";

    const referenceMode = configuredImageEditReferenceMode(config);
    if (referenceMode === "json" || referenceMode === "public-url" || globalAiOpcImagePreset(config) || isQingyanProvider({ baseUrl: apiBase, model: config.model, protocol: config.advancedConfig?.protocol })) return configuredPath;
    if (isStandardOpenAiImageGenerationPath(configuredPath)) return configuredPath.replace(/\/generations$/i, "/edits");
    return configuredPath;
}

export function configuredImageEditPath(config: ImageTaskConfig) {
    const rule = (config.advancedConfig?.referenceRule || "").trim();
    const match = rule.match(/\/(?:[a-z0-9._-]+\/)*images\/edits\b/i);
    return match?.[0] ? normalizeImageTaskPath(match[0]) : "";
}

export function normalizeImageTaskPath(path: string) {
    return path.startsWith("/") ? path : `/${path}`;
}

export function isStandardOpenAiImageGenerationPath(path: string) {
    return /^\/(?:v1\/)?images\/generations$/i.test(path);
}

export async function shouldUseJsonImageEdit(config: ImageTaskConfig) {
    if (globalAiOpcImagePreset(config)) return true;
    const apiBase = await resolveConfiguredApiBaseUrl(config.baseUrl).catch(() => config.baseUrl);
    const referenceMode = configuredImageEditReferenceMode(config);
    if (shouldUseSub2ApiImageEdit(config, apiBase)) return true;
    if (referenceMode === "json" || referenceMode === "public-url") return true;
    if (referenceMode === "multipart") return false;
    return isQingyanProvider({ baseUrl: apiBase, model: config.model, protocol: config.advancedConfig?.protocol });
}

export function configuredImageEditReferenceMode(config: ImageTaskConfig): ImageEditReferenceMode {
    const rule = (config.advancedConfig?.referenceRule || "").trim().toLowerCase();
    if (!rule) return "auto";
    if (/\bmultipart\b|form-?data|file upload|\u6587\u4ef6\u4e0a\u4f20|\u4e0a\u4f20\u6587\u4ef6/i.test(rule)) return "multipart";
    if (/\u516c\u7f51|public|next_public_site_url|localhost|must.*\burl\b|\burl\b.*only|\u5fc5\u987b.*\burl\b|\u4ec5.*\burl\b|\u53ea.*\burl\b/i.test(rule)) return "public-url";
    if (/\bjson\b|base64.*json|json.*base64|data:image|inline|ref_assets|input_image|image\/images/i.test(rule)) return "json";
    return "auto";
}

export function globalAiOpcImagePreset(config: ImageTaskConfig) {
    const preset = resolveGlobalAiOpcPreset(config.advancedConfig, config.model);
    return preset?.capability === "image" ? preset : undefined;
}

export async function resolveConfiguredApiBaseUrl(baseUrl: string) {
    const systemChannelId = readSystemChannelId(baseUrl);
    if (!systemChannelId) return baseUrl;
    const settings = await getAuthSettings();
    return settings.systemChannels.find((channel) => channel.id === systemChannelId)?.baseUrl || baseUrl;
}

export function readSystemChannelId(baseUrl: string) {
    try {
        const parsed = new URL(baseUrl, "http://localhost");
        const match = parsed.pathname.match(/^\/api\/ai\/system\/([^/]+)/);
        return match?.[1] ? decodeURIComponent(match[1]) : "";
    } catch {
        return "";
    }
}

export function shouldUseSub2ApiImageEdit(config: ImageTaskConfig, apiBase: string) {
    if (config.advancedConfig?.protocol === "sub2api") return true;
    if (isCode2AlitaApiBase(apiBase)) return true;
    const advanced = config.advancedConfig;
    const requestTemplate = (advanced?.requestTemplate || "").toLowerCase();
    const referenceRule = (advanced?.referenceRule || "").toLowerCase();
    if (/\bsub2api\b/i.test(`${requestTemplate}\n${referenceRule}`)) return true;
    return /\bimage_urls\b|images\[\]\.image_url|"images"\s*:\s*\[\s*\{\s*"image_url"|images\s*:\s*\[\s*\{\s*image_url/i.test(requestTemplate);
}

export function isCode2AlitaApiBase(baseUrl: string) {
    return matchesApiHost(baseUrl, "code2alita.com");
}

export function matchesApiHost(baseUrl: string, hostname: string) {
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        const target = hostname.toLowerCase();
        return host === target || host.endsWith(`.${target}`);
    } catch {
        return false;
    }
}

export function taskUrl(config: ImageTaskConfig, path: string, origin: string) {
    const apiBase = normalizeApiBaseUrl(config.baseUrl, config.apiFormat, origin);
    return `${apiBase}${path}`;
}

export function normalizeApiBaseUrl(baseUrl: string, apiFormat: "openai" | "gemini", origin: string) {
    const absoluteBase = baseUrl.startsWith("/") ? `${origin}${baseUrl}` : baseUrl;
    const normalized = absoluteBase.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    if (isInternalSystemProxyBase(normalized)) return normalized;
    if (lower.endsWith("/v1") || lower.endsWith("/v1beta") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3")) return normalized;
    if (apiFormat === "gemini") return `${normalized}/v1beta`;
    return `${normalized}/v1`;
}

export function isInternalSystemProxyBase(value: string) {
    try {
        return /^\/api\/ai\/system\/[^/]+$/i.test(new URL(value).pathname);
    } catch {
        return false;
    }
}

export function taskHeaders(config: ImageTaskConfig, cookie: string, pointsIdempotencyKey?: string) {
    const headers = new Headers();
    if (config.baseUrl.startsWith("/") && cookie) headers.set("cookie", cookie);
    if (config.baseUrl.startsWith("/") && pointsIdempotencyKey) headers.set("x-vozeb-pro-points-idempotency-key", pointsIdempotencyKey);
    if (config.apiFormat === "gemini") headers.set("x-goog-api-key", config.apiKey);
    else headers.set("authorization", `Bearer ${config.apiKey}`);
    return headers;
}

export function taskFetch(config: ImageTaskConfig, url: string, init: RequestInit) {
    const nextInit = {
        ...init,
        signal: init.signal || AbortSignal.timeout(imageTaskRequestTimeoutMs(config)),
    };
    if (!isInternalApiBaseUrl(config.baseUrl)) return fetch(url, nextInit);
    if (typeof FormData !== "undefined" && nextInit.body instanceof FormData) return fetch(url, nextInit);
    return fetchInternalApi(url, nextInit);
}

export function imageTaskRequestTimeoutMs(config: ImageTaskConfig) {
    return resolveModelRequestTimeoutMs(config, "image");
}

export function imageTaskPollAttempts(config: ImageTaskConfig) {
    return resolveModelPollingAttempts(config, "image", IMAGE_TASK_POLL_INTERVAL_MS, IMAGE_TASK_POLL_ATTEMPTS);
}

export function geminiHeaders(config: ImageTaskConfig, cookie: string, pointsIdempotencyKey?: string) {
    const headers = taskHeaders(config, cookie, pointsIdempotencyKey);
    headers.set("content-type", "application/json");
    return headers;
}

export function imagePointsIdempotencyKey(task: Pick<ImageTask, "id" | "attemptNo">) {
    return `image-task:${task.id}:attempt:${task.attemptNo || 1}`;
}

export function geminiApiUrl(config: ImageTaskConfig, action: "generateContent", origin: string) {
    const baseUrl = normalizeApiBaseUrl(config.baseUrl, "gemini", origin);
    return `${baseUrl}/models/${encodeURIComponent(config.model.replace(/^models\//, ""))}:${action}`;
}

export function withSystemPrompt(config: ImageTaskConfig, prompt: string) {
    const systemPrompt = (config.systemPrompt || "").trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

export async function parseImagePayloadOrPoll(config: ImageTaskConfig, payload: ImageApiResponse, mediaBaseUrl: string, cookie: string, pollBaseUrl = mediaBaseUrl): Promise<ImageTaskResult> {
    const image = parseImagePayloadCompat(payload, mediaBaseUrl, config);
    if (image) return image;

    const taskId = readImageTaskId(payload);
    if (!taskId) throw new Error(readImagePayloadError(payload) || "接口没有返回图片");
    return pollOpenAiImageTask(config, taskId, mediaBaseUrl, pollBaseUrl, cookie, readImagePollUrl(config, payload, mediaBaseUrl, pollBaseUrl));
}

export async function pollOpenAiImageTask(config: ImageTaskConfig, taskId: string, mediaBaseUrl: string, pollBaseUrl: string, cookie: string, explicitPollUrl = ""): Promise<ImageTaskResult> {
    const pollUrls = imageTaskPollUrls(config, pollBaseUrl, taskId, explicitPollUrl);
    let lastError = "";
    for (let attempt = 0; attempt < imageTaskPollAttempts(config); attempt += 1) {
        for (const pollUrl of pollUrls) {
            const response = await taskFetch(config, pollUrl, { method: "GET", headers: taskHeaders(config, cookie), cache: "no-store", signal: AbortSignal.timeout(Math.min(imageTaskRequestTimeoutMs(config), 60_000)) });
            if (!response.ok) {
                const message = await readFetchError(response, "图片任务查询失败");
                lastError = message;
                if (response.status === 404 || response.status === 405) continue;
                throw new Error(message);
            }
            const payload = (await response.json()) as ImageApiResponse;
            const baseUrl = response.headers.get("x-vozeb-pro-upstream-url") || mediaBaseUrl || pollUrl;
            const image = parseImagePayloadCompat(payload, baseUrl, config);
            if (image) return image;
            const error = readImagePayloadError(payload);
            if (error) throw new Error(error);
            payload.status = readImageTaskStatus(payload) || payload.status;
            if (!isPendingImageStatus(payload.status)) throw new Error("图片任务完成但没有返回图片");
        }
        await delay(IMAGE_TASK_POLL_INTERVAL_MS);
    }
    throw new Error(lastError || "图片生成超时，请稍后重试");
}

export function parseImagePayloadCompat(payload: ImageApiResponse, baseUrl: string, config: ImageTaskConfig): ImageTaskResult | null {
    const error = readImagePayloadError(payload);
    if (error) throw new Error(error);
    return findImageResult(payload, baseUrl, config);
}

export function findImageResult(value: unknown, baseUrl: string, config: ImageTaskConfig, depth = 0): ImageTaskResult | null {
    if (!value || depth > 6) return null;
    if (typeof value === "string") {
        const url = resolveImageUrlLike(value, baseUrl, config, false);
        if (url) return url;
        const dataUrl = resolveImageBase64Like(value);
        return dataUrl ? { dataUrl } : null;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const image = findImageResult(item, baseUrl, config, depth + 1);
            if (image) return image;
        }
        return null;
    }
    if (typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    for (const key of IMAGE_BASE64_KEYS) {
        const dataUrl = resolveImageBase64Like(stringField(record, key));
        if (dataUrl) return { dataUrl };
    }
    for (const key of IMAGE_URL_KEYS) {
        const image = resolveImageUrlLike(stringField(record, key), baseUrl, config, true);
        if (image) return image;
    }
    for (const key of IMAGE_CONTAINER_KEYS) {
        const image = findImageResult(record[key], baseUrl, config, depth + 1);
        if (image) return image;
    }
    return null;
}

export function resolveImageUrlLike(value: string, baseUrl: string, config: ImageTaskConfig, fromNamedField: boolean) {
    const mediaUrl = value.trim();
    if (!mediaUrl) return null;
    if (/^data:image\//i.test(mediaUrl) || /^blob:/i.test(mediaUrl)) return { dataUrl: mediaUrl };
    if (fromNamedField || isLikelyImageUrl(mediaUrl)) {
        const dataUrl = resolveTaskMediaUrl(config, mediaUrl, baseUrl);
        const remoteUrl = resolveGeneratedMediaUrl(mediaUrl, baseUrl);
        return { dataUrl, remoteUrl: isRemoteMediaUrl(remoteUrl) ? remoteUrl : undefined };
    }
    return null;
}

export function resolveImageBase64Like(value: string) {
    const base64 = value.trim();
    if (!base64) return "";
    if (/^data:image\//i.test(base64)) return base64;
    if (base64.length < 64 || !/^[a-z0-9+/=_-]+$/i.test(base64.replace(/\s/g, ""))) return "";
    return `data:image/png;base64,${base64.replace(/\s/g, "")}`;
}

export function isLikelyImageUrl(value: string) {
    return /^https?:\/\//i.test(value) || value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(value);
}

export function readImagePayloadError(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) return payload.msg || "图片生成失败";
    if (payload.error?.message) return payload.error.message;
    const status = (payload.status || "").toLowerCase();
    if (["failed", "failure", "error", "cancelled", "canceled", "expired"].includes(status)) return payload.msg || "图片生成失败";
    return "";
}

export function readImageTaskId(payload: ImageApiResponse) {
    return findStringByKeys(payload, IMAGE_TASK_ID_KEYS);
}

export function readImageTaskStatus(payload: ImageApiResponse) {
    return findStringByKeys(payload, IMAGE_STATUS_KEYS).toLowerCase();
}

export function readImagePollUrl(config: ImageTaskConfig, payload: ImageApiResponse, mediaBaseUrl: string, pollBaseUrl: string) {
    const value = findStringByKeys(payload, IMAGE_POLL_URL_KEYS);
    if (!value || config.baseUrl.startsWith("/api/ai/system/")) return "";
    return resolveGeneratedMediaUrl(value, mediaBaseUrl || pollBaseUrl);
}

export function findStringByKeys(value: unknown, keys: string[], depth = 0): string {
    if (!value || depth > 5) return "";
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findStringByKeys(item, keys, depth + 1);
            if (found) return found;
        }
        return "";
    }
    if (typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    for (const key of keys) {
        const found = stringField(record, key);
        if (found) return found;
    }
    for (const key of IMAGE_CONTAINER_KEYS) {
        const found = findStringByKeys(record[key], keys, depth + 1);
        if (found) return found;
    }
    return "";
}

export function isPendingImageStatus(status?: string) {
    const value = (status || "").toLowerCase();
    return !value || ["pending", "queued", "running", "processing", "in_progress", "created"].includes(value);
}

export function imageTaskPollUrls(config: ImageTaskConfig, requestUrl: string, taskId: string, explicitPollUrl = "") {
    const cleanUrl = requestUrl.split("?")[0].replace(/\/+$/, "");
    const encodedTaskId = encodeURIComponent(taskId);
    const pollUrls = [configuredImageTaskPollUrl(config, taskId, requestUrl), explicitPollUrl, `${cleanUrl}/${encodedTaskId}`];
    const generationsUrl = cleanUrl.replace(/\/images\/(?:generations|edits)$/i, "/images/generations");
    if (generationsUrl !== cleanUrl) pollUrls.push(`${generationsUrl}/${encodedTaskId}`);
    return Array.from(new Set(pollUrls.filter(Boolean)));
}

export function configuredImageTaskPollUrl(config: ImageTaskConfig, taskId: string, requestUrl: string) {
    const queryPath = (globalAiOpcImagePreset(config)?.queryPath || config.advancedConfig?.queryPath || "").trim();
    if (!queryPath) return "";
    let origin = "";
    try {
        origin = new URL(requestUrl).origin;
    } catch {
        return "";
    }
    const rendered = queryPath.replace(/\{\{\s*(?:taskId|task_id|id)\s*\}\}|\{(?:taskId|task_id|id)\}|:(?:taskId|task_id|id)\b/gi, encodeURIComponent(taskId));
    return taskUrl(config, rendered === queryPath ? `${queryPath.replace(/\/+$/, "")}/${encodeURIComponent(taskId)}` : rendered, origin);
}

export function resolveTaskMediaUrl(config: ImageTaskConfig, value: string, baseUrl: string) {
    if (/^(data|blob):/i.test(value)) return value;
    const remoteUrl = resolveGeneratedMediaUrl(value, baseUrl);
    if (!config.baseUrl.startsWith("/api/ai/system/")) return remoteUrl;
    const proxyBase = config.baseUrl.trim().replace(/\/+$/, "");
    return `${proxyBase}/_media?url=${encodeURIComponent(remoteUrl)}`;
}

export function shouldRetryInternalImageUrlAsBase64(result: ImageTaskResult) {
    return isInternalGeneratedImageUrl(result.remoteUrl || "") || isInternalGeneratedImageUrl(result.dataUrl || "");
}

export function isInternalGeneratedImageUrl(value: string) {
    const url = value.trim();
    if (!/^https?:\/\//i.test(url)) return false;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return !host.includes(".") || host.endsWith(".internal") || host.endsWith(".local");
    } catch {
        return false;
    }
}

export async function inlineRemoteImageResult(value: string, origin: string, cookie: string, remoteFallback?: string) {
    const url = (value || "").trim();
    if (!url || url.startsWith("data:")) return { dataUrl: url, remoteUrl: remoteFallback };
    const mediaSource = resolveProxiedMediaSource(url, origin);
    const remoteUrl = mediaSource.remoteUrl || remoteFallback || (isRemoteMediaUrl(url) && !mediaSource.proxyUrl ? url : undefined);
    const fallbackUrl = remoteUrl || mediaSource.proxyUrl;
    const fetchUrl = url.startsWith("/") ? `${origin}${url}` : url;
    if (!isRemoteMediaUrl(fetchUrl)) return { dataUrl: url, remoteUrl: fallbackUrl };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), INLINE_IMAGE_TIMEOUT_MS);
    try {
        const response = await fetch(fetchUrl, {
            headers: cookie && url.startsWith("/") ? { cookie } : undefined,
            cache: "no-store",
            signal: controller.signal,
        });
        if (!response.ok || !response.body) return { dataUrl: url, remoteUrl: fallbackUrl };
        const contentLength = Number(response.headers.get("content-length") || 0);
        if (contentLength > MAX_INLINE_IMAGE_BYTES) return { dataUrl: url, remoteUrl: fallbackUrl };
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > MAX_INLINE_IMAGE_BYTES) return { dataUrl: url, remoteUrl: fallbackUrl };
        const mimeType = response.headers.get("content-type")?.split(";", 1)[0] || "image/png";
        if (!mimeType.startsWith("image/")) return { dataUrl: url, remoteUrl: fallbackUrl };
        return { dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`, remoteUrl: fallbackUrl };
    } catch {
        return { dataUrl: url, remoteUrl: fallbackUrl };
    } finally {
        clearTimeout(timer);
    }
}

export function directRemoteImageResult(remoteUrl?: string) {
    const fallback = (remoteUrl || "").trim();
    if (!isRemoteMediaUrl(fallback) || isInternalGeneratedImageUrl(fallback)) return null;
    return { dataUrl: fallback, remoteUrl: fallback };
}

export function resolveProxiedMediaSource(value: string, origin: string) {
    const trimmed = value.trim();
    const absolute = trimmed.startsWith("/") ? `${origin}${trimmed}` : trimmed;
    try {
        const parsed = new URL(absolute);
        const isSameOrigin = parsed.origin === origin;
        const isProxyPath = parsed.pathname === "/api/media-proxy" || /^\/api\/ai\/system\/[^/]+\/_media$/.test(parsed.pathname);
        if (!isProxyPath) return {};
        const sourceUrl = parsed.searchParams.get("url") || "";
        const proxyUrl = trimmed.startsWith("/") || isSameOrigin ? `${parsed.pathname}${parsed.search}` : trimmed;
        return {
            remoteUrl: isRemoteMediaUrl(sourceUrl) ? sourceUrl : undefined,
            proxyUrl,
        };
    } catch {
        return {};
    }
}

export function shouldFallbackToJsonImageEdit(status: number, message: string) {
    if (status === 404 || status === 405 || status === 415) return true;
    if (status !== 400 && status !== 422) return false;
    return (
        /multipart|form-?data|file upload|prompt.*required|required.*prompt|image url|image file|input image|reference image|invalid image|images\[\]|unsupported|not supported|failed to parse request body|parse request body|invalid request body|request body.*(?:parse|invalid)|body.*(?:parse|invalid)|cannot parse/i.test(
            message,
        ) || isPydanticDictionaryError(message)
    );
}

export function shouldTryNextImageResponseFormat(responseFormat: (typeof IMAGE_RESPONSE_FORMATS)[number], status: number, message: string) {
    if (status !== 400 && status !== 422) return false;
    if (responseFormat === "url") return /response[_ -]?format|url|unsupported|not supported|invalid/i.test(message);
    if (responseFormat === "b64_json") return /response[_ -]?format|b64|base64|unsupported|not supported|invalid/i.test(message);
    return false;
}

export function shouldRetryJsonImageEditPayload(status: number, message: string) {
    if (status !== 400 && status !== 422) return false;
    return (
        /image|images|image_url|input_image|reference|invalid type|unmarshal|deserialize|field|failed to parse request body|parse request body|invalid request body|request body.*(?:parse|invalid)|body.*(?:parse|invalid)|cannot parse/i.test(message) ||
        isPydanticDictionaryError(message)
    );
}

export function isPydanticDictionaryError(message: string) {
    return /valid dictionary|dictionary or object|extract fields/i.test(message);
}

export function shouldFallbackToResponsesImage(status: number, message: string) {
    if (status === 401 || status === 403 || status === 429) return false;
    if (status === 404 || status === 405 || status === 415) return true;
    if (status === 400 || status === 422) return /images\/generations|images\/edits|endpoint|route|not found|not implemented|no such|cannot post|unsupported|not supported/i.test(message);
    return false;
}

export function stringField(record: Record<string, unknown>, key: string) {
    const value = record[key];
    return typeof value === "string" ? value.trim() : "";
}

export function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseGeminiImagePayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
    const image = payload.candidates
        ?.flatMap((candidate) => candidate.content?.parts || [])
        .map((part) => {
            const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
            if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
            return part.fileData?.fileUri || "";
        })
        .find(Boolean);
    if (!image) throw new Error("Gemini 接口没有返回图片");
    return image;
}

export function toGeminiImagePart(dataUrl: string, fallbackType?: string): GeminiPart {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: dataUrl, mimeType: fallbackType || "image/png" } };
}

export async function buildImageEditFormData(task: ImageTask, quality: string | undefined, requestSize: string | undefined, origin: string, cookie: string, responseFormat: (typeof IMAGE_RESPONSE_FORMATS)[number]) {
    const formData = new FormData();
    formData.set("model", task.config.model);
    formData.set("prompt", withSystemPrompt(task.config, buildImageReferencePromptText(task.prompt, task.references)));
    formData.set("n", "1");
    formData.set("response_format", responseFormat);
    formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    if (quality) formData.set("quality", quality);
    if (requestSize) formData.set("size", requestSize);
    const referenceFiles = await Promise.all(task.references.map((reference, index) => imageReferenceToFile(reference, reference.name || `reference-${index + 1}.png`, origin, cookie)));
    referenceFiles.forEach((file) => formData.append("image", file));
    if (task.mask) formData.set("mask", await imageReferenceToFile(task.mask, task.mask.name || "mask.png", origin, cookie));
    return formData;
}

export async function imageReferenceToFile(reference: ImageTaskReference, name: string, origin: string, cookie: string) {
    let lastError: unknown;
    for (const value of rawReferenceRequestUrlCandidates(reference)) {
        try {
            if (/^data:image\//i.test(value)) return dataUrlToFile(value, name, reference.type);
            if (/^blob:/i.test(value)) throw new Error("参考图已失效，请重新上传");
            const fetchUrl = value.startsWith("/") ? `${origin}${value}` : value;
            if (!isRemoteMediaUrl(fetchUrl)) throw new Error("参考图地址无效，请重新上传参考图");
            const response = await fetch(fetchUrl, {
                headers: cookie && value.startsWith("/") ? { cookie } : undefined,
                cache: "no-store",
                signal: AbortSignal.timeout(INLINE_IMAGE_TIMEOUT_MS),
            });
            if (!response.ok || !response.body) throw new Error("参考图读取失败");
            const contentLength = Number(response.headers.get("content-length") || 0);
            if (contentLength > MAX_INLINE_IMAGE_BYTES) throw new Error("参考图过大，请压缩后重试");
            const bytes = Buffer.from(await response.arrayBuffer());
            if (!bytes.length) throw new Error("参考图读取失败");
            if (bytes.length > MAX_INLINE_IMAGE_BYTES) throw new Error("参考图过大，请压缩后重试");
            const mimeType = response.headers.get("content-type")?.split(";", 1)[0] || reference.type || "image/png";
            if (!mimeType.startsWith("image/")) throw new Error("参考图不是有效图片");
            return new File([bytes], name, { type: mimeType });
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error("参考图读取失败");
}

export function dataUrlToFile(dataUrl: string, name: string, fallbackType?: string) {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) throw new Error("参考图不是有效 base64 图片");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length) throw new Error("参考图读取失败");
    return new File([bytes], name, { type: fallbackType || match[1] || "image/png" });
}

export async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    const statusText = `${fallback}，状态码 ${response.status}`;
    if (!text) return statusText;
    if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) {
        const upstreamUrl = response.headers.get("x-vozeb-pro-upstream-url") || "";
        const contentType = response.headers.get("content-type") || "";
        const details = [upstreamUrl ? `地址 ${upstreamUrl}` : "", contentType ? `类型 ${contentType}` : ""].filter(Boolean).join("，");
        return `${fallback}，上游返回了网页错误（HTTP ${response.status}${details ? `，${details}` : ""}），请检查接口路径、鉴权、参考图提交方式或网关状态`;
    }
    try {
        const payload = JSON.parse(text) as { error?: { message?: string }; message?: string; msg?: string };
        return payload.msg || payload.message || payload.error?.message || statusText;
    } catch {
        return text.slice(0, 300) || statusText;
    }
}

export function readPointsRemaining(headers: Headers) {
    const value = headers.get("x-vozeb-pro-points-remaining");
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

export function readBilling(headers: Headers) {
    const pointsCost = Number(headers.get("x-vozeb-pro-points-cost"));
    return {
        pointsRemaining: readPointsRemaining(headers),
        pointsCost: Number.isFinite(pointsCost) && pointsCost > 0 ? pointsCost : undefined,
        pointsRecordId: headers.get("x-vozeb-pro-points-record-id") || undefined,
    };
}

export async function parseChargedImageResponse(task: ImageTask, response: Response, parse: () => Promise<ImageTaskResult>) {
    try {
        return { ...(await parse()), ...readBilling(response.headers) };
    } catch (error) {
        await refundChargedImageResponse(task, response.headers);
        throw error;
    }
}

export async function refundChargedImageResponse(task: ImageTask, headers: Headers) {
    const { pointsCost, pointsRecordId } = readBilling(headers);
    if (!pointsCost || !pointsRecordId) return;
    const settings = await getAuthSettings();
    await refundUserPoints(task.userId, generationModelId(task.config), pointsCost, "image", imageUnits(task.config.quality, settings.generationPointMultipliers.imageQuality), undefined, pointsRecordId);
}

export function imageUnits(quality: string | undefined, multipliers: Record<string, number>) {
    const key = QUALITY_ALIASES[String(quality || "").toLowerCase()] || String(quality || "auto").toLowerCase();
    return multipliers[key] || 1;
}

export function isRemoteMediaUrl(value: string) {
    return /^https?:\/\//i.test(value);
}

export function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

export function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(quality, value);
    throw new Error("图片尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

export function imageRequestAspectRatio(size: string) {
    const value = size.trim();
    if (/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value)) return value;
    const dimensions = parseImageDimensions(value);
    return (dimensions && closestImageAspectRatio(dimensions.width, dimensions.height)) || "1:1";
}

export function resolveSize(quality: string | undefined, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;
    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }
    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

export function parseImageRatio(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图片尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const width = Number(parts[0]);
    const height = Number(parts[1]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("图片比例必须是正数，例如 9:16");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图片宽高比不能超过 3:1，请调整尺寸");
    return { width, height };
}

export { parseImageDimensions };

export function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图片尺寸必须是正整数，例如 1024x1024");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error("图片尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图片宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error("图片总像素需在 655360 到 8294400 之间，请调整尺寸");
}
