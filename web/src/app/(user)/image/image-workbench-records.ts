"use client";

import { nanoid } from "nanoid";

import { browserReadableMediaUrl } from "@/lib/browser-media-url";
import type { GenerationLogReferenceSnapshot, GenerationLogRequestSnapshot, GenerationLogSlotSnapshot, GenerationLogSnapshotParameters } from "@/lib/generation-log-snapshot";
import { readImageMeta } from "@/lib/image-utils";
import { deleteGenerationLogs as deleteServerGenerationLogs, listGenerationLogs, recordGenerationLog, type StoredGenerationLogRecord } from "@/services/api/generation-logs";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type GeneratedImage = {
    id: string;
    dataUrl: string;
    remoteUrl?: string;
    serverUrl?: string;
    storageKey?: string;
    taskId?: string;
    slotIndex?: number;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
};

export type PendingImageTask = {
    resultId: string;
    taskId: string;
    kind: "generation" | "edit";
    model: string;
    index: number;
    startedAt: number;
};

export type GenerationFailure = {
    resultId: string;
    index: number;
    error: string;
};

export type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    error?: string;
    task?: PendingImageTask;
};

export type GenerationLog = {
    id: string;
    ownerUserId?: string;
    creativeConversationId?: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "成功" | "失败" | "生成中";
    images: GeneratedImage[];
    thumbnails: string[];
    pendingCount?: number;
    error?: string;
    imageTasks?: PendingImageTask[];
    failures?: GenerationFailure[];
    requestSnapshot?: GenerationLogRequestSnapshot;
};

export type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;
export type GenerationSnapshot = { text: string; config: AiConfig; references: ReferenceImage[]; count?: number };

export function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
    return results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
}

export async function readStoredLogs(userId: string) {
    return (await readServerImageLogs()).map((log) => withLogOwner(log, userId));
}

export function withLogOwner(log: GenerationLog, userId: string): GenerationLog {
    return userId ? { ...log, ownerUserId: userId } : log;
}

export function saveStoredImageLog(log: GenerationLog) {
    return recordImageWorkbenchLog(log);
}

export function removeStoredImageLogs(ids: string[]) {
    return deleteServerGenerationLogs(ids.flatMap(imageServerLogIds));
}

export async function readServerImageLogs() {
    try {
        const payload = await listGenerationLogs({ kind: "image", source: "image-workbench", pageSize: 100 });
        const workbenchLogs = payload.items.filter((item) => item.id.startsWith("image-workbench:"));
        const primaryWorkbenchLogs = workbenchLogs.filter((item) => !isTaskBackedWorkbenchRecord(item));
        const aggregateAssetUrls = new Set(workbenchLogs.flatMap((item) => item.assets.map(stableAssetUrl).filter(Boolean)));
        const records = payload.items.filter((item) => {
            if (isTaskBackedWorkbenchRecord(item)) return !isDuplicateWorkbenchFallbackLog(item, primaryWorkbenchLogs);
            if (item.id.startsWith("image-workbench:")) return true;
            return !item.assets.some((asset) => aggregateAssetUrls.has(stableAssetUrl(asset))) && !isDuplicateServerImageTaskLog(item, workbenchLogs);
        });
        return Promise.all(records.map(serverImageLogToWorkbenchLog));
    } catch {
        return [];
    }
}

function stableAssetUrl(asset: StoredGenerationLogRecord["assets"][number]) {
    return asset.serverUrl || asset.url || asset.remoteUrl || "";
}

function isTaskBackedWorkbenchRecord(record: StoredGenerationLogRecord) {
    return record.id.startsWith("image-workbench:image-task-");
}

function isDuplicateWorkbenchFallbackLog(record: StoredGenerationLogRecord, primaryWorkbenchLogs: StoredGenerationLogRecord[]) {
    return primaryWorkbenchLogs.some((log) => areRelatedServerImageLogs(record, log));
}

function isDuplicateServerImageTaskLog(record: StoredGenerationLogRecord, workbenchLogs: StoredGenerationLogRecord[]) {
    if (!record.id.startsWith("image-task:")) return false;
    return workbenchLogs.some((log) => areRelatedServerImageLogs(record, log));
}

function areRelatedServerImageLogs(record: StoredGenerationLogRecord, workbenchLog: StoredGenerationLogRecord) {
    const sharedTaskId = Boolean(serverRecordTaskId(record) && serverRecordTaskId(record) === serverRecordTaskId(workbenchLog));
    const sharedAsset = hasSharedServerAsset(record, workbenchLog);
    if (sharedTaskId || sharedAsset) return true;
    return hasSameComparableModel(record.model, workbenchLog.model) && hasRelatedRecordText(record, workbenchLog) && isWithinServerLogWindow(record, workbenchLog);
}

function serverRecordTaskId(record: StoredGenerationLogRecord) {
    if (record.taskId) return record.taskId;
    if (record.id.startsWith("image-task:")) return record.id.replace(/^image-task:/, "");
    if (record.id.startsWith("image-workbench:image-task-")) return record.id.replace(/^image-workbench:image-task-/, "");
    return "";
}

function hasSharedServerAsset(record: StoredGenerationLogRecord, workbenchLog: StoredGenerationLogRecord) {
    const assetUrls = new Set(workbenchLog.assets.map(stableAssetUrl).filter(Boolean));
    return Boolean(assetUrls.size && record.assets.some((asset) => assetUrls.has(stableAssetUrl(asset))));
}

function hasSameComparableModel(left: string, right: string) {
    return Boolean(left && right && comparableModelName(left) === comparableModelName(right));
}

function hasRelatedRecordText(left: Pick<StoredGenerationLogRecord, "prompt" | "title">, right: Pick<StoredGenerationLogRecord, "prompt" | "title">) {
    const leftTexts = relatedLogTexts(left);
    const rightTexts = relatedLogTexts(right);
    return leftTexts.some((leftText) => rightTexts.some((rightText) => leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText)));
}

function relatedLogTexts(log: Pick<StoredGenerationLogRecord, "prompt" | "title">) {
    return [log.prompt, log.title].map((text) => text.trim()).filter((text) => text.length >= 2);
}

function isWithinServerLogWindow(record: StoredGenerationLogRecord, workbenchLog: StoredGenerationLogRecord) {
    const recordTime = Date.parse(record.createdAt) || 0;
    const windowTimes = [workbenchLog.createdAt, workbenchLog.updatedAt, workbenchLog.completedAt].map((time) => (time ? Date.parse(time) : 0)).filter(Boolean);
    if (!recordTime || !windowTimes.length) return false;
    const paddingMs = 30 * 60 * 1000;
    return recordTime >= Math.min(...windowTimes) - paddingMs && recordTime <= Math.max(...windowTimes) + paddingMs;
}

export function filterCoveredLocalImageTaskLogs(localLogs: GenerationLog[], remoteLogs: GenerationLog[]) {
    const remoteWorkbenchLogs = remoteLogs.filter((log) => !log.id.startsWith("image-task-"));
    const coveredIds = new Set<string>();
    const logs = localLogs.filter((log) => {
        if (!log.id.startsWith("image-task-")) return true;
        if (!remoteWorkbenchLogs.some((workbenchLog) => isCoveredLocalImageTaskLog(log, workbenchLog))) return true;
        coveredIds.add(log.id);
        return false;
    });
    return { logs, coveredIds };
}

function isCoveredLocalImageTaskLog(log: GenerationLog, workbenchLog: GenerationLog) {
    if (hasSharedLocalAsset(log, workbenchLog)) return true;
    return hasSameComparableModel(log.model, workbenchLog.model) && hasRelatedLocalLogText(log, workbenchLog) && isWithinLocalWorkbenchWindow(log, workbenchLog);
}

function hasSharedLocalAsset(log: GenerationLog, workbenchLog: GenerationLog) {
    const assetUrls = new Set(workbenchLog.images.map(stableResultImageUrl).filter(Boolean));
    return Boolean(assetUrls.size && log.images.some((image) => assetUrls.has(stableResultImageUrl(image))));
}

function hasRelatedLocalLogText(left: GenerationLog, right: GenerationLog) {
    const leftTexts = [left.prompt, left.title].map((text) => text.trim()).filter((text) => text.length >= 2);
    const rightTexts = [right.prompt, right.title].map((text) => text.trim()).filter((text) => text.length >= 2);
    return leftTexts.some((leftText) => rightTexts.some((rightText) => leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText)));
}

function isWithinLocalWorkbenchWindow(log: GenerationLog, workbenchLog: GenerationLog) {
    const createdAt = log.createdAt || 0;
    const workbenchCreatedAt = workbenchLog.createdAt || 0;
    if (!createdAt || !workbenchCreatedAt) return false;
    return Math.abs(createdAt - workbenchCreatedAt) < 6 * 60 * 60 * 1000;
}

function comparableModelName(model: string) {
    const normalized = model.trim();
    const separator = normalized.indexOf("::");
    return (separator >= 0 ? normalized.slice(separator + 2) : normalized).trim();
}

export async function deleteServerImageTaskLogsForResults(currentLog: GenerationLog, removedResults: GenerationResult[], nextResults: GenerationResult[]) {
    const explicitIds = new Set<string>();
    if (currentLog.id.startsWith("image-task-")) imageServerLogIds(currentLog.id).forEach((id) => explicitIds.add(id));
    removedResults.forEach((result) => {
        if (result.image?.taskId) explicitIds.add(`image-task:${result.image.taskId}`);
    });

    const removedUrls = new Set(removedResults.map((result) => stableResultImageUrl(result.image)).filter(Boolean));
    const keptUrls = new Set(nextResults.map((result) => stableResultImageUrl(result.image)).filter(Boolean));
    if (!explicitIds.size && !removedUrls.size) return;

    const payload = await listGenerationLogs({ kind: "image", source: "image-workbench", pageSize: 100 });
    payload.items.forEach((record) => {
        if (!record.id.startsWith("image-task:")) return;
        if (explicitIds.has(record.id)) {
            explicitIds.add(record.id);
            return;
        }
        const hasRemovedAsset = record.assets.some((asset) => {
            const url = stableAssetUrl(asset);
            return url && removedUrls.has(url) && !keptUrls.has(url);
        });
        if (hasRemovedAsset) explicitIds.add(record.id);
    });
    if (explicitIds.size) await deleteServerGenerationLogs(Array.from(explicitIds));
}

export function stableResultImageUrl(image?: GeneratedImage) {
    if (!image) return "";
    return image.serverUrl || (isStableImageUrl(image.dataUrl) ? image.dataUrl : "") || image.remoteUrl || "";
}

export async function serverImageLogToWorkbenchLog(record: StoredGenerationLogRecord): Promise<GenerationLog> {
    const createdAt = Date.parse(record.createdAt) || Date.now();
    const snapshot = record.requestSnapshot;
    const slotsByAssetIndex = new Map((snapshot?.slots || []).filter((slot) => slot.status === "success" && slot.assetIndex !== undefined).map((slot) => [slot.assetIndex!, slot]));
    const images: GeneratedImage[] = record.assets.map((asset, index) => ({
        id: slotsByAssetIndex.get(index)?.id || `${serverWorkbenchLogId(record)}:${index}`,
        dataUrl: browserReadableMediaUrl(stableAssetUrl(asset)),
        remoteUrl: asset.remoteUrl,
        serverUrl: asset.serverUrl,
        storageKey: undefined,
        taskId: slotsByAssetIndex.get(index)?.taskId || record.taskId || (record.id.startsWith("image-task:") ? record.id.replace(/^image-task:/, "") : undefined),
        slotIndex: slotsByAssetIndex.get(index)?.index ?? index,
        durationMs: record.durationMs || 0,
        width: asset.width || 0,
        height: asset.height || 0,
        bytes: asset.bytes || 0,
        mimeType: asset.mimeType,
    }));
    const parameters = snapshot?.parameters || {};
    const imageTasks = (snapshot?.slots || []).flatMap((slot): PendingImageTask[] =>
        slot.status === "pending" && slot.taskId
            ? [{ resultId: slot.id, taskId: slot.taskId, kind: slot.taskKind === "edit" ? "edit" : "generation", model: slot.taskModel || parameters.model || record.model, index: slot.index, startedAt: slot.startedAt || createdAt }]
            : [],
    );
    const failures = (snapshot?.slots || []).flatMap((slot): GenerationFailure[] => (slot.status === "failed" ? [{ resultId: slot.id, index: slot.index, error: slot.error || record.error || "生成失败" }] : []));
    const references = (snapshot?.references || []).flatMap(imageReferenceFromSnapshot);
    const pendingCount = (snapshot?.slots || []).filter((slot) => slot.status === "pending").length;
    return normalizeLog({
        id: serverWorkbenchLogId(record),
        creativeConversationId: record.conversationId,
        createdAt,
        title: record.title || record.prompt || record.model,
        prompt: record.prompt,
        time: new Date(createdAt).toLocaleString("zh-CN", { hour12: false }),
        model: record.model,
        config: {
            model: parameters.model || record.model,
            imageModel: parameters.model || record.model,
            quality: parameters.quality || "",
            size: parameters.size || "",
            count: parameters.count || String(record.count || Math.max(1, images.length)),
        },
        references,
        durationMs: record.durationMs || 0,
        successCount: record.successCount || images.length,
        failCount: failures.length || record.failCount || 0,
        pendingCount,
        imageCount: record.count || Math.max(1, images.length + (record.failCount || 0)),
        size: "",
        quality: "",
        status: record.status === "pending" ? "生成中" : record.status === "failed" ? "失败" : "成功",
        images,
        thumbnails: images.map((image) => image.dataUrl),
        imageTasks,
        failures,
        requestSnapshot: snapshot,
        error: record.error,
    });
}

function serverWorkbenchLogId(record: StoredGenerationLogRecord) {
    return record.id.replace(/^image-workbench:/, "").replace(/^image-task:/, "image-task-");
}

export function imageServerLogIds(id: string) {
    if (id.startsWith("image-task-")) return [`image-task:${id.replace(/^image-task-/, "")}`];
    return [`image-workbench:${id}`];
}

export async function recordImageWorkbenchLog(log: GenerationLog) {
    const assets = log.images
        .map((image) => ({
            type: "image" as const,
            url: image.serverUrl || (isStableImageUrl(image.dataUrl) ? image.dataUrl : "") || image.remoteUrl || "",
            remoteUrl: image.remoteUrl,
            serverUrl: image.serverUrl,
            mimeType: image.mimeType,
            width: image.width,
            height: image.height,
            bytes: image.bytes,
        }))
        .filter((asset) => Boolean(asset.url));
    await recordGenerationLog({
        conversationId: log.creativeConversationId,
        id: `image-workbench:${log.id}`,
        kind: "image",
        source: "image-workbench",
        status: log.pendingCount ? "pending" : log.failCount && !log.successCount ? "failed" : "success",
        title: log.title,
        prompt: log.prompt,
        model: log.model || log.config.imageModel || log.config.model,
        summary: log.pendingCount ? "图片生成中" : log.failCount && !log.successCount ? "图片生成失败" : "图片生成完成",
        durationMs: log.durationMs,
        count: log.imageCount || Math.max(1, assets.length + (log.failCount || 0)),
        successCount: log.successCount || assets.length,
        failCount: log.failCount || 0,
        assets,
        requestSnapshot: log.requestSnapshot,
        error: log.error,
        createdAt: log.createdAt,
        completedAt: log.pendingCount ? undefined : Date.now(),
    });
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => ({
            ...item,
            dataUrl: await hydrateGeneratedImageUrl(item.storageKey, item.dataUrl, item.remoteUrl, item.serverUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    const imageTasks = (log.imageTasks || []).filter((task): task is PendingImageTask => Boolean(task?.resultId && task.taskId));
    const failures = (log.failures || []).filter((failure): failure is GenerationFailure => Boolean(failure?.resultId));
    const pendingCount = log.pendingCount ?? imageTasks.length;
    const failCount = log.failCount ?? failures.length;
    return {
        id: log.id || nanoid(),
        ownerUserId: log.ownerUserId,
        creativeConversationId: log.creativeConversationId,
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "未命名",
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount,
        pendingCount,
        imageCount: log.imageCount || log.successCount || images.length + failCount + pendingCount,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: pendingCount ? "生成中" : log.status || "成功",
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
        imageTasks,
        failures,
        requestSnapshot: log.requestSnapshot,
        error: log.error,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : isStableImageUrl(image.dataUrl) ? image.dataUrl : "" })),
        thumbnails: [],
    };
}

async function hydrateGeneratedImageUrl(storageKey?: string, fallback = "", remoteFallback = "", serverFallback = "") {
    const remoteUrl = isRemoteImageUrl(remoteFallback) ? remoteFallback : isRemoteImageUrl(fallback) ? fallback : "";
    const serverUrl = isServerImageUrl(serverFallback) ? serverFallback : isServerImageUrl(fallback) ? fallback : "";
    return browserReadableMediaUrl(serverUrl || remoteUrl || (!storageKey && !isLocalImageUrl(fallback) ? fallback : ""));
}

export async function normalizeGeneratedImage(url: string, remoteFallback = "", serverFallback = "", authoritativeMeta?: { width?: number; height?: number; bytes?: number; mimeType?: string }) {
    const remoteUrl = isRemoteImageUrl(remoteFallback) ? remoteFallback : isRemoteImageUrl(url) ? url : "";
    const serverUrl = isServerImageUrl(serverFallback) ? serverFallback : isServerImageUrl(url) ? url : "";
    const fallbackUrl = serverUrl || (!isLocalImageUrl(url) ? url : "") || remoteUrl;
    if (!fallbackUrl) throw new Error("生成结果未保存到服务器，请重试");
    if (!serverUrl) {
        const stored = await uploadImage(fallbackUrl);
        return { url: stored.url, remoteUrl: remoteUrl || undefined, serverUrl: stored.url, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType, storageKey: stored.storageKey };
    }
    const safeUrl = browserReadableMediaUrl(fallbackUrl);
    const trustedMeta = authoritativeGeneratedImageMeta(authoritativeMeta);
    if (trustedMeta) return { url: safeUrl, remoteUrl: remoteUrl || undefined, serverUrl: serverUrl || undefined, storageKey: undefined, ...trustedMeta };
    const meta = await readImageMeta(safeUrl);
    return { url: safeUrl, remoteUrl: remoteUrl || undefined, serverUrl: serverUrl || undefined, width: meta.width, height: meta.height, bytes: 0, mimeType: meta.mimeType, storageKey: undefined };
}

export function authoritativeGeneratedImageMeta(value?: { width?: number; height?: number; bytes?: number; mimeType?: string }) {
    const width = Math.floor(Number(value?.width) || 0);
    const height = Math.floor(Number(value?.height) || 0);
    if (width <= 0 || height <= 0) return null;
    return {
        width,
        height,
        bytes: Math.max(0, Math.floor(Number(value?.bytes) || 0)),
        mimeType: typeof value?.mimeType === "string" && value.mimeType.startsWith("image/") ? value.mimeType : "image/png",
    };
}

function isStableImageUrl(value?: string) {
    return Boolean(value && (value.startsWith("data:") || /^https?:\/\//i.test(value) || isServerImageUrl(value)));
}

function isLocalImageUrl(value: string) {
    return value.startsWith("data:") || value.startsWith("blob:");
}

export function isRemoteImageUrl(value: string) {
    return /^https?:\/\//i.test(value);
}

export function isServerImageUrl(value: string) {
    return value.startsWith("/api/generation-log-assets/") || value.startsWith("/api/reference-assets/");
}

export function resultsFromLog(log: GenerationLog): GenerationResult[] {
    const usedResultIds = new Set<string>();
    const entries: Array<{ index: number; result: GenerationResult }> = [];
    log.images.forEach((image, fallbackIndex) => {
        usedResultIds.add(image.id);
        entries.push({ index: image.slotIndex ?? fallbackIndex, result: { id: image.id, status: "success", image } });
    });
    (log.imageTasks || []).forEach((task, fallbackIndex) => {
        if (usedResultIds.has(task.resultId)) return;
        usedResultIds.add(task.resultId);
        entries.push({ index: task.index ?? entries.length + fallbackIndex, result: { id: task.resultId, status: "pending", task } });
    });
    (log.failures || []).forEach((failure, fallbackIndex) => {
        if (usedResultIds.has(failure.resultId)) return;
        usedResultIds.add(failure.resultId);
        entries.push({ index: failure.index ?? entries.length + fallbackIndex, result: { id: failure.resultId, status: "failed", error: failure.error || log.error || "生成失败" } });
    });
    const knownPendingCount = entries.filter((entry) => entry.result.status === "pending").length;
    const missingPendingCount = Math.max(0, (log.pendingCount || 0) - knownPendingCount);
    for (let index = 0; index < missingPendingCount; index += 1) {
        entries.push({ index: entries.length, result: { id: `${log.id}-pending-${index}`, status: "pending" } });
    }
    const knownFailureCount = entries.filter((entry) => entry.result.status === "failed").length;
    const missingFailureCount = Math.max(0, (log.failCount || 0) - knownFailureCount);
    for (let index = 0; index < missingFailureCount; index += 1) {
        entries.push({ index: entries.length, result: { id: `${log.id}-failed-${index}`, status: "failed", error: log.error || "生成失败" } });
    }
    return entries.sort((a, b) => a.index - b.index).map((entry) => entry.result);
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
    };
}

export function buildLogFromResults(baseLog: GenerationLog | null, snapshot: GenerationSnapshot, results: GenerationResult[], durationMs: number, count: string, error?: string): GenerationLog {
    const images = results.flatMap((item, index) => (item.status === "success" && item.image ? [{ ...item.image, id: item.id, slotIndex: item.image.slotIndex ?? index }] : []));
    const imageTasks = results.flatMap((item, index) => (item.status === "pending" && item.task ? [{ ...item.task, resultId: item.id, index }] : []));
    const failures = results.flatMap((item, index) => (item.status === "failed" ? [{ resultId: item.id, index, error: item.error || error || "生成失败" }] : []));
    const pendingCount = results.filter((item) => item.status === "pending").length;
    const failCount = failures.length;
    const logConfig = buildLogConfig(snapshot.config, count);
    const status: GenerationLog["status"] = pendingCount ? "生成中" : images.length ? "成功" : "失败";
    const errorMessage = error || failures[0]?.error;
    const requestSnapshot = mergeImageRequestSnapshot(baseLog?.requestSnapshot, snapshot, results, count, errorMessage);
    return buildLog({
        baseLog,
        prompt: snapshot.text,
        model: snapshot.config.imageModel || snapshot.config.model,
        config: logConfig,
        references: snapshot.references,
        durationMs,
        successCount: images.length,
        failCount,
        pendingCount,
        imageCount: Math.max(Number(count) || 0, results.length, images.length + failCount + pendingCount),
        status,
        images,
        imageTasks,
        failures,
        requestSnapshot,
        error: errorMessage,
    });
}

function buildLog({
    baseLog,
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    pendingCount,
    imageCount,
    status,
    images,
    imageTasks,
    failures,
    requestSnapshot,
    error,
}: {
    baseLog?: GenerationLog | null;
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    pendingCount: number;
    imageCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
    imageTasks: PendingImageTask[];
    failures: GenerationFailure[];
    requestSnapshot: GenerationLogRequestSnapshot;
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count: config.count,
    };
    return {
        id: baseLog?.id || nanoid(),
        creativeConversationId: baseLog?.creativeConversationId,
        createdAt: baseLog?.createdAt || Date.now(),
        title: baseLog?.title || prompt.slice(0, 12) || "未命名",
        prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        successCount,
        failCount,
        pendingCount,
        imageCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
        imageTasks,
        failures,
        requestSnapshot,
        error,
    };
}

function buildLogConfig(config: AiConfig, count: string): GenerationLogConfig {
    return {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count,
    };
}

export function snapshotFromLog(log: GenerationLog, fallbackConfig: AiConfig, resultId?: string): GenerationSnapshot {
    const slot = resultId ? log.requestSnapshot?.slots.find((item) => item.id === resultId) : undefined;
    const parameters = { ...log.requestSnapshot?.parameters, ...slot?.parameters };
    const model = parameters.model || log.config.imageModel || log.model || fallbackConfig.imageModel || fallbackConfig.model;
    const snapshotReferences = log.requestSnapshot?.references || [];
    const referenceIds = slot?.referenceIds?.length ? new Set(slot.referenceIds) : undefined;
    const restoredReferences = snapshotReferences.filter((item) => !referenceIds || referenceIds.has(item.id)).flatMap(imageReferenceFromSnapshot);
    return {
        text: slot?.prompt || log.prompt,
        references: restoredReferences.length ? restoredReferences : log.references || [],
        config: {
            ...fallbackConfig,
            ...log.config,
            model,
            imageModel: model,
            size: parameters.size || log.config.size || fallbackConfig.size,
            quality: parameters.quality || log.config.quality || fallbackConfig.quality,
            count: "1",
        },
        count: 1,
    };
}

function mergeImageRequestSnapshot(base: GenerationLogRequestSnapshot | undefined, snapshot: GenerationSnapshot, results: GenerationResult[], count: string, error?: string): GenerationLogRequestSnapshot {
    const parameters = imageSnapshotParameters(snapshot.config, count);
    const currentReferences = snapshot.references.map(imageReferenceSnapshot);
    const references = Array.from(new Map([...(base?.references || []), ...currentReferences].map((item) => [item.id, item])).values());
    const currentReferenceIds = currentReferences.map((item) => item.id);
    const previousSlots = new Map((base?.slots || []).map((slot) => [slot.id, slot]));
    let assetIndex = 0;
    const slots = results.map((result, index): GenerationLogSlotSnapshot => {
        const previous = previousSlots.get(result.id);
        const task = result.task;
        const slot: GenerationLogSlotSnapshot = {
            ...previous,
            id: result.id,
            index,
            status: result.status,
            prompt: previous?.prompt || snapshot.text,
            parameters: previous?.parameters || parameters,
            referenceIds: previous?.referenceIds || currentReferenceIds,
            assetIndex: result.status === "success" ? assetIndex : undefined,
            taskId: task?.taskId || result.image?.taskId || previous?.taskId,
            taskKind: task?.kind || previous?.taskKind,
            taskModel: task?.model || previous?.taskModel || parameters.model,
            startedAt: task?.startedAt || previous?.startedAt,
            error: result.status === "failed" ? result.error || error || previous?.error || "生成失败" : undefined,
        };
        if (result.status === "success") assetIndex += 1;
        return slot;
    });
    return { version: 1, parameters, references, slots };
}

function imageSnapshotParameters(config: GenerationLogConfig | AiConfig, count: string): GenerationLogSnapshotParameters {
    return {
        model: config.imageModel || config.model,
        size: config.size,
        quality: config.quality,
        count,
    };
}

function imageReferenceSnapshot(reference: ReferenceImage): GenerationLogReferenceSnapshot {
    const stableUrl = [reference.serverUrl, reference.url, reference.remoteUrl, reference.dataUrl].find((value) => value && !/^(?:data|blob):/i.test(value));
    return {
        id: reference.id,
        kind: "image",
        name: reference.name,
        mimeType: reference.type,
        url: stableUrl,
        remoteUrl: reference.remoteUrl,
        serverUrl: reference.serverUrl,
        storageKey: reference.storageKey,
        width: reference.width,
        height: reference.height,
    };
}

function imageReferenceFromSnapshot(reference: GenerationLogReferenceSnapshot): ReferenceImage[] {
    if (reference.kind !== "image") return [];
    const dataUrl = browserReadableMediaUrl(reference.serverUrl || reference.url || reference.remoteUrl || "");
    if (!dataUrl && !reference.storageKey) return [];
    return [
        {
            id: reference.id,
            name: reference.name,
            type: reference.mimeType,
            dataUrl,
            url: reference.url,
            remoteUrl: reference.remoteUrl,
            serverUrl: reference.serverUrl,
            storageKey: reference.storageKey,
            width: reference.width,
            height: reference.height,
        },
    ];
}
