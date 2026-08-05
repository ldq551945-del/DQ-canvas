import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), getTask: vi.fn(), transition: vi.fn(), repair: vi.fn(), finalizeCancelled: vi.fn(), cancelProvider: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/server/background-removal-provider", () => {
    class MockBackgroundRemovalProviderError extends Error {
        constructor(
            message: string,
            readonly status: number,
            readonly transient: boolean,
        ) {
            super(message);
        }
    }
    return { BackgroundRemovalProviderError: MockBackgroundRemovalProviderError, cancelBackgroundRemovalWithRembg: mocks.cancelProvider };
});
vi.mock("@/lib/server/background-removal-task-store", () => ({ getBackgroundRemovalTask: mocks.getTask, transitionBackgroundRemovalTask: mocks.transition, publicBackgroundRemovalTask: (task: unknown) => task }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ repairUnscheduledImageProcessTask: mocks.repair, finalizeCancelledBackgroundRemovalTask: mocks.finalizeCancelled }));

import { GET, PATCH } from "./route";

const context = { params: Promise.resolve({ id: "process-one" }) };

describe("background removal task detail route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "user-one", role: "user" });
        mocks.getTask.mockResolvedValue(task());
        mocks.repair.mockResolvedValue({ id: "process-one", type: "image_process", status: "pending", nextPollAt: Date.now() });
        mocks.finalizeCancelled.mockResolvedValue({ id: "process-one", type: "image_process", status: "cancelled", executionPhase: "completed" });
        mocks.cancelProvider.mockResolvedValue({ terminated: true });
    });

    it("repairs a missing schedule without claiming the polled task", async () => {
        const response = await GET(new Request("http://localhost/api/background-removal-tasks/process-one", { headers: { cookie: "session=x" } }), context);
        expect(response.status).toBe(200);
        expect((await response.json()).data.task.id).toBe("process-one");
        expect(mocks.repair).toHaveBeenCalledWith("process-one");
    });

    it("preserves an existing future poll time without waking a targeted worker", async () => {
        mocks.repair.mockResolvedValue(null);

        const response = await GET(new Request("http://localhost/api/background-removal-tasks/process-one"), context);

        expect(response.status).toBe(200);
        expect(mocks.repair).toHaveBeenCalledWith("process-one");
    });

    it("hides foreign tasks", async () => {
        mocks.getTask.mockResolvedValue(task({ userId: "other-user" }));
        const response = await GET(new Request("http://localhost/api/background-removal-tasks/process-one"), context);
        expect(response.status).toBe(404);
    });

    it("atomically cancels an active task", async () => {
        mocks.transition.mockResolvedValue(task({ status: "cancelled", progressStage: "cancelled", progress: 50 }));
        const response = await PATCH(new Request("http://localhost/api/background-removal-tasks/process-one", { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }), context);
        expect(response.status).toBe(200);
        expect(mocks.transition).toHaveBeenCalledWith(expect.objectContaining({ id: "process-one" }), ["pending", "running"], expect.objectContaining({ status: "cancelled", progressStage: "cancelled", progress: 0 }));
        expect(mocks.cancelProvider).toHaveBeenCalledWith("process-one");
        expect(mocks.finalizeCancelled).toHaveBeenCalledWith("process-one");
        expect((await response.json()).data.task).toMatchObject({ status: "cancelled", progressStage: "cancelled", progress: 50 });
    });

    it("retries sidecar termination confirmation for an already-cancelled task", async () => {
        mocks.getTask.mockResolvedValue(task({ status: "cancelled", progressStage: "cancelled", progress: 50 }));

        const response = await PATCH(new Request("http://localhost/api/background-removal-tasks/process-one", { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }), context);

        expect(response.status).toBe(200);
        expect(mocks.transition).not.toHaveBeenCalled();
        expect(mocks.cancelProvider).toHaveBeenCalledWith("process-one");
        expect(mocks.finalizeCancelled).toHaveBeenCalledWith("process-one");
        expect((await response.json()).data.cancellationConfirmed).toBe(true);
    });

    it("confirms there is no running process when completion wins the cancellation race", async () => {
        mocks.getTask.mockResolvedValue(task({ status: "success" }));

        const response = await PATCH(new Request("http://localhost/api/background-removal-tasks/process-one", { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }), context);

        expect(response.status).toBe(200);
        expect(mocks.transition).not.toHaveBeenCalled();
        expect(mocks.cancelProvider).toHaveBeenCalledWith("process-one");
        expect(mocks.finalizeCancelled).not.toHaveBeenCalled();
        expect((await response.json()).data).toMatchObject({ cancellationConfirmed: true, task: { status: "success" } });
    });

    it("confirms termination when completion wins during the atomic cancellation update", async () => {
        mocks.getTask.mockResolvedValueOnce(task()).mockResolvedValueOnce(task({ status: "success" }));
        mocks.transition.mockResolvedValue(null);

        const response = await PATCH(new Request("http://localhost/api/background-removal-tasks/process-one", { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }), context);

        expect(response.status).toBe(200);
        expect(mocks.transition).toHaveBeenCalledOnce();
        expect(mocks.cancelProvider).toHaveBeenCalledWith("process-one");
        expect(mocks.finalizeCancelled).not.toHaveBeenCalled();
        expect((await response.json()).data).toMatchObject({ cancellationConfirmed: true, task: { status: "success" } });
    });

    it("does not claim complete termination until the sidecar acknowledges it", async () => {
        mocks.transition.mockResolvedValue(task({ status: "cancelled", progressStage: "cancelled" }));
        mocks.cancelProvider.mockRejectedValue(new Error("sidecar unavailable"));

        const response = await PATCH(new Request("http://localhost/api/background-removal-tasks/process-one", { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }), context);
        const payload = await response.json();

        expect(response.status).toBe(503);
        expect(payload.data).toMatchObject({ cancellationConfirmed: false, task: { status: "cancelled" } });
        expect(mocks.finalizeCancelled).not.toHaveBeenCalled();
        expect(payload.msg).toContain("尚未确认推理终止");
    });
});

function task(patch: Record<string, unknown> = {}) {
    return {
        id: "process-one",
        userId: "user-one",
        operation: "remove-background",
        status: "pending",
        sourceStorageKey: "permanent/source.png",
        sourceMimeType: "image/png",
        sourceBytes: 10,
        sourceWidth: 2,
        sourceHeight: 2,
        createdAt: 1,
        updatedAt: 1,
        ...patch,
    };
}
