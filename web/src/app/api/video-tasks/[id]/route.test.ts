import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    currentUser: vi.fn(),
    getVideoTask: vi.fn(),
    recover: vi.fn(),
    transition: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: vi.fn() };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/auth/store", () => ({ refundUserPoints: vi.fn() }));
vi.mock("@/lib/server/internal-origin", () => ({ fetchInternalApi: vi.fn(), resolveInternalOrigin: vi.fn(() => "http://localhost") }));
vi.mock("@/lib/server/points-response", () => ({ pointsResponseHeaders: vi.fn(() => new Headers()) }));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: mocks.recover }));
vi.mock("@/lib/server/video-task-store", () => ({
    canReconcileVideoTask: (task: { status: string; error?: string }) => task.status === "running" || (task.status === "error" && /视频生成超时|视频任务长时间未更新/.test(task.error || "")),
    getVideoTask: mocks.getVideoTask,
    transitionVideoTask: mocks.transition,
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "local-video" }) };

describe("GET /api/video-tasks/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "user", role: "user", pointsBalance: 100 });
    });

    it("returns a running task immediately and schedules a low-cost Worker wakeup", async () => {
        const task = videoTask();
        mocks.getVideoTask.mockResolvedValue(task);

        const response = await GET(new Request("http://localhost/api/video-tasks/local-video", { headers: { cookie: "session=test" } }), context);

        expect(response.status).toBe(200);
        expect(after).toHaveBeenCalledOnce();
        expect((await response.json()).task).toMatchObject({ status: "running" });
    });

    it("schedules recovery for a legacy local timeout instead of treating it as terminal", async () => {
        const task = videoTask({ status: "error", error: "视频任务长时间未更新，请重新查询或生成。" });
        mocks.getVideoTask.mockResolvedValue(task);

        await GET(new Request("http://localhost/api/video-tasks/local-video"), context);

        expect(after).toHaveBeenCalledOnce();
    });

    it.each([
        ["cancelled", "任务已取消"],
        ["error", "The output video may contain sensitive information"],
    ])("does not reconcile a %s terminal task", async (status, error) => {
        mocks.getVideoTask.mockResolvedValue(videoTask({ status, error }));

        await GET(new Request("http://localhost/api/video-tasks/local-video"), context);

        expect(after).not.toHaveBeenCalled();
    });

    it("returns the existing local state when upstream reconciliation is temporarily unavailable", async () => {
        const task = videoTask();
        mocks.getVideoTask.mockResolvedValue(task);
        const response = await GET(new Request("http://localhost/api/video-tasks/local-video"), context);

        expect(response.status).toBe(200);
        expect((await response.json()).task).toMatchObject({ status: "running" });
    });
});

import { after } from "next/server";

function videoTask(patch: Record<string, unknown> = {}) {
    return {
        id: "local-video",
        userId: "user",
        status: "running",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        config: { channelId: "channel", baseUrl: "/api/ai/system/channel", apiKey: "system", apiFormat: "openai", model: "video-model" },
        upstream: { id: "upstream-video", provider: "generation", model: "video-model" },
        requestedDurationSeconds: 5,
        ...patch,
    };
}
