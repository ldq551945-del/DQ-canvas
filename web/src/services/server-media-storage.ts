"use client";

import { browserReadableMediaUrl } from "@/lib/browser-media-url";
import { CREATIVE_UPLOAD_MAX_BYTES, isCreativeUploadMimeType } from "@/lib/creative-upload";

export type ServerMediaType = "image" | "video" | "audio";
export type StoredServerMedia = { url: string; storageKey: string; bytes: number; mimeType: string };

export async function uploadServerMedia(input: string | Blob, type: ServerMediaType, maxBytes = CREATIVE_UPLOAD_MAX_BYTES): Promise<StoredServerMedia> {
    const blob = typeof input === "string" ? await fetchMediaBlob(input) : input;
    const originalName = input instanceof File ? input.name.trim() : "";
    if (!blob.size) throw new Error("上传文件为空");
    if (blob.size > maxBytes) throw new Error(maxBytes === CREATIVE_UPLOAD_MAX_BYTES ? "单个文件不能超过 20MB" : "生成媒体文件过大");
    if (!isCreativeUploadMimeType(blob.type) || !blob.type.startsWith(`${type}/`)) throw new Error(`仅支持${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}格式`);

    const response = await fetch("/api/reference-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, persistent: true, dataUrl: await blobToDataUrl(blob), originalName: originalName || undefined }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; url?: string; token?: string; key?: string; bytes?: number; mimeType?: string };
    if (!response.ok || !payload.token) throw new Error(payload.error || "文件保存到服务器失败");
    return {
        url: payload.url || serverMediaUrl(payload.token),
        storageKey: payload.key || payload.token,
        bytes: payload.bytes || blob.size,
        mimeType: payload.mimeType || blob.type,
    };
}

export function serverMediaUrl(storageKey?: string, fallback = "") {
    const key = (storageKey || "").trim().replace(/\\/g, "/");
    if (!key) return browserReadableMediaUrl(fallback);
    if (key.startsWith("/") || /^https?:\/\//i.test(key)) return browserReadableMediaUrl(key);
    if (!/^(?:temporary|permanent)\//.test(key)) return browserReadableMediaUrl(fallback);
    return `/api/reference-assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function getServerMediaBlob(storageKey: string, fallback = "") {
    const url = serverMediaUrl(storageKey, fallback);
    if (!url) return null;
    try {
        return await fetchMediaBlob(url);
    } catch {
        return null;
    }
}

export function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(blob);
    });
}

async function fetchMediaBlob(url: string) {
    if (url.startsWith("data:")) return dataUrlToBlob(url);
    const response = await fetch(browserReadableMediaUrl(url), { cache: "no-store" });
    if (!response.ok) throw new Error("读取媒体失败");
    return response.blob();
}

function dataUrlToBlob(dataUrl: string) {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) throw new Error("文件格式不正确");
    const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: match[1] });
}
