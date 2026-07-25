import { after, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings, isAuthInputError, refundUserPoints } from "@/lib/auth/store";
import { generationModelId, toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { finishGenerationAttempt, startGenerationAttempt, type GenerationAttempt } from "@/lib/server/generation-attempt";
import { fetchInternalApi, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { assertReferenceCapabilities, assertReferenceUrls, buildVideoProviderRequest, isProviderBusinessError, providerCreatePaths, providerQueryPaths, readProviderError, readProviderString, videoPollingPolicy } from "@/lib/server/provider-task-config";
import { isQingyanProvider } from "@/lib/provider-compatibility";
import { buildGlobalAiOpcVideoRequest, resolveGlobalAiOpcPreset } from "@/lib/globalaiopc-catalog";
import { createVideoTask, getVideoTask, touchVideoTask, transitionVideoTask, updateVideoTask, type VideoTask } from "@/lib/server/video-task-store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { getStoredGenerationTaskByRequest, linkStoredGenerationTask, withGenerationConcurrencyLimit, type GenerationTaskContext } from "@/lib/server/generation-task-store";
import { normalizeVideoAspectRatio, resolveVideoDuration, resolveVideoGenerationParameters, withVideoReferenceFidelity } from "@/lib/server/video-task-config";
import { registerGenerationTaskAssetsForUser } from "@/lib/server/creative-runtime-service";
import { signReferenceAssetInputUrl } from "@/lib/server/reference-asset-access";
import { assertCapabilityConstraints } from "@/lib/server/capability-constraints";
import { normalizeVideoResult } from "@/lib/server/video-result-normalizer";
import { checkGenerationRateLimit, rateLimitHeaders } from "@/lib/server/security";
import { mediaTaskSource } from "@/lib/media-management-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREATE_PATHS = ["/video/generations", "/videos/generations", "/videos/videos", "/videos"];

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const rate = await checkGenerationRateLimit(user.id, request, "video");
    if (!rate.allowed) return NextResponse.json({ error: "视频生成请求过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(rate) });
    const settings = await getAuthSettings();
    const response = await withGenerationConcurrencyLimit(user.id, "video", 10 * 60 * 1000, settings.generationConcurrency.video, async () => {
        let body: { config?: Record<string, unknown>; prompt?: string; references?: Array<{ type?: string; url?: string }>; source?: string; context?: GenerationTaskContext };
        try {
            body = await readJsonBody(request);
        } catch (error) {
            if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
            throw error;
        }
        const requestedModel = typeof body.config?.model === "string" && body.config.model.trim() ? body.config.model : settings.defaultModels.videoModel;
        const channels = resolveLogicalModelCandidates(settings, "video", requestedModel).map(toSystemGenerationChannel);
        const prompt = String(body.prompt || "").trim();
        if (!channels.length || !prompt) return NextResponse.json({ error: "视频任务参数不完整或渠道不支持" }, { status: 400 });
        const publicOrigin = requestPublicOrigin(request);
        const references = (Array.isArray(body.references) ? body.references : []).map((reference) => ({ ...reference, url: signReferenceAssetInputUrl(String(reference.url || ""), publicOrigin) }));
        const providerPrompt = withVideoReferenceFidelity(prompt, references);
        const origin = resolveInternalOrigin(new URL(request.url).origin);
        const cookie = request.headers.get("cookie") || "";
        const parameters = resolveVideoGenerationParameters(body.config || {}, settings.generationDefaults);
        const billingRequestId = clean(body.context?.clientRequestId) || clean(request.headers.get("x-vozeb-pro-client-request-id")) || `video-request:${user.id}:${Date.now()}`;
        if (body.context?.clientRequestId) {
            const existing = await getStoredGenerationTaskByRequest<VideoTask>("video", user.id, body.context.clientRequestId, body.context.attemptNo);
            if (existing) return NextResponse.json({ task: publicTask(existing) });
        }
        let lastError: unknown;
        let capabilityError: unknown;
        let attempts: GenerationAttempt[] = [];
        for (let index = 0; index < channels.length; index += 1) {
            const channel = channels[index];
            if (channel.apiFormat === "gemini") continue;
            try {
                assertCapabilityConstraints(channel.capabilityProfile, {
                    capability: "video",
                    referenceCount: references.filter((reference) => reference.type === "image").length,
                    durationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds,
                    aspectRatio: ratioValue(parameters.size),
                });
                const globalPreset = globalAiOpcVideoPreset(channel.advancedConfig, channel.model);
                assertReferenceCapabilities(
                    globalPreset
                        ? {
                              ...channel.advancedConfig!,
                              supportsReferenceImage: Boolean(globalPreset.supportsReferenceImage),
                              supportsReferenceVideo: Boolean(globalPreset.supportsReferenceVideo),
                              supportsReferenceAudio: Boolean(globalPreset.supportsReferenceAudio),
                          }
                        : channel.advancedConfig,
                    references,
                );
                assertReferenceUrls(channel.advancedConfig, references, isQingyanProvider({ model: channel.model, protocol: channel.advancedConfig?.protocol }) || Boolean(globalPreset));
            } catch (error) {
                capabilityError = error;
                continue;
            }
            const started = startGenerationAttempt(attempts, { channelId: channel.channelId, model: generationModelId(channel), capability: "video" });
            attempts = started.attempts;
            try {
                const upstream = await createUpstream(user.id, origin, cookie, channel, providerPrompt, parameters, references, settings.generationPointMultipliers, billingRequestId);
                const task = await createVideoTask({
                    userId: user.id,
                    config: channel,
                    upstream,
                    requestedDurationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds,
                    prompt,
                    source: mediaTaskSource(body.source, body.context, "video-task"),
                    attempts,
                    ...(body.context || {}),
                });
                await linkStoredGenerationTask("video", task.id, body.context || {});
                after(() => runVideoTask(task, origin, cookie));
                return NextResponse.json({ task: publicTask(task) });
            } catch (error) {
                lastError = error;
                attempts = finishGenerationAttempt(attempts, started.attempt.attemptNo, { status: "failed", error: toSafeGenerationErrorMessage(error, "视频任务创建失败") });
                if (!(error instanceof SafeCandidateFailure) || index === channels.length - 1) break;
            }
        }
        if (!lastError && capabilityError) return NextResponse.json({ error: capabilityError instanceof Error ? capabilityError.message : "当前渠道不支持参考素材" }, { status: 400 });
        return NextResponse.json({ error: toSafeGenerationErrorMessage(lastError, "视频任务创建失败") }, { status: 502 });
    });
    return response || NextResponse.json({ error: "当前用户视频任务已达到并发上限" }, { status: 429 });
}

function ratioValue(value: unknown) {
    const text = typeof value === "string" ? value.trim() : "";
    return text || undefined;
}

async function createUpstream(
    userId: string,
    origin: string,
    cookie: string,
    channel: NonNullable<ReturnType<typeof toSystemGenerationChannel>>,
    prompt: string,
    raw: Record<string, unknown>,
    references: Array<{ type?: string; url?: string }>,
    multipliers: Awaited<ReturnType<typeof getAuthSettings>>["generationPointMultipliers"],
    billingRequestId: string,
) {
    let lastError = "";
    const images = referenceUrls(references, "image");
    const videos = referenceUrls(references, "video");
    const audios = referenceUrls(references, "audio");
    const qingyan = isQingyanProvider({ model: channel.model, protocol: channel.advancedConfig?.protocol });
    const requestImage = qingyan && images.length > 1 ? "" : images[0] || "";
    const requestImages = qingyan && images.length === 1 ? [] : images;
    const dimensions = videoDimensions(raw.size, raw.vquality);
    const values = {
        model: channel.model,
        prompt,
        duration: duration(raw.videoSeconds),
        seconds: duration(raw.videoSeconds),
        ratio: ratio(raw.size),
        aspect_ratio: ratio(raw.size),
        size: ratio(raw.size),
        resolution: resolution(raw.vquality),
        quality: resolution(raw.vquality),
        width: dimensions.width,
        height: dimensions.height,
        images: requestImages,
        videos,
        audios,
        image: requestImage,
        video: videos[0] || "",
        audio: audios[0] || "",
        references,
    };
    const defaults = {
        model: channel.model,
        prompt,
        duration: values.duration,
        seconds: values.seconds,
        ratio: values.ratio,
        aspect_ratio: values.aspect_ratio,
        resolution: values.resolution,
        quality: values.quality,
        generate_audio: raw.videoGenerateAudio !== "false",
        watermark: raw.videoWatermark === "true",
        ...(requestImage ? { image: requestImage } : {}),
        ...(requestImages.length ? { images: requestImages, image_urls: requestImages, reference_images: requestImages } : {}),
        ...(videos.length ? { video: videos[0], videos, reference_videos: videos } : {}),
        ...(audios.length ? { audio: audios[0], audios, reference_audios: audios } : {}),
        ...(references.length ? { ref_assets: references.map((item) => ({ type: item.type, url: item.url })) } : {}),
    };
    const globalPreset = globalAiOpcVideoPreset(channel.advancedConfig, channel.model);
    const payload = globalPreset
        ? buildGlobalAiOpcVideoRequest(globalPreset, {
              model: channel.model,
              prompt,
              duration: values.duration as number,
              ratio: values.ratio as string,
              resolution: values.resolution as string,
              images: requestImages.length ? requestImages : requestImage ? [requestImage] : [],
              videos,
              audios,
              generateAudio: raw.videoGenerateAudio !== "false",
          })
        : buildVideoProviderRequest(channel.advancedConfig?.requestTemplate, defaults, values);
    const createPaths = globalPreset ? [globalPreset.createPath] : providerCreatePaths(channel.advancedConfig, CREATE_PATHS);
    for (const path of createPaths) {
        const response = await proxyFetch(origin, channel.baseUrl, path, cookie, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-vozeb-pro-points-idempotency-key": `video-request:${billingRequestId}` },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(3 * 60 * 1000),
        });
        const text = await response.text();
        if (!response.ok) {
            lastError = readError(text, response.status);
            if (!SAFE_CREATE_FAILURE_STATUSES.has(response.status)) throw new Error(lastError);
            continue;
        }
        let data: unknown;
        try {
            data = parseJson(text);
        } catch (error) {
            const pointsCost = positiveNumber(response.headers.get("x-vozeb-pro-points-cost"));
            const pointsRecordId = response.headers.get("x-vozeb-pro-points-record-id") || undefined;
            if (pointsCost && pointsRecordId) await refundUserPoints(userId, generationModelId(channel), pointsCost, "video", videoUnits(raw, multipliers), undefined, pointsRecordId);
            throw error instanceof Error ? error : new Error("视频接口返回了无效 JSON");
        }
        const providerError = readProviderError(data);
        if (isProviderBusinessError(data)) {
            const pointsCost = positiveNumber(response.headers.get("x-vozeb-pro-points-cost"));
            const pointsRecordId = response.headers.get("x-vozeb-pro-points-record-id") || undefined;
            if (pointsCost && pointsRecordId) await refundUserPoints(userId, generationModelId(channel), pointsCost, "video", videoUnits(raw, multipliers), undefined, pointsRecordId);
            throw new Error(providerError || "视频接口请求失败");
        }
        const resultUrl = readProviderString(data, channel.advancedConfig?.resultField, MEDIA_KEYS);
        const id = findString(data, ID_KEYS) || (resultUrl ? `direct:${Date.now()}` : "");
        if (!id) {
            const pointsCost = positiveNumber(response.headers.get("x-vozeb-pro-points-cost"));
            const pointsRecordId = response.headers.get("x-vozeb-pro-points-record-id") || undefined;
            if (pointsCost && pointsRecordId) await refundUserPoints(userId, generationModelId(channel), pointsCost, "video", videoUnits(raw, multipliers), undefined, pointsRecordId);
            throw new Error(providerError || "视频接口没有返回任务 ID");
        }
        return {
            id,
            provider: "generation" as const,
            model: channel.model,
            pollPath: path,
            resultUrl: resultUrl || undefined,
            pointsCost: positiveNumber(response.headers.get("x-vozeb-pro-points-cost")),
            pointsUnits: videoUnits(raw, multipliers),
            pointsRecordId: response.headers.get("x-vozeb-pro-points-record-id") || undefined,
        };
    }
    throw new SafeCandidateFailure(lastError || "没有可用的视频创建接口");
}

function globalAiOpcVideoPreset(config: NonNullable<ReturnType<typeof toSystemGenerationChannel>>["advancedConfig"], model: string) {
    const preset = resolveGlobalAiOpcPreset(config, model);
    return preset?.capability === "video" ? preset : undefined;
}

async function runVideoTask(task: VideoTask, origin: string, cookie: string) {
    const polling = videoPollingPolicy(Boolean(globalAiOpcVideoPreset(task.config.advancedConfig, task.config.model)));
    const heartbeat = setInterval(() => {
        void touchVideoTask(task.id);
    }, 60_000);
    try {
        if (task.upstream.resultUrl) {
            const attempts = finishGenerationAttempt(task.attempts || [], task.attempts?.at(-1)?.attemptNo || 1, { status: "succeeded", pointsCost: task.upstream.pointsCost, pointsRecordId: task.upstream.pointsRecordId });
            await updateVideoTask(task.id, { attempts });
            const result = await normalizeVideoResult({
                url: mediaUrl(task.config.baseUrl, task.upstream.resultUrl),
                origin,
                cookie,
                requestedDurationSeconds: task.requestedDurationSeconds,
                mimeType: "video/mp4",
                ownerUserId: task.userId,
                source: task.source,
                conversationId: task.conversationId,
                runId: task.runId,
                taskId: task.id,
                projectId: task.projectId,
            });
            const completed = await transitionVideoTask(task, { status: "success", result });
            if (completed) await registerVideoAsset(completed);
            return;
        }
        for (let attempt = 0; attempt < polling.attempts; attempt += 1) {
            const latest = await getVideoTask(task.id);
            if (!latest || latest.status === "cancelled") return;
            const data = await queryUpstream(task, origin, cookie);
            if (isProviderBusinessError(data)) throw new Error(readProviderError(data) || "视频任务查询失败");
            const status = readProviderString(data, task.config.advancedConfig?.statusField, STATUS_KEYS).toLowerCase();
            const resultUrl = readProviderString(data, task.config.advancedConfig?.resultField, MEDIA_KEYS);
            if (resultUrl || SUCCESS.has(status)) {
                if (!resultUrl) throw new Error("视频任务已完成但没有返回视频地址");
                const attempts = finishGenerationAttempt(task.attempts || [], task.attempts?.at(-1)?.attemptNo || 1, { status: "succeeded", pointsCost: task.upstream.pointsCost, pointsRecordId: task.upstream.pointsRecordId });
                await updateVideoTask(task.id, { attempts });
                const result = await normalizeVideoResult({
                    url: mediaUrl(task.config.baseUrl, resultUrl),
                    origin,
                    cookie,
                    requestedDurationSeconds: task.requestedDurationSeconds,
                    mimeType: "video/mp4",
                    ownerUserId: task.userId,
                    source: task.source,
                    conversationId: task.conversationId,
                    runId: task.runId,
                    taskId: task.id,
                    projectId: task.projectId,
                });
                const completed = await transitionVideoTask(task, { status: "success", result });
                if (completed) await registerVideoAsset(completed);
                return;
            }
            if (FAILED.has(status)) throw new Error(findString(data, ERROR_KEYS) || "视频生成失败");
            await new Promise((resolve) => setTimeout(resolve, polling.intervalMs));
        }
        throw new Error("视频生成超时");
    } catch (error) {
        const current = await getVideoTask(task.id);
        if (current?.status !== "cancelled") {
            const attempts = finishGenerationAttempt(task.attempts || [], task.attempts?.at(-1)?.attemptNo || 1, { status: "failed", error: error instanceof Error ? error.message : "视频生成失败" });
            await updateVideoTask(task.id, { attempts });
            const failed = await transitionVideoTask(task, { status: "error", error: toSafeGenerationErrorMessage(error, "视频生成失败") });
            if (failed) await refundVideoTask(task);
        }
    } finally {
        clearInterval(heartbeat);
    }
}

async function registerVideoAsset(task: VideoTask & GenerationTaskContext) {
    const url = task.result?.remoteUrl || task.result?.url;
    if (!url) return;
    await registerGenerationTaskAssetsForUser(task.userId, {
        ...task,
        taskId: task.id,
        title: task.prompt?.slice(0, 80) || "生成视频",
        assets: [{ type: "video", url, mimeType: task.result?.mimeType || "video/mp4", durationMs: task.result?.durationMs }],
    }).catch((error) => console.error("Creative video asset registration failed", error));
}

async function queryUpstream(task: VideoTask, origin: string, cookie: string) {
    const createPath = task.upstream.pollPath || "/video/generations";
    const globalPreset = globalAiOpcVideoPreset(task.config.advancedConfig, task.config.model);
    const paths = globalPreset?.queryPath
        ? [globalPreset.queryPath.replace(/:(?:task_id|taskId|id)\b/g, encodeURIComponent(task.upstream.id))]
        : providerQueryPaths(task.config.advancedConfig, task.upstream.id, [
              `${createPath.replace(/\/+$/, "")}/${encodeURIComponent(task.upstream.id)}`,
              `/videos/${encodeURIComponent(task.upstream.id)}`,
              `/video/generations/${encodeURIComponent(task.upstream.id)}`,
              `/videos/generations/${encodeURIComponent(task.upstream.id)}`,
              `/result?id=${encodeURIComponent(task.upstream.id)}`,
          ]);
    let lastError = "";
    for (const path of paths) {
        const response = await proxyFetch(origin, task.config.baseUrl, path, cookie, { cache: "no-store", signal: AbortSignal.timeout(60 * 1000) });
        const text = await response.text();
        if (!response.ok) {
            lastError = readError(text, response.status);
            continue;
        }
        return parseJson(text);
    }
    throw new Error(lastError || "视频任务查询失败");
}

function proxyFetch(origin: string, baseUrl: string, path: string, cookie: string, init: RequestInit) {
    return fetchInternalApi(`${origin}${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), cookie } });
}
function publicTask(task: VideoTask) {
    return { id: task.id, status: task.status, model: generationModelId(task.config), upstreamId: task.upstream.id };
}
function mediaUrl(baseUrl: string, url: string) {
    const base = baseUrl.replace(/\/+$/, "");
    return /^https?:\/\//i.test(url) ? `${base}/_media?url=${encodeURIComponent(url)}` : `${base}/${url.replace(/^\/+/, "")}`;
}
function duration(value: unknown) {
    return resolveVideoDuration(value, 5);
}
function ratio(value: unknown) {
    return normalizeVideoAspectRatio(value);
}
function resolution(value: unknown) {
    const text = clean(value).replace(/p$/i, "");
    return text === "480" || text === "1080" ? `${text}p` : "720p";
}
function videoDimensions(size: unknown, quality: unknown) {
    const [x, y] = ratio(size).split(":").map(Number);
    const edge = Number(resolution(quality).replace("p", "")) || 720;
    if (!x || !y) return { width: 1280, height: 720 };
    return x >= y ? { width: Math.round((edge * x) / y), height: edge } : { width: edge, height: Math.round((edge * y) / x) };
}
function positiveNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}
function videoUnits(raw: Record<string, unknown>, multipliers: Awaited<ReturnType<typeof getAuthSettings>>["generationPointMultipliers"]) {
    const quality = clean(raw.vquality).replace(/p$/i, "") || "720";
    const seconds = String(duration(raw.videoSeconds));
    return (multipliers.videoQuality[quality] || 1) * (multipliers.videoSeconds[seconds] || 1);
}
async function refundVideoTask(task: VideoTask) {
    if (task.upstream.pointsCost && task.upstream.pointsRecordId)
        await refundUserPoints(task.userId, generationModelId(task.config), task.upstream.pointsCost, "video", task.upstream.pointsUnits || 1, `video-task:${task.id}:refund`, task.upstream.pointsRecordId);
}
function clean(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
function unique(values: string[]) {
    return Array.from(new Set(values.filter(Boolean)));
}
function referenceUrls(items: Array<{ type?: string; url?: string }>, type: string) {
    return unique(items.filter((item) => item.type === type).map((item) => clean(item.url)));
}
function requestPublicOrigin(request: Request) {
    const configured = normalizePublicOrigin(process.env.NEXT_PUBLIC_SITE_URL || "");
    if (configured) return configured;
    const url = new URL(request.url);
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "");
    return `${protocol}://${host}`;
}
function normalizePublicOrigin(value: string) {
    try {
        const url = new URL(value.trim());
        return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
    } catch {
        return "";
    }
}
function parseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        throw new Error("视频接口返回了无效 JSON");
    }
}
function readError(value: string, status: number) {
    try {
        const data = JSON.parse(value);
        return findString(data, ERROR_KEYS) || `视频接口请求失败（${status}）`;
    } catch {
        return value.slice(0, 300) || `视频接口请求失败（${status}）`;
    }
}
function findString(value: unknown, keys: string[], depth = 0): string {
    if (!value || depth > 6) return "";
    if (typeof value === "string") return keys === MEDIA_KEYS && (/^https?:\/\//i.test(value) || /\.(mp4|webm|mov)(\?|$)/i.test(value)) ? value : "";
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findString(item, keys, depth + 1);
            if (found) return found;
        }
        return "";
    }
    if (typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    for (const key of keys) {
        const item = record[key];
        if (typeof item === "string" && item.trim()) return item.trim();
        if (typeof item === "number") return String(item);
    }
    for (const item of Object.values(record)) {
        const found = findString(item, keys, depth + 1);
        if (found) return found;
    }
    return "";
}

const ID_KEYS = ["task_id", "taskId", "id", "job_id", "jobId", "request_id", "requestId", "uuid", "task_uuid", "taskUuid", "generation_id", "generationId"];
const STATUS_KEYS = ["status", "state", "task_status", "taskStatus"];
const MEDIA_KEYS = ["video_url", "videoUrl", "media_url", "mediaUrl", "content_url", "contentUrl", "output_url", "outputUrl", "result_url", "resultUrl", "url", "uri"];
const ERROR_KEYS = ["error_message", "errorMessage", "message", "msg", "error"];
const SUCCESS = new Set(["completed", "complete", "succeeded", "success", "done", "finished"]);
const FAILED = new Set(["failed", "failure", "error", "cancelled", "canceled", "expired"]);
const SAFE_CREATE_FAILURE_STATUSES = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429]);

class SafeCandidateFailure extends Error {}
