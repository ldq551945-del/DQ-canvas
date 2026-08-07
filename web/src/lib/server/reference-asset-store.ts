import { copyFile, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

import { CANVAS_IMAGE_UPLOAD_MAX_BYTES } from "@/lib/creative-upload";
import { cleanupExpiredLocalMediaAssets, createDatedMediaPath, REFERENCE_MEDIA_ROOT } from "@/lib/server/local-media-storage";
import { deleteLocalMediaRegistrations, getLocalMediaRegistration, registerLocalMediaAsset } from "@/lib/server/local-media-registry";
import { detectSafeMediaBuffer, detectSafeMediaFile } from "@/lib/server/media-content-validation";
import { persistExternalMediaIfEnabled } from "@/lib/server/object-storage-service";

const REFERENCE_ASSET_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REFERENCE_BYTES: Record<string, number> = { image: 20 * 1024 * 1024, video: 200 * 1024 * 1024, audio: 30 * 1024 * 1024 };

type StoredReferenceAsset = {
    token: string;
    bytes: number;
    mimeType: string;
    url?: string;
    storage?: "local" | "object";
};

export type ReferenceMediaWriteContext = {
    ownerUserId: string;
    source: string;
    originalName?: string;
    conversationId?: string;
    runId?: string;
    taskId?: string;
    projectId?: string;
    maxBytes?: number;
    ttlMs?: number;
};

export async function writeReferenceImageDataUrl(dataUrl: string, context: ReferenceMediaWriteContext): Promise<StoredReferenceAsset> {
    return writeReferenceMediaDataUrl(dataUrl, "image", context);
}

export async function writeReferenceMediaDataUrl(dataUrl: string, expectedType: "image" | "video" | "audio", context: ReferenceMediaWriteContext): Promise<StoredReferenceAsset> {
    return writeMediaDataUrl(dataUrl, expectedType, false, context);
}

export async function writePersistentMediaDataUrl(dataUrl: string, expectedType: "image" | "video" | "audio", context: ReferenceMediaWriteContext): Promise<StoredReferenceAsset> {
    return writeMediaDataUrl(dataUrl, expectedType, true, context);
}

const MAX_PERSISTENT_BUFFER_IMAGE_BYTES = CANVAS_IMAGE_UPLOAD_MAX_BYTES;

/** Persists an already validated PNG without converting it through a data URL. */
export async function writePersistentReferenceImageBuffer(bytes: Buffer, context: ReferenceMediaWriteContext): Promise<StoredReferenceAsset> {
    await cleanupExpiredLocalMediaAssets().catch(() => undefined);
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error("图片文件为空");
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error("图片文件不是有效 PNG");
    const maxBytes = Math.min(Math.max(1, Math.floor(Number(context.maxBytes) || MAX_PERSISTENT_BUFFER_IMAGE_BYTES)), MAX_PERSISTENT_BUFFER_IMAGE_BYTES);
    if (bytes.length > maxBytes) throw new Error("图片文件过大");
    const token = createDatedMediaPath("permanent", "image", ".png");
    const registration = referenceRegistration(token, true, "image", "image/png", bytes.length, context);
    const external = await persistExternalMediaIfEnabled({ registration, bytes });
    if (external) return { token, bytes: bytes.length, mimeType: "image/png", storage: "object" };
    const filePath = resolve(REFERENCE_MEDIA_ROOT, token);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, bytes);
    try {
        await registerLocalMediaAsset(registration);
    } catch (error) {
        await unlink(filePath).catch(() => undefined);
        throw error;
    }
    return { token, bytes: bytes.length, mimeType: "image/png", storage: "local" };
}

async function writeMediaDataUrl(dataUrl: string, expectedType: "image" | "video" | "audio", persistent: boolean, context: ReferenceMediaWriteContext): Promise<StoredReferenceAsset> {
    await cleanupExpiredLocalMediaAssets().catch(() => undefined);
    const parsed = parseMediaDataUrl(dataUrl);
    if (!parsed || !parsed.mimeType.startsWith(`${expectedType}/`)) throw new Error("参考素材格式不正确");
    if (parsed.bytes.length > referenceMediaMaxBytes(expectedType, context.maxBytes)) throw new Error(`参考${expectedType === "image" ? "图" : expectedType === "video" ? "视频" : "音频"}文件过大`);

    const detected = await detectSafeMediaBuffer(parsed.bytes).catch(() => null);
    if (!detected || detected.type !== expectedType) throw new Error("参考素材实际文件类型不正确");
    const mimeType = detected.mimeType;

    const token = createDatedMediaPath(persistent ? "permanent" : "temporary", expectedType, extensionFromMime(mimeType));
    const registration = referenceRegistration(token, persistent, expectedType, mimeType, parsed.bytes.length, context);
    const external = await persistExternalMediaIfEnabled({ registration, bytes: parsed.bytes });
    if (external) return { token, bytes: parsed.bytes.length, mimeType, storage: "object" };
    const filePath = resolve(REFERENCE_MEDIA_ROOT, token);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, parsed.bytes);
    try {
        await registerLocalMediaAsset(registration);
    } catch (error) {
        await unlink(filePath).catch(() => undefined);
        throw error;
    }
    return { token, bytes: parsed.bytes.length, mimeType, storage: "local" };
}

export async function writeReferenceMediaFile(sourcePath: string, expectedType: "video" | "audio", mimeType: string, persistent: boolean, context: ReferenceMediaWriteContext): Promise<StoredReferenceAsset> {
    await cleanupExpiredLocalMediaAssets().catch(() => undefined);
    if (!mimeType.startsWith(`${expectedType}/`)) throw new Error("媒体文件格式不正确");
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size <= 0 || sourceStat.size > Math.min(context.maxBytes || MAX_REFERENCE_BYTES[expectedType], MAX_REFERENCE_BYTES[expectedType]))
        throw new Error(`生成${expectedType === "video" ? "视频" : "音频"}文件为空或过大`);
    const detected = await detectSafeMediaFile(sourcePath).catch(() => null);
    if (!detected || detected.type !== expectedType) throw new Error("媒体文件实际类型与声明不一致");
    const detectedMimeType = detected.mimeType;
    const token = createDatedMediaPath(persistent ? "permanent" : "temporary", expectedType, extensionFromMime(detectedMimeType));
    const registration = referenceRegistration(token, persistent, expectedType, detectedMimeType, sourceStat.size, context);
    const external = await persistExternalMediaIfEnabled({ registration, filePath: sourcePath });
    if (external) return { token, bytes: sourceStat.size, mimeType: detectedMimeType, storage: "object" };
    const filePath = resolve(REFERENCE_MEDIA_ROOT, token);
    await mkdir(dirname(filePath), { recursive: true });
    await copyFile(sourcePath, filePath);
    try {
        await registerLocalMediaAsset(registration);
    } catch (error) {
        await unlink(filePath).catch(() => undefined);
        throw error;
    }
    return { token, bytes: sourceStat.size, mimeType: detectedMimeType, storage: "local" };
}

export async function readReferenceAsset(token: string) {
    const safeToken = (token || "").replace(/\\/g, "/");
    if (!isReferenceAssetPath(safeToken)) return null;

    const filePath = resolve(REFERENCE_MEDIA_ROOT, safeToken);
    const root = resolve(REFERENCE_MEDIA_ROOT);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return null;

    try {
        const fileStat = await stat(filePath);
        const registration = await getLocalMediaRegistration(safeToken);
        const registeredExpiry = registration?.expiresAt ? Date.parse(registration.expiresAt) : Number.NaN;
        const expired = Number.isFinite(registeredExpiry) ? registeredExpiry <= Date.now() : Date.now() - fileStat.mtimeMs > REFERENCE_ASSET_TTL_MS;
        if (safeToken.startsWith("temporary/") && expired) {
            await unlink(filePath).catch(() => undefined);
            await deleteLocalMediaRegistrations([safeToken]).catch(() => undefined);
            return null;
        }
        return { filePath, size: fileStat.size, mimeType: mimeTypeFromToken(basename(safeToken)), mtimeMs: fileStat.mtimeMs, registration };
    } catch {
        return null;
    }
}

function referenceRegistration(token: string, persistent: boolean, type: "image" | "video" | "audio", mimeType: string, bytes: number, context: ReferenceMediaWriteContext) {
    if (!context.ownerUserId.trim()) throw new Error("媒体文件缺少用户归属");
    const createdAt = new Date().toISOString();
    const ttlMs = Math.max(1, Math.floor(Number(context.ttlMs) || REFERENCE_ASSET_TTL_MS));
    return {
        storageKey: token,
        scope: "reference",
        storageClass: persistent ? "permanent" : "temporary",
        type,
        ownerUserId: context.ownerUserId,
        originalName: context.originalName,
        source: context.source,
        conversationId: context.conversationId,
        runId: context.runId,
        taskId: context.taskId,
        projectId: context.projectId,
        mimeType,
        bytes,
        createdAt,
        expiresAt: persistent ? undefined : new Date(Date.parse(createdAt) + ttlMs).toISOString(),
    } as const;
}

function parseMediaDataUrl(dataUrl: string) {
    const match = dataUrl.match(/^data:((?:image\/(?:png|jpe?g|webp|gif))|(?:video\/(?:mp4|webm|quicktime))|(?:audio\/(?:mpeg|mp3|wav|x-wav|ogg|opus|aac|flac)));base64,([a-z0-9+/=\s]+)$/i);
    if (!match) return null;
    const mimeType = normalizeMimeType(match[1]);
    const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    return bytes.length ? { mimeType, bytes } : null;
}

function normalizeMimeType(value: string) {
    const mimeType = value.toLowerCase();
    return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

function referenceMediaMaxBytes(expectedType: "image" | "video" | "audio", requestedMaxBytes?: number) {
    const defaultMaxBytes = MAX_REFERENCE_BYTES[expectedType];
    const upperBound = expectedType === "image" ? CANVAS_IMAGE_UPLOAD_MAX_BYTES : defaultMaxBytes;
    const requested = Math.floor(Number(requestedMaxBytes));
    return Number.isFinite(requested) && requested > 0 ? Math.min(requested, upperBound) : defaultMaxBytes;
}

function extensionFromMime(mimeType: string) {
    if (mimeType === "image/jpeg") return ".jpg";
    if (mimeType === "image/webp") return ".webp";
    if (mimeType === "image/gif") return ".gif";
    if (mimeType === "video/webm") return ".webm";
    if (mimeType === "video/quicktime") return ".mov";
    if (mimeType.startsWith("video/")) return ".mp4";
    if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return ".wav";
    if (mimeType === "audio/ogg" || mimeType === "audio/opus") return ".ogg";
    if (mimeType === "audio/aac") return ".aac";
    if (mimeType === "audio/flac") return ".flac";
    if (mimeType.startsWith("audio/")) return ".mp3";
    return ".png";
}

function mimeTypeFromToken(token: string) {
    const lower = token.toLowerCase();
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".mov")) return "video/quicktime";
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".wav")) return "audio/wav";
    if (lower.endsWith(".ogg")) return "audio/ogg";
    if (lower.endsWith(".aac")) return "audio/aac";
    if (lower.endsWith(".flac")) return "audio/flac";
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    return "image/png";
}

export function isReferenceAssetPath(value: string) {
    return /^(?:temporary|permanent)\/\d{4}\/\d{2}\/\d{2}\/(?:images|videos|audio)\/\d{8}-\d{6}-[0-9a-f-]{36}\.(?:png|jpg|jpeg|webp|gif|mp4|webm|mov|mp3|wav|ogg|aac|flac)$/i.test(value);
}
