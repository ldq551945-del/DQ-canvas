import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    deleteAssets: vi.fn(),
    writeAsset: vi.fn(),
    removeBackground: vi.fn(),
    readMedia: vi.fn(),
    getTask: vi.fn(),
    transitionTask: vi.fn(),
    updateTask: vi.fn(),
}));

vi.mock("@/lib/server/local-media-storage", () => ({ deleteUserLocalMediaAssets: mocks.deleteAssets }));
vi.mock("@/lib/server/reference-asset-store", () => ({ writePersistentReferenceImageBuffer: mocks.writeAsset }));
vi.mock("@/lib/server/background-removal-provider", () => {
    class MockBackgroundRemovalProviderError extends Error {
        readonly status: number;
        readonly transient: boolean;

        constructor(message: string, status: number, transient: boolean) {
            super(message);
            this.name = "BackgroundRemovalProviderError";
            this.status = status;
            this.transient = transient;
        }
    }

    return { BackgroundRemovalProviderError: MockBackgroundRemovalProviderError, removeBackgroundWithRembg: mocks.removeBackground };
});
vi.mock("@/lib/server/registered-media-reader", () => ({
    BACKGROUND_REMOVAL_MAX_BYTES: 30 * 1024 * 1024,
    readRegisteredImageBytes: mocks.readMedia,
}));
vi.mock("@/lib/server/background-removal-task-store", () => ({
    getBackgroundRemovalTask: mocks.getTask,
    transitionBackgroundRemovalTask: mocks.transitionTask,
    updateBackgroundRemovalTask: mocks.updateTask,
}));

import { BackgroundRemovalProviderError } from "@/lib/server/background-removal-provider";
import { runBackgroundRemovalTaskStep } from "./background-removal-task-runtime";
import type { BackgroundRemovalTask } from "./background-removal-task-store";

describe("background removal task runtime", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTask.mockResolvedValue(task({ status: "pending" }));
        mocks.transitionTask.mockImplementation(async (current: BackgroundRemovalTask, _allowed: string[], patch: Record<string, unknown>) => ({ ...current, ...patch }));
        mocks.updateTask.mockResolvedValue(task({ status: "running" }));
        mocks.readMedia.mockResolvedValue({ bytes: Buffer.from("source"), mimeType: "image/png", width: 4, height: 2, registration: {} });
        mocks.removeBackground.mockResolvedValue({ bytes: Buffer.from("png"), mimeType: "image/png", width: 4, height: 2, model: "u2net" });
        mocks.writeAsset.mockResolvedValue({ token: "permanent/result.png", bytes: 3, mimeType: "image/png", storage: "local" });
        mocks.deleteAssets.mockResolvedValue(undefined);
    });

    it("persists a validated PNG and commits the success result", async () => {
        const result = await runBackgroundRemovalTaskStep(task());

        expect(result).toEqual({ state: "completed" });
        expect(mocks.readMedia).toHaveBeenCalledWith(expect.objectContaining({ storageKey: "source.png", ownerUserId: "user-one", maxBytes: 30 * 1024 * 1024 }));
        expect(mocks.removeBackground).toHaveBeenCalledWith(expect.objectContaining({ taskId: "process-one", bytes: Buffer.from("source"), mimeType: "image/png", width: 4, height: 2, options: expect.objectContaining({ preset: "standard" }) }));
        expect(mocks.writeAsset).toHaveBeenCalledWith(Buffer.from("png"), expect.objectContaining({ ownerUserId: "user-one", projectId: "canvas-one", taskId: "process-one" }));
        expect(mocks.transitionTask).toHaveBeenCalledWith(
            expect.objectContaining({ id: "process-one" }),
            ["pending", "running"],
            expect.objectContaining({ status: "success", model: "u2net", result: expect.objectContaining({ storageKey: "permanent/result.png", serverUrl: "/api/reference-assets/permanent/result.png", width: 4, height: 2, model: "u2net" }) }),
        );
        expect(mocks.deleteAssets).not.toHaveBeenCalled();
        expect(mocks.updateTask.mock.calls).toEqual([
            ["process-one", { progressStage: "inference", progress: 50 }],
            ["process-one", { progressStage: "saving", progress: 75 }],
        ]);
        expect(mocks.transitionTask).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "process-one" }), ["pending"], expect.objectContaining({ status: "running", progressStage: "reading_source", progress: 25 }));
        expect(mocks.transitionTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: "process-one" }), ["pending", "running"], expect.objectContaining({ status: "success", progressStage: "completed", progress: 100 }));
        expect(mocks.transitionTask.mock.invocationCallOrder[0]).toBeLessThan(mocks.readMedia.mock.invocationCallOrder[0]!);
        expect(mocks.readMedia.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateTask.mock.invocationCallOrder[0]!);
        expect(mocks.updateTask.mock.invocationCallOrder[0]).toBeLessThan(mocks.removeBackground.mock.invocationCallOrder[0]!);
        expect(mocks.removeBackground.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateTask.mock.invocationCallOrder[1]!);
        expect(mocks.updateTask.mock.invocationCallOrder[1]).toBeLessThan(mocks.writeAsset.mock.invocationCallOrder[0]!);
        expect(mocks.writeAsset.mock.invocationCallOrder[0]).toBeLessThan(mocks.transitionTask.mock.invocationCallOrder.at(-1)!);
    });

    it("retries transient provider errors with an incremented attempt", async () => {
        const running = task({ status: "running", providerAttempt: 0 });
        mocks.getTask.mockResolvedValue(running);
        const error = new BackgroundRemovalProviderError("provider unavailable", 503, true);
        mocks.removeBackground.mockRejectedValue(error);

        const result = await runBackgroundRemovalTaskStep(running);

        expect(result.state).toBe("retry");
        if (result.state !== "retry") throw new Error("expected a retry result");
        expect(result).toMatchObject({ error: "provider unavailable", attempt: 1 });
        expect(result.nextPollAt).toBeGreaterThan(Date.now() + 3_000);
        expect(mocks.updateTask).toHaveBeenLastCalledWith("process-one", { providerAttempt: 1, error: "provider unavailable", progressStage: "queued", progress: 0 });
        expect(mocks.transitionTask).not.toHaveBeenCalled();
    });

    it("reports cancellation when it wins the final failure transition", async () => {
        const running = task({ status: "running", providerAttempt: 2 });
        const cancelled = task({ status: "cancelled", providerAttempt: 3 });
        mocks.getTask.mockResolvedValueOnce(running).mockResolvedValueOnce(running).mockResolvedValueOnce(cancelled);
        mocks.removeBackground.mockRejectedValue(new BackgroundRemovalProviderError("invalid source", 422, false));
        mocks.transitionTask.mockResolvedValueOnce(null);

        const result = await runBackgroundRemovalTaskStep(running);

        expect(result).toEqual({ state: "cancelled" });
        expect(mocks.transitionTask).toHaveBeenCalledWith(expect.objectContaining({ id: "process-one" }), ["pending", "running"], expect.objectContaining({ status: "error", providerAttempt: 3 }));
    });

    it("terminates a non-transient failure at the last reached milestone", async () => {
        const running = task({ status: "running", progressStage: "inference", progress: 50 });
        mocks.getTask.mockResolvedValue(running);
        mocks.removeBackground.mockRejectedValue(new BackgroundRemovalProviderError("invalid source", 422, false));

        const result = await runBackgroundRemovalTaskStep(running);

        expect(result).toEqual({ state: "failed", error: "invalid source" });
        expect(mocks.transitionTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: "process-one" }), ["pending", "running"], expect.objectContaining({ status: "error", progressStage: "failed", progress: 50 }));
    });

    it("stops before writing an output when cancellation wins after provider completion", async () => {
        const running = task({ status: "running" });
        const cancelled = task({ status: "cancelled" });
        mocks.getTask.mockResolvedValueOnce(running).mockResolvedValueOnce(cancelled);

        const result = await runBackgroundRemovalTaskStep(running);

        expect(result).toEqual({ state: "cancelled" });
        expect(mocks.writeAsset).not.toHaveBeenCalled();
        expect(mocks.deleteAssets).not.toHaveBeenCalled();
        expect(mocks.transitionTask).not.toHaveBeenCalled();
    });

    it("deletes a written output when cancellation wins before commit", async () => {
        const running = task({ status: "running" });
        const cancelled = task({ status: "cancelled" });
        mocks.getTask.mockResolvedValueOnce(running).mockResolvedValueOnce(running).mockResolvedValueOnce(cancelled);

        const result = await runBackgroundRemovalTaskStep(running);

        expect(result).toEqual({ state: "cancelled" });
        expect(mocks.writeAsset).toHaveBeenCalledOnce();
        expect(mocks.deleteAssets).toHaveBeenCalledWith("user-one", ["permanent/result.png"]);
        expect(mocks.transitionTask).not.toHaveBeenCalled();
    });
});

function task(patch: Partial<BackgroundRemovalTask> = {}): BackgroundRemovalTask {
    return {
        id: "process-one",
        userId: "user-one",
        operation: "remove-background",
        status: "pending",
        sourceStorageKey: "source.png",
        sourceNodeId: "node-one",
        sourceMimeType: "image/png",
        sourceBytes: 6,
        sourceWidth: 4,
        sourceHeight: 2,
        options: {
            version: 3,
            model: "u2net",
            preset: "standard",
            alphaMatting: false,
            foregroundThreshold: 240,
            backgroundThreshold: 10,
            refineRange: 10,
            cleanMask: false,
            outputMode: "transparent",
            backgroundColor: [255, 255, 255, 255],
        },
        optionsHash: "fcf7c7a18cb13beeb0f8ab0fc2694ecfaff30aa0eff70aa21b0a0c569279974b",
        model: "u2net",
        providerAttempt: 0,
        surface: "canvas",
        projectId: "canvas-one",
        clientRequestId: "request-one",
        createdAt: 1,
        updatedAt: 1,
        ...patch,
    };
}
