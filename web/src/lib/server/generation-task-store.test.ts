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
import { createStoredGenerationTask, getStoredGenerationTask, listStoredGenerationTaskRecords, mutateStoredGenerationTask, summarizeStoredGenerationTaskCosts, withGenerationConcurrencyLimit } from "./generation-task-store";

type TestTask = {
    id: string;
    userId: string;
    status: string;
    events: string[];
    createdAt: number;
    updatedAt: number;
};

describe("mutateStoredGenerationTask", () => {
    beforeEach(() => {
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
        expect(String(pageQuery)).toContain("user_id = ANY($7::text[])");
        expect(String(pageQuery)).toContain("LIMIT $8 OFFSET $9");
        expect(pageParams).toEqual(["video", "success", "chat", "project-one", "user-one", "needle", ["user-one"], 20, 0]);
        expect(String(summaryQuery)).toContain("GROUP BY task_type, status");
        expect(summaryParams).toEqual(["video", "success", "chat", "project-one", "user-one", "needle", ["user-one"]]);
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
