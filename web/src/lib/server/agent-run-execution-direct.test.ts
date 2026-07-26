import { describe, expect, it } from "vitest";

import { directAgentPlan, readFunctionCallResult } from "./agent-run-execution";

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
});
