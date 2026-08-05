import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import sharp from "sharp";

import { getLocalMediaRegistration, type LocalMediaRegistration } from "@/lib/server/local-media-registry";
import { GENERATION_MEDIA_ROOT, REFERENCE_MEDIA_ROOT } from "@/lib/server/local-media-storage";
import { getObjectBytes } from "@/lib/server/object-storage-client";
import { getObjectStorageRuntimeConfig } from "@/lib/server/object-storage-config";

export const BACKGROUND_REMOVAL_MAX_BYTES = 30 * 1024 * 1024;
export const BACKGROUND_REMOVAL_MAX_PIXELS = 64_000_000;

const SUPPORTED_INPUT_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SUPPORTED_INPUT_FORMATS = new Set(["jpeg", "png", "webp"]);

export class RegisteredMediaReadError extends Error {
    constructor(
        message: string,
        readonly status: 404 | 410 | 413 | 415 | 422 | 502,
        readonly code: "missing" | "expired" | "too_large" | "unsupported" | "invalid" | "storage_error" = "invalid",
    ) {
        super(message);
        this.name = "RegisteredMediaReadError";
    }
}

export type RegisteredImageBytes = {
    bytes: Buffer;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    width: number;
    height: number;
    registration: LocalMediaRegistration;
};

export async function readRegisteredImageBytes(input: { storageKey: string; ownerUserId: string; maxBytes?: number; maxPixels?: number }): Promise<RegisteredImageBytes> {
    const storageKey = input.storageKey.trim();
    const ownerUserId = input.ownerUserId.trim();
    const maxBytes = Math.max(1, Math.floor(Number(input.maxBytes) || BACKGROUND_REMOVAL_MAX_BYTES));
    const maxPixels = input.maxPixels === undefined ? undefined : Math.max(1, Math.floor(Number(input.maxPixels) || BACKGROUND_REMOVAL_MAX_PIXELS));
    if (!storageKey || !ownerUserId) throw new RegisteredMediaReadError("图片素材不存在", 404, "missing");

    const registration = await getLocalMediaRegistration(storageKey);
    if (!registration || registration.ownerUserId !== ownerUserId || registration.type !== "image") throw new RegisteredMediaReadError("图片素材不存在", 404, "missing");
    if (registration.expiresAt && Date.parse(registration.expiresAt) <= Date.now()) throw new RegisteredMediaReadError("图片素材已过期", 410, "expired");
    if (!SUPPORTED_INPUT_MIME_TYPES.has(normalizeMimeType(registration.mimeType))) throw new RegisteredMediaReadError("仅支持 JPEG、PNG 或 WebP 图片", 415, "unsupported");
    if (registration.bytes > maxBytes) throw new RegisteredMediaReadError("图片超过 30MB 限制", 413, "too_large");

    let bytes: Buffer;
    try {
        bytes = registration.storageProvider === "object" ? await readObjectMedia(registration, maxBytes) : await readLocalMedia(registration, maxBytes);
    } catch (error) {
        if (error instanceof RegisteredMediaReadError) throw error;
        throw new RegisteredMediaReadError("图片素材读取失败", registration.storageProvider === "object" ? 502 : 404, registration.storageProvider === "object" ? "storage_error" : "missing");
    }
    if (!bytes.length) throw new RegisteredMediaReadError("图片素材为空", 422, "invalid");
    if (bytes.length > maxBytes) throw new RegisteredMediaReadError("图片超过 30MB 限制", 413, "too_large");

    const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: false })
        .metadata()
        .catch(() => null);
    const format = metadata?.format?.toLowerCase() || "";
    const rawWidth = Number(metadata?.width || 0);
    const rawHeight = Number(metadata?.height || 0);
    const orientation = Number(metadata?.orientation || 1);
    const width = orientation >= 5 && orientation <= 8 ? rawHeight : rawWidth;
    const height = orientation >= 5 && orientation <= 8 ? rawWidth : rawHeight;
    if (!metadata || !SUPPORTED_INPUT_FORMATS.has(format) || !width || !height) throw new RegisteredMediaReadError("图片格式或内容无效", 422, "invalid");
    if (maxPixels !== undefined && width * height > maxPixels) throw new RegisteredMediaReadError(`图片超过 ${maxPixels} 像素限制`, 413, "too_large");
    if (Number(metadata.pages || 1) > 1) throw new RegisteredMediaReadError("不支持动画图片", 422, "invalid");
    const mimeType = format === "jpeg" ? "image/jpeg" : format === "png" ? "image/png" : "image/webp";
    return { bytes, mimeType, width, height, registration };
}

async function readLocalMedia(registration: LocalMediaRegistration, maxBytes: number) {
    const root = registration.scope === "generation" ? GENERATION_MEDIA_ROOT : REFERENCE_MEDIA_ROOT;
    const normalizedKey = registration.storageKey.replace(/\\/g, "/");
    const filePath = resolve(root, normalizedKey);
    const rootPath = resolve(root);
    if (filePath === rootPath || !filePath.startsWith(`${rootPath}${sep}`)) throw new RegisteredMediaReadError("图片素材不存在", 404, "missing");
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) throw new RegisteredMediaReadError("图片素材不存在", 404, "missing");
    if (info.size > maxBytes) throw new RegisteredMediaReadError("图片超过 30MB 限制", 413, "too_large");
    return readFile(filePath);
}

async function readObjectMedia(registration: LocalMediaRegistration, maxBytes: number) {
    if (!registration.externalObjectKey) throw new RegisteredMediaReadError("图片素材不存在", 404, "missing");
    const config = await getObjectStorageRuntimeConfig();
    if (registration.externalStorageId && registration.externalStorageId !== config.id) throw new RegisteredMediaReadError("图片存储配置已变更", 502, "storage_error");
    try {
        return await getObjectBytes(config, registration.externalObjectKey, maxBytes);
    } catch (error) {
        if (error instanceof Error && /exceed|too large/i.test(error.message)) throw new RegisteredMediaReadError("图片超过 30MB 限制", 413, "too_large");
        throw error;
    }
}

function normalizeMimeType(value: string) {
    const normalized = value.trim().toLowerCase();
    return normalized === "image/jpg" ? "image/jpeg" : normalized;
}
