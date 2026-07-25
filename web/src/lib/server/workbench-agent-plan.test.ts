import { describe, expect, it, vi } from "vitest";
import { normalizeWorkbenchPlan, parseWorkbenchPlanCall } from "./workbench-agent-plan";

describe("normalizeWorkbenchPlan", () => {
    it("keeps only valid image fields", () => {
        const plan = normalizeWorkbenchPlan(
            { parameterPatch: { size: "16:9", quality: "high", count: 3, model: "image-1", admin: true, videoSeconds: 20 }, resolvedPrompt: "商品主图", shouldGenerate: true, reply: "开始", selectedSkillIds: ["commerce", "unknown"] },
            { workspace: "image", prompt: "生成商品图", models: ["image-1"], skillIds: ["commerce"] },
        );
        expect(plan).toMatchObject({
            intent: "generation",
            foundation: { brief: { objective: "生成商品图" }, direction: { summary: expect.any(String) } },
            deliverables: [{ type: "image" }],
            parameterPatch: { size: "16:9", model: "image-1", quality: "high", count: 3 },
            resolvedPrompt: "商品主图",
            shouldGenerate: true,
            reply: "开始",
            selectedSkillIds: ["commerce"],
        });
    });

    it("preserves conversation intent without media parameters", () => {
        const plan = normalizeWorkbenchPlan(
            { intent: "conversation", parameterPatch: {}, resolvedPrompt: "你在吗？", shouldGenerate: false, reply: "在的。", decisions: [], choices: [] },
            { workspace: "image", prompt: "你在吗？", models: ["image-1"], skillIds: [] },
        );

        expect(plan).toMatchObject({ intent: "conversation", parameterPatch: {}, shouldGenerate: false, reply: "在的。" });
    });

    it("rejects invalid values and foreign models", () => {
        const plan = normalizeWorkbenchPlan({ parameterPatch: { size: "999:1", count: 99, model: "foreign", vquality: "8k" } }, { workspace: "video", prompt: "生成视频", models: ["video-1"], skillIds: [] });
        expect(plan?.parameterPatch).toEqual({});
        expect(plan?.resolvedPrompt).toBe("生成视频");
    });

    it("normalizes video duration and quality", () => {
        const plan = normalizeWorkbenchPlan({ parameterPatch: { videoSeconds: 10, vquality: "1080" }, shouldGenerate: false }, { workspace: "video", prompt: "做视频", models: [], skillIds: [] });
        expect(plan?.parameterPatch).toEqual({ videoSeconds: "10", vquality: "1080" });
        expect(plan?.shouldGenerate).toBe(false);
    });

    it("keeps concise decisions and actionable choices", () => {
        const plan = normalizeWorkbenchPlan(
            {
                parameterPatch: { model: "image-1" },
                decisions: [
                    { label: "模型", value: "image-1", reason: "更适合写实产品摄影" },
                    { label: "", value: "bad", reason: "bad" },
                ],
                choices: [
                    { label: "上传参考图", description: "保持人物和产品一致性", action: "upload" },
                    { label: "改为文生图", description: "由 Agent 直接设计画面", prompt: "不使用参考图，直接设计画面" },
                ],
            },
            { workspace: "image", prompt: "生成海报", models: ["image-1"], skillIds: [] },
        );

        expect(plan?.decisions).toEqual([{ label: "模型", value: "image-1", reason: "更适合写实产品摄影" }]);
        expect(plan?.choices).toEqual([
            { label: "上传参考图", description: "保持人物和产品一致性", action: "upload" },
            { label: "改为文生图", description: "由 Agent 直接设计画面", prompt: "不使用参考图，直接设计画面", action: "prompt" },
        ]);
    });

    it("normalizes the creative foundation and material roles", () => {
        const plan = normalizeWorkbenchPlan(
            {
                foundation: { complexity: "complex", brief: { objective: "新品发布", audience: "设计从业者" }, direction: { summary: "克制科技感", keywords: ["清晰", "统一"] } },
                deliverables: [
                    { title: "主视觉", type: "image", role: "作为整套物料母版" },
                    { title: "短视频", type: "video", role: "延展动态传播" },
                ],
            },
            { workspace: "image", prompt: "做一套新品发布视觉", models: [], skillIds: [] },
        );

        expect(plan?.foundation).toMatchObject({ complexity: "complex", brief: { objective: "新品发布", audience: "设计从业者" }, direction: { summary: "克制科技感" } });
        expect(plan?.deliverables).toHaveLength(2);
    });
});

describe("parseWorkbenchPlanCall", () => {
    const input = { workspace: "image" as const, prompt: "生成商品图", models: ["image-1"], skillIds: ["commerce"] };

    it("refunds malformed JSON and returns the fallback signal", async () => {
        const refund = vi.fn().mockResolvedValue(undefined);

        await expect(parseWorkbenchPlanCall({ arguments: "{" }, input, refund)).resolves.toBeNull();
        expect(refund).toHaveBeenCalledTimes(1);
    });

    it("refunds a structurally invalid plan and returns the fallback signal", async () => {
        const refund = vi.fn().mockResolvedValue(undefined);

        await expect(parseWorkbenchPlanCall({ arguments: "[]" }, input, refund)).resolves.toBeNull();
        expect(refund).toHaveBeenCalledTimes(1);
    });

    it("keeps a valid plan without refunding", async () => {
        const refund = vi.fn().mockResolvedValue(undefined);
        const value = { parameterPatch: { model: "image-1", count: 2 }, resolvedPrompt: "商品主图", shouldGenerate: true, reply: "开始", selectedSkillIds: ["commerce"] };

        await expect(parseWorkbenchPlanCall({ arguments: JSON.stringify(value), pointsCost: 1 }, input, refund)).resolves.toEqual(normalizeWorkbenchPlan(value, input));
        expect(refund).not.toHaveBeenCalled();
    });
});
