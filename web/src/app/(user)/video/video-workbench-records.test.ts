import { describe, expect, it, vi } from "vitest";

import type { AiConfig } from "@/stores/use-config-store";
import { generationLogPublicPrompt } from "@/lib/generation-log-snapshot";
import { buildLogFromVideoResults, buildVideoConfig, filterAudioReferencesByDuration, generatedVideoFallback, normalizeVideoSeconds, resultsFromLog, snapshotFromLog } from "./video-workbench-records";

describe("video workbench records", () => {
    it("restores success, failure, and pending results from a log", () => {
        const log = {
            id: "log-1",
            status: "生成中" as const,
            task: { id: "task-1" },
            taskResultId: "pending-1",
            videos: [video("ok-1")],
            failures: [{ resultId: "fail-1", error: "上游失败" }],
        };

        expect(resultsFromLog(log as never)).toEqual([
            { id: "ok-1", status: "success", video: video("ok-1") },
            { id: "fail-1", status: "failed", error: "上游失败" },
            { id: "pending-1", status: "pending" },
        ]);
    });

    it("builds a failed log from failed generation results", () => {
        const log = buildLogFromVideoResults(null, { text: "生成视频", config: baseConfig(), references: [], videoReferences: [], audioReferences: [] }, [{ id: "result-1", status: "failed", error: "生成失败" }], 1200);

        expect(log).toMatchObject({
            prompt: "生成视频",
            status: "失败",
            error: "生成失败",
            failures: [{ resultId: "result-1", error: "生成失败" }],
            resultDeleted: false,
        });
    });

    it("keeps the user request separate from the internal video prompt", () => {
        const log = buildLogFromVideoResults(null, { text: "内部视频执行提示词", userText: "让产品自然旋转五秒", config: baseConfig(), references: [], videoReferences: [], audioReferences: [] }, [{ id: "result-1", status: "pending" }], 0);

        expect(log.prompt).toBe("内部视频执行提示词");
        expect(log.title).toBe("让产品自然旋转五秒".slice(0, 12));
        expect(log.requestSnapshot?.userPrompt).toBe("让产品自然旋转五秒");
        expect(generationLogPublicPrompt(log)).toBe("让产品自然旋转五秒");
        expect(snapshotFromLog(log, baseConfig())).toMatchObject({ text: "内部视频执行提示词", userText: "让产品自然旋转五秒" });
    });

    it("keeps audio references within duration limits and warns once", () => {
        const warn = vi.fn();
        const accepted = filterAudioReferencesByDuration(
            [{ id: "old", name: "old.mp3", type: "audio/mpeg", url: "old", durationMs: 5000 }],
            [
                { id: "short", name: "short.mp3", type: "audio/mpeg", url: "short", durationMs: 1000 },
                { id: "ok", name: "ok.mp3", type: "audio/mpeg", url: "ok", durationMs: 4000 },
                { id: "overflow", name: "overflow.mp3", type: "audio/mpeg", url: "overflow", durationMs: 8000 },
            ],
            warn,
        );

        expect(accepted.map((item) => item.id)).toEqual(["ok"]);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("normalizes video config and preserves intelligent duration", () => {
        expect(normalizeVideoSeconds("-1")).toBe("-1");
        expect(buildVideoConfig({ ...baseConfig(), videoSeconds: "99", vquality: "999", size: "bad" }, "video-v1")).toMatchObject({ model: "video-v1", videoModel: "video-v1", videoSeconds: "20", vquality: "999", size: "1280x720" });
    });

    it("prefers remote and server fallbacks over blob URLs", () => {
        expect(generatedVideoFallback({ url: "blob:local", remoteUrl: "https://cdn.example.com/video.mp4" })).toBe("https://cdn.example.com/video.mp4");
        expect(generatedVideoFallback({ url: "blob:local", serverUrl: "/api/generation-log-assets/video.mp4" })).toBe("/api/generation-log-assets/video.mp4");
    });
});

function video(id: string) {
    return { id, url: `https://cdn.example.com/${id}.mp4`, storageKey: "", durationMs: 1000, width: 1280, height: 720, bytes: 100, mimeType: "video/mp4" };
}

function baseConfig(): AiConfig {
    return {
        apiSource: "system",
        channelMode: "remote",
        baseUrl: "",
        apiKey: "",
        apiFormat: "openai",
        channels: [],
        logicalModels: [],
        model: "video-v1",
        imageModel: "",
        videoModel: "video-v1",
        textModel: "",
        audioModel: "",
        audioVoice: "",
        audioFormat: "",
        audioSpeed: "",
        audioInstructions: "",
        videoSeconds: "5",
        vquality: "720",
        videoGenerateAudio: "true",
        videoWatermark: "false",
        systemPrompt: "",
        models: [],
        imageModels: [],
        videoModels: [],
        textModels: [],
        audioModels: [],
        quality: "",
        size: "16:9",
        count: "1",
        canvasImageCount: "1",
        modelPointCosts: {},
        generationPointMultipliers: { imageQuality: {}, videoQuality: {}, videoSeconds: {} },
        generationConcurrency: { agent: 1, image: 1, video: 1, audio: 1, text: 1, render: 1 },
    };
}
