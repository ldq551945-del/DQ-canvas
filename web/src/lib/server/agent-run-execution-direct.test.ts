import { describe, expect, it } from "vitest";

import { directAgentPlan, normalizeTasks, planToOps, readFunctionCallResult } from "./agent-run-execution";

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
            deliverables: [{ id: "edit", title: "人物替换", type: "image", model: "image-pro", prompt: "换成黑人", count: 1, targetNodeId: "old-dog", dependencies: [] }],
        };
        const snapshot = {
            selectedNodeIds: ["current-person"],
            nodes: [
                { id: "old-dog", type: "image", title: "上一轮泰迪犬", metadata: { url: "/api/reference-assets/old.webp" } },
                { id: "current-person", type: "image", title: "本轮上传人物", metadata: { url: "/api/reference-assets/current.webp" } },
            ],
        };

        const [task] = normalizeTasks(plan as never, [], generationSettings() as never, snapshot, "换成黑人", "canvas", []);

        expect(task).toMatchObject({ targetNodeId: "current-person", referenceUrl: "/api/reference-assets/current.webp", referenceType: "image" });
        expect(task.prompt).toContain("本轮上传人物");
        expect(task.prompt).not.toContain("上一轮泰迪犬");
        expect(planToOps(plan as never, [task], "run", snapshot)).toContainEqual({ type: "connect_nodes", fromNodeId: "current-person", toNodeId: "task-run-0" });
        expect(planToOps(plan as never, [task], "run", snapshot)).not.toContainEqual({ type: "connect_nodes", fromNodeId: "old-dog", toNodeId: "task-run-0" });
    });
});

function generationSettings() {
    return {
        defaultModels: { textModel: "", imageModel: "image-pro", videoModel: "", audioModel: "" },
        systemChannels: [{ id: "image-channel", name: "图片", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", models: ["vendor/image-pro"] }],
        logicalModels: [{ id: "image-pro", name: "专业图片模型", capability: "image", enabled: true, bindings: [{ id: "binding", channelId: "image-channel", upstreamModel: "vendor/image-pro", enabled: true, priority: 1 }] }],
        generationDefaults: { canvasImageCount: 1, imageSize: "1:1", imageQuality: "high", videoSeconds: 5, videoQuality: "720p", audioVoice: "alloy", audioFormat: "mp3" },
    };
}
