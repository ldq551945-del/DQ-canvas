import { after, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings, isAuthInputError, refundUserPoints } from "@/lib/auth/store";
import { generationModelId, toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { finishGenerationAttempt, startGenerationAttempt, type GenerationAttempt } from "@/lib/server/generation-attempt";
import { fetchInternalApi, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { assertReferenceCapabilities, assertReferenceUrls, buildVideoProviderRequest, isProviderBusinessError, readProviderError, readProviderString, resolvedProviderCreatePaths } from "@/lib/server/provider-task-config";
import { isQingyanProvider } from "@/lib/provider-compatibility";
import { buildGlobalAiOpcVideoRequest, resolveGlobalAiOpcPreset } from "@/lib/globalaiopc-catalog";
import { createVideoTask, transitionVideoTask, updateVideoTask, type VideoTask } from "@/lib/server/video-task-store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { getStoredGenerationTaskByRequest, linkStoredGenerationTask, withGenerationConcurrencyLimit, type GenerationTaskContext } from "@/lib/server/generation-task-store";
import { normalizeVideoAspectRatio, resolveUpstreamVideoDuration, resolveVideoDuration, resolveVideoGenerationParameters, withVideoReferenceFidelity } from "@/lib/server/video-task-config";
import { signReferenceAssetInputUrl } from "@/lib/server/reference-asset-access";
import { assertCapabilityConstraints } from "@/lib/server/capability-constraints";
import { checkGenerationRateLimit, rateLimitHeaders } from "@/lib/server/security";
import { resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";
import { mediaTaskSource } from "@/lib/media-management-contract";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { VIDEO_PROVIDER_MEDIA_KEYS, parseVideoProviderJson, readVideoProviderHttpError, readVideoProviderId, readVideoProviderUrl } from "@/lib/server/video-provider-response";
import { buildSeedanceSpecialRequest } from "@/lib/seedance-special";
import { systemAiBillingHeaders } from "@/lib/server/system-ai-billing";
import { maintenanceWorkerContextHeaders, requestRuntimeCredential } from "@/lib/server/maintenance-auth";
import { buildOpenAiVideoFormData } from "./video-task-openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREATE_PATHS = ["/video/generations", "/videos/generations", "/videos/videos", "/videos"];

export async function POST(request: Request) {
    const user = await getCurrentUser(request);
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
        const cookie = requestRuntimeCredential(request, user.id);
        const requestedParameters = resolveVideoGenerationParameters(body.config || {}, settings.generationDefaults);
        const billingRequestId = clean(body.context?.clientRequestId) || clean(request.headers.get("x-vozeb-pro-client-request-id")) || `video-request:${user.id}:${Date.now()}`;
        if (body.context?.clientRequestId) {
            const existing = await getStoredGenerationTaskByRequest<VideoTask>("video", user.id, body.context.clientRequestId, body.context.attemptNo);
            if (existing) return NextResponse.json({ task: publicTask(existing) });
        }
        let lastError: unknown;
        let capabilityError: unknown;
        let attempts: GenerationAttempt[] = [];
        let localTask: VideoTask | undefined;
        for (let index = 0; index < channels.length; index += 1) {
            const channel = channels[index];
            if (channel.apiFormat === "gemini") continue;
            const parameters = {
                ...requestedParameters,
                videoSeconds: resolveUpstreamVideoDuration(requestedParameters.videoSeconds, settings.generationDefaults.videoSeconds, {
                    durationRange: channel.advancedConfig?.durationRange,
                    minDurationSeconds: channel.capabilityProfile?.minDurationSeconds,
                    maxDurationSeconds: channel.capabilityProfile?.maxDurationSeconds,
                }),
            };
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
            const pendingUpstream = {
                id: "",
                provider: "generation" as const,
                model: channel.model,
                pollPath: channel.advancedConfig?.createPath || CREATE_PATHS[0],
            };
            if (!localTask) {
                localTask = await createVideoTask({
                    userId: user.id,
                    config: channel,
                    upstream: pendingUpstream,
                    requestedDurationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds,
                    prompt,
                    source: mediaTaskSource(body.source, body.context, "video-task"),
                    attempts,
                    ...(body.context || {}),
                });
                await linkStoredGenerationTask("video", localTask.id, body.context || {});
            } else {
                await updateVideoTask(localTask.id, {
                    config: channel,
                    upstream: pendingUpstream,
                    requestedDurationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds,
                    attempts,
                });
                localTask = { ...localTask, config: channel, upstream: pendingUpstream, requestedDurationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds, attempts };
            }
            await scheduleGenerationTask("video", localTask.id, {
                executionPhase: "submitting",
                channelId: channel.channelId,
                provider: channel.advancedConfig?.protocol || channel.apiFormat,
                queryPath: channel.advancedConfig?.queryPath,
                nextPollAt: Date.now(),
                lastUpstreamStatus: "submitting",
            });
            try {
                const upstream = await createUpstream(user.id, origin, cookie, channel, providerPrompt, parameters, references, settings.generationPointMultipliers, billingRequestId);
                await updateVideoTask(localTask.id, { config: channel, upstream, requestedDurationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds, attempts });
                const task = { ...localTask, config: channel, upstream, requestedDurationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds, attempts };
                const submittedAt = Date.now();
                await scheduleGenerationTask("video", task.id, {
                    executionPhase: "submitted",
                    upstreamTaskId: task.upstream.id,
                    channelId: channel.channelId,
                    provider: task.upstream.provider,
                    queryPath: task.upstream.pollPath,
                    submittedAt,
                    nextPollAt: submittedAt,
                    lastUpstreamStatus: "submitted",
                });
                after(() => runGenerationTaskRecoveryBatch({ origin, cookie, limit: 1, taskIds: [task.id] }));
                return NextResponse.json({ task: publicTask(task) });
            } catch (error) {
                lastError = error;
                attempts = finishGenerationAttempt(attempts, started.attempt.attemptNo, { status: "failed", error: toSafeGenerationErrorMessage(error, "视频任务创建失败") });
                await updateVideoTask(localTask.id, { attempts });
                if (error instanceof SafeCandidateFailure && index < channels.length - 1) continue;
                const message = toSafeGenerationErrorMessage(error, "视频任务创建失败");
                if (!(error instanceof SafeCandidateFailure)) {
                    await scheduleGenerationTask("video", localTask.id, { executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "submission_outcome_unknown" });
                    return NextResponse.json({ task: { ...publicTask({ ...localTask, attempts }), needsReview: true }, warning: `${message}；上游创建结果待确认，系统不会自动重复创建。` }, { status: 202 });
                }
                await transitionVideoTask(localTask, { status: "error", error: message });
                await scheduleGenerationTask("video", localTask.id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "create_failed" });
                break;
            }
        }
        if (!lastError && capabilityError) return NextResponse.json({ error: capabilityError instanceof Error ? capabilityError.message : "当前渠道不支持参考素材" }, { status: 400 });
        if (localTask && lastError) {
            const message = toSafeGenerationErrorMessage(lastError, "视频任务创建失败");
            await transitionVideoTask(localTask, { status: "error", error: message });
            await scheduleGenerationTask("video", localTask.id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "create_failed" });
        }
        return NextResponse.json({ error: toSafeGenerationErrorMessage(lastError, "视频任务创建失败") }, { status: 502 });
    });
    return response || NextResponse.json({ error: "当前用户视频任务已达到并发上限" }, { status: 429 });
}

function ratioValue(value: unknown) {
    const text = typeof value === "string" ? value.trim() : "";
    return text || undefined;
}

export async function createUpstream(
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
    const multipart = channel.advancedConfig?.requestTemplate?.trim().toLowerCase().startsWith("multipart/form-data") === true;
    const payload = multipart
        ? undefined
        : channel.advancedConfig?.protocol === "seedance-special"
          ? buildSeedanceSpecialRequest({
                model: channel.model,
                prompt,
                duration: values.duration === -1 ? 5 : (values.duration as number),
                ratio: values.ratio as string,
                generateAudio: raw.videoGenerateAudio !== "false",
                references: { images, videos, audios },
            })
          : globalPreset
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
    const requestBody = multipart ? await buildOpenAiVideoFormData({ model: channel.model, prompt, seconds: values.seconds as number, width: dimensions.width, height: dimensions.height, imageUrls: images, origin, cookie }) : JSON.stringify(payload);
    const imageToVideoPath = images.length ? channel.advancedConfig?.imageToVideoPath?.trim() : "";
    const createPaths = globalPreset ? [globalPreset.createPath] : imageToVideoPath ? [imageToVideoPath] : resolvedProviderCreatePaths(channel.advancedConfig, "video", CREATE_PATHS);
    for (const path of createPaths) {
        const response = await proxyFetch(origin, channel.baseUrl, path, cookie, {
            method: "POST",
            headers: {
                ...(multipart ? {} : { "Content-Type": "application/json" }),
                "Idempotency-Key": billingRequestId,
                "X-Client-Request-Id": billingRequestId,
                ...systemAiBillingHeaders(generationModelId(channel), `video-request:${billingRequestId}`, channel.model),
            },
            body: requestBody,
            signal: AbortSignal.timeout(resolveModelRequestTimeoutMs(channel, "video")),
        });
        const text = await response.text();
        if (!response.ok) {
            lastError = readVideoProviderHttpError(text, response.status);
            if (!SAFE_CREATE_FAILURE_STATUSES.has(response.status)) throw new Error(lastError);
            continue;
        }
        let data: unknown;
        try {
            data = parseVideoProviderJson(text);
        } catch (error) {
            const pointsCost = billedPointsCost(response.headers.get("x-vozeb-pro-points-cost"));
            const pointsRecordId = response.headers.get("x-vozeb-pro-points-record-id") || undefined;
            if (pointsCost !== undefined && pointsRecordId) await refundUserPoints(userId, generationModelId(channel), pointsCost, "video", videoUnits(raw, multipliers), undefined, pointsRecordId);
            throw error instanceof Error ? error : new Error("视频接口返回了无效 JSON");
        }
        const providerError = readProviderError(data);
        if (isProviderBusinessError(data)) {
            const pointsCost = billedPointsCost(response.headers.get("x-vozeb-pro-points-cost"));
            const pointsRecordId = response.headers.get("x-vozeb-pro-points-record-id") || undefined;
            if (pointsCost !== undefined && pointsRecordId) await refundUserPoints(userId, generationModelId(channel), pointsCost, "video", videoUnits(raw, multipliers), undefined, pointsRecordId);
            throw new SafeCandidateFailure(providerError || "视频接口请求失败");
        }
        const resultUrl = readVideoProviderUrl(data, channel.advancedConfig?.resultField);
        const id = readVideoProviderId(data) || (resultUrl ? `direct:${Date.now()}` : "");
        if (!id) {
            const pointsCost = billedPointsCost(response.headers.get("x-vozeb-pro-points-cost"));
            const pointsRecordId = response.headers.get("x-vozeb-pro-points-record-id") || undefined;
            if (pointsCost !== undefined && pointsRecordId) await refundUserPoints(userId, generationModelId(channel), pointsCost, "video", videoUnits(raw, multipliers), undefined, pointsRecordId);
            throw new Error(providerError || "视频接口没有返回任务 ID");
        }
        return {
            id,
            provider: "generation" as const,
            model: channel.model,
            pollPath: path,
            resultUrl: resultUrl || undefined,
            pointsCost: billedPointsCost(response.headers.get("x-vozeb-pro-points-cost")),
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

function proxyFetch(origin: string, baseUrl: string, path: string, cookie: string, init: RequestInit) {
    const headers = new Headers(init.headers);
    const workerHeaders = maintenanceWorkerContextHeaders(cookie);
    if (workerHeaders) Object.entries(workerHeaders).forEach(([key, value]) => headers.set(key, value));
    else if (cookie) headers.set("cookie", cookie);
    return fetchInternalApi(`${origin}${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`, { ...init, headers });
}
function publicTask(task: VideoTask) {
    return { id: task.id, status: task.status, model: generationModelId(task.config), upstreamId: task.upstream.id || undefined, durationSeconds: task.requestedDurationSeconds };
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
function billedPointsCost(value: unknown) {
    if (value === null || value === undefined || value === "") return undefined;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}
function videoUnits(raw: Record<string, unknown>, multipliers: Awaited<ReturnType<typeof getAuthSettings>>["generationPointMultipliers"]) {
    const quality = clean(raw.vquality).replace(/p$/i, "") || "720";
    const seconds = String(duration(raw.videoSeconds));
    return (multipliers.videoQuality[quality] || 1) * (multipliers.videoSeconds[seconds] || 1);
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
const MEDIA_KEYS = VIDEO_PROVIDER_MEDIA_KEYS;
const SAFE_CREATE_FAILURE_STATUSES = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429]);

class SafeCandidateFailure extends Error {}
