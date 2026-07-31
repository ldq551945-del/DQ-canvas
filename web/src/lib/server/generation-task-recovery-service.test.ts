import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    claim: vi.fn(),
    release: vi.fn(),
    renew: vi.fn(),
    schedule: vi.fn(),
    executeAgentRun: vi.fn(),
    processAgentRunReview: vi.fn(),
    getAgentRun: vi.fn(),
    getImageTask: vi.fn(),
    getVideoTask: vi.fn(),
    queryVideoTaskUpstream: vi.fn(),
}));

vi.mock("@/lib/server/generation-task-scheduler", () => ({
    claimDueGenerationTasks: mocks.claim,
    releaseGenerationTaskLease: mocks.release,
    renewGenerationTaskLeases: mocks.renew,
    scheduleGenerationTask: mocks.schedule,
    generationTaskNextPollAt: vi.fn(() => 20_000),
}));
vi.mock("@/lib/server/agent-run-executor", () => ({ executeAgentRun: mocks.executeAgentRun }));
vi.mock("@/lib/server/agent-run-execution", () => ({ processAgentRunReview: mocks.processAgentRunReview }));
vi.mock("@/lib/server/agent-run-store", () => ({ getAgentRun: mocks.getAgentRun }));
vi.mock("@/lib/server/maintenance-auth", () => ({ maintenanceWorkerContext: vi.fn((userId: string) => `worker-context:${userId}`) }));
vi.mock("@/lib/server/video-task-runtime", () => ({ failVideoTaskFromWorker: vi.fn(), persistVideoTaskResult: vi.fn(), queryVideoTaskUpstream: mocks.queryVideoTaskUpstream }));
vi.mock("@/lib/server/video-task-store", () => ({ getVideoTask: mocks.getVideoTask }));
vi.mock("@/lib/server/audio-task-runtime", () => ({ createAudioTaskUpstreamStep: vi.fn(), markAudioTaskFailed: vi.fn(), persistAudioTaskResult: vi.fn(), queryAudioTaskUpstreamStep: vi.fn() }));
vi.mock("@/lib/server/audio-task-store", () => ({ getAudioTask: vi.fn() }));
vi.mock("@/lib/server/image-task-runtime", () => ({ createImageTaskUpstreamStep: vi.fn(), markImageTaskFailed: vi.fn(), persistImageTaskResult: vi.fn(), queryImageTaskUpstreamStep: vi.fn() }));
vi.mock("@/lib/server/image-task-store", () => ({ getImageTask: mocks.getImageTask }));
vi.mock("@/lib/server/text-task-store", () => ({ getTextTask: vi.fn() }));

import { runGenerationTaskRecoveryBatch } from "./generation-task-recovery-service";

describe("generation task recovery service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.release.mockResolvedValue({});
        mocks.renew.mockResolvedValue(1);
    });

    it("returns without starting a heartbeat when no task is due", async () => {
        mocks.claim.mockResolvedValue([]);

        await expect(runGenerationTaskRecoveryBatch({ origin: "http://internal" })).resolves.toEqual({ claimed: 0, pending: 0, resultReady: 0, completed: 0, failed: 0, needsReview: 0, deferred: 0 });
        expect(mocks.release).not.toHaveBeenCalled();
    });

    it("executes an active Agent through its persisted lease and closes the terminal schedule", async () => {
        const run = { id: "agent-one", userId: "user-one", status: "planning", tasks: [], createdAt: 1_000 };
        mocks.claim.mockResolvedValue([lease()]);
        mocks.getAgentRun.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: "completed" });

        const result = await runGenerationTaskRecoveryBatch({ origin: "http://internal", workerId: "worker-one" });

        expect(mocks.executeAgentRun).toHaveBeenCalledWith(run, "http://internal", "worker-context:user-one");
        expect(mocks.release).toHaveBeenCalledWith("agent", "agent-one", "worker-one", expect.objectContaining({ executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "completed" }));
        expect(result).toMatchObject({ claimed: 1, completed: 1 });
    });

    it("does not restart a paused Agent", async () => {
        mocks.claim.mockResolvedValue([lease()]);
        mocks.getAgentRun.mockResolvedValue({ id: "agent-one", userId: "user-one", status: "paused", tasks: [], createdAt: 1_000 });

        const result = await runGenerationTaskRecoveryBatch({ origin: "http://internal", workerId: "worker-one" });

        expect(mocks.executeAgentRun).not.toHaveBeenCalled();
        expect(mocks.release).toHaveBeenCalledWith("agent", "agent-one", "worker-one", expect.objectContaining({ executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "paused" }));
        expect(result).toMatchObject({ claimed: 1, failed: 1 });
    });

    it("runs a completed Agent review from its persistent review lease", async () => {
        const run = { id: "agent-one", userId: "user-one", status: "completed", reviewed: false, reviewStatus: "review_pending", tasks: [], createdAt: 1_000 };
        mocks.claim.mockResolvedValue([{ ...lease(), status: "success", executionPhase: "review_pending" }]);
        mocks.getAgentRun.mockResolvedValue(run);
        mocks.processAgentRunReview.mockResolvedValue({ status: "completed", attempts: 1 });

        const result = await runGenerationTaskRecoveryBatch({ origin: "http://internal", workerId: "worker-one" });

        expect(mocks.executeAgentRun).not.toHaveBeenCalled();
        expect(mocks.processAgentRunReview).toHaveBeenCalledWith(run, "http://internal", "worker-context:user-one");
        expect(mocks.release).toHaveBeenCalledWith("agent", "agent-one", "worker-one", { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "review_completed" });
        expect(result).toMatchObject({ claimed: 1, completed: 1 });
    });

    it("advances an existing child task before resuming its parent Agent", async () => {
        const run = {
            id: "agent-one",
            userId: "user-one",
            status: "running",
            tasks: [{ id: "agent-task", type: "image", status: "running", taskId: "child-one", taskIds: ["child-one"], childTasks: [{ id: "child-one", status: "pending", attempt: 1 }] }],
            createdAt: 1_000,
        };
        mocks.claim.mockResolvedValueOnce([lease()]).mockResolvedValueOnce([{ ...lease(), id: "child-one", type: "image", status: "running" }]);
        mocks.getAgentRun.mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: "completed" });
        mocks.getImageTask.mockResolvedValue({ id: "child-one", userId: "user-one", status: "success" });

        const result = await runGenerationTaskRecoveryBatch({ origin: "http://internal", workerId: "worker-one" });

        expect(mocks.claim).toHaveBeenNthCalledWith(2, expect.objectContaining({ workerId: "worker-one:children", taskIds: ["child-one"], limit: 1 }));
        expect(mocks.release).toHaveBeenCalledWith("image", "child-one", "worker-one:children", expect.objectContaining({ executionPhase: "completed", nextPollAt: undefined }));
        expect(mocks.release.mock.invocationCallOrder.find((order) => order < mocks.executeAgentRun.mock.invocationCallOrder[0]!)).toBeTruthy();
        expect(mocks.executeAgentRun).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ claimed: 1, completed: 1 });
    });

    it("passes the task owner to a worker-driven video poll", async () => {
        const task = { id: "video-one", userId: "user-one", status: "running", upstream: { id: "upstream-one" }, createdAt: 1_000 };
        mocks.claim.mockResolvedValue([{ ...lease(), id: task.id, userId: task.userId, type: "video", status: "running", executionPhase: "polling", upstreamTaskId: task.upstream.id }]);
        mocks.getVideoTask.mockResolvedValue(task);
        mocks.queryVideoTaskUpstream.mockResolvedValue({ state: "pending", status: "processing" });

        const result = await runGenerationTaskRecoveryBatch({ origin: "http://internal", workerId: "worker-one" });

        expect(mocks.queryVideoTaskUpstream).toHaveBeenCalledWith(task, "http://internal", "", task.userId);
        expect(mocks.release).toHaveBeenCalledWith("video", task.id, "worker-one", expect.objectContaining({ executionPhase: "polling", lastUpstreamStatus: "processing" }));
        expect(result).toMatchObject({ claimed: 1, pending: 1 });
    });
});

function lease() {
    return {
        id: "agent-one",
        userId: "user-one",
        type: "agent",
        status: "pending",
        payload: {},
        executionPhase: "created",
        nextPollAt: 1,
        createdAt: 1_000,
        updatedAt: 1_000,
        expiresAt: 60_000,
    };
}
