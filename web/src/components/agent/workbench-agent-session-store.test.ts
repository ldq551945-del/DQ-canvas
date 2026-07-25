import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchAgentSession } from "./workbench-agent-panel";

const mocks = vi.hoisted(() => ({
    listCreativeAssets: vi.fn(),
    listCreativeConversations: vi.fn(),
    listCreativeMessages: vi.fn(),
}));

vi.mock("@/services/api/creative", () => mocks);

import { findWorkbenchAgentSessionForRecord, loadWorkbenchAgentSessions, matchesWorkbenchHistoryQuery, normalizeWorkbenchAgentSessions, removeWorkbenchAgentSessionsForRecords } from "./workbench-agent-session-store";

const sessions: WorkbenchAgentSession[] = [
    { id: "linked", recordId: "record-1", title: "已关联", messages: [], prompt: "提示词一", lastPrompt: "提示词一", updatedAt: 2 },
    { id: "legacy", title: "旧会话", messages: [], prompt: "旧提示词", lastPrompt: "旧提示词", updatedAt: 1 },
];

describe("工作台历史搜索", () => {
    it("matches titles and prompt or conversation content case-insensitively", () => {
        expect(matchesWorkbenchHistoryQuery("咖啡杯", "产品主图", "白色咖啡杯商业摄影")).toBe(true);
        expect(matchesWorkbenchHistoryQuery("agent", "Agent 多轮对话")).toBe(true);
        expect(matchesWorkbenchHistoryQuery("视频", "商品图片", "静物摄影")).toBe(false);
    });
});

describe("工作台会话与生成记录", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("loads video sessions only from the video workbench source", async () => {
        mocks.listCreativeConversations.mockResolvedValue([
            { id: "video-conversation", title: "视频工作台对话", updatedAt: 9 },
            { id: "other-title", title: "普通 Agent 对话", updatedAt: 8 },
        ]);
        mocks.listCreativeMessages.mockResolvedValue([
            { id: "user-message", role: "user", status: "completed", content: "生成产品视频", metadata: { workspace: "video" } },
            {
                id: "assistant-message",
                role: "assistant",
                status: "completed",
                content: "已收到生成需求。",
                metadata: { workspace: "video", workbenchPlan: { resolvedPrompt: "内部提示词", decisions: [{ label: "模型" }], foundation: { brief: {} } } },
            },
        ]);
        mocks.listCreativeAssets.mockResolvedValue([{ metadata: { generationLogId: "video-workbench:record-1" } }]);

        const result = await loadWorkbenchAgentSessions("video", "user-1");

        expect(mocks.listCreativeConversations).toHaveBeenCalledWith("video-workbench");
        expect(result).toEqual([expect.objectContaining({ id: "video-conversation", recordId: "record-1", lastPrompt: "生成产品视频" })]);
        expect(result[0].messages[1]).toEqual(expect.objectContaining({ text: "已收到生成需求。" }));
        expect(result[0].messages[1]).not.toHaveProperty("foundation");
        expect(result[0].messages[1]).not.toHaveProperty("decisions");
        expect(mocks.listCreativeMessages).toHaveBeenCalledTimes(1);
    });

    it("finds the linked session first and falls back to an exact legacy prompt", () => {
        expect(findWorkbenchAgentSessionForRecord(sessions, "record-1", "提示词一")?.id).toBe("linked");
        expect(findWorkbenchAgentSessionForRecord(sessions, "record-2", "旧提示词")?.id).toBe("legacy");
    });

    it("removes only sessions linked to deleted records", () => {
        expect(removeWorkbenchAgentSessionsForRecords(sessions, new Set(["record-1"])).map((session) => session.id)).toEqual(["legacy"]);
    });

    it("removes repeated requests and does not restore a sent prompt as draft", () => {
        const [session] = normalizeWorkbenchAgentSessions([
            {
                id: "duplicate",
                title: "重复消息",
                messages: [
                    { id: "user-1", role: "user", text: "生成发布会照片" },
                    { id: "assistant", role: "assistant", text: "正在按当前参数创建生成任务。" },
                    { id: "user-2", role: "user", text: "生成发布会照片" },
                ],
                prompt: "生成发布会照片",
                lastPrompt: "生成发布会照片",
                updatedAt: 1,
            },
        ]);

        expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
        expect(session.messages.some((message) => message.text === "正在按当前参数创建生成任务。")).toBe(false);
        expect(session.prompt).toBe("");
    });
});
