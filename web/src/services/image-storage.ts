"use client";

import { browserReadableMediaUrl } from "@/lib/browser-media-url";
import { CREATIVE_UPLOAD_MAX_BYTES } from "@/lib/creative-upload";
import { readImageMeta } from "@/lib/image-utils";
import { blobToDataUrl, getServerMediaBlob, serverMediaUrl, uploadServerMedia, type ServerMediaUploadOptions } from "@/services/server-media-storage";

export type UploadedImage = {
    url: string;
    storageKey: string;
    remoteUrl?: string;
    serverUrl?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

export async function uploadImage(input: string | Blob, options: { maxBytes?: number; purpose?: ServerMediaUploadOptions["purpose"] } = {}): Promise<UploadedImage> {
    const maxBytes = options.maxBytes ?? CREATIVE_UPLOAD_MAX_BYTES;
    const stored = await uploadServerMedia(input, "image", maxBytes, options);
    const meta = await readImageMeta(stored.url);
    return { ...stored, serverUrl: stored.url, width: meta.width, height: meta.height, mimeType: stored.mimeType || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    return serverMediaUrl(storageKey, fallback);
}

export async function resolveStoredImageDataUrl(storageKey?: string, fallback = "") {
    return serverMediaUrl(storageKey, fallback);
}

export function getImageBlob(storageKey: string, fallback = "") {
    return getServerMediaBlob(storageKey, fallback);
}

export async function setImageBlob(_storageKey: string, blob: Blob) {
    return (await uploadServerMedia(blob, "image")).url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; remoteUrl?: string; serverUrl?: string; storageKey?: string }) {
    const candidates = uniqueImageSources([serverMediaUrl(image.storageKey, image.serverUrl || image.url || image.dataUrl), image.serverUrl, image.remoteUrl, image.url, image.dataUrl]);
    let fallback = "";
    for (const url of candidates) {
        if (url.startsWith("data:")) return url;
        fallback ||= browserReadableMediaUrl(url);
        try {
            const response = await fetch(browserReadableMediaUrl(url), { cache: "no-store" });
            if (response.ok) return blobToDataUrl(await response.blob());
        } catch {
            // Continue with another stable server or upstream source.
        }
    }
    return fallback;
}

export async function deleteStoredImages(keys: Iterable<string>) {
    return deleteServerMedia(keys);
}

function uniqueImageSources(values: Array<string | undefined>) {
    return Array.from(new Set(values.map((value) => (value || "").trim()).filter(Boolean)));
}

async function deleteServerMedia(keys: Iterable<string>) {
    const storageKeys = Array.from(new Set(Array.from(keys, (key) => key.trim()).filter(Boolean)));
    if (!storageKeys.length) return { deletedFiles: 0, blocked: [] };
    const response = await fetch("/api/media-assets", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storageKeys }) });
    const payload = (await response.json().catch(() => ({}))) as { data?: { deletedFiles?: number; blocked?: unknown[] }; msg?: string };
    if (!response.ok) throw new Error(payload.msg || "服务器图片删除失败");
    if (payload.data?.blocked?.length) throw new Error("部分图片仍被会话、项目或素材库引用，服务器文件已保留");
    return payload.data || { deletedFiles: 0, blocked: [] };
}
