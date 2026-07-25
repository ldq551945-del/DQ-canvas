"use client";

import { nanoid } from "nanoid";

import { normalizeVideoResolutionValue, normalizeVideoSizeValue } from "@/components/video-settings-panel";
import { browserReadableMediaUrl, isRemoteMediaUrl } from "@/lib/browser-media-url";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceRatio } from "@/lib/seedance-video";
import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import { listGenerationLogs, recordGenerationLog, type StoredGenerationLogRecord } from "@/services/api/generation-logs";
import type { VideoGenerationTask } from "@/services/api/video";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type GeneratedVideo = {
    id: string;
    url: string;
    remoteUrl?: string;
    serverUrl?: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

export type GenerationFailure = {
    resultId: string;
    error: string;
};

export type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
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
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "生成中" | "成功" | "失败";
    task?: VideoGenerationTask;
    taskStartedAt?: number;
    taskResultId?: string;
    video?: GeneratedVideo;
    videos?: GeneratedVideo[];
    failures?: GenerationFailure[];
    error?: string;
    resultDeleted?: boolean;
};

export type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark">;
export type GenerationSnapshot = { text: string; config: AiConfig; references: ReferenceImage[]; videoReferences: ReferenceVideo[]; audioReferences: ReferenceAudio[] };
export type ReferenceDropTarget = "image" | "video" | "audio";

export async function readStoredLogs(userId: string) {
    return (await readServerVideoLogs()).map((log) => withLogOwner(log, userId));
}

export function withLogOwner(log: GenerationLog, userId: string): GenerationLog {
    return userId ? { ...log, ownerUserId: userId } : log;
}

export function saveStoredVideoLog(log: GenerationLog) {
    return recordVideoGenerationLog(log);
}

export function removeStoredVideoLogs(ids: string[]) {
    return Promise.resolve(ids);
}

export async function readServerVideoLogs() {
    try {
        const payload = await listGenerationLogs({ kind: "video", source: "video-workbench", pageSize: 100 });
        return Promise.all(payload.items.filter((item) => item.id.startsWith("video-workbench:")).map(serverVideoLogToWorkbenchLog));
    } catch {
        return [];
    }
}

export async function serverVideoLogToWorkbenchLog(record: StoredGenerationLogRecord): Promise<GenerationLog> {
    const createdAt = Date.parse(record.createdAt) || Date.now();
    const videos: GeneratedVideo[] = record.assets.flatMap((asset, index) => {
        const url = browserReadableMediaUrl(asset.serverUrl || asset.url || asset.remoteUrl || "");
        if (!url) return [];
        return [
            {
                id: `${serverVideoLogId(record)}:${index}`,
                url,
                remoteUrl: asset.remoteUrl,
                serverUrl: asset.serverUrl,
                storageKey: "",
                durationMs: record.durationMs || 0,
                width: asset.width || 0,
                height: asset.height || 0,
                bytes: asset.bytes || 0,
                mimeType: asset.mimeType || "video/mp4",
            },
        ];
    });
    return normalizeLog({
        id: serverVideoLogId(record),
        creativeConversationId: record.conversationId,
        createdAt,
        title: record.title || record.prompt || record.model,
        prompt: record.prompt,
        time: new Date(createdAt).toLocaleString("zh-CN", { hour12: false }),
        model: record.model,
        config: { model: record.model, videoModel: record.model, size: "", vquality: "", videoSeconds: "", videoGenerateAudio: "true", videoWatermark: "false" },
        references: [],
        videoReferences: [],
        audioReferences: [],
        durationMs: record.durationMs || 0,
        size: "",
        resolution: "",
        seconds: "",
        status: record.status === "pending" ? "生成中" : record.status === "failed" ? "失败" : "成功",
        video: videos[videos.length - 1],
        videos,
        failures: record.status === "failed" ? [{ resultId: serverVideoLogId(record), error: record.error || "生成失败" }] : [],
        error: record.error,
        resultDeleted: !videos.length && record.status === "success",
    });
}

export async function recordVideoGenerationLog(log: GenerationLog) {
    const videos = log.videos?.length ? log.videos : log.video ? [log.video] : [];
    const assets = videos.flatMap((video) => {
        const assetUrl = video.serverUrl || (video.url && !video.url.startsWith("blob:") ? video.url : "") || video.remoteUrl || "";
        if (!assetUrl) return [];
        return [
            {
                type: "video" as const,
                url: assetUrl,
                remoteUrl: video.remoteUrl,
                serverUrl: video.serverUrl,
                mimeType: video.mimeType,
                width: video.width,
                height: video.height,
                bytes: video.bytes,
            },
        ];
    });
    return (
        await recordGenerationLog({
            conversationId: log.creativeConversationId,
            id: `video-workbench:${log.id}`,
            kind: "video",
            source: "video-workbench",
            status: log.status === "成功" ? "success" : log.status === "失败" ? "failed" : "pending",
            title: log.title,
            prompt: log.prompt,
            model: log.model || log.config.videoModel || log.config.model,
            summary: log.status === "成功" ? "视频生成完成" : log.status === "失败" ? "视频生成失败" : "视频生成中",
            durationMs: log.durationMs,
            count: Math.max(1, resultsFromLog(log).length),
            successCount: videos.length,
            failCount: log.failures?.length || (log.status === "失败" ? 1 : 0),
            assets,
            error: log.error,
            createdAt: log.createdAt,
            completedAt: Date.now(),
        })
    ).assets[0];
}

export async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const videoFallback = generatedVideoFallback(log.video);
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, videoFallback) } : log.video ? { ...log.video, url: browserReadableMediaUrl(videoFallback || log.video.url || "") } : undefined;
    const videos = await Promise.all((log.videos?.length ? log.videos : video ? [video] : []).map(normalizeGeneratedVideo));
    const videoReferences = await Promise.all((log.videoReferences || []).map(async (item) => ({ ...item, url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : browserReadableMediaUrl(item.url) })));
    const audioReferences = await Promise.all((log.audioReferences || []).map(async (item) => ({ ...item, url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : browserReadableMediaUrl(item.url) })));
    const references = await Promise.all((log.references || []).map(async (item) => ({ ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) })));
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        ownerUserId: log.ownerUserId,
        creativeConversationId: log.creativeConversationId,
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "未命名",
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        videoReferences,
        audioReferences,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "成功",
        task: log.task,
        taskStartedAt: log.taskStartedAt,
        taskResultId: log.taskResultId,
        video: videos[videos.length - 1],
        videos,
        failures: log.failures || [],
        error: log.error,
        resultDeleted: Boolean(log.resultDeleted),
    };
}

export async function normalizeGeneratedVideo(video: GeneratedVideo): Promise<GeneratedVideo> {
    const fallback = generatedVideoFallback(video);
    return video.storageKey ? { ...video, url: await resolveMediaUrl(video.storageKey, fallback) } : { ...video, url: browserReadableMediaUrl(fallback || video.url || "") };
}

export function generatedVideoFallback(video?: Partial<GeneratedVideo>) {
    const value = video?.url || "";
    const localValue = value.startsWith("data:") ? value : "";
    const remoteUrl = isRemoteMediaUrl(video?.remoteUrl || "") ? video?.remoteUrl || "" : isRemoteMediaUrl(value) ? value : "";
    const serverUrl = isServerMediaUrl(video?.serverUrl || "") ? video?.serverUrl || "" : isServerMediaUrl(value) ? value : "";
    return serverUrl || localValue || (value && !value.startsWith("blob:") ? value : "") || remoteUrl;
}

export function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        videoReferences: log.videoReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        audioReferences: log.audioReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
        videos: log.videos?.map((video) => (video.storageKey ? { ...video, url: "" } : video)),
    };
}

export function resultsFromLog(log: GenerationLog): GenerationResult[] {
    if (log.resultDeleted) return [];
    const results: GenerationResult[] = (log.videos?.length ? log.videos : log.video ? [log.video] : []).map((video) => ({ id: video.id, status: "success", video }));
    (log.failures || []).forEach((failure) => results.push({ id: failure.resultId, status: "failed", error: failure.error }));
    if (log.status === "生成中" && log.task) results.push({ id: log.taskResultId || log.id, status: "pending" });
    if (!results.length && log.error) results.push({ id: log.id, status: "failed", error: log.error });
    return results;
}

export function isSupportedAudioFile(file: Pick<File, "type" | "name">) {
    return file.type === "audio/mpeg" || file.type === "audio/mp3" || file.type === "audio/wav" || file.type === "audio/x-wav" || /\.(mp3|wav)$/i.test(file.name);
}

export function filterAudioReferencesByDuration(existing: ReferenceAudio[], next: ReferenceAudio[], warn: (content: string) => void) {
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceAudio[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > 15000)) {
            skipped = true;
            continue;
        }
        if (item.durationMs && total + item.durationMs > 15000) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn("已忽略不符合时长要求的参考音频：单个 2-15 秒，总时长不超过 15 秒");
    return accepted;
}

export function replaceResult(results: GenerationResult[], resultId: string, nextResult: GenerationResult) {
    let replaced = false;
    const nextResults = results.map((result) => {
        if (result.id !== resultId) return result;
        replaced = true;
        return nextResult;
    });
    return replaced ? nextResults : [...nextResults, nextResult];
}

export function buildLogFromVideoResults(baseLog: GenerationLog | null, snapshot: GenerationSnapshot, results: GenerationResult[], durationMs: number, error?: string, pending?: { task: VideoGenerationTask; taskResultId: string }): GenerationLog {
    const videos = results.flatMap((result) => (result.status === "success" && result.video ? [result.video] : []));
    const failures = results.flatMap((result) => (result.status === "failed" ? [{ resultId: result.id, error: result.error || error || "生成失败" }] : []));
    const hasPending = results.some((result) => result.status === "pending");
    const status: GenerationLog["status"] = hasPending ? "生成中" : videos.length ? "成功" : "失败";
    const latestVideo = videos[videos.length - 1];
    return buildLog({
        baseLog,
        prompt: snapshot.text,
        model: snapshot.config.videoModel || snapshot.config.model,
        config: snapshot.config,
        references: snapshot.references,
        videoReferences: snapshot.videoReferences,
        audioReferences: snapshot.audioReferences,
        durationMs,
        status,
        task: pending?.task,
        taskResultId: pending?.taskResultId,
        video: latestVideo,
        videos,
        failures,
        error: error || failures[0]?.error,
        resultDeleted: !results.length,
    });
}

export function snapshotFromLog(log: GenerationLog, config: AiConfig): GenerationSnapshot {
    return {
        text: log.prompt,
        config,
        references: log.references || [],
        videoReferences: log.videoReferences || [],
        audioReferences: log.audioReferences || [],
    };
}

export function buildLog({
    baseLog,
    prompt,
    model,
    config,
    references,
    videoReferences,
    audioReferences,
    durationMs,
    status,
    task,
    taskResultId,
    video,
    videos,
    failures,
    error,
    resultDeleted,
}: {
    baseLog?: GenerationLog | null;
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    status: GenerationLog["status"];
    task?: VideoGenerationTask;
    taskResultId?: string;
    video?: GeneratedVideo;
    videos?: GeneratedVideo[];
    failures?: GenerationFailure[];
    error?: string;
    resultDeleted?: boolean;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
    };
    const nextVideos = videos || (video ? [video] : baseLog?.videos || []);
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
        videoReferences,
        audioReferences,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        taskStartedAt: task ? Date.now() : undefined,
        taskResultId,
        video: video || nextVideos[nextVideos.length - 1],
        videos: nextVideos,
        failures,
        error,
        resultDeleted,
    };
}

export function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    const seedance = isSeedanceVideoConfig({ ...config, model });
    return {
        ...config,
        model,
        videoModel: model,
        size: seedance ? normalizeSeedanceRatio(config.size) : normalizeVideoSize(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
    };
}

export function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    const seconds = Math.floor(Number(value) || 5);
    return String(Math.max(1, Math.min(20, seconds)));
}

export function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

export function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

export function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
    };
}

function serverVideoLogId(record: StoredGenerationLogRecord) {
    return record.id.replace(/^video-workbench:/, "");
}

export function isServerMediaUrl(value: string) {
    return value.startsWith("/api/generation-log-assets/");
}
