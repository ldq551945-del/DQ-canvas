import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentRun } from "./agent-run-store";

const mocks = vi.hoisted(() => ({
    files: new Map<string, unknown>(),
    databaseProvider: "file" as "file" | "postgres",
    query: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: vi.fn(),
    getDatabaseProvider: vi.fn(() => mocks.databaseProvider),
    postgresQuery: mocks.query,
    withPostgresTransaction: mocks.transaction,
}));
vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: vi.fn(async (fileName: string, fallback: unknown) => structuredClone(mocks.files.has(fileName) ? mocks.files.get(fileName) : fallback)),
    writeJsonDataFile: vi.fn(async (fileName: string, value: unknown) => {
        mocks.files.set(fileName, structuredClone(value));
    }),
}));

import {
    appendCreativeConversationExchange,
    createCreativeConversation,
    createCreativeRunBundle,
    CreativeStoreConflict,
    getCreativeConversationContext,
    getCreativeRunByClientRequestId,
    listCreativeConversations,
    listCreativeMessages,
    listCreativeRunEvents,
    mutateCreativeRun,
    registerCreativeAssets,
} from "./creative-runtime-store";

describe("creative runtime file provider", () => {
    beforeEach(() => {
        mocks.files = new Map();
        mocks.databaseProvider = "file";
        mocks.query.mockReset();
        mocks.transaction.mockReset();
    });

    it("creates a run bundle once and keeps message sequence stable", async () => {
        const first = await createBundle(run({ id: "run-one" }));
        const duplicate = await createBundle(run({ id: "run-two" }));

        expect(first.created).toBe(true);
        expect(duplicate).toMatchObject({ created: false, run: { id: "run-one" } });
        expect(await getCreativeRunByClientRequestId<AgentRun>("user", "request-one")).toMatchObject({ id: "run-one" });
        expect(await listCreativeMessages("conversation", 0, 10)).toMatchObject([
            { sequence: 1, role: "user", status: "completed", content: "生成一张图" },
            { sequence: 2, role: "assistant", status: "running", runId: "run-one" },
        ]);
        expect((mocks.files.get("generation-tasks.json") as unknown[]).length).toBe(1);
    });

    it("replays events after a numeric cursor without duplication", async () => {
        await createBundle(run());
        await mutateCreativeRun<AgentRun>("run-one", 60_000, (current) => ({ run: { ...current, status: "running" }, event: { type: "run.running" } }), ["planning"]);

        expect((await listCreativeRunEvents("run-one")).map((event) => event.type)).toEqual(["run.created", "run.running"]);
        expect((await listCreativeRunEvents("run-one", "1")).map((event) => event.type)).toEqual(["run.running"]);
    });

    it("upserts a stable asset for the same run task and ordinal", async () => {
        await createBundle(run());
        const first = await registerCreativeAssets([
            {
                userId: "user",
                conversationId: "conversation",
                messageId: "assistant-message",
                sourceRunId: "run-one",
                sourceTaskId: "child-one",
                ordinal: 0,
                type: "image",
                title: "第一版",
                remoteUrl: "https://cdn.example.com/one.png",
                storageKind: "remote",
            },
        ]);
        const second = await registerCreativeAssets([
            {
                userId: "user",
                conversationId: "conversation",
                messageId: "assistant-message",
                sourceRunId: "run-one",
                sourceTaskId: "child-one",
                ordinal: 0,
                type: "image",
                title: "更新标题",
                remoteUrl: "https://cdn.example.com/one.png",
                storageKind: "remote",
            },
        ]);

        expect(second[0]).toMatchObject({ id: first[0].id, title: "更新标题" });
        expect((mocks.files.get("creative-runtime.json") as { assets: unknown[] }).assets).toHaveLength(1);
    });

    it("rejects foreign assets and immutable conversation scope changes", async () => {
        const foreign = await registerCreativeAssets([
            {
                userId: "other-user",
                conversationId: "other-conversation",
                sourceRunId: "other-run",
                sourceTaskId: "other-task",
                ordinal: 0,
                type: "image",
                title: "他人资产",
                remoteUrl: "https://cdn.example.com/other.png",
                storageKind: "remote",
            },
        ]);
        await expect(createBundle(run(), [foreign[0].id])).rejects.toMatchObject({ status: 403 });

        const conversation = await createCreativeConversation("user", { surface: "canvas", projectId: "project-one" });
        await expect(createBundle(run({ conversationId: conversation.id, surface: "canvas", projectId: "project-two" }), [], conversation.id)).rejects.toBeInstanceOf(CreativeStoreConflict);
    });

    it("keeps recent messages and rolls older messages into a persistent summary", async () => {
        const now = Date.now();
        mocks.files.set("creative-runtime.json", {
            version: 1,
            nextEventId: 1,
            conversations: [
                {
                    id: "conversation",
                    userId: "user",
                    surface: "chat",
                    title: "长对话",
                    status: "active",
                    contextSummary: "",
                    contextSummaryThroughSequence: 0,
                    createdAt: now,
                    updatedAt: now,
                    lastMessageAt: now,
                },
            ],
            messages: Array.from({ length: 16 }, (_, index) => ({
                id: `message-${index + 1}`,
                conversationId: "conversation",
                sequence: index + 1,
                role: index % 2 ? "assistant" : "user",
                status: "completed",
                content: `第 ${index + 1} 条历史内容`,
                metadata: {},
                createdAt: now + index,
                updatedAt: now + index,
            })),
            assets: [],
            events: [],
        });

        const first = await getCreativeConversationContext("conversation", "user");
        const second = await getCreativeConversationContext("conversation", "user");

        expect(first.recentMessages.map((item) => item.sequence)).toEqual(Array.from({ length: 12 }, (_, index) => index + 5));
        expect(first.summary).toContain("第 1 条历史内容");
        expect(first.summaryThroughSequence).toBe(4);
        expect(second).toEqual(first);
        expect((mocks.files.get("creative-runtime.json") as { conversations: Array<{ contextSummaryThroughSequence: number }> }).conversations[0].contextSummaryThroughSequence).toBe(4);
    });

    it("queries only messages newer than the persisted PostgreSQL context summary", async () => {
        mocks.databaseProvider = "postgres";
        const query = vi
            .fn()
            .mockResolvedValueOnce({
                rows: [
                    {
                        id: "conversation",
                        user_id: "user",
                        surface: "chat",
                        source: "agent",
                        title: "长对话",
                        status: "active",
                        context_summary: "已压缩内容",
                        context_summary_through_sequence: 120,
                        created_at: new Date(0),
                        updated_at: new Date(0),
                        last_message_at: new Date(0),
                    },
                ],
            })
            .mockResolvedValueOnce({ rows: [] });
        mocks.transaction.mockImplementation(async (handler: (client: { query: typeof query }) => Promise<unknown>) => handler({ query }));

        await expect(getCreativeConversationContext("conversation", "user", "current-run")).resolves.toEqual({ summary: "已压缩内容", summaryThroughSequence: 120, recentMessages: [] });

        expect(String(query.mock.calls[1]?.[0])).toContain("sequence > $3");
        expect(query.mock.calls[1]?.[1]).toEqual(["conversation", "current-run", 120]);
    });

    it("appends a workbench exchange atomically and advances the sequence", async () => {
        await createCreativeConversation("user", { surface: "chat", source: "image-workbench" });
        const conversation = (mocks.files.get("creative-runtime.json") as { conversations: Array<{ id: string }> }).conversations[0];

        const exchange = await appendCreativeConversationExchange({
            userId: "user",
            conversationId: conversation.id,
            userContent: "生成产品主图",
            assistantContent: "已选择横向商业摄影方案。",
            assistantMetadata: { workspace: "image" },
        });

        expect(exchange).toMatchObject({ userMessage: { sequence: 1, role: "user" }, assistantMessage: { sequence: 2, role: "assistant" } });
        expect(await listCreativeMessages(conversation.id)).toHaveLength(2);
        await expect(appendCreativeConversationExchange({ userId: "other", conversationId: conversation.id, userContent: "test", assistantContent: "reply" })).rejects.toMatchObject({ status: 404 });
    });

    it("is idempotent for the same request identity but keeps identical prompts from new requests", async () => {
        const conversation = await createCreativeConversation("user", { surface: "chat", source: "image-workbench" });
        const input = { userId: "user", conversationId: conversation.id, userContent: "相同提示词", assistantContent: "已收到生成需求。", runId: "request-one" };
        const first = await appendCreativeConversationExchange(input);
        const replay = await appendCreativeConversationExchange(input);
        const second = await appendCreativeConversationExchange({ ...input, runId: "request-two" });

        expect(replay).toEqual(first);
        expect(second.userMessage.id).not.toBe(first.userMessage.id);
        expect((await listCreativeMessages(conversation.id)).filter((message) => message.role === "user")).toHaveLength(2);
    });

    it("filters conversation sources before applying pagination", async () => {
        const agent = await createCreativeConversation("user", { surface: "chat", source: "agent", title: "Agent" });
        await createCreativeConversation("user", { surface: "chat", source: "image-workbench", title: "Image" });
        await createCreativeConversation("user", { surface: "chat", source: "video-workbench", title: "Video" });

        expect(await listCreativeConversations("user", { surface: "chat", source: "agent", limit: 1 })).toEqual([agent]);
    });

    it("loads the newest page first and can page backward through long conversations", async () => {
        const now = Date.now();
        mocks.files.set("creative-runtime.json", {
            version: 1,
            nextEventId: 1,
            conversations: [],
            assets: [],
            events: [],
            messages: Array.from({ length: 240 }, (_, index) => ({
                id: `message-${index + 1}`,
                conversationId: "long",
                sequence: index + 1,
                role: index % 2 ? "assistant" : "user",
                status: "completed",
                content: String(index + 1),
                metadata: {},
                createdAt: now,
                updatedAt: now,
            })),
        });

        const latest = await listCreativeMessages("long", 0, 200);
        const older = await listCreativeMessages("long", 0, 200, latest[0].sequence);

        expect(latest[0].sequence).toBe(41);
        expect(latest.at(-1)?.sequence).toBe(240);
        expect(older.map((item) => item.sequence)).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    });
});

function createBundle(value: AgentRun, assetIds: string[] = [], conversationId?: string) {
    return createCreativeRunBundle("user", { run: value, conversationId, prompt: value.prompt, title: "测试会话", assetIds, ttlMs: 60_000 });
}

function run(patch: Partial<AgentRun> = {}): AgentRun {
    const now = Date.now();
    return {
        id: "run-one",
        userId: "user",
        conversationId: "conversation",
        clientRequestId: "request-one",
        surface: "chat",
        inputMessageId: "input-message",
        assistantMessageId: "assistant-message",
        prompt: "生成一张图",
        referencedAssetIds: [],
        assetIds: [],
        status: "planning",
        tasks: [],
        reviewed: false,
        createdAt: now,
        updatedAt: now,
        ...patch,
    };
}
