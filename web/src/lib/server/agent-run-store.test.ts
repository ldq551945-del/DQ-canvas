import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentRun } from "./agent-run-store";

const mocks = vi.hoisted(() => ({ mutateCreativeRun: vi.fn() }));

vi.mock("./creative-runtime-store", () => ({
    createCreativeRunBundle: vi.fn(),
    getCreativeRunByClientRequestId: vi.fn(),
    mutateCreativeRun: mocks.mutateCreativeRun,
}));
vi.mock("./generation-task-store", () => ({ getStoredGenerationTask: vi.fn(), listStoredGenerationTasks: vi.fn() }));

import { setAgentRunStatus, updateAgentRunById, updateAgentRunTaskById } from "./agent-run-store";

describe("setAgentRunStatus", () => {
    beforeEach(() => vi.clearAllMocks());

    it("settles active Canvas tasks and emits terminal node operations when cancelled", async () => {
        const run = canvasRun();
        let mutation: Record<string, unknown> | null = null;
        mocks.mutateCreativeRun.mockImplementation(async (_id, _ttl, mutate) => {
            mutation = mutate(run);
            return mutation && "run" in mutation ? mutation.run : null;
        });

        const updated = await setAgentRunStatus(run, "cancelled");

        expect(updated).toMatchObject({ status: "cancelled", tasks: [{ status: "cancelled", childTasks: [{ status: "cancelled" }] }, { status: "completed" }] });
        expect(mutation).toMatchObject({
            event: {
                type: "run.cancelled",
                data: {
                    ops: [
                        { type: "update_node", id: "task-run-0", metadata: { agentTaskStatus: "cancelled", agentTaskError: "任务已取消" } },
                        { type: "update_node", id: "output-run-0-0", metadata: { status: "cancelled", agentTaskStatus: "cancelled", errorDetails: "任务已取消" } },
                    ],
                },
            },
        });
    });

    it("merges concurrent child task and asset updates without dropping earlier results", async () => {
        let current = canvasRun();
        current = { ...current, tasks: [{ ...current.tasks[0], count: 2, status: "running", childTasks: [] }], assetIds: [] };
        const events: Array<Record<string, unknown>> = [];
        mocks.mutateCreativeRun.mockImplementation(async (_id, _ttl, mutate) => {
            const mutation = mutate(current);
            if (!mutation) return null;
            events.push(mutation.event);
            current = mutation.run;
            return current;
        });

        await Promise.all([
            updateAgentRunTaskById("run", "image", { taskIds: ["child-one"], childTasks: [{ id: "child-one", status: "completed", attempt: 1, result: { url: "one" } }], assetIds: ["asset-one"] }, "task.child.completed", "execution"),
            updateAgentRunTaskById("run", "image", { taskIds: ["child-two"], childTasks: [{ id: "child-two", status: "completed", attempt: 1, result: { url: "two" } }], assetIds: ["asset-two"] }, "task.child.completed", "execution"),
        ]);

        expect(current.assetIds).toEqual(["asset-one", "asset-two"]);
        expect(current.timings?.firstResultReadyAt).toEqual(expect.any(Number));
        expect(current.tasks[0]).toMatchObject({
            taskIds: ["child-one", "child-two"],
            assetIds: ["asset-one", "asset-two"],
            childTasks: [
                { id: "child-one", status: "completed", result: { url: "one" } },
                { id: "child-two", status: "completed", result: { url: "two" } },
            ],
        });
        expect(events).toEqual([
            expect.objectContaining({ data: expect.objectContaining({ completedCount: 1, failedCount: 0, totalCount: 2, outputNodeIds: ["output-run-0-0"] }) }),
            expect.objectContaining({ data: expect.objectContaining({ completedCount: 2, failedCount: 0, totalCount: 2, outputNodeIds: ["output-run-0-1"] }) }),
        ]);
    });

    it("marks only the failed child output and keeps successful sibling assets", async () => {
        let current = { ...canvasRun(), tasks: [{ ...canvasRun().tasks[0], count: 2, childTasks: [] }], assetIds: [] };
        const events: Array<Record<string, unknown>> = [];
        mocks.mutateCreativeRun.mockImplementation(async (_id, _ttl, mutate) => {
            const mutation = mutate(current);
            if (!mutation) return null;
            events.push(mutation.event);
            current = mutation.run;
            return current;
        });

        await updateAgentRunTaskById("run", "image", { taskIds: ["child-one"], childTasks: [{ id: "child-one", status: "completed", attempt: 1, result: { serverUrl: "/one.webp" } }], assetIds: ["asset-one"] }, "task.child.completed", "execution");
        await updateAgentRunTaskById("run", "image", { taskIds: ["child-two"], childTasks: [{ id: "child-two", status: "failed", attempt: 1, error: "上游拒绝" }] }, "task.child.failed", "execution");

        expect(current.assetIds).toEqual(["asset-one"]);
        expect(current.tasks[0].childTasks).toEqual([expect.objectContaining({ id: "child-one", status: "completed" }), expect.objectContaining({ id: "child-two", status: "failed" })]);
        expect(events[1]).toMatchObject({
            data: {
                completedCount: 1,
                failedCount: 1,
                totalCount: 2,
                outputNodeIds: ["output-run-0-1"],
                ops: [
                    { type: "update_node", id: "output-run-0-1", metadata: { status: "error", errorDetails: "上游拒绝" } },
                    { type: "update_node", id: "task-run-0", metadata: { agentTaskStatus: "running", agentTaskCompletedCount: 1, agentTaskFailedCount: 1 } },
                ],
            },
        });
    });

    it("keeps internal foundation and review out of the completed conversation message", async () => {
        const run = {
            ...canvasRun(),
            foundation: { complexity: "simple" as const, brief: { objective: "内部简报" }, direction: { summary: "内部方向" } },
            review: { mode: "text" as const, status: "passed" as const, summary: "内部复盘", issues: [], retryTaskIds: [] },
        };
        let mutation: Record<string, unknown> | null = null;
        mocks.mutateCreativeRun.mockImplementation(async (_id, _ttl, mutate) => {
            mutation = mutate(run);
            return mutation && "run" in mutation ? mutation.run : null;
        });

        await updateAgentRunById("run", { status: "completed" }, { type: "run.completed", data: { reply: "创作任务已完成。" } }, ["running"]);

        expect(mutation).toMatchObject({
            assistant: {
                status: "completed",
                content: "创作任务已完成。",
                metadata: { assetIds: [], taskIds: [] },
            },
        });
        expect((mutation as { assistant?: { metadata?: Record<string, unknown> } } | null)?.assistant?.metadata).not.toHaveProperty("foundation");
        expect((mutation as { assistant?: { metadata?: Record<string, unknown> } } | null)?.assistant?.metadata).not.toHaveProperty("review");
    });

    it("persists background review without rewriting the completed assistant message", async () => {
        const run = { ...canvasRun(), status: "completed" as const };
        let mutation: Record<string, unknown> | null = null;
        mocks.mutateCreativeRun.mockImplementation(async (_id, _ttl, mutate) => {
            mutation = mutate(run);
            return mutation && "run" in mutation ? mutation.run : null;
        });

        await updateAgentRunById("run", { reviewed: true }, { type: "run.review.background", data: { status: "passed", issueCount: 0 } }, ["completed"]);

        expect(mutation).toMatchObject({ run: { status: "completed", reviewed: true }, event: { type: "run.review.background" } });
        expect((mutation as { assistant?: unknown } | null)?.assistant).toBeUndefined();
    });
});

function canvasRun(): AgentRun {
    return {
        id: "run",
        userId: "user",
        conversationId: "conversation",
        clientRequestId: "request",
        surface: "canvas",
        projectId: "project",
        inputMessageId: "input",
        assistantMessageId: "assistant",
        prompt: "prompt",
        referencedAssetIds: [],
        assetIds: [],
        status: "running",
        executionId: "execution",
        tasks: [
            { id: "image", title: "图片", type: "image", prompt: "prompt", count: 1, dependencies: [], status: "running", attempts: 1, childTasks: [{ id: "child", status: "pending", attempt: 1 }] },
            { id: "text", title: "文案", type: "text", prompt: "prompt", count: 1, dependencies: [], status: "completed", attempts: 1 },
        ],
        reviewed: false,
        createdAt: 1,
        updatedAt: 2,
    };
}
