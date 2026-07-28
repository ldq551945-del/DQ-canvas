import { describe, expect, it } from "vitest";

import { directAgentPlan, normalizeTasks, planToOps, readFunctionCallResult, taskResultOps } from "./agent-run-execution";
import { agentSurfaceImageSize, normalizeCanvasPlanForSelection, resolveAgentTaskRatio } from "./agent-run-task-input";

describe("directAgentPlan", () => {
    it("使用用户指定的媒体模型创建单任务计划", () => {
        const plan = directAgentPlan([{ id: "image-pro", name: "专业图片模型", capability: "image", capabilityProfile: undefined }], "生成商品主图", ["asset-one"]);

        expect(plan.deliverables).toEqual([
            expect.objectContaining({
                id: "direct-model-task-1",
                type: "image",
                model: "image-pro",
                prompt: "生成商品主图",
                assetIds: ["asset-one"],
            }),
        ]);
        expect(plan.decisions?.[0]).toMatchObject({ label: "模型", value: "专业图片模型" });
    });

    it("拒绝把文本规划模型作为直接媒体模型", () => {
        expect(() => directAgentPlan([{ id: "planner", name: "规划模型", capability: "text", capabilityProfile: undefined }], "你好", [])).toThrow("当前模型不支持直接生成媒体");
    });

    it("保留零积分文本流水用于失败时撤销套餐次数", () => {
        expect(readFunctionCallResult("{}", new Headers({ "x-vozeb-pro-points-cost": "0", "x-vozeb-pro-points-record-id": "free-agent-plan" }))).toMatchObject({ pointsCost: 0, pointsRecordId: "free-agent-plan" });
    });

    it("画布本轮选中图片会覆盖模型误选的历史编辑目标", () => {
        const plan = {
            intent: "generation",
            objective: "替换人物",
            reply: "开始替换人物",
            decisions: [],
            foundation: { complexity: "simple", brief: { objective: "替换人物" }, direction: { summary: "保持当前构图" } },
            deliverables: [{ id: "edit", title: "人物替换", type: "image", model: "image-pro", prompt: "换成黑人", count: 1, ratio: "原图比例", targetNodeId: "old-dog", dependencies: [] }],
        };
        const snapshot = {
            selectedNodeIds: ["current-person"],
            nodes: [
                { id: "old-dog", type: "image", title: "上一轮泰迪犬", metadata: { url: "/api/reference-assets/old.webp" } },
                { id: "current-person", type: "image", title: "本轮上传人物", metadata: { url: "/api/reference-assets/current.webp", naturalWidth: 360, naturalHeight: 640 } },
            ],
        };

        const [task] = normalizeTasks(plan as never, [], generationSettings() as never, snapshot, "换成黑人", "canvas", []);

        expect(task).toMatchObject({ targetNodeId: "current-person", referenceUrl: "/api/reference-assets/current.webp", referenceType: "image", ratio: "9:16" });
        expect(task.prompt).toContain("本轮上传人物");
        expect(task.prompt).not.toContain("上一轮泰迪犬");
        expect(planToOps(plan as never, [task], "run", snapshot)).toContainEqual({ type: "connect_nodes", fromNodeId: "current-person", toNodeId: "task-run-0" });
        expect(planToOps(plan as never, [task], "run", snapshot)).not.toContainEqual({ type: "connect_nodes", fromNodeId: "old-dog", toNodeId: "task-run-0" });
    });

    it("统一按文字尺寸、自定义尺寸、参考图、规划和默认值排序", () => {
        const base = { type: "image" as const, configuredImageSize: "1824x1024", reference: { type: "image" as const, width: 1024, height: 1536 }, plannedRatio: "1:1", globalSize: "4:3" };

        expect(resolveAgentTaskRatio({ ...base, requestedImageSize: "1280x720" })).toBe("1280x720");
        expect(resolveAgentTaskRatio(base)).toBe("1824x1024");
        expect(resolveAgentTaskRatio({ ...base, configuredImageSize: undefined })).toBe("2:3");
        expect(resolveAgentTaskRatio({ ...base, configuredImageSize: undefined, reference: undefined })).toBe("1:1");
        expect(resolveAgentTaskRatio({ ...base, configuredImageSize: undefined, reference: undefined, plannedRatio: undefined })).toBe("4:3");
        expect(resolveAgentTaskRatio({ ...base, type: "video" })).toBe("1824x1024");
        expect(agentSurfaceImageSize("canvas", { imageSize: "1824x1024" })).toBe("1824x1024");
        expect(agentSurfaceImageSize("canvas", { imageSize: "1:1" })).toBeUndefined();
        expect(
            agentSurfaceImageSize("canvas", {
                imageSize: "1:1",
                selectedNodeIds: ["reference"],
                nodes: [
                    { id: "config", type: "config", metadata: { size: "1824x1024" } },
                    { id: "reference", type: "image", metadata: { naturalWidth: 1024, naturalHeight: 1536 } },
                ],
            }),
        ).toBe("1824x1024");
        expect(
            agentSurfaceImageSize("canvas", {
                imageSize: "1024x1024",
                selectedNodeIds: ["config"],
                nodes: [{ id: "config", type: "config", metadata: { size: "1824x1024" } }],
            }),
        ).toBe("1824x1024");
    });

    it("短剧 Agent 使用项目自定义画幅覆盖规划画幅", () => {
        const plan = {
            intent: "generation",
            objective: "生成分镜",
            reply: "开始生成",
            decisions: [],
            foundation: { complexity: "simple", brief: { objective: "生成分镜" }, direction: { summary: "电影感" } },
            deliverables: [{ id: "shot", title: "分镜", type: "image", model: "image-pro", prompt: "雨夜车站", count: 1, ratio: "1:1", dependencies: [] }],
        };

        const [task] = normalizeTasks(plan as never, [], generationSettings() as never, { project: { ratio: "16:9" } }, "生成分镜", "drama", []);

        expect(task.ratio).toBe("16:9");
    });

    it("短剧 Agent 在没有精确自定义宽高时继承本轮参考图比例", () => {
        const plan = {
            intent: "generation",
            objective: "生成分镜",
            reply: "开始生成",
            decisions: [],
            foundation: { complexity: "simple", brief: { objective: "生成分镜" }, direction: { summary: "电影感" } },
            deliverables: [{ id: "shot", title: "分镜", type: "image", model: "image-pro", prompt: "雨夜车站", count: 1, ratio: "1:1", assetIds: ["reference"], dependencies: [] }],
        };
        const assets = [{ id: "reference", type: "image", title: "竖版参考图", width: 1080, height: 1920, serverUrl: "/api/generation-log-assets/reference.webp", metadata: {} }];

        const [task] = normalizeTasks(plan as never, [], generationSettings() as never, { project: { ratio: "16:9" } }, "生成分镜", "drama", assets as never);

        expect(task.ratio).toBe("9:16");
    });

    it("画布 Agent 使用当前自定义宽高覆盖规划画幅", () => {
        const plan = {
            intent: "generation",
            objective: "生成主视觉",
            reply: "开始生成",
            decisions: [],
            foundation: { complexity: "simple", brief: { objective: "生成主视觉" }, direction: { summary: "横版构图" } },
            deliverables: [{ id: "hero", title: "主视觉", type: "image", model: "image-pro", prompt: "中国辣妹", count: 1, ratio: "1:1", dependencies: [] }],
        };

        const [task] = normalizeTasks(plan as never, [], generationSettings() as never, { imageSize: "1824x1024", selectedNodeIds: [], nodes: [] }, "中国辣妹", "canvas", []);

        expect(task.ratio).toBe("1824x1024");
    });

    it("画布配置节点的自定义宽高覆盖选中参考图和规划画幅", () => {
        const plan = {
            intent: "generation",
            objective: "生成主视觉",
            reply: "开始生成",
            decisions: [],
            foundation: { complexity: "simple", brief: { objective: "生成主视觉" }, direction: { summary: "横版构图" } },
            deliverables: [{ id: "hero", title: "主视觉", type: "image", model: "image-pro", prompt: "中国辣妹", count: 1, ratio: "1:1", dependencies: [] }],
        };
        const snapshot = {
            imageSize: "1:1",
            selectedNodeIds: ["reference"],
            nodes: [
                { id: "config", type: "config", title: "生成配置", metadata: { size: "1824x1024" } },
                { id: "reference", type: "image", title: "参考图", metadata: { url: "/api/reference-assets/reference.webp", naturalWidth: 1024, naturalHeight: 1536 } },
            ],
        };

        const [task] = normalizeTasks(plan as never, [], generationSettings() as never, snapshot, "中国辣妹", "canvas", []);

        expect(task).toMatchObject({ ratio: "1824x1024", targetNodeId: "reference", referenceUrl: "/api/reference-assets/reference.webp" });
    });

    it("选中提示词节点时原位改写且不创建图片或计划节点", () => {
        const plan = {
            intent: "generation",
            objective: "生成紫毛小狗",
            reply: "开始生图",
            decisions: [],
            foundation: { complexity: "simple", brief: { objective: "生成紫毛小狗" }, direction: { summary: "紫色毛发" } },
            deliverables: [{ id: "image", title: "紫毛小狗", type: "image", model: "image-pro", prompt: "生成紫毛小狗", count: 1, dependencies: [] }],
        };
        const snapshot = {
            selectedNodeIds: ["prompt-one"],
            nodes: [{ id: "prompt-one", type: "text", title: "紫毛小狗提示词", metadata: { content: "一只白色小狗在草地上" } }],
        };

        const normalizedPlan = normalizeCanvasPlanForSelection(plan as never, snapshot, "帮我优化一下这个提示词");
        const [task] = normalizeTasks(normalizedPlan, [], generationSettings() as never, snapshot, "帮我优化一下这个提示词", "canvas", []);

        expect(normalizedPlan.deliverables).toEqual([expect.objectContaining({ type: "text", targetNodeId: "prompt-one" })]);
        expect(task).toMatchObject({ type: "text", targetNodeId: "prompt-one" });
        expect(task.prompt).toContain("一只白色小狗在草地上");
        expect(planToOps(normalizedPlan, [task], "run", snapshot)).toEqual([]);
        expect(taskResultOps("run", 0, { ...task, status: "completed", attempts: 1, result: { content: "一只紫色毛发的小狗在草地上" } })).toEqual({
            nodeIds: ["prompt-one"],
            ops: [
                { type: "update_node", id: "prompt-one", metadata: { content: "一只紫色毛发的小狗在草地上", prompt: "一只紫色毛发的小狗在草地上", status: "success", agentRunId: "run" } },
                { type: "select_nodes", ids: ["prompt-one"] },
            ],
        });
    });
});

function generationSettings() {
    return {
        defaultModels: { textModel: "text-pro", imageModel: "image-pro", videoModel: "", audioModel: "" },
        systemChannels: [
            { id: "image-channel", name: "图片", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", models: ["vendor/image-pro"] },
            { id: "text-channel", name: "文本", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", models: ["vendor/text-pro"] },
        ],
        logicalModels: [
            { id: "image-pro", name: "专业图片模型", capability: "image", enabled: true, bindings: [{ id: "binding-image", channelId: "image-channel", upstreamModel: "vendor/image-pro", enabled: true, priority: 1 }] },
            { id: "text-pro", name: "文本模型", capability: "text", enabled: true, bindings: [{ id: "binding-text", channelId: "text-channel", upstreamModel: "vendor/text-pro", enabled: true, priority: 1 }] },
        ],
        generationDefaults: { canvasImageCount: 1, imageSize: "1:1", imageQuality: "high", videoSeconds: 5, videoQuality: "720p", audioVoice: "alloy", audioFormat: "mp3" },
    };
}
