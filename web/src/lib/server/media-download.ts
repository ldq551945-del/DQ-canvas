import { open, unlink } from "node:fs/promises";

import { fetchInternalApi } from "@/lib/server/internal-origin";
import { inspectSafeMediaBody } from "@/lib/server/media-content-validation";
import type { SafeOutboundOptions } from "@/lib/server/outbound-url-security";
import { fetchSafeOutboundUrl } from "@/lib/server/safe-outbound-fetch";

export async function downloadMediaToFile(url: string, path: string, input: { origin: string; cookie?: string; internalHeaders?: HeadersInit; maxBytes: number; expectedType: "video" | "audio"; timeoutMs?: number }) {
    const source = url.trim();
    if (!source) throw new Error("媒体地址为空");
    const internal = source.startsWith("/");
    const target = internal ? `${input.origin.replace(/\/+$/, "")}${source}` : source;
    const internalHeaders = new Headers(input.internalHeaders);
    if (input.cookie) internalHeaders.set("cookie", input.cookie);
    const response = internal ? await fetchInternalApi(target, { headers: internalHeaders, signal: AbortSignal.timeout(input.timeoutMs || 3 * 60_000) }) : await fetchSafeExternalMedia(target, input.timeoutMs || 3 * 60_000);
    if (!response.ok) throw new Error(`媒体下载失败（${response.status}）`);
    if (!response.body) throw new Error("媒体文件为空");
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > input.maxBytes) {
        await response.body.cancel("Media file is too large").catch(() => undefined);
        throw new Error("媒体文件超过大小限制");
    }
    const inspected = await inspectSafeMediaBody(response.body);
    if (inspected.type !== input.expectedType) {
        await inspected.body.cancel("Unexpected media type").catch(() => undefined);
        throw new Error(`媒体文件类型无效，应为${input.expectedType === "video" ? "视频" : "音频"}`);
    }

    const file = await open(path, "w");
    let bytes = 0;
    let writeFailed = false;
    try {
        const reader = inspected.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > input.maxBytes) {
                await reader.cancel();
                throw new Error("媒体文件超过大小限制");
            }
            await writeChunkFully(file, value);
        }
    } catch (error) {
        writeFailed = true;
        throw error;
    } finally {
        await file.close();
        if (writeFailed) await unlink(path).catch(() => undefined);
    }
    if (!bytes) throw new Error("媒体文件为空");
    return { bytes, mimeType: inspected.mimeType };
}

async function writeChunkFully(file: Awaited<ReturnType<typeof open>>, chunk: Uint8Array) {
    let offset = 0;
    while (offset < chunk.byteLength) {
        const result = await file.write(chunk, offset, chunk.byteLength - offset);
        if (!result.bytesWritten) throw new Error("媒体文件写入失败");
        offset += result.bytesWritten;
    }
}

export async function fetchSafeExternalMedia(initialUrl: string, timeoutMs: number, options?: SafeOutboundOptions) {
    let target = initialUrl;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
        const response = await fetchSafeOutboundUrl(target, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) }, options);
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get("location");
        if (!location) throw new Error("媒体重定向地址无效");
        target = new URL(location, target).toString();
    }
    throw new Error("媒体重定向次数过多");
}
