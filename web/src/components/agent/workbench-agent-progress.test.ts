import { describe, expect, it } from "vitest";

import { appendWorkbenchAgentRequest, applyWorkbenchAgentPlan, createWorkbenchAgentProgressMessage, updateWorkbenchAgentProgress, workbenchAgentProgressSteps } from "./workbench-agent-progress";

describe("workbench Agent progress", () => {
    it("shows the progressive creative stages", () => {
        expect(workbenchAgentProgressSteps({ phase: "planning", hasReferences: false }).map((step) => [step.label, step.status])).toEqual([["理解当前需求与参考素材", "running"]]);
        expect(workbenchAgentProgressSteps({ phase: "submitting", hasReferences: true, intent: "generation" }).map((step) => step.label)).toEqual(["理解当前需求与参考素材", "检查创作约束", "准备生成任务", "创建生成任务", "整理生成结果"]);
    });

    it("completes planning without claiming a generation task when generation is not requested", () => {
        expect(workbenchAgentProgressSteps({ phase: "completed", hasReferences: false, shouldGenerate: false, intent: "generation" }).map((step) => step.label)).toEqual(["理解当前需求与参考素材", "检查创作约束", "准备生成任务"]);
    });

    it("shows reference inspection when the request requires a missing reference", () => {
        expect(workbenchAgentProgressSteps({ phase: "completed", hasReferences: false, referenceRequired: true, shouldGenerate: false, intent: "generation" }).map((step) => step.label)).toEqual(["理解当前需求与参考素材", "检查创作约束", "准备生成任务"]);
    });

    it("shows a single completed understanding step for ordinary conversation", () => {
        expect(workbenchAgentProgressSteps({ phase: "completed", hasReferences: false, shouldGenerate: false, intent: "conversation" }).map((step) => [step.label, step.status])).toEqual([["理解当前需求与参考素材", "completed"]]);
    });

    it("marks the real failure boundary and preserves unrelated messages", () => {
        const progress = createWorkbenchAgentProgressMessage("progress", false);
        const messages = [{ id: "user", role: "user" as const, text: "生成商品图" }, progress];
        const next = updateWorkbenchAgentProgress(messages, "progress", { phase: "failed", hasReferences: false, shouldGenerate: true, failedAt: "submitting" }, "任务创建失败");

        expect(next[0]).toBe(messages[0]);
        expect(next[1]).toMatchObject({ role: "error", text: "任务创建失败" });
        expect(workbenchAgentProgressSteps(next[1].progress!).find((step) => step.status === "failed")?.label).toBe("创建生成任务");
    });

    it("marks cancelled execution at the real boundary", () => {
        const progress = createWorkbenchAgentProgressMessage("progress", false);
        const next = updateWorkbenchAgentProgress([progress], "progress", { phase: "cancelled", hasReferences: false, shouldGenerate: true, failedAt: "submitting" }, "本次生成已取消");

        expect(next[0]).toMatchObject({ role: "warning", text: "本次生成已取消" });
        expect(workbenchAgentProgressSteps(next[0].progress!).find((step) => step.status === "cancelled")?.label).toBe("创建生成任务");
    });

    it("replaces thinking progress with the final Agent reply", () => {
        const progress = createWorkbenchAgentProgressMessage("progress", false);
        const next = applyWorkbenchAgentPlan([progress], "progress", "我建议使用横版构图。", [{ label: "使用横版", description: "保留环境信息" }]);

        expect(next).toHaveLength(1);
        expect(next[0]).toMatchObject({ id: "progress", role: "assistant", text: "我建议使用横版构图。", choices: [{ label: "使用横版" }] });
        expect(next[0]).not.toHaveProperty("decisions");
        expect(next[0].progress).toBeUndefined();
    });

    it("does not repeat the same user request when replanning", () => {
        const progress = createWorkbenchAgentProgressMessage("progress", false);
        const messages = [
            { id: "user", role: "user" as const, text: "生成商品图" },
            { id: "assistant", role: "assistant" as const, text: "请补充素材" },
        ];

        expect(appendWorkbenchAgentRequest(messages, "生成商品图", [], progress).filter((item) => item.role === "user")).toHaveLength(1);
        expect(appendWorkbenchAgentRequest(messages, "换成竖版", [], progress).filter((item) => item.role === "user")).toHaveLength(2);
    });

    it("keeps the current-turn reference snapshot and does not deduplicate the same text with a different image", () => {
        const first = { kind: "image" as const, name: "人物一", url: "/api/reference-assets/permanent/one.png", storageKey: "permanent/one.png", mimeType: "image/png" };
        const second = { kind: "image" as const, name: "人物二", url: "/api/reference-assets/permanent/two.png", storageKey: "permanent/two.png", mimeType: "image/png" };
        const firstMessages = appendWorkbenchAgentRequest([], "换成白发", [first], createWorkbenchAgentProgressMessage("first", true));
        const next = appendWorkbenchAgentRequest(firstMessages, "换成白发", [second], createWorkbenchAgentProgressMessage("second", true));

        expect(next.filter((item) => item.role === "user")).toHaveLength(2);
        expect(next.find((item) => item.id === "first-user")?.attachments).toEqual([first]);
        expect(next.find((item) => item.id === "second-user")?.attachments).toEqual([second]);
    });
});
