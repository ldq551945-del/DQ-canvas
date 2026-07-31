import { refundUserPoints } from "@/lib/auth/store";
import { resolveGlobalAiOpcPreset } from "@/lib/globalaiopc-catalog";
import { generationModelId } from "@/lib/server/generation-channel";
import { finishGenerationAttempt } from "@/lib/server/generation-attempt";
import { fetchInternalApi } from "@/lib/server/internal-origin";
import { resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";
import { isProviderBusinessError, providerQueryPaths, readProviderError, videoPollingPolicy } from "@/lib/server/provider-task-config";
import { registerGenerationTaskAssetsForUser } from "@/lib/server/creative-runtime-service";
import { normalizeVideoResult } from "@/lib/server/video-result-normalizer";
import { VIDEO_PROVIDER_FAILED, VIDEO_PROVIDER_SUCCESS, parseVideoProviderJson, readVideoProviderHttpError, readVideoProviderStatus, readVideoProviderUrl, videoProviderMediaUrl } from "@/lib/server/video-provider-response";
import { claimVideoTaskPoll, completeReconciledVideoTask, failReconciledVideoTask, getVideoTask, updateVideoTask, type VideoTask } from "@/lib/server/video-task-store";
import { maintenanceWorkerHeaders } from "@/lib/server/maintenance-auth";

export type VideoUpstreamStep = { state: "pending"; status: string } | { state: "result_ready"; status: string; resultUrl: string } | { state: "failed"; status: string; error: string };

export async function refreshVideoTaskFromUpstream(task: VideoTask, origin: string, cookie: string) {
    const polling = taskPollingPolicy(task);
    const claimed = await claimVideoTaskPoll(task.id, polling.intervalMs);
    if (!claimed) return getVideoTask(task.id);

    const step = await queryVideoTaskUpstream(claimed, origin, cookie);
    if (step.state === "failed") return failVideoTask(claimed, step.error);
    if (step.state === "result_ready") return persistVideoTaskResult(claimed, step.resultUrl, origin, cookie);
    return getVideoTask(claimed.id);
}

export async function queryVideoTaskUpstream(task: VideoTask, origin: string, cookie = "", workerUserId = ""): Promise<VideoUpstreamStep> {
    if (task.upstream.resultUrl) return { state: "result_ready", status: "completed", resultUrl: task.upstream.resultUrl };
    const data = await queryVideoUpstream(task, origin, cookie, workerUserId);
    const status = readVideoProviderStatus(data, task.config.advancedConfig?.statusField);
    const resultUrl = readVideoProviderUrl(data, task.config.advancedConfig?.resultField);
    if (resultUrl || VIDEO_PROVIDER_SUCCESS.has(status)) {
        return resultUrl ? { state: "result_ready", status: status || "completed", resultUrl } : { state: "failed", status: status || "completed", error: "视频任务已完成但没有返回视频地址" };
    }
    if (isProviderBusinessError(data) || VIDEO_PROVIDER_FAILED.has(status)) return { state: "failed", status: status || "failed", error: readProviderError(data) || "视频生成失败" };
    return { state: "pending", status: status || "processing" };
}

export async function persistVideoTaskResult(task: VideoTask, resultUrl: string, origin: string, cookie = "", workerUserId = "") {
    return completeVideoTask(task, resultUrl, origin, cookie, workerUserId);
}

export async function failVideoTaskFromWorker(task: VideoTask, error: string, retryable = false) {
    return failVideoTask(task, error, retryable);
}

function taskPollingPolicy(task: VideoTask) {
    return videoPollingPolicy(Boolean(globalAiOpcPreset(task)));
}

async function completeVideoTask(task: VideoTask, resultUrl: string, origin: string, cookie: string, workerUserId = "") {
    const attempts = finishGenerationAttempt(task.attempts || [], task.attempts?.at(-1)?.attemptNo || 1, {
        status: "succeeded",
        pointsCost: task.upstream.pointsCost,
        pointsRecordId: task.upstream.pointsRecordId,
    });
    await updateVideoTask(task.id, { attempts });
    const result = await normalizeVideoResult({
        url: videoProviderMediaUrl(task.config.baseUrl, resultUrl),
        origin,
        cookie,
        internalHeaders: workerUserId ? maintenanceWorkerHeaders(workerUserId) : undefined,
        requestedDurationSeconds: task.requestedDurationSeconds,
        mimeType: "video/mp4",
        ownerUserId: task.userId,
        source: task.source,
        conversationId: task.conversationId,
        runId: task.runId,
        taskId: task.id,
        projectId: task.projectId,
    });
    const completed = await completeReconciledVideoTask(task.id, result);
    if (completed) await registerVideoAsset(completed);
    return completed || getVideoTask(task.id);
}

async function failVideoTask(task: VideoTask, error: string, retryable = true) {
    const attempts = finishGenerationAttempt(task.attempts || [], task.attempts?.at(-1)?.attemptNo || 1, { status: "failed", error });
    await updateVideoTask(task.id, { attempts });
    const failed = await failReconciledVideoTask(task.id, error, retryable);
    if (failed && task.status === "running") await refundVideoTask(failed);
    return failed || getVideoTask(task.id);
}

async function registerVideoAsset(task: VideoTask) {
    const url = task.result?.remoteUrl || task.result?.url;
    if (!url) return;
    await registerGenerationTaskAssetsForUser(task.userId, {
        ...task,
        taskId: task.id,
        title: task.prompt?.slice(0, 80) || "生成视频",
        assets: [{ type: "video", url, mimeType: task.result?.mimeType || "video/mp4", durationMs: task.result?.durationMs }],
    }).catch((error) => console.error("Creative video asset registration failed", error));
}

async function refundVideoTask(task: VideoTask) {
    if (task.upstream.pointsCost === undefined || !task.upstream.pointsRecordId) return;
    await refundUserPoints(task.userId, generationModelId(task.config), task.upstream.pointsCost, "video", task.upstream.pointsUnits || 1, `video-task:${task.id}:refund`, task.upstream.pointsRecordId);
}

async function queryVideoUpstream(task: VideoTask, origin: string, cookie: string, workerUserId = "") {
    const createPath = task.upstream.pollPath || "/video/generations";
    const preset = globalAiOpcPreset(task);
    const seedanceSpecial = task.config.advancedConfig?.protocol === "seedance-special";
    const paths = preset?.queryPath
        ? [preset.queryPath.replace(/:(?:task_id|taskId|id)\b/g, encodeURIComponent(task.upstream.id))]
        : providerQueryPaths(task.config.advancedConfig, task.upstream.id, [
              `${createPath.replace(/\/+$/, "")}/${encodeURIComponent(task.upstream.id)}`,
              `/videos/${encodeURIComponent(task.upstream.id)}`,
              `/video/generations/${encodeURIComponent(task.upstream.id)}`,
              `/videos/generations/${encodeURIComponent(task.upstream.id)}`,
              `/result?id=${encodeURIComponent(task.upstream.id)}`,
          ]);
    let lastError = "";
    for (const path of paths) {
        const response = await fetchInternalApi(`${origin}${task.config.baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`, {
            headers: workerUserId ? maintenanceWorkerHeaders(workerUserId) : { cookie },
            cache: "no-store",
            signal: AbortSignal.timeout(Math.min(resolveModelRequestTimeoutMs(task.config, "video"), 60_000)),
        });
        if (seedanceSpecial && videoContentReady(response)) {
            await response.body?.cancel().catch(() => undefined);
            return { status: "completed", video_url: path };
        }
        const text = await response.text();
        if (!response.ok) {
            lastError = readVideoProviderHttpError(text, response.status);
            continue;
        }
        try {
            return parseVideoProviderJson(text);
        } catch (error) {
            if (!seedanceSpecial) throw error;
            lastError = "视频查询接口返回了非 JSON 内容";
        }
    }
    const contentPath = seedanceSpecial ? await readyVideoContentPath(task, origin, cookie, workerUserId) : "";
    if (contentPath) return { status: "completed", video_url: contentPath };
    throw new Error(lastError || "视频任务查询失败");
}

async function readyVideoContentPath(task: VideoTask, origin: string, cookie: string, workerUserId: string) {
    const id = encodeURIComponent(task.upstream.id);
    const paths = [`/v1/videos/${id}/content`, `/videos/${id}/content`];
    for (const path of paths) {
        const url = `${origin}${task.config.baseUrl.replace(/\/+$/, "")}${path}`;
        const headers = workerUserId ? maintenanceWorkerHeaders(workerUserId) : { cookie };
        const head = await fetchInternalApi(url, { method: "HEAD", headers, cache: "no-store", signal: AbortSignal.timeout(60_000) }).catch(() => null);
        if (head && videoContentReady(head)) return path;
        if (head && ![405, 501].includes(head.status)) continue;
        const rangeHeaders = new Headers(headers);
        rangeHeaders.set("range", "bytes=0-0");
        const probe = await fetchInternalApi(url, { headers: rangeHeaders, cache: "no-store", signal: AbortSignal.timeout(60_000) }).catch(() => null);
        if (!probe) continue;
        const ready = videoContentReady(probe);
        await probe.body?.cancel().catch(() => undefined);
        if (ready) return path;
    }
    return "";
}

function videoContentReady(response: Response) {
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    const disposition = response.headers.get("content-disposition")?.toLowerCase() || "";
    return contentType.startsWith("video/") || contentType === "application/octet-stream" || /filename[^;]*\.(?:mp4|webm|mov|m4v)\b/.test(disposition);
}

function globalAiOpcPreset(task: VideoTask) {
    const preset = resolveGlobalAiOpcPreset(task.config.advancedConfig, task.config.model);
    return preset?.capability === "video" ? preset : undefined;
}
