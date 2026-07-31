import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchAgentSession } from "./workbench-agent-panel";

const mocks = vi.hoisted(() => ({
    getCreativeWorkbenchSession: vi.fn(),
    listCreativeWorkbenchSessions: vi.fn(),
}));

vi.mock("@/services/api/creative", () => mocks);

import {
    findWorkbenchAgentSessionForRecord,
    loadOlderWorkbenchAgentSession,
    loadWorkbenchAgentSession,
    loadWorkbenchAgentSessions,
    mergeWorkbenchAgentSessions,
    matchesWorkbenchHistoryQuery,
    normalizeWorkbenchAgentSessions,
    removeWorkbenchAgentSessionsForRecords,
} from "./workbench-agent-session-store";

const sessions: WorkbenchAgentSession[] = [
    { id: "linked", recordId: "record-1", creativeConversationId: "conversation-1", title: "已关联", messages: [], prompt: "提示词一", lastPrompt: "提示词一", updatedAt: 2 },
    { id: "same-text", creativeConversationId: "conversation-2", title: "相同文字", messages: [], prompt: "提示词一", lastPrompt: "提示词一", updatedAt: 1 },
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
        mocks.listCreativeWorkbenchSessions.mockResolvedValue([{ id: "video-conversation", title: "生成产品视频", lastPrompt: "生成产品视频", searchText: "生成产品视频 已收到生成需求。", recordId: "video-workbench:record-1", updatedAt: 9 }]);

        const result = await loadWorkbenchAgentSessions("video", "user-1");

        expect(mocks.listCreativeWorkbenchSessions).toHaveBeenCalledWith("video");
        expect(result).toEqual([expect.objectContaining({ id: "video-conversation", recordId: "record-1", lastPrompt: "生成产品视频", searchText: "生成产品视频 已收到生成需求。", loaded: false })]);
        expect(result[0].messages).toEqual([]);
    });

    it("loads complete messages only after a history item is opened", async () => {
        mocks.getCreativeWorkbenchSession.mockResolvedValue({
            id: "video-conversation",
            recordId: "video-workbench:record-1",
            hasMore: false,
            messages: [
                {
                    id: "user-message",
                    role: "user",
                    status: "completed",
                    content: "生成产品视频",
                    metadata: {
                        workspace: "video",
                        contentVisibility: "public",
                        attachments: [{ kind: "image", name: "产品图", url: "/api/reference-assets/permanent/product.png", storageKey: "permanent/product.png", mimeType: "image/png", width: 1200, height: 800 }],
                    },
                },
                { id: "assistant-message", role: "assistant", status: "completed", content: "已收到生成需求。", metadata: { workspace: "video", contentVisibility: "public" } },
            ],
        });

        const result = await loadWorkbenchAgentSession("video", {
            id: "video-conversation",
            creativeConversationId: "video-conversation",
            title: "生成产品视频",
            messages: [],
            prompt: "",
            lastPrompt: "生成产品视频",
            updatedAt: 9,
        });

        expect(mocks.getCreativeWorkbenchSession).toHaveBeenCalledWith("video-conversation", "video");
        expect(result).toMatchObject({ recordId: "record-1", loaded: true });
        expect(result.messages).toEqual([expect.objectContaining({ role: "user", text: "生成产品视频" }), expect.objectContaining({ role: "assistant", text: "已收到生成需求。" })]);
        expect(result.messages[0].attachments).toEqual([expect.objectContaining({ storageKey: "permanent/product.png", width: 1200, height: 800 })]);
    });

    it("prepends an older page without duplicating messages", async () => {
        mocks.getCreativeWorkbenchSession.mockResolvedValue({
            id: "video-conversation",
            hasMore: false,
            nextBeforeSequence: 1,
            messages: [
                { id: "older", sequence: 1, role: "user", status: "completed", content: "最早需求", metadata: { workspace: "video", contentVisibility: "public" } },
                { id: "existing", sequence: 2, role: "assistant", status: "completed", content: "已确认", metadata: { workspace: "video", contentVisibility: "public" } },
            ],
        });

        const result = await loadOlderWorkbenchAgentSession("video", {
            id: "video-conversation",
            title: "视频会话",
            messages: [{ id: "existing", sequence: 2, role: "assistant", text: "已确认" }],
            prompt: "",
            lastPrompt: "最早需求",
            loaded: true,
            hasOlderMessages: true,
            oldestSequence: 2,
            updatedAt: 9,
        });

        expect(mocks.getCreativeWorkbenchSession).toHaveBeenCalledWith("video-conversation", "video", 2);
        expect(result.messages.map((message) => message.id)).toEqual(["older", "existing"]);
        expect(result.hasOlderMessages).toBe(false);
    });

    it("finds sessions only by record or conversation identity, never repeated prompt text", () => {
        expect(findWorkbenchAgentSessionForRecord(sessions, "record-1", "conversation-2")?.id).toBe("linked");
        expect(findWorkbenchAgentSessionForRecord(sessions, "record-2", "conversation-2")?.id).toBe("same-text");
        expect(findWorkbenchAgentSessionForRecord(sessions, "record-3", "missing")).toBeUndefined();
    });

    it("removes only sessions linked to deleted records", () => {
        expect(removeWorkbenchAgentSessionsForRecords(sessions, new Set(["record-1"])).map((session) => session.id)).toEqual(["same-text"]);
    });

    it("keeps repeated requests and does not restore a sent prompt as draft", () => {
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

        expect(session.messages.filter((message) => message.role === "user")).toHaveLength(2);
        expect(session.messages.some((message) => message.text === "正在按当前参数创建生成任务。")).toBe(false);
        expect(session.prompt).toBe("");
    });

    it("keeps a local running session when server hydration returns before its summary", () => {
        const local = {
            id: "active-session",
            creativeConversationId: "conversation-new",
            title: "生成商品图",
            messages: [{ id: "request-1-user", role: "user" as const, text: "生成商品图" }],
            prompt: "",
            lastPrompt: "生成商品图",
            updatedAt: 20,
        };

        const merged = mergeWorkbenchAgentSessions([], [local]);

        expect(merged).toEqual([local]);
    });

    it("keeps repeated text when each request used a different reference", () => {
        const [session] = normalizeWorkbenchAgentSessions([
            {
                id: "different-references",
                title: "不同参考图",
                messages: [
                    { id: "user-1", role: "user", text: "换成白发", attachments: [{ kind: "image", name: "一", url: "/api/reference-assets/permanent/one.png", storageKey: "permanent/one.png", mimeType: "image/png" }] },
                    { id: "user-2", role: "user", text: "换成白发", attachments: [{ kind: "image", name: "二", url: "/api/reference-assets/permanent/two.png", storageKey: "permanent/two.png", mimeType: "image/png" }] },
                ],
                prompt: "",
                lastPrompt: "换成白发",
                updatedAt: 1,
            },
        ]);

        expect(session.messages.filter((message) => message.role === "user")).toHaveLength(2);
    });

    it("drops any server message that is not explicitly public", async () => {
        mocks.getCreativeWorkbenchSession.mockResolvedValue({
            id: "legacy-conversation",
            hasMore: false,
            messages: [
                { id: "internal", role: "user", status: "completed", content: "内部改写提示词", metadata: { workspace: "image" } },
                { id: "public", role: "assistant", status: "completed", content: "任务正在生成", metadata: { workspace: "image", contentVisibility: "public" } },
            ],
        });

        const result = await loadWorkbenchAgentSession("image", { id: "legacy-conversation", title: "旧会话", messages: [], prompt: "", lastPrompt: "", updatedAt: 1 });

        expect(result.messages.map((message) => message.text)).toEqual(["任务正在生成"]);
    });
});
