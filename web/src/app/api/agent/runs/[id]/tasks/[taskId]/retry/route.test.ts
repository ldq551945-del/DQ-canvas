import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    countActive: vi.fn(),
    executeAgentRun: vi.fn(),
    getAuthSettings: vi.fn(),
    getAgentRun: vi.fn(),
    updateAgentRunById: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: vi.fn((callback: () => unknown) => callback()) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user" })) }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings }));
vi.mock("@/lib/server/agent-run-executor", () => ({ executeAgentRun: mocks.executeAgentRun }));
vi.mock("@/lib/server/agent-run-store", () => ({ getAgentRun: mocks.getAgentRun, updateAgentRunById: mocks.updateAgentRunById }));
vi.mock("@/lib/server/generation-task-store", () => ({ withGenerationConcurrencyLimit: vi.fn(async (_userId, _type, _staleMs, limit, handler) => ((await mocks.countActive()) >= limit ? null : handler())) }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://localhost") }));

import { POST } from "./route";

describe("Agent child task retry concurrency", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAgentRun.mockResolvedValue({ id: "run", userId: "user", status: "failed", tasks: [{ id: "task", status: "failed" }] });
        mocks.countActive.mockResolvedValue(1);
        mocks.getAuthSettings.mockResolvedValue({ generationConcurrency: { agent: 1 } });
    });

    it("uses the current backend limit before changing the failed task", async () => {
        const response = await POST(new Request("http://localhost/api/agent/runs/run/tasks/task/retry", { method: "POST" }), { params: Promise.resolve({ id: "run", taskId: "task" }) });

        expect(response.status).toBe(429);
        expect(mocks.getAuthSettings).toHaveBeenCalledTimes(1);
        expect(mocks.updateAgentRunById).not.toHaveBeenCalled();
    });

    it("discards failed child task IDs before starting a new retry", async () => {
        const run = {
            id: "run",
            userId: "user",
            status: "failed",
            tasks: [
                {
                    id: "task",
                    status: "failed",
                    attempts: 3,
                    taskId: "child-failed",
                    taskIds: ["child-failed"],
                    childTasks: [{ id: "child-failed", status: "failed", attempt: 3, error: "上游超时" }],
                    error: "视频生成超时",
                },
            ],
        };
        mocks.countActive.mockResolvedValue(0);
        mocks.getAgentRun.mockResolvedValue(run);
        mocks.updateAgentRunById.mockImplementation(async (_id, patch) => ({ ...run, ...patch }));

        const response = await POST(new Request("http://localhost/api/agent/runs/run/tasks/task/retry", { method: "POST" }), { params: Promise.resolve({ id: "run", taskId: "task" }) });

        expect(response.status).toBe(200);
        const tasks = mocks.updateAgentRunById.mock.calls[0]?.[1]?.tasks;
        expect(tasks).toEqual([expect.objectContaining({ id: "task", status: "ready", attempts: 3, taskId: undefined, taskIds: undefined, childTasks: undefined, result: undefined, error: undefined })]);
        expect(mocks.executeAgentRun).toHaveBeenCalledWith(expect.objectContaining({ id: "run", status: "running", tasks }), "http://localhost", "");
    });
});
