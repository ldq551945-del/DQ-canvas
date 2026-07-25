import { describe, expect, it } from "vitest";
import { agentChildTaskTerminal, agentTaskCopies, resolveAgentTaskCount, resolveAgentVideoSeconds, validateAgentPlan, validateAgentTaskResult } from "./agent-run-validation";

describe("validateAgentPlan", () => {
    it("accepts a bounded executable plan", () => {
        expect(() => validateAgentPlan({ objective: "商品发布", deliverables: [{ title: "主图", type: "image", prompt: "生成商品主图" }] })).not.toThrow();
    });

    it("accepts a direct conversation reply without deliverables", () => {
        expect(() => validateAgentPlan({ intent: "conversation", objective: "回答用户", reply: "在的，你可以直接告诉我需要什么。", decisions: [], deliverables: [] })).not.toThrow();
        expect(() => validateAgentPlan({ intent: "conversation", objective: "回答用户", reply: "", deliverables: [] })).toThrow("对话结果无效");
    });

    it("accepts a project handoff without new deliverables", () => {
        expect(() => validateAgentPlan({ intent: "generation", objective: "建立短剧项目", projectHandoff: { surface: "drama", title: "都市悬疑", ratio: "9:16", assetIds: ["asset-one"] }, deliverables: [] })).not.toThrow();
        expect(() => validateAgentPlan({ intent: "generation", objective: "建立项目", projectHandoff: { surface: "drama", title: "" }, deliverables: [] })).toThrow("项目交接参数无效");
    });

    it("rejects empty and oversized plans", () => {
        expect(() => validateAgentPlan({ objective: "", deliverables: [] })).toThrow();
        expect(() => validateAgentPlan({ objective: "批量生成", deliverables: Array.from({ length: 51 }, (_, index) => ({ title: String(index), type: "image", prompt: "图" })) })).toThrow();
    });

    it("accepts valid dependencies and rejects unknown ones", () => {
        expect(() =>
            validateAgentPlan({
                objective: "发布",
                deliverables: [
                    { id: "copy", title: "文案", type: "text", prompt: "写文案" },
                    { id: "image", targetNodeId: "existing-image", title: "主图", type: "image", prompt: "做图", dependencies: ["copy"] },
                ],
            }),
        ).not.toThrow();
        expect(() => validateAgentPlan({ objective: "发布", deliverables: [{ id: "image", title: "主图", type: "image", prompt: "做图", dependencies: ["missing"] }] })).toThrow("任务依赖无效");
    });

    it("accepts model choices and validates visible decision summaries", () => {
        expect(() =>
            validateAgentPlan({
                objective: "发布会视觉",
                reply: "建议先生成横版主视觉。",
                decisions: [{ label: "画幅", value: "16:9", reason: "容纳舞台和观众" }],
                deliverables: [{ title: "主视觉", type: "image", model: "image-pro", prompt: "生成发布会主视觉" }],
            }),
        ).not.toThrow();
        expect(() => validateAgentPlan({ objective: "发布会视觉", decisions: [{ label: "", value: "16:9", reason: "原因" }], deliverables: [{ title: "主视觉", type: "image", prompt: "生成" }] })).toThrow("决策摘要无效");
    });

    it("rejects duplicate task ids", () => {
        expect(() =>
            validateAgentPlan({
                objective: "发布",
                deliverables: [
                    { id: "same", title: "A", type: "text", prompt: "A" },
                    { id: "same", title: "B", type: "image", prompt: "B" },
                ],
            }),
        ).toThrow("任务依赖无效");
    });

    it("accepts multiple real media results and rejects invalid entries", () => {
        expect(() => validateAgentTaskResult("image", { results: [{ url: "https://example.com/1.png" }, { dataUrl: "data:image/png;base64,AA==" }] })).not.toThrow();
        expect(() => validateAgentTaskResult("image", { results: [{ url: "https://example.com/1.png" }, {}] })).toThrow("包含无效产物");
    });

    it("runs the configured number of image copies only", () => {
        expect(agentTaskCopies("image", 4)).toBe(4);
        expect(agentTaskCopies("image", 99)).toBe(10);
        expect(agentTaskCopies("video", 4)).toBe(1);
    });

    it("uses plan, skill, then canvas image count defaults", () => {
        expect(resolveAgentTaskCount("image", 3, 4, 5)).toBe(3);
        expect(resolveAgentTaskCount("image", undefined, 4, 5)).toBe(4);
        expect(resolveAgentTaskCount("image", undefined, undefined, 5)).toBe(5);
        expect(resolveAgentTaskCount("video", 3, 4, 5)).toBe(1);
    });

    it("recognizes child cancellation as a terminal state", () => {
        expect(agentChildTaskTerminal("cancelled")).toBe("cancelled");
        expect(agentChildTaskTerminal("canceled")).toBe("cancelled");
        expect(agentChildTaskTerminal("running")).toBeNull();
    });

    it("keeps Agent video duration aligned with the real video task range", () => {
        expect(resolveAgentVideoSeconds("video", "5", undefined, 10)).toBe(5);
        expect(resolveAgentVideoSeconds("video", 60, 10, 5)).toBe(20);
        expect(resolveAgentVideoSeconds("video", undefined, 10, 5)).toBe(10);
        expect(resolveAgentVideoSeconds("video", undefined, undefined, 6)).toBe(6);
        expect(resolveAgentVideoSeconds("image", 10, 10, 10)).toBeUndefined();
    });
});
