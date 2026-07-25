import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeReferenceMediaFile } from "@/lib/server/reference-asset-store";
import { ffmpegAvailable, runFfmpeg, runFfprobe } from "@/lib/server/ffmpeg";
import { downloadMediaToFile } from "@/lib/server/media-download";

const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const DURATION_TOLERANCE_SECONDS = 0.08;

export type NormalizedVideoResult = {
    url: string;
    mimeType: string;
    durationMs: number;
};

export async function normalizeVideoResult(input: {
    url: string;
    origin: string;
    cookie?: string;
    requestedDurationSeconds?: number;
    mimeType?: string;
    ownerUserId: string;
    source?: string;
    conversationId?: string;
    runId?: string;
    taskId?: string;
    projectId?: string;
}) {
    const workdir = await mkdtemp(join(tmpdir(), "vozeb-pro-video-"));
    const sourcePath = join(workdir, "source-video");
    const normalizedPath = join(workdir, "normalized-video.mp4");
    try {
        const downloaded = await downloadMediaToFile(input.url, sourcePath, { origin: input.origin, cookie: input.cookie, maxBytes: MAX_VIDEO_BYTES });
        const sourceDuration = await probeDuration(sourcePath);
        const requestedDuration = normalizeRequestedDuration(input.requestedDurationSeconds);
        let outputPath = sourcePath;
        let duration = sourceDuration;
        let mimeType = downloaded.mimeType.startsWith("video/") ? downloaded.mimeType : input.mimeType || "video/mp4";

        if (requestedDuration && Math.abs(sourceDuration - requestedDuration) > DURATION_TOLERANCE_SECONDS) {
            if (!(await ffmpegAvailable())) throw new Error(`上游返回 ${formatSeconds(sourceDuration)} 秒，服务器未安装 FFmpeg，无法处理为请求的 ${requestedDuration} 秒`);
            await runFfmpeg(
                [
                    "-y",
                    "-i",
                    sourcePath,
                    "-vf",
                    `trim=duration=${requestedDuration},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${requestedDuration}`,
                    "-af",
                    `apad=whole_dur=${requestedDuration}`,
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0?",
                    "-t",
                    String(requestedDuration),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "22",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-movflags",
                    "+faststart",
                    normalizedPath,
                ],
                { cwd: workdir, timeoutMs: 10 * 60_000 },
            );
            duration = await probeDuration(normalizedPath);
            if (Math.abs(duration - requestedDuration) > DURATION_TOLERANCE_SECONDS) throw new Error(`服务器处理后视频时长为 ${formatSeconds(duration)} 秒，未达到请求的 ${requestedDuration} 秒`);
            outputPath = normalizedPath;
            mimeType = "video/mp4";
        }

        const asset = await writeReferenceMediaFile(outputPath, "video", mimeType, true, {
            ownerUserId: input.ownerUserId,
            source: input.source || "video-task",
            conversationId: input.conversationId,
            runId: input.runId,
            taskId: input.taskId,
            projectId: input.projectId,
        });
        return { url: asset.url || `/api/reference-assets/${asset.token}`, mimeType, durationMs: Math.round(duration * 1000) } satisfies NormalizedVideoResult;
    } finally {
        await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function probeDuration(path: string) {
    try {
        const result = await runFfprobe(["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], { timeoutMs: 60_000 });
        const duration = Number(result.stdout.trim());
        if (!Number.isFinite(duration) || duration <= 0) throw new Error("视频时长无效");
        return duration;
    } catch {
        throw new Error("服务器无法读取视频实际时长，请检查 FFmpeg/FFprobe 配置");
    }
}

function normalizeRequestedDuration(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.max(1, Math.min(20, Math.floor(number))) : undefined;
}

function formatSeconds(value: number) {
    return Number(value.toFixed(2)).toString();
}
