import { describe, expect, it } from "vitest";

import { buildWorkbenchAgentFailureUpdate, mergeWorkbenchAgentPatch, workbenchRequiresManualModel } from "./use-workbench-agent-run";

describe("workbench Agent failure update", () => {
    it("marks planning errors as failed with a text-model recovery hint", () => {
        const result = buildWorkbenchAgentFailureUpdate({
            aborted: false,
            failedAt: "planning",
            hasReferences: false,
            mediaLabel: "视频",
            errorMessage: "请管理员先配置并启用默认文本模型",
        });

        expect(result.progress).toEqual({ phase: "failed", hasReferences: false, failedAt: "planning" });
        expect(result.text).toContain("规划没有完成");
        expect(result.text).toContain("默认文本模型已启用");
    });

    it("marks submit errors as failed instead of cancelled", () => {
        const result = buildWorkbenchAgentFailureUpdate({
            aborted: false,
            failedAt: "submitting",
            hasReferences: true,
            shouldGenerate: true,
            mediaLabel: "视频",
            errorMessage: "请联系管理员在后台配置可用视频模型",
        });

        expect(result.progress).toEqual({ phase: "failed", hasReferences: true, shouldGenerate: true, failedAt: "submitting" });
        expect(result.text).toContain("本次没有进入视频生成队列");
        expect(result.text).toContain("视频逻辑模型");
    });

    it("keeps user stops as cancelled", () => {
        const result = buildWorkbenchAgentFailureUpdate({
            aborted: true,
            failedAt: "planning",
            hasReferences: false,
            mediaLabel: "图片",
            errorMessage: "AbortError",
        });

        expect(result.progress).toEqual({ phase: "cancelled", hasReferences: false, failedAt: "planning" });
        expect(result.text).toBe("你已停止本轮 Agent，本次没有创建生成任务。");
    });

    it("merges video parameter patches into the same generation request snapshot", () => {
        const config = mergeWorkbenchAgentPatch({ videoModel: "old-video", size: "1:1", vquality: "480", videoSeconds: "5" }, { model: "video-v1", size: "16:9", vquality: "720", videoSeconds: 10 }, "video");

        expect(config).toMatchObject({ videoModel: "video-v1", size: "16:9", vquality: "720", videoSeconds: "10" });
    });

    it("merges image parameter patches before the current batch is created", () => {
        const config = mergeWorkbenchAgentPatch({ imageModel: "old-image", size: "1:1", quality: "auto", count: "1" }, { model: "gpt-image-2", size: "9:16", quality: "high", count: 4 }, "image");

        expect(config).toMatchObject({ imageModel: "gpt-image-2", size: "9:16", quality: "high", count: "4" });
    });

    it("requires an explicit model when smart planning is disabled", () => {
        expect(workbenchRequiresManualModel(false, [])).toBe(true);
        expect(workbenchRequiresManualModel(false, ["video-v1"])).toBe(false);
        expect(workbenchRequiresManualModel(true, [])).toBe(false);
    });
});
