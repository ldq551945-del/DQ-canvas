import { after, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings, isAuthInputError, refundUserPoints } from "@/lib/auth/store";
import { generationModelId, toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { createAudioTask, getAudioTask, touchAudioTask, transitionAudioTask, updateAudioTask, type AudioTask, type AudioTaskConfig } from "@/lib/server/audio-task-store";
import { audioTaskRefundIdempotencyKey, refundAudioTask } from "@/lib/server/audio-task-refund";
import { fetchInternalApi, isInternalApiBaseUrl, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { finishGenerationAttempt, startGenerationAttempt } from "@/lib/server/generation-attempt";
import { getStoredGenerationTaskByRequest, linkStoredGenerationTask, withGenerationConcurrencyLimit, type GenerationTaskContext } from "@/lib/server/generation-task-store";
import { writePersistentMediaDataUrl } from "@/lib/server/reference-asset-store";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { buildProviderRequest, providerCreatePaths, providerQueryPaths, readProviderString } from "@/lib/server/provider-task-config";
import { resolveAudioTaskOptions } from "@/lib/server/audio-task-config";
import { registerGenerationTaskAssetsForUser } from "@/lib/server/creative-runtime-service";
import { checkGenerationRateLimit, rateLimitHeaders } from "@/lib/server/security";
import { mediaTaskSource } from "@/lib/media-management-contract";
import { resolveModelPollingAttempts, resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const rate = await checkGenerationRateLimit(user.id, request, "audio");
    if (!rate.allowed) return NextResponse.json({ error: "音频生成请求过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(rate) });
    const settings = await getAuthSettings();
    const response = await withGenerationConcurrencyLimit(user.id, "audio", 10 * 60 * 1000, settings.generationConcurrency.audio, async () => {
        let body: { config?: AudioTaskConfig; prompt?: string; source?: string; context?: GenerationTaskContext };
        try {
            body = await readJsonBody(request);
        } catch (error) {
            if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
            throw error;
        }
        const channels = resolveLogicalModelCandidates(settings, "audio", body.config?.model || settings.defaultModels.audioModel).map((resolved) => ({ ...toSystemGenerationChannel(resolved), channelId: resolved.channelId }));
        const prompt = String(body.prompt || "").trim();
        const supportedChannels = channels.filter((channel) => channel.apiFormat !== "gemini");
        if (!supportedChannels.length || !prompt) return NextResponse.json({ error: "音频任务参数不完整或渠道不支持" }, { status: 400 });
        const configs: AudioTaskConfig[] = supportedChannels.map((channel) => ({ ...channel, ...resolveAudioTaskOptions(body.config, settings.generationDefaults), instructions: clean(body.config?.instructions, 2000) }));
        const requestId = body.context?.clientRequestId?.trim();
        if (requestId) {
            const existing = await getStoredGenerationTaskByRequest<AudioTask>("audio", user.id, requestId, body.context?.attemptNo);
            if (existing) return NextResponse.json({ task: publicTask(existing) });
        }
        const task = await createAudioTask({ ...(body.context || {}), userId: user.id, config: configs[0], candidateConfigs: configs.slice(1), prompt: prompt.slice(0, 20000), source: mediaTaskSource(body.source, body.context, "audio-task") });
        await linkStoredGenerationTask("audio", task.id, body.context || {});
        after(() => runAudioTask(task, resolveInternalOrigin(new URL(request.url).origin), request.headers.get("cookie") || ""));
        return NextResponse.json({ task: publicTask(task) });
    });
    return response || NextResponse.json({ error: "当前用户音频任务已达到并发上限" }, { status: 429 });
}

async function runAudioTask(task: AudioTask, origin: string, cookie: string) {
    const runningTask = await transitionAudioTask(task, ["pending"], { status: "running" });
    if (!runningTask) return;
    const candidates = [task.config, ...(task.candidateConfigs || [])];
    let attempts = task.attempts || [];
    let lastError: unknown;
    const heartbeat = setInterval(() => {
        void touchAudioTask(task.id);
    }, 60_000);
    try {
        for (const [index, config] of candidates.entries()) {
            const started = startGenerationAttempt(attempts, { channelId: config.channelId, model: generationModelId(config), capability: "audio" });
            attempts = started.attempts;
            const candidateTask = { ...task, config, candidateConfigs: candidates.slice(index + 1), attempts, attemptNo: started.attempt.attemptNo };
            await updateAudioTask(task.id, { config, candidateConfigs: candidateTask.candidateConfigs, attempts, attemptNo: candidateTask.attemptNo });
            let chargedPoints = 0;
            let pointsRecordId: string | undefined;
            try {
                const defaults = {
                    model: config.model,
                    input: candidateTask.prompt,
                    prompt: candidateTask.prompt,
                    text: candidateTask.prompt,
                    voice: config.voice,
                    response_format: config.format,
                    format: config.format,
                    speed: Number(config.speed) || 1,
                    ...(config.instructions ? { instructions: config.instructions } : {}),
                };
                const payload = buildProviderRequest(config.advancedConfig?.requestTemplate, defaults, defaults);
                const { response, path } = await createAudioUpstream(candidateTask, origin, cookie, payload);
                chargedPoints = Number(response.headers.get("x-vozeb-pro-points-cost")) || 0;
                pointsRecordId = response.headers.get("x-vozeb-pro-points-record-id") || undefined;
                if (chargedPoints > 0) await updateAudioTask(task.id, { billing: { pointsCost: chargedPoints, pointsRecordId, refunded: false } });
                const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase() || "";
                if (contentType.includes("json")) {
                    const data = (await response.json()) as unknown;
                    const directUrl = readProviderString(data, config.advancedConfig?.resultField, AUDIO_KEYS);
                    if (directUrl) await persistRemoteAudio(candidateTask, origin, cookie, directUrl);
                    else {
                        const id = readProviderString(data, undefined, ID_KEYS);
                        if (!id) throw new Error("音频接口没有返回音频或任务 ID");
                        await updateAudioTask(task.id, { upstream: { id, createPath: path } });
                        const resultUrl = await pollAudioUpstream(candidateTask, origin, cookie, id, path);
                        await persistRemoteAudio(candidateTask, origin, cookie, resultUrl);
                    }
                } else await persistAudioBytes(candidateTask, origin, Buffer.from(await response.arrayBuffer()), contentType);
                const persisted = await getAudioTask(task.id);
                if (persisted?.status === "cancelled") {
                    attempts = finishGenerationAttempt(attempts, started.attempt.attemptNo, { status: "failed", error: "任务已取消", pointsCost: chargedPoints || undefined, pointsRecordId });
                    await updateAudioTask(task.id, { attempts, attemptNo: started.attempt.attemptNo });
                    return;
                }
                if (persisted?.status !== "success") throw new Error("音频结果保存失败");
                attempts = finishGenerationAttempt(attempts, started.attempt.attemptNo, { status: "succeeded", pointsCost: chargedPoints || undefined, pointsRecordId });
                await updateAudioTask(task.id, {
                    config: { ...config, apiKey: "system" },
                    candidateConfigs: [],
                    attempts,
                    attemptNo: started.attempt.attemptNo,
                    billing: chargedPoints ? { pointsCost: chargedPoints, pointsRecordId, refunded: false } : undefined,
                });
                return;
            } catch (error) {
                lastError = error;
                const current = await getAudioTask(task.id);
                pointsRecordId = pointsRecordId || current?.billing?.pointsRecordId || attempts.at(-1)?.pointsRecordId;
                if (chargedPoints > 0 && pointsRecordId && current?.status !== "success" && !current?.billing?.refunded) {
                    await refundUserPoints(task.userId, generationModelId(config), chargedPoints, "audio", 1, audioTaskRefundIdempotencyKey({ id: task.id, attemptNo: started.attempt.attemptNo }), pointsRecordId);
                    await updateAudioTask(task.id, { billing: { pointsCost: chargedPoints, pointsRecordId, refunded: true } });
                }
                attempts = finishGenerationAttempt(attempts, started.attempt.attemptNo, { status: "failed", error: toSafeGenerationErrorMessage(error, "音频生成失败"), pointsCost: chargedPoints || undefined, pointsRecordId });
                await updateAudioTask(task.id, { attempts, attemptNo: started.attempt.attemptNo });
                if (current?.status === "cancelled" || current?.status === "success") return;
            }
        }
        throw lastError instanceof Error ? lastError : new Error("没有可用的音频渠道");
    } catch (error) {
        const current = await getAudioTask(task.id);
        if (current && current.status !== "cancelled") {
            const failed = await transitionAudioTask(current, ["running"], {
                status: "error",
                error: toSafeGenerationErrorMessage(error, "音频生成失败"),
                config: { ...current.config, apiKey: "" },
                billing: current.billing,
            });
            if (failed) await updateAudioTask(task.id, { candidateConfigs: [], attempts, attemptNo: attempts.at(-1)?.attemptNo, billing: failed.billing });
        }
    } finally {
        clearInterval(heartbeat);
    }
}

async function createAudioUpstream(task: AudioTask, origin: string, cookie: string, payload: Record<string, unknown>) {
    let lastError = "";
    for (const path of providerCreatePaths(task.config.advancedConfig, ["/audio/speech"])) {
        const response = await providerFetch(task, origin, cookie, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(resolveModelRequestTimeoutMs(task.config, "audio")) });
        if (response.ok) return { response, path };
        lastError = readAudioError(await response.text(), response.status);
    }
    throw new Error(lastError || "没有可用的音频创建接口");
}

async function pollAudioUpstream(task: AudioTask, origin: string, cookie: string, id: string, createPath: string) {
    for (let attempt = 0; attempt < resolveModelPollingAttempts(task.config, "audio", 2_500, 180); attempt += 1) {
        const latest = await getAudioTask(task.id);
        if (!latest || latest.status === "cancelled") throw new Error("任务已取消");
        let lastError = "";
        for (const path of providerQueryPaths(task.config.advancedConfig, id, [`${createPath.replace(/\/+$/, "")}/${encodeURIComponent(id)}`])) {
            const response = await providerFetch(task, origin, cookie, path, { cache: "no-store", signal: AbortSignal.timeout(Math.min(resolveModelRequestTimeoutMs(task.config, "audio"), 60_000)) });
            const text = await response.text();
            if (!response.ok) {
                lastError = readAudioError(text, response.status);
                continue;
            }
            let data: unknown;
            try {
                data = JSON.parse(text);
            } catch {
                continue;
            }
            const result = readProviderString(data, task.config.advancedConfig?.resultField, AUDIO_KEYS);
            if (result) return result;
            const status = readProviderString(data, task.config.advancedConfig?.statusField, STATUS_KEYS).toLowerCase();
            if (FAILED.has(status)) throw new Error(readProviderString(data, undefined, ERROR_KEYS) || "音频生成失败");
            lastError = "";
            break;
        }
        if (lastError) throw new Error(lastError);
        await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    throw new Error("音频生成超时");
}

async function persistRemoteAudio(task: AudioTask, origin: string, cookie: string, remoteUrl: string) {
    if (/^data:audio\//i.test(remoteUrl)) {
        const current = await getAudioTask(task.id);
        if (current?.status === "cancelled") {
            await refundAudioTask(current);
            return;
        }
        const asset = await writePersistentMediaDataUrl(remoteUrl, "audio", mediaContext(task));
        const completed = await transitionAudioTask(task, ["running"], {
            status: "success",
            result: { url: asset.url || `${origin}/api/reference-assets/${asset.token}`, mimeType: remoteUrl.slice(5, remoteUrl.indexOf(";")) || mimeFromFormat(task.config.format || "mp3") },
            config: { ...task.config, apiKey: "" },
        });
        if (completed) await registerAudioAsset(completed);
        if (!completed) {
            const latest = await getAudioTask(task.id);
            if (latest) await refundAudioTask(latest);
        }
        return;
    }
    const path = /^https?:\/\//i.test(remoteUrl) ? `/_media?url=${encodeURIComponent(remoteUrl)}` : `/${remoteUrl.replace(/^\/+/, "")}`;
    const response = await providerFetch(task, origin, cookie, path, { signal: AbortSignal.timeout(resolveModelRequestTimeoutMs(task.config, "audio")) });
    if (!response.ok) throw new Error(readAudioError(await response.text(), response.status));
    await persistAudioBytes(task, origin, Buffer.from(await response.arrayBuffer()), response.headers.get("content-type")?.split(";")[0] || "");
}

async function persistAudioBytes(task: AudioTask, origin: string, bytes: Buffer, responseMime: string) {
    if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw new Error("音频结果为空或超过 30MB 限制");
    const mimeType = responseMime.startsWith("audio/") ? responseMime : mimeFromFormat(task.config.format || "mp3");
    const current = await getAudioTask(task.id);
    if (current?.status === "cancelled") {
        await refundAudioTask(current);
        return;
    }
    const asset = await writePersistentMediaDataUrl(`data:${mimeType};base64,${bytes.toString("base64")}`, "audio", mediaContext(task));
    const completed = await transitionAudioTask(task, ["running"], { status: "success", result: { url: asset.url || `${origin}/api/reference-assets/${asset.token}`, mimeType }, config: { ...task.config, apiKey: "" } });
    if (completed) await registerAudioAsset(completed);
    if (!completed) {
        const latest = await getAudioTask(task.id);
        if (latest) await refundAudioTask(latest);
    }
}

async function registerAudioAsset(task: AudioTask & GenerationTaskContext) {
    if (!task.result?.url) return;
    await registerGenerationTaskAssetsForUser(task.userId, {
        ...task,
        taskId: task.id,
        title: task.prompt.slice(0, 80) || "生成音频",
        assets: [{ type: "audio", url: task.result.url, mimeType: task.result.mimeType }],
    }).catch((error) => console.error("Creative audio asset registration failed", error));
}

function mediaContext(task: AudioTask & GenerationTaskContext) {
    return { ownerUserId: task.userId, source: task.source || "audio-task", conversationId: task.conversationId, runId: task.runId, taskId: task.id, projectId: task.projectId };
}

function providerFetch(task: AudioTask, origin: string, cookie: string, path: string, init: RequestInit) {
    const url = task.config.baseUrl.startsWith("/") ? `${origin}${task.config.baseUrl.replace(/\/+$/, "")}${path}` : `${task.config.baseUrl.replace(/\/+$/, "")}${path}`;
    return (isInternalApiBaseUrl(task.config.baseUrl) ? fetchInternalApi : fetch)(url, {
        ...init,
        headers: {
            ...Object.fromEntries(new Headers(init.headers).entries()),
            Authorization: `Bearer ${task.config.apiKey}`,
            ...(cookie ? { cookie } : {}),
            ...(task.config.baseUrl.startsWith("/") ? { "x-vozeb-pro-points-idempotency-key": `audio-task:${task.id}:attempt:${task.attemptNo || 1}` } : {}),
        },
    });
}

function publicTask(task: AudioTask) {
    return { id: task.id, status: task.status, model: generationModelId(task.config), result: task.result, error: task.error };
}
function clean(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function mimeFromFormat(format: string) {
    return format === "wav" ? "audio/wav" : format === "opus" ? "audio/ogg" : format === "aac" ? "audio/aac" : format === "flac" ? "audio/flac" : "audio/mpeg";
}
function readAudioError(value: string, status: number) {
    try {
        const payload = JSON.parse(value) as { msg?: string; message?: string; error?: string | { message?: string } };
        const message = typeof payload.error === "string" ? payload.error : payload.error?.message || payload.msg || payload.message;
        return message?.trim().slice(0, 500) || `音频生成失败（${status}）`;
    } catch {
        return value.trim().slice(0, 500) || `音频生成失败（${status}）`;
    }
}

const ID_KEYS = ["task_id", "taskId", "id", "job_id", "jobId", "generation_id", "generationId"];
const STATUS_KEYS = ["status", "state", "task_status", "taskStatus"];
const AUDIO_KEYS = ["audio_url", "audioUrl", "media_url", "mediaUrl", "output_url", "outputUrl", "result_url", "resultUrl", "url", "uri"];
const ERROR_KEYS = ["error_message", "errorMessage", "message", "msg", "error"];
const FAILED = new Set(["failed", "failure", "error", "cancelled", "canceled", "expired"]);
