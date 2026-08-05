import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createStoredTask: vi.fn() }));

vi.mock("@/lib/server/generation-task-store", () => ({
    createStoredGenerationTask: mocks.createStoredTask,
    getStoredGenerationTask: vi.fn(),
    mutateStoredGenerationTask: vi.fn(),
    transitionStoredGenerationTask: vi.fn(),
}));

import { createBackgroundRemovalTaskWithResult, publicBackgroundRemovalTask } from "./background-removal-task-store";

describe("background removal task store", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createStoredTask.mockImplementation(async (_type: string, task: unknown) => task);
    });

    it("creates a due processing task in the same persistent write", async () => {
        const before = Date.now();
        const result = await createBackgroundRemovalTaskWithResult({
            operation: "remove-background",
            sourceStorageKey: "permanent/source.png",
            sourceNodeId: "node-one",
            sourceMimeType: "image/png",
            sourceBytes: 128,
            sourceWidth: 4_096,
            sourceHeight: 4_096,
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
            optionsHash: "hash",
            model: "u2net",
            userId: "user-one",
            surface: "canvas",
            projectId: "canvas-one",
            clientRequestId: "request-one",
        });

        expect(result.created).toBe(true);
        expect(mocks.createStoredTask).toHaveBeenCalledWith(
            "image_process",
            expect.objectContaining({ id: result.task.id, status: "pending", progressStage: "queued", progress: 0 }),
            expect.any(Number),
            expect.objectContaining({ executionPhase: "submitting", provider: "rembg", nextPollAt: expect.any(Number), lastUpstreamStatus: "processing" }),
        );
        expect(mocks.createStoredTask.mock.calls[0]?.[3]?.nextPollAt).toBeGreaterThanOrEqual(before);
        expect(publicBackgroundRemovalTask(result.task)).toMatchObject({ model: "u2net", options: { model: "u2net" } });
    });
});
