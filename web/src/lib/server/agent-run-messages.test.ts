import { describe, expect, it } from "vitest";
import { agentRunCompletionReply, agentRunFailureMessage, agentTaskCompletionMessage } from "./agent-run-messages";
import type { AgentRun, AgentRunTask } from "./agent-run-store";

const task = (patch: Partial<AgentRunTask>): AgentRunTask => ({ id: "task", title: "任务", type: "text", prompt: "", count: 1, dependencies: [], status: "completed", attempts: 1, ...patch });

describe("Agent 返回文案", () => {
    it("returns generated text content to the chat", () => {
        expect(agentTaskCompletionMessage(task({ title: "文案", result: { content: "最终文案内容" } }))).toContain("最终文案内容");
    });

    it("summarizes media completion without exposing base64", () => {
        const image = task({ title: "主图", type: "image", result: { dataUrl: "data:image/png;base64,abc" } });
        const run = agentRun({ tasks: [image] });
        expect(agentRunCompletionReply(run)).toBe("已完成 1 个创作任务。\n\n「主图」已生成并返回画布。");
    });

    it("does not mention canvas for chat media completion", () => {
        const image = task({ title: "主图", type: "image", result: { url: "https://example.com/image.png" } });
        expect(agentRunCompletionReply(agentRun({ surface: "chat", projectId: undefined, tasks: [image] }))).toBe("「主图」已生成。");
    });

    it("keeps the visual review internal", () => {
        const image = task({ title: "主图", type: "image", result: { url: "https://example.com/image.png" } });
        const run = agentRun({
            tasks: [image],
            review: { mode: "visual", status: "passed", score: 91, summary: "主体、色彩和构图符合视觉方向", issues: [], retryTaskIds: [] },
        });

        expect(agentRunCompletionReply(run)).toBe("已完成 1 个创作任务。\n\n「主图」已生成并返回画布。");
        expect(agentRunCompletionReply(run)).not.toContain("视觉复盘");
        expect(agentRunCompletionReply(run)).not.toContain("91/100");
    });

    it("returns only the final text when the user explicitly asks for a text-only result", () => {
        const textTask = task({ title: "品牌口号", result: { content: "**声创未来**\n\n- 解释一\n- 解释二" } });
        const run = agentRun({ prompt: "生成四字口号，只需要文本产物", tasks: [textTask] });
        expect(agentRunCompletionReply(run)).toBe("声创未来");
    });

    it("recognizes conversational concise requests and enforces the requested character limit", () => {
        const textTask = task({ result: { content: "科技连接无限未来" } });
        const run = agentRun({ prompt: "直接给我6字以内答案，别啰嗦", tasks: [textTask] });
        expect(agentRunCompletionReply(run)).toBe("科技连接无限");
    });

    it("preserves the first failed task cause instead of replacing it with a dependency error", () => {
        expect(agentRunFailureMessage([task({ title: "辣妹图", status: "failed", error: "模型 gpt-image-2-4k 暂不可用" }), task({ title: "配套视频", status: "ready", dependencies: ["task"] })])).toBe("「辣妹图」失败：模型 gpt-image-2-4k 暂不可用");
    });
});

function agentRun(patch: Partial<AgentRun> = {}): AgentRun {
    return {
        id: "run",
        userId: "user",
        conversationId: "conversation",
        clientRequestId: "request",
        surface: "canvas",
        projectId: "project",
        inputMessageId: "input-message",
        assistantMessageId: "assistant-message",
        prompt: "",
        referencedAssetIds: [],
        assetIds: [],
        status: "completed",
        tasks: [],
        reviewed: true,
        createdAt: 1,
        updatedAt: 1,
        ...patch,
    };
}
