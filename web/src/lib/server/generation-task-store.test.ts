import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ records: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: vi.fn(),
    getDatabaseProvider: vi.fn(() => "file"),
    postgresQuery: vi.fn(),
    withPostgresTransaction: vi.fn(),
}));
vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: vi.fn(async () => structuredClone(mocks.records)),
    writeJsonDataFile: vi.fn(async (_fileName: string, value: Array<Record<string, unknown>>) => {
        mocks.records = structuredClone(value);
    }),
}));

import { getDatabaseProvider, postgresQuery } from "@/lib/server/database";
import {
    createStoredGenerationTask,
    getActiveStoredGenerationTaskBySourceNode,
    getStoredGenerationTask,
    getStoredGenerationTaskByUpstream,
    listStoredGenerationTaskRecords,
    mutateStoredGenerationTask,
    summarizeStoredGenerationTaskCosts,
    withGenerationConcurrencyLimit,
} from "./generation-task-store";

type TestTask = {
    id: string;
    userId: string;
    status: string;
    events: string[];
    createdAt: number;
    updatedAt: number;
};

describe("getStoredGenerationTaskByUpstream", () => {
    beforeEach(() => {
        vi.mocked(getDatabaseProvider).mockReturnValue("file");
        vi.mocked(postgresQuery).mockReset();
        const now = Date.now();
        const record = (id: string, userId: string, type: string, channelId: string, upstreamTaskId: string, updatedAt: number) => ({
            id,
            userId,
            type,
            channelId,
            upstreamTaskId,
            status: "running",
            payload: { id, config: { model: "vendor-video" } },
            createdAt: now,
            updatedAt,
            expiresAt: now + 60_000,
        });
        mocks.records = [
            record("owned-latest", "user", "video", "channel", "upstream", now + 1),
            record("owned-old", "user", "video", "channel", "upstream", now),
            record("other-user", "other", "video", "channel", "upstream", now + 2),
            record("other-channel", "user", "video", "other", "upstream", now + 3),
        ];
    });

    it("matches owner, type, channel and upstream id exactly in the file provider", async () => {
        await expect(getStoredGenerationTaskByUpstream("video", "user", "channel", "upstream")).resolves.toMatchObject({ id: "owned-latest" });
        await expect(getStoredGenerationTaskByUpstream("image", "user", "channel", "upstream")).resolves.toBeNull();
        await expect(getStoredGenerationTaskByUpstream("video", "other", "channel", "missing")).resolves.toBeNull();
    });

    it("uses all four ownership fields in PostgreSQL", async () => {
        vi.mocked(getDatabaseProvider).mockReturnValue("postgres");
        vi.mocked(postgresQuery).mockResolvedValue({ rows: [] } as never);

        await expect(getStoredGenerationTaskByUpstream("video", "user", "channel", "upstream")).resolves.toBeNull();

        const [query, values] = vi.mocked(postgresQuery).mock.calls[0] || [];
        expect(String(query)).toMatch(/user_id = \$1[\s\S]*task_type = \$2[\s\S]*channel_id = \$3[\s\S]*upstream_task_id = \$4/);
        expect(values).toEqual(["user", "video", "channel", "upstream"]);
    });
});

describe("mutateStoredGenerationTask", () => {
    beforeEach(() => {
        vi.mocked(getDatabaseProvider).mockReturnValue("file");
        vi.mocked(postgresQuery).mockReset();
        const now = Date.now();
        mocks.records = [
            {
                id: "agent-one",
                userId: "user",
                type: "agent",
                status: "running",
                payload: { id: "agent-one", userId: "user", status: "running", events: [], createdAt: now, updatedAt: now },
                createdAt: now,
                updatedAt: now,
                expiresAt: now + 60_000,
            },
        ];
    });

    it("serializes file mutations so concurrent events are not lost", async () => {
        await Promise.all([
            mutateStoredGenerationTask<TestTask>("agent", "agent-one", 60_000, (current) => ({ ...current, events: [...current.events, "first"] })),
            mutateStoredGenerationTask<TestTask>("agent", "agent-one", 60_000, (current) => ({ ...current, events: [...current.events, "second"] })),
        ]);

        expect((mocks.records[0].payload as TestTask).events).toEqual(["first", "second"]);
    });

    it("serializes concurrency checks with task creation", async () => {
        mocks.records = [];
        const create = (id: string) =>
            withGenerationConcurrencyLimit("user", "video", 60_000, 1, async () => {
                const now = Date.now();
                mocks.records.unshift({ id, userId: "user", type: "video", status: "pending", payload: {}, executionPhase: "created", createdAt: now, updatedAt: now, expiresAt: now + 60_000 });
                return id;
            });

        await expect(Promise.all([create("video-one"), create("video-two")])).resolves.toEqual(["video-one", null]);
        expect(mocks.records).toHaveLength(1);
    });

    it("does not let tasks awaiting manual review consume generation capacity", async () => {
        const now = Date.now();
        mocks.records = [
            {
                id: "image-review",
                userId: "user",
                type: "image",
                status: "running",
                executionPhase: "needs_review",
                payload: {},
                createdAt: now,
                updatedAt: now,
                expiresAt: now + 60_000,
            },
        ];

        await expect(withGenerationConcurrencyLimit("user", "image", 60_000, 1, async () => "image-retry")).resolves.toBe("image-retry");
    });

    it("deduplicates the same request attempt but allows a later retry attempt", async () => {
        mocks.records = [];
        const now = Date.now();
        const first = await createStoredGenerationTask("video", { id: "video-one", userId: "user", status: "pending", clientRequestId: "request-one", attemptNo: 1, createdAt: now, updatedAt: now }, 60_000);
        const duplicate = await createStoredGenerationTask("video", { id: "video-duplicate", userId: "user", status: "pending", clientRequestId: "request-one", attemptNo: 1, createdAt: now, updatedAt: now }, 60_000);
        const retry = await createStoredGenerationTask("video", { id: "video-retry", userId: "user", status: "pending", clientRequestId: "request-one", attemptNo: 2, createdAt: now, updatedAt: now }, 60_000);

        expect(first.id).toBe("video-one");
        expect(duplicate.id).toBe("video-one");
        expect(retry.id).toBe("video-retry");
        expect(mocks.records).toHaveLength(2);
        expect(mocks.records.every((record) => record.executionPhase === "created")).toBe(true);
    });

    it("keeps only one active image processing task for the same canvas node", async () => {
        mocks.records = [];
        const now = Date.now();
        const first = await createStoredGenerationTask("image_process", { id: "process-one", userId: "user", status: "pending", projectId: "canvas-one", sourceNodeId: "node-one", createdAt: now, updatedAt: now }, 60_000);
        const duplicate = await createStoredGenerationTask("image_process", { id: "process-two", userId: "user", status: "pending", projectId: "canvas-one", sourceNodeId: "node-one", createdAt: now, updatedAt: now }, 60_000);

        expect(first.id).toBe("process-one");
        expect(duplicate.id).toBe("process-one");
        expect(mocks.records).toHaveLength(1);
    });

    it("persists an image processing schedule in the same file write as task creation", async () => {
        mocks.records = [];
        const now = Date.now();

        await createStoredGenerationTask("image_process", { id: "process-scheduled", userId: "user", status: "pending", projectId: "canvas-one", sourceNodeId: "node-one", createdAt: now, updatedAt: now }, 60_000, {
            executionPhase: "submitting",
            provider: "rembg",
            nextPollAt: now,
            lastUpstreamStatus: "processing",
        });

        expect(mocks.records[0]).toMatchObject({ executionPhase: "submitting", provider: "rembg", nextPollAt: now, lastUpstreamStatus: "processing" });
    });

    it("inserts an initial schedule atomically in PostgreSQL", async () => {
        const now = Date.now();
        vi.mocked(getDatabaseProvider).mockReturnValue("postgres");
        vi.mocked(postgresQuery)
            .mockResolvedValueOnce({ rows: [] } as never)
            .mockResolvedValueOnce({ rows: [{ payload: { id: "process-scheduled" } }] } as never);

        await createStoredGenerationTask("image_process", { id: "process-scheduled", userId: "user", status: "pending", projectId: "canvas-one", sourceNodeId: "node-one", createdAt: now, updatedAt: now }, 60_000, {
            executionPhase: "submitting",
            provider: "rembg",
            nextPollAt: now,
            lastUpstreamStatus: "processing",
        });

        const [query, values] = vi.mocked(postgresQuery).mock.calls[1] || [];
        expect(String(query)).toContain("execution_phase, provider, next_poll_at, last_upstream_status");
        expect(values).toEqual(expect.arrayContaining(["submitting", "rembg", new Date(now), "processing"]));
        vi.mocked(postgresQuery).mockClear();
        vi.mocked(getDatabaseProvider).mockReturnValue("file");
    });

    it("keeps distinct canvas submissions for the same source node while preserving both node bindings", async () => {
        mocks.records = [];
        const now = Date.now();
        const first = await createStoredGenerationTask(
            "video",
            { id: "video-one", userId: "user", status: "pending", projectId: "canvas-one", sourceNodeId: "source-one", targetNodeId: "target-one", clientRequestId: "submission-one", createdAt: now, updatedAt: now },
            60_000,
        );
        const second = await createStoredGenerationTask(
            "video",
            { id: "video-two", userId: "user", status: "pending", projectId: "canvas-one", sourceNodeId: "source-one", targetNodeId: "target-one", clientRequestId: "submission-two", createdAt: now, updatedAt: now + 1 },
            60_000,
        );

        expect(first.id).toBe("video-one");
        expect(second.id).toBe("video-two");
        expect(mocks.records).toHaveLength(2);
        expect(mocks.records.map((record) => record.payload)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ sourceNodeId: "source-one", targetNodeId: "target-one", clientRequestId: "submission-one" }),
                expect.objectContaining({ sourceNodeId: "source-one", targetNodeId: "target-one", clientRequestId: "submission-two" }),
            ]),
        );
    });

    it("keeps source-node deduplication scoped to its canvas project", async () => {
        mocks.records = [];
        const now = Date.now();
        const first = await createStoredGenerationTask("image_process", { id: "process-one", userId: "user", status: "pending", projectId: "canvas-one", sourceNodeId: "node-one", createdAt: now, updatedAt: now }, 60_000);
        const otherProject = await createStoredGenerationTask("image_process", { id: "process-two", userId: "user", status: "pending", projectId: "canvas-two", sourceNodeId: "node-one", createdAt: now, updatedAt: now }, 60_000);

        expect(first.id).toBe("process-one");
        expect(otherProject.id).toBe("process-two");
        expect(mocks.records).toHaveLength(2);
    });

    it("selects the newest active source-node task in file storage", async () => {
        const now = Date.now();
        mocks.records = [
            {
                id: "process-old",
                userId: "user",
                type: "image_process",
                status: "running",
                payload: { id: "process-old", sourceNodeId: "node-one" },
                projectId: "canvas-one",
                createdAt: now - 2_000,
                updatedAt: now - 2_000,
                expiresAt: now + 60_000,
            },
            {
                id: "process-new",
                userId: "user",
                type: "image_process",
                status: "pending",
                payload: { id: "process-new", sourceNodeId: "node-one" },
                projectId: "canvas-one",
                createdAt: now - 1_000,
                updatedAt: now - 1_000,
                expiresAt: now + 60_000,
            },
        ];

        await expect(getActiveStoredGenerationTaskBySourceNode<{ id: string }>("image_process", "user", "node-one", "canvas-one")).resolves.toEqual({ id: "process-new", sourceNodeId: "node-one" });
    });

    it("orders PostgreSQL source-node matches by update time and id", async () => {
        vi.mocked(getDatabaseProvider).mockReturnValue("postgres");
        vi.mocked(postgresQuery).mockResolvedValueOnce({ rows: [{ payload: { id: "process-new" } }] } as never);

        await expect(getActiveStoredGenerationTaskBySourceNode<{ id: string }>("image_process", "user", "node-one", "canvas-one")).resolves.toEqual({ id: "process-new" });
        expect(String(vi.mocked(postgresQuery).mock.calls[0]?.[0])).toContain("ORDER BY updated_at DESC, id DESC");
        vi.mocked(postgresQuery).mockClear();
        vi.mocked(getDatabaseProvider).mockReturnValue("file");
    });
});

describe("listStoredGenerationTaskRecords", () => {
    it("matches file-provider tasks through resolved public user ids", async () => {
        vi.mocked(getDatabaseProvider).mockReturnValue("file");
        const now = Date.now();
        mocks.records = [
            { id: "task-one", userId: "user-one", type: "image", status: "success", payload: { prompt: "first" }, createdAt: now, updatedAt: now, expiresAt: now + 60_000 },
            { id: "task-two", userId: "user-two", type: "image", status: "success", payload: { prompt: "second" }, createdAt: now, updatedAt: now, expiresAt: now + 60_000 },
        ];

        const result = await listStoredGenerationTaskRecords({ search: "0001", searchUserIds: ["user-one"], includeAll: false });

        expect(result.items.map((item) => item.id)).toEqual(["task-one"]);
    });

    it("filters active statuses before paging so terminal tasks cannot hide a running task", async () => {
        vi.mocked(getDatabaseProvider).mockReturnValue("file");
        const now = Date.now();
        mocks.records = [
            { id: "recent-success", userId: "user-one", type: "image", status: "success", payload: {}, surface: "canvas", projectId: "canvas-one", createdAt: now, updatedAt: now + 2, expiresAt: now + 60_000 },
            { id: "older-running", userId: "user-one", type: "video", status: "running", payload: {}, surface: "canvas", projectId: "canvas-one", createdAt: now, updatedAt: now + 1, expiresAt: now + 60_000 },
        ];

        const result = await listStoredGenerationTaskRecords({ surface: "canvas", projectId: "canvas-one", userId: "user-one", statuses: ["pending", "running", "paused"], page: 1, pageSize: 1, includeAll: false });

        expect(result.total).toBe(1);
        expect(result.items.map((item) => item.id)).toEqual(["older-running"]);
    });

    it("pushes PostgreSQL filters, pagination and aggregate summary into database queries", async () => {
        vi.mocked(getDatabaseProvider).mockReturnValue("postgres");
        vi.mocked(postgresQuery)
            .mockResolvedValueOnce({
                rows: [
                    {
                        id: "task-one",
                        user_id: "user-one",
                        task_type: "video",
                        status: "success",
                        surface: "chat",
                        project_id: "project-one",
                        payload: { prompt: "needle" },
                        created_at: new Date(1),
                        updated_at: new Date(2),
                        expires_at: new Date(Date.now() + 60_000),
                        total_count: "1",
                    },
                ],
            } as never)
            .mockResolvedValueOnce({ rows: [{ task_type: "video", status: "success", total: "1", completed_total: "1", duration_total_ms: "1", points_cost: "3" }] } as never);

        const result = await listStoredGenerationTaskRecords({ page: 1, pageSize: 20, type: "video", status: "success", surface: "chat", projectId: "project-one", userId: "user-one", search: "needle", searchUserIds: ["user-one"], includeAll: false });
        const [pageQuery, pageParams] = vi.mocked(postgresQuery).mock.calls[0] || [];
        const [summaryQuery, summaryParams] = vi.mocked(postgresQuery).mock.calls[1] || [];

        expect(String(pageQuery)).toContain("payload::text ILIKE");
        expect(String(pageQuery)).toContain("status = ANY($3::text[])");
        expect(String(pageQuery)).toContain("user_id = ANY($8::text[])");
        expect(String(pageQuery)).toContain("LIMIT $9 OFFSET $10");
        expect(pageParams).toEqual(["video", "success", [], "chat", "project-one", "user-one", "needle", ["user-one"], 20, 0]);
        expect(String(summaryQuery)).toContain("GROUP BY task_type, status");
        expect(summaryParams).toEqual(["video", "success", [], "chat", "project-one", "user-one", "needle", ["user-one"]]);
        expect(result).toMatchObject({ total: 1, items: [{ id: "task-one", type: "video" }], all: [], summary: { total: 1, totalPointsCost: 3 } });
    });
});

describe("summarizeStoredGenerationTaskCosts", () => {
    it("aggregates project costs in PostgreSQL without loading task payload rows", async () => {
        vi.mocked(getDatabaseProvider).mockReturnValue("postgres");
        vi.mocked(postgresQuery).mockClear();
        vi.mocked(postgresQuery).mockResolvedValueOnce({
            rows: [
                { task_type: "image", status: "success", task_count: "2", estimated_points: "4", actual_points: "3.5" },
                { task_type: "video", status: "error", task_count: "1", estimated_points: "8", actual_points: "0" },
            ],
        } as never);

        const result = await summarizeStoredGenerationTaskCosts({ userId: "user-one", projectId: "project-one", types: ["image", "video", "image"] });
        const [statement, params] = vi.mocked(postgresQuery).mock.calls[0] || [];

        expect(String(statement)).toContain("GROUP BY task_type, status");
        expect(String(statement)).not.toContain("LIMIT 5000");
        expect(String(statement)).toContain("nullif(sum(");
        expect(String(statement)).toContain("attempt->>'status' IN ('succeeded', 'success')");
        expect(params).toEqual(["user-one", "project-one", ["image", "video"]]);
        expect(result).toEqual([
            { type: "image", status: "success", taskCount: 2, estimatedPoints: 4, actualPoints: 3.5 },
            { type: "video", status: "error", taskCount: 1, estimatedPoints: 8, actualPoints: 0 },
        ]);
    });
});
