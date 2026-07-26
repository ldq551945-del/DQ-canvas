import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    provider: "postgres" as "postgres" | "file",
    ensurePostgresSchema: vi.fn(),
    postgresQuery: vi.fn(),
    readRuntimeFile: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: mocks.ensurePostgresSchema,
    getDatabaseProvider: () => mocks.provider,
    postgresQuery: mocks.postgresQuery,
}));
vi.mock("@/lib/server/creative-runtime-repository", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./creative-runtime-repository")>();
    return { ...actual, readRuntimeFile: mocks.readRuntimeFile };
});

import { getCreativeWorkbenchSessionDetail, listCreativeWorkbenchSessionSummaries } from "./creative-workbench-session-store";

describe("creative workbench session summaries", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.provider = "postgres";
    });

    it("returns PostgreSQL summaries with one bounded query", async () => {
        mocks.postgresQuery.mockResolvedValue({
            rows: [
                {
                    id: "conversation-one",
                    title: "图片工作台对话",
                    updated_at: new Date("2026-07-26T00:00:00.000Z"),
                    first_prompt: "生成咖啡商品图",
                    last_prompt: "改成暖色",
                    search_text: "生成咖啡商品图 已完成 改成暖色",
                    record_id: "image-workbench:record-one",
                },
            ],
        });

        const result = await listCreativeWorkbenchSessionSummaries("user-one", "image", 101);

        expect(mocks.postgresQuery).toHaveBeenCalledTimes(1);
        expect(String(mocks.postgresQuery.mock.calls[0][0])).toContain("WITH scoped_conversations");
        expect(mocks.postgresQuery.mock.calls[0][1]).toEqual(["user-one", "image-workbench", 101, "image", 4000]);
        expect(result).toEqual([expect.objectContaining({ id: "conversation-one", title: "生成咖啡商品图", lastPrompt: "改成暖色", recordId: "image-workbench:record-one" })]);
    });

    it("keeps the same summary contract for the file provider", async () => {
        mocks.provider = "file";
        mocks.readRuntimeFile.mockResolvedValue({
            conversations: [{ id: "conversation-one", userId: "user-one", surface: "chat", source: "video-workbench", status: "active", title: "视频工作台对话", updatedAt: 9 }],
            messages: [
                { id: "message-one", conversationId: "conversation-one", sequence: 1, role: "user", content: "生成商品视频", metadata: { workspace: "video" } },
                { id: "message-two", conversationId: "conversation-one", sequence: 2, role: "assistant", content: "已创建任务", metadata: { workspace: "video" } },
            ],
            assets: [{ conversationId: "conversation-one", userId: "user-one", status: "ready", createdAt: 5, ordinal: 0, metadata: { generationLogId: "record-one" } }],
        });

        await expect(listCreativeWorkbenchSessionSummaries("user-one", "video", 100)).resolves.toEqual([
            expect.objectContaining({ id: "conversation-one", recordId: "record-one", title: "生成商品视频", lastPrompt: "生成商品视频", searchText: "生成商品视频 已创建任务" }),
        ]);
        expect(mocks.postgresQuery).not.toHaveBeenCalled();
        expect(mocks.readRuntimeFile).toHaveBeenCalledTimes(1);
    });

    it("loads one owned conversation detail with one PostgreSQL query", async () => {
        mocks.postgresQuery.mockResolvedValue({
            rows: [
                {
                    id: "conversation-one",
                    record_id: "record-one",
                    has_more: true,
                    next_before_sequence: 1,
                    messages: [
                        {
                            id: "message-one",
                            conversation_id: "conversation-one",
                            sequence: 1,
                            role: "user",
                            status: "completed",
                            content: "生成商品图",
                            metadata: { workspace: "image" },
                            created_at: new Date("2026-07-26T00:00:00.000Z"),
                            updated_at: new Date("2026-07-26T00:00:00.000Z"),
                        },
                    ],
                },
            ],
        });

        const result = await getCreativeWorkbenchSessionDetail("user-one", "conversation-one", "image");

        expect(mocks.postgresQuery).toHaveBeenCalledTimes(1);
        expect(mocks.postgresQuery.mock.calls[0][1]).toEqual(["conversation-one", "user-one", "image-workbench", "image", 0, 51, 50]);
        expect(result).toEqual(expect.objectContaining({ id: "conversation-one", recordId: "record-one", hasMore: true, nextBeforeSequence: 1, messages: [expect.objectContaining({ content: "生成商品图" })] }));
    });
});
