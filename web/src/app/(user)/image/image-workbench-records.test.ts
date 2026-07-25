import { describe, expect, it } from "vitest";

import type { AiConfig } from "@/stores/use-config-store";
import type { GenerationLog, PendingImageTask } from "./image-workbench-records";
import { buildLogFromResults, filterCoveredLocalImageTaskLogs, imageServerLogIds, resultsFromLog, snapshotFromLog, stableResultImageUrl } from "./image-workbench-records";

describe("image workbench records", () => {
    it("restores pending, failed, and success results in slot order", () => {
        const pendingTask: PendingImageTask = { resultId: "pending-1", taskId: "task-1", kind: "generation", model: "image-v1", index: 0, startedAt: 1000 };
        const log = generationLog({
            images: [image("ok-1", { slotIndex: 2 })],
            imageTasks: [pendingTask],
            failures: [{ resultId: "fail-1", index: 1, error: "上游失败" }],
            pendingCount: 1,
            failCount: 1,
            imageCount: 3,
            status: "生成中",
        });

        expect(resultsFromLog(log)).toEqual([
            { id: "pending-1", status: "pending", task: pendingTask },
            { id: "fail-1", status: "failed", error: "上游失败" },
            { id: "ok-1", status: "success", image: image("ok-1", { slotIndex: 2 }) },
        ]);
    });

    it("builds a failed log from failed generation results", () => {
        const log = buildLogFromResults(null, { text: "生成图片", config: baseConfig(), references: [] }, [{ id: "result-1", status: "failed", error: "生成失败" }], 1200, "1");

        expect(log).toMatchObject({
            prompt: "生成图片",
            status: "失败",
            error: "生成失败",
            successCount: 0,
            failCount: 1,
            imageCount: 1,
            failures: [{ resultId: "result-1", index: 0, error: "生成失败" }],
        });
    });

    it("restores the original prompt and parameters for retry", () => {
        const log = generationLog({ prompt: "原始商品图提示词", model: "image-v1", config: { ...baseConfig(), imageModel: "image-v1", size: "16:9", quality: "high" } });

        expect(snapshotFromLog(log, baseConfig())).toMatchObject({ text: "原始商品图提示词", config: { model: "image-v1", imageModel: "image-v1", size: "16:9", quality: "high" } });
    });

    it("uses stable remote, server, and data URLs for generated images", () => {
        expect(stableResultImageUrl(image("remote", { dataUrl: "blob:local", remoteUrl: "https://cdn.example.com/image.png" }))).toBe("https://cdn.example.com/image.png");
        expect(stableResultImageUrl(image("server", { dataUrl: "blob:local", serverUrl: "/api/generation-log-assets/image.png" }))).toBe("/api/generation-log-assets/image.png");
        expect(stableResultImageUrl(image("data", { dataUrl: "data:image/png;base64,AAAA" }))).toBe("data:image/png;base64,AAAA");
        expect(stableResultImageUrl(image("blob", { dataUrl: "blob:local" }))).toBe("");
    });

    it("maps workbench and task log ids to server ids", () => {
        expect(imageServerLogIds("image-task-abc")).toEqual(["image-task:abc"]);
        expect(imageServerLogIds("workbench-1")).toEqual(["image-workbench:workbench-1"]);
    });

    it("filters local task logs covered by remote workbench logs", () => {
        const localTask = generationLog({
            id: "image-task-task-1",
            prompt: "一只橘猫",
            model: "provider::image-v1",
            images: [image("local", { remoteUrl: "https://cdn.example.com/cat.png" })],
        });
        const localWorkbench = generationLog({ id: "local-workbench", prompt: "保留这条" });
        const remoteWorkbench = generationLog({
            id: "remote-workbench",
            prompt: "一只橘猫",
            model: "image-v1",
            images: [image("remote", { remoteUrl: "https://cdn.example.com/cat.png" })],
        });

        const result = filterCoveredLocalImageTaskLogs([localTask, localWorkbench], [remoteWorkbench]);

        expect(result.logs.map((item) => item.id)).toEqual(["local-workbench"]);
        expect(result.coveredIds).toEqual(new Set(["image-task-task-1"]));
    });
});

function image(id: string, overrides: Partial<GenerationLog["images"][number]> = {}): GenerationLog["images"][number] {
    return {
        id,
        dataUrl: `https://cdn.example.com/${id}.png`,
        durationMs: 1000,
        width: 1024,
        height: 1024,
        bytes: 100,
        mimeType: "image/png",
        ...overrides,
    };
}

function generationLog(overrides: Partial<GenerationLog> = {}): GenerationLog {
    const images = overrides.images || [];
    const failures = overrides.failures || [];
    const imageTasks = overrides.imageTasks || [];
    return {
        id: "log-1",
        createdAt: 1000,
        title: "生成图片",
        prompt: "生成图片",
        time: "2026/7/15 10:00:00",
        model: "image-v1",
        config: { model: "image-v1", imageModel: "image-v1", quality: "high", size: "1:1", count: "1" },
        references: [],
        durationMs: 1000,
        successCount: images.length,
        failCount: failures.length,
        imageCount: Math.max(1, images.length + failures.length + imageTasks.length),
        size: "1:1",
        quality: "high",
        status: imageTasks.length ? "生成中" : failures.length && !images.length ? "失败" : "成功",
        images,
        thumbnails: images.map((item) => item.dataUrl),
        imageTasks,
        failures,
        ...overrides,
    };
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
        model: "image-v1",
        imageModel: "image-v1",
        videoModel: "",
        textModel: "",
        audioModel: "",
        audioVoice: "",
        audioFormat: "",
        audioSpeed: "",
        audioInstructions: "",
        videoSeconds: "5",
        vquality: "",
        videoGenerateAudio: "true",
        videoWatermark: "false",
        systemPrompt: "",
        models: [],
        imageModels: [],
        videoModels: [],
        textModels: [],
        audioModels: [],
        quality: "high",
        size: "1:1",
        count: "1",
        canvasImageCount: "1",
        modelPointCosts: {},
        generationPointMultipliers: { imageQuality: {}, videoQuality: {}, videoSeconds: {} },
        generationConcurrency: { agent: 1, image: 1, video: 1, audio: 1, text: 1, render: 1 },
    };
}
