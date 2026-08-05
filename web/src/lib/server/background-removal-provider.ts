import sharp from "sharp";

import { normalizeBackgroundRemovalOptions, type BackgroundRemovalOptionsV1 } from "@/lib/background-removal-options";
import { prepareBackgroundRemovalImage } from "@/lib/server/background-removal-image-preprocessor";
import { BACKGROUND_REMOVAL_MAX_BYTES, BACKGROUND_REMOVAL_MAX_PIXELS } from "@/lib/server/registered-media-reader";

export class BackgroundRemovalProviderError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly transient: boolean,
    ) {
        super(message);
        this.name = "BackgroundRemovalProviderError";
    }
}

export function isBackgroundRemovalProviderEnabled() {
    const enabled = process.env.DQ_REMBG_ENABLED?.trim().toLowerCase();
    if (enabled === "0" || enabled === "false" || enabled === "off") return false;
    return Boolean(rembgBaseUrl());
}

export async function removeBackgroundWithRembg(input: { taskId: string; bytes: Buffer; mimeType: string; width: number; height: number; options?: BackgroundRemovalOptionsV1; signal?: AbortSignal }) {
    const baseUrl = rembgBaseUrl();
    if (!baseUrl) throw new BackgroundRemovalProviderError("抠图服务未启用", 503, false);
    const taskId = input.taskId.trim();
    if (!taskId) throw new BackgroundRemovalProviderError("抠图任务标识无效", 400, false);
    const options = normalizeBackgroundRemovalOptions(input.options);
    if (options.outputMode !== "transparent") throw new BackgroundRemovalProviderError("抠图仅支持透明 PNG 输出", 400, false);
    let prepared;
    try {
        prepared = await prepareBackgroundRemovalImage(input.bytes);
    } catch (error) {
        throw new BackgroundRemovalProviderError(error instanceof Error ? error.message : "抠图图片预处理失败", 422, false);
    }
    const timeoutMs = configuredTimeoutMs();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
        const response = await fetch(`${baseUrl}/v1/remove`, {
            method: "POST",
            headers: {
                "content-type": prepared.mimeType,
                "x-dq-rembg-task-id": taskId,
                "x-dq-rembg-options": JSON.stringify(options),
                ...(process.env.DQ_REMBG_INTERNAL_TOKEN?.trim() ? { authorization: `Bearer ${process.env.DQ_REMBG_INTERNAL_TOKEN.trim()}` } : {}),
            },
            body: prepared.bytes as unknown as BodyInit,
            signal: controller.signal,
            cache: "no-store",
        }).catch((error) => {
            console.warn("Background removal provider request failed", {
                baseUrl,
                error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
                name: error instanceof Error ? error.name : typeof error,
                cause: error instanceof Error && error.cause instanceof Error ? error.cause.message.slice(0, 500) : undefined,
            });
            if (input.signal?.aborted) throw new BackgroundRemovalProviderError("抠图任务已取消", 499, false);
            if (timedOut) throw new BackgroundRemovalProviderError("抠图服务请求超时", 504, true);
            throw new BackgroundRemovalProviderError("抠图服务暂不可用", 503, true);
        });

        if (!response.ok) {
            await readResponseText(response);
            const transient = response.status === 408 || response.status === 429 || response.status >= 500;
            throw new BackgroundRemovalProviderError(transient ? "抠图服务暂不可用" : "抠图图片不符合处理要求", response.status, transient);
        }
        const actualModel = response.headers.get("x-rembg-model")?.trim();
        if (actualModel !== options.model) throw new BackgroundRemovalProviderError("抠图服务返回的模型无效", 502, true);
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (contentType !== "image/png") throw new BackgroundRemovalProviderError("抠图服务返回格式无效", 502, true);
        const output = await readResponseBytes(response, BACKGROUND_REMOVAL_MAX_BYTES);
        if (!isPng(output)) throw new BackgroundRemovalProviderError("抠图服务返回的不是 PNG", 502, true);
        const metadata = await sharp(output, { failOn: "error", limitInputPixels: BACKGROUND_REMOVAL_MAX_PIXELS })
            .metadata()
            .catch(() => null);
        if (!metadata?.width || !metadata.height || metadata.width !== prepared.width || metadata.height !== prepared.height || metadata.hasAlpha !== true || metadata.channels !== 4) {
            throw new BackgroundRemovalProviderError("抠图服务返回的图片无效", 502, true);
        }
        return { bytes: output, width: metadata.width, height: metadata.height, mimeType: "image/png" as const, model: actualModel };
    } finally {
        clearTimeout(timeout);
        input.signal?.removeEventListener("abort", abort);
    }
}

export async function cancelBackgroundRemovalWithRembg(taskId: string) {
    const baseUrl = rembgBaseUrl();
    if (!baseUrl) throw new BackgroundRemovalProviderError("抠图服务未启用，无法确认任务已终止", 503, true);
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) throw new BackgroundRemovalProviderError("抠图任务标识无效", 400, false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), configuredCancellationTimeoutMs());
    try {
        const response = await fetch(`${baseUrl}/v1/tasks/${encodeURIComponent(normalizedTaskId)}`, {
            method: "DELETE",
            headers: process.env.DQ_REMBG_INTERNAL_TOKEN?.trim() ? { authorization: `Bearer ${process.env.DQ_REMBG_INTERNAL_TOKEN.trim()}` } : undefined,
            signal: controller.signal,
            cache: "no-store",
        }).catch((error) => {
            console.warn("Background removal cancellation request failed", {
                taskId: normalizedTaskId,
                error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            });
            if (controller.signal.aborted) throw new BackgroundRemovalProviderError("抠图终止确认超时，请重试", 504, true);
            throw new BackgroundRemovalProviderError("抠图服务暂不可用，终止尚未确认", 503, true);
        });
        const payload = (await response.json().catch(() => ({}))) as { terminated?: unknown };
        if (!response.ok || payload.terminated !== true) {
            const transient = response.status === 408 || response.status === 429 || response.status >= 500;
            throw new BackgroundRemovalProviderError(transient ? "抠图服务暂不可用，终止尚未确认" : "抠图服务未确认任务已终止", response.ok ? 502 : response.status, transient);
        }
        return { terminated: true as const };
    } finally {
        clearTimeout(timeout);
    }
}

function rembgBaseUrl() {
    const value = (process.env.DQ_REMBG_URL || process.env.DQ_REMBG_API_URL || "").trim().replace(/\/+$/, "");
    if (!value) return "";
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return "";
    }
}

function configuredTimeoutMs() {
    const explicit = Number(process.env.DQ_REMBG_TIMEOUT_MS);
    if (Number.isFinite(explicit) && explicit > 0) return Math.min(5 * 60_000, Math.max(5_000, Math.floor(explicit)));
    const seconds = Number(process.env.DQ_REMBG_TIMEOUT_SECONDS);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(5 * 60_000, Math.max(5_000, Math.floor(seconds * 1000)));
    return 120_000;
}

function configuredCancellationTimeoutMs() {
    const explicit = Number(process.env.DQ_REMBG_CANCEL_TIMEOUT_MS);
    if (Number.isFinite(explicit) && explicit > 0) return Math.min(30_000, Math.max(5_000, Math.floor(explicit)));
    return 15_000;
}

async function readResponseBytes(response: Response, maxBytes: number) {
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maxBytes) throw new BackgroundRemovalProviderError("抠图输出超过大小限制", 502, false);
    if (!response.body) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > maxBytes) throw new BackgroundRemovalProviderError("抠图输出超过大小限制", 502, false);
        return bytes;
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            const chunk = Buffer.from(next.value);
            total += chunk.length;
            if (total > maxBytes) throw new BackgroundRemovalProviderError("抠图输出超过大小限制", 502, false);
            chunks.push(chunk);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
}

async function readResponseText(response: Response) {
    try {
        return await response.text();
    } catch {
        return "";
    }
}

function isPng(bytes: Buffer) {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}
