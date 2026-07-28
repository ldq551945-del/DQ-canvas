import { describe, expect, it } from "vitest";

import { analyzeWorkbenchRequest, buildTrustedWorkbenchBody, finalizeWorkbenchPlan, type WorkbenchRequestBody } from "./workbench-agent-policy";
import type { WorkbenchPlan } from "./workbench-agent-plan";

type AuthSettings = Parameters<typeof buildTrustedWorkbenchBody>[0];

describe("workbench agent policy", () => {
    it("rebuilds trusted model options from backend reference capabilities", () => {
        const trusted = buildTrustedWorkbenchBody(settings, {
            workspace: "video",
            models: ["forged-video"],
            referenceTypes: ["image", "audio"],
            currentConfig: { videoModel: "forged-video", size: "9:16", vquality: "720", videoSeconds: "5", apiKey: "client-secret" },
        });

        expect(trusted.models).toEqual(["video-image-audio"]);
        expect(trusted.modelOptions).toEqual([{ id: "video-image-audio", name: "图音视频模型" }]);
        expect(trusted.currentConfig).toEqual({ videoModel: "", size: "9:16", vquality: "720", videoSeconds: "5" });
        expect(trusted.hasReferences).toBe(true);
    });

    it("honors model binding capability limits over a broad channel declaration", () => {
        const restricted = structuredClone(settings);
        const model = restricted.logicalModels.find((item) => item.id === "video-image-audio");
        if (model) model.bindings[0].capabilityProfile = { supportsReferenceImage: true, supportsReferenceAudio: false };

        const trusted = buildTrustedWorkbenchBody(restricted, { workspace: "video", referenceTypes: ["image", "audio"] });

        expect(trusted.models).toEqual([]);
        expect(trusted.modelOptions).toEqual([]);
    });

    it("does not let broad portrait keywords force reference editing", () => {
        expect(analyzeWorkbenchRequest(settings, "image", "生成一张自然光人像照片")).toMatchObject({ referenceRequired: false });
        expect(analyzeWorkbenchRequest(settings, "image", "给这张照片自然美颜精修")).toMatchObject({ referenceRequired: true });
        expect(analyzeWorkbenchRequest(settings, "image", "不使用参考图，给这张照片自然美颜精修")).toMatchObject({ referenceRequired: false });
    });

    it("validates an explicit Skill separately from the user prompt", () => {
        const trusted = buildTrustedWorkbenchBody(settings, {
            workspace: "image",
            skillIds: ["portrait-retouch", "forged-skill"],
            smartPlanning: false,
            modelIds: ["image-basic"],
            currentConfig: { imageModel: "image-basic", size: "1:1", quality: "high", count: 1 },
        });
        const analysis = analyzeWorkbenchRequest(settings, "image", "把照片处理得自然一些", trusted.skillIds);

        expect(trusted.skillIds).toEqual(["portrait-retouch"]);
        expect(trusted.smartPlanning).toBe(false);
        expect(analysis.skills.map((skill) => skill.id)).toEqual(["portrait-retouch"]);
        expect(analysis).toMatchObject({ conversationOnly: false, referenceRequired: true });
    });

    it("locks the manually selected model when smart planning is disabled", () => {
        const body = buildTrustedWorkbenchBody(settings, {
            workspace: "image",
            smartPlanning: false,
            modelIds: ["image-basic"],
            currentConfig: { imageModel: "image-basic", size: "1:1", quality: "high", count: 1 },
        });
        const result = finalizeWorkbenchPlan(plan({ model: "foreign-model", size: "1:1", quality: "high", count: 1 }), {
            body,
            prompt: "生成商品图",
            workspace: "image",
            skillIds: [],
            referenceRequired: false,
            planOnly: false,
            conversationOnly: false,
        });

        expect(result.parameterPatch.model).toBe("image-basic");
        expect(result.decisions).toContainEqual(expect.objectContaining({ label: "模型", value: "基础图片模型", reason: "按你在输入区手动选择的模型执行" }));
    });

    it("keeps exact custom dimensions ahead of the planner and reference ratio", () => {
        const result = finalizeWorkbenchPlan(plan({ model: "image-basic", size: "16:9", quality: "high", count: 1 }), {
            body: { workspace: "image", currentConfig: { size: "1824x1024", referenceAspectRatio: "9:16" }, hasReferences: true, referenceTypes: ["image"] },
            prompt: "生成老虎图",
            workspace: "image",
            skillIds: [],
            referenceRequired: false,
            planOnly: false,
            conversationOnly: false,
        });

        expect(result.parameterPatch.size).toBe("1824x1024");
        expect(result.decisions).toContainEqual(expect.objectContaining({ label: "尺寸", value: "1824x1024" }));
    });

    it("lets dimensions written in the prompt override the current custom size", () => {
        const result = finalizeWorkbenchPlan(plan({ model: "image-basic", size: "16:9", quality: "high", count: 1 }), {
            body: { workspace: "image", currentConfig: { size: "1824x1024", referenceAspectRatio: "9:16" }, hasReferences: true, referenceTypes: ["image"] },
            prompt: "生成一张 1024×1536 的老虎图",
            workspace: "image",
            skillIds: [],
            referenceRequired: false,
            planOnly: false,
            conversationOnly: false,
        });

        expect(result.parameterPatch.size).toBe("1024x1536");
    });

    it("uses the same size priority for video workbench planning", () => {
        const result = finalizeWorkbenchPlan(plan({ model: "video-basic", size: "1:1", vquality: "720", videoSeconds: 5 }), {
            body: { workspace: "video", currentConfig: { size: "1824x1024", referenceAspectRatio: "9:16" }, hasReferences: true, referenceTypes: ["image"] },
            prompt: "生成视频",
            workspace: "video",
            skillIds: [],
            referenceRequired: false,
            planOnly: false,
            conversationOnly: false,
        });

        expect(result.parameterPatch.size).toBe("1824x1024");
    });

    it("does not turn a missing manual selection into the current default model", () => {
        const trusted = buildTrustedWorkbenchBody(settings, {
            workspace: "image",
            smartPlanning: false,
            currentConfig: { imageModel: "image-basic", size: "1:1", quality: "high", count: 1 },
        });

        expect(trusted.smartPlanning).toBe(false);
        expect(trusted.modelIds).toEqual([]);
        expect(trusted.models).toEqual([]);
        expect(trusted.currentConfig).toMatchObject({ imageModel: "" });
    });

    it("restricts manual multi-model planning to trusted selected models", () => {
        const body = buildTrustedWorkbenchBody(settings, {
            workspace: "video",
            smartPlanning: false,
            modelIds: ["video-basic", "video-image-audio", "forged-model"],
            currentConfig: { videoModel: "video-basic", size: "16:9", vquality: "720", videoSeconds: "5" },
        });

        expect(body.smartPlanning).toBe(false);
        expect(body.modelIds).toEqual(["video-basic", "video-image-audio"]);
        expect(body.models).toEqual(["video-basic", "video-image-audio"]);
        expect(body.modelOptions).toEqual([
            { id: "video-basic", name: "基础视频模型" },
            { id: "video-image-audio", name: "图音视频模型" },
        ]);
    });

    it("keeps ordinary questions in conversation mode even when the planner requests generation", () => {
        const analysis = analyzeWorkbenchRequest(settings, "image", "你在吗？");
        const result = finalizeWorkbenchPlan(plan({ model: "image-basic", size: "1:1", quality: "high", count: 1 }), {
            body: { workspace: "image", models: ["image-basic"], modelOptions: [{ id: "image-basic", name: "基础图片模型" }] },
            prompt: "你在吗？",
            workspace: "image",
            skillIds: [],
            referenceRequired: false,
            planOnly: false,
            conversationOnly: analysis.conversationOnly,
        });

        expect(result).toMatchObject({ intent: "conversation", shouldGenerate: false, parameterPatch: {}, referenceRequired: false, referenceMissing: false });
        expect(result.decisions).toEqual([]);
        expect(result.choices).toEqual([]);
        expect(analyzeWorkbenchRequest(settings, "image", "这个功能怎么使用？").conversationOnly).toBe(true);
        expect(analyzeWorkbenchRequest(settings, "image", "怎么生成一张商品图？").conversationOnly).toBe(false);
    });

    it("stops generation and offers safe choices when required references are missing", () => {
        const body: WorkbenchRequestBody = {
            workspace: "video",
            models: ["video-basic"],
            modelOptions: [{ id: "video-basic", name: "基础视频模型" }],
            currentConfig: { videoModel: "video-basic", size: "16:9", vquality: "720", videoSeconds: "5" },
            hasReferences: false,
            referenceTypes: [],
        };

        const result = finalizeWorkbenchPlan(plan({ model: "video-basic", size: "16:9", vquality: "720", videoSeconds: "5" }), {
            body,
            prompt: "请使用我提供的参考照片生成 5 秒视频",
            workspace: "video",
            skillIds: [],
            referenceRequired: true,
            planOnly: false,
            conversationOnly: false,
        });

        expect(result).toMatchObject({ shouldGenerate: false, referenceRequired: true, referenceMissing: true });
        expect(result.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ label: "参考素材", value: "尚未上传" })]));
        expect(result.choices).toEqual([expect.objectContaining({ label: "上传参考图", action: "upload" }), expect.objectContaining({ label: "改为无参考方案", action: "prompt" }), expect.objectContaining({ label: "先只做方案", action: "prompt" })]);
    });

    it("blocks attached references when no compatible backend model exists", () => {
        const body: WorkbenchRequestBody = { workspace: "video", models: [], modelOptions: [], currentConfig: { videoModel: "", size: "16:9" }, hasReferences: true, referenceTypes: ["image"] };

        const result = finalizeWorkbenchPlan(plan({ size: "16:9", vquality: "720", videoSeconds: "5" }), {
            body,
            prompt: "让参考图人物自然挥手",
            workspace: "video",
            skillIds: [],
            referenceRequired: false,
            planOnly: false,
            conversationOnly: false,
        });

        expect(result).toMatchObject({ shouldGenerate: false, referenceMissing: false });
        expect(result.reply).toContain("没有启用支持参考图的视频模型");
        expect(result.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ label: "参考能力", value: "参考图暂不可用" })]));
        expect(result.choices).toEqual([expect.objectContaining({ label: "改为无参考方案" }), expect.objectContaining({ label: "先只做方案" })]);
    });
});

function plan(parameterPatch: Record<string, string | number>): WorkbenchPlan {
    return {
        intent: "generation",
        foundation: { complexity: "simple", brief: { objective: "生成方案" }, direction: { summary: "清晰统一" } },
        deliverables: [{ title: "当前产物", type: "image", role: "核心画面" }],
        parameterPatch,
        resolvedPrompt: "生成方案",
        shouldGenerate: true,
        reply: "开始生成。",
        selectedSkillIds: [],
        decisions: [{ label: "模型", value: String(parameterPatch.model || "基础模型"), reason: "适合当前需求" }],
        choices: [],
    };
}

const settings = {
    defaultModels: { textModel: "planner", imageModel: "image-basic", videoModel: "video-basic", audioModel: "" },
    agentSkills: [
        {
            id: "portrait-retouch",
            name: "自然美颜精修",
            enabled: true,
            workspaces: ["image"],
            keywords: ["人像", "美颜"],
            requiresReference: true,
            action: "edit",
            defaultConfig: {},
            instructions: "保留参考人物身份",
        },
    ],
    systemChannels: [
        {
            id: "basic",
            name: "基础渠道",
            baseUrl: "https://basic.example.com/v1",
            apiKey: "server-key",
            apiFormat: "openai",
            models: ["vendor/image", "vendor/video-basic"],
            enabled: true,
            advancedConfig: { supportsReferenceImage: false, supportsReferenceVideo: false, supportsReferenceAudio: false },
        },
        {
            id: "reference",
            name: "参考渠道",
            baseUrl: "https://reference.example.com/v1",
            apiKey: "server-key",
            apiFormat: "openai",
            models: ["vendor/video-image-audio"],
            enabled: true,
            advancedConfig: { supportsReferenceImage: true, supportsReferenceVideo: false, supportsReferenceAudio: true },
        },
    ],
    logicalModels: [
        { id: "image-basic", name: "基础图片模型", capability: "image", enabled: true, bindings: [{ id: "image-basic", channelId: "basic", upstreamModel: "vendor/image", enabled: true, priority: 1 }] },
        { id: "video-basic", name: "基础视频模型", capability: "video", enabled: true, bindings: [{ id: "video-basic", channelId: "basic", upstreamModel: "vendor/video-basic", enabled: true, priority: 1 }] },
        { id: "video-image-audio", name: "图音视频模型", capability: "video", enabled: true, bindings: [{ id: "video-reference", channelId: "reference", upstreamModel: "vendor/video-image-audio", enabled: true, priority: 1 }] },
    ],
} as unknown as AuthSettings;
