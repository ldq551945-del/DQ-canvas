import { nanoid } from "nanoid";

import { refreshUserPointsIfSystem, syncUserPointsFromHeaders } from "@/services/api/points";
import { imageToDataUrl } from "@/services/image-storage";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

type GenerationLogSource = "agent" | "image-workbench" | "video-workbench" | "canvas" | "drama" | "unknown";
type RequestOptions = {
    signal?: AbortSignal;
    logSource?: GenerationLogSource;
    logTitle?: string;
    conversationId?: string;
    runId?: string;
    surface?: "chat" | "canvas" | "drama";
    projectId?: string;
    episodeId?: string;
    shotId?: string;
    estimatedPoints?: number;
    parentTaskId?: string;
    attemptNo?: number;
    clientRequestId?: string;
};

export type ImageGenerationTask = {
    id: string;
    kind: "generation" | "edit";
    model: string;
    status?: "pending" | "running" | "success" | "error";
};

type ImageTaskPayload = {
    task?: ImageGenerationTask & {
        result?: { dataUrl?: string; remoteUrl?: string; serverUrl?: string };
        error?: string;
    };
    error?: string;
};

const IMAGE_TASK_POLL_INTERVAL_MS = 1800;
const IMAGE_TASK_TIMEOUT_MS = 30 * 60 * 1000;

export async function createImageGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], mask?: ReferenceImage, options?: RequestOptions): Promise<ImageGenerationTask> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const taskReferences = await Promise.all(references.map(referenceToTaskInput));
    const taskMask = mask ? await referenceToTaskInput(mask) : undefined;
    const response = await fetch("/api/image-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            kind: references.length || mask ? "edit" : "generation",
            config: {
                model: requestConfig.model,
                quality: requestConfig.quality,
                size: requestConfig.size,
            },
            prompt,
            references: taskReferences,
            mask: taskMask,
            source: options?.logSource || "image-workbench",
            title: options?.logTitle || "",
            context: taskContext(options),
        }),
        signal: options?.signal,
    });
    syncUserPointsFromHeaders(response.headers, requestConfig.apiSource);
    if (!response.ok) throw new Error(await readFetchError(response, "创建图片任务失败"));
    const payload = (await response.json()) as ImageTaskPayload;
    if (!payload.task?.id) throw new Error(payload.error || "创建图片任务失败");
    return payload.task;
}

function taskContext(options?: RequestOptions) {
    if (!options) return undefined;
    return {
        conversationId: options.conversationId,
        runId: options.runId,
        surface: options.surface,
        projectId: options.projectId,
        episodeId: options.episodeId,
        shotId: options.shotId,
        estimatedPoints: options.estimatedPoints,
        parentTaskId: options.parentTaskId,
        attemptNo: options.attemptNo,
        clientRequestId: options.clientRequestId,
    };
}

export async function waitForImageGenerationTask(config: AiConfig, task: ImageGenerationTask, options?: RequestOptions) {
    const startedAt = Date.now();
    for (;;) {
        if (options?.signal?.aborted) throw new DOMException("请求已取消", "AbortError");
        if (Date.now() - startedAt > IMAGE_TASK_TIMEOUT_MS) {
            await refreshUserPointsIfSystem(config.apiSource);
            throw new Error("图片生成超时，请稍后重试");
        }
        const response = await fetch(`/api/image-tasks/${encodeURIComponent(task.id)}`, { cache: "no-store", signal: options?.signal });
        syncUserPointsFromHeaders(response.headers, config.apiSource);
        if (!response.ok) throw new Error(await readFetchError(response, "读取图片任务失败"));
        const payload = (await response.json()) as ImageTaskPayload;
        const current = payload.task;
        if (!current) throw new Error(payload.error || "图片任务不存在");
        if (current.status === "success") {
            if (!current.result?.dataUrl) throw new Error("图片任务没有返回结果");
            await refreshUserPointsIfSystem(config.apiSource);
            return { id: nanoid(), dataUrl: current.result.dataUrl, remoteUrl: current.result.remoteUrl, serverUrl: current.result.serverUrl };
        }
        if (current.status === "error") {
            await refreshUserPointsIfSystem(config.apiSource);
            throw new Error(current.error || "图片生成失败");
        }
        await delay(IMAGE_TASK_POLL_INTERVAL_MS, options?.signal);
    }
}

async function referenceToTaskInput(reference: ReferenceImage) {
    const dataUrl = (await imageToDataUrl(reference)).trim();
    if (!dataUrl) throw new Error("参考图读取失败，请重新上传参考图");
    if (dataUrl.startsWith("blob:")) throw new Error("参考图已失效，请重新上传");
    const remoteUrl = firstRemoteReferenceUrl(reference.remoteUrl, reference.url, reference.serverUrl, reference.dataUrl, dataUrl);
    return {
        id: reference.id,
        name: reference.name,
        type: reference.type,
        dataUrl,
        url: remoteUrl,
        remoteUrl: isRemoteReferenceUrl(reference.remoteUrl) ? reference.remoteUrl : remoteUrl,
        serverUrl: reference.serverUrl,
    };
}

function firstRemoteReferenceUrl(...values: Array<string | undefined>) {
    return values.find((value) => isRemoteReferenceUrl(value));
}

function isRemoteReferenceUrl(value?: string) {
    return /^https?:\/\//i.test(value || "");
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return statusError(response.status, fallback);
    try {
        const payload = JSON.parse(text) as { msg?: unknown; error?: unknown };
        const nestedError = payload.error && typeof payload.error === "object" ? (payload.error as { message?: unknown }).message : undefined;
        const message = typeof payload.msg === "string" ? payload.msg : typeof payload.error === "string" ? payload.error : typeof nestedError === "string" ? nestedError : "";
        return message || statusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || statusError(response.status, fallback);
    }
}

function statusError(status: number, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}：${status}` : fallback;
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("请求已取消", "AbortError"));
            return;
        }
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
        }, ms);
        const abort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("请求已取消", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
    });
}
