import { describe, expect, it } from "vitest";

import { publicGenerationTaskState } from "./generation-task-public-state";

describe("public generation task state", () => {
    const base = { createdAt: 1_000, updatedAt: 1_200, status: "running" };

    it.each([
        ["created", "queued"],
        ["submitting", "submitting"],
        ["submitted", "generating"],
        ["polling", "generating"],
        ["result_ready", "generating"],
        ["persisting", "generating"],
    ] as const)("maps %s to %s", (executionPhase, publicStatus) => {
        expect(publicGenerationTaskState({ ...base, executionPhase }, undefined, 2_000).publicStatus).toBe(publicStatus);
    });

    it("does not invent a progress percentage", () => {
        expect(publicGenerationTaskState({ ...base, executionPhase: "polling" }, { resultPayload: {} }, 5_000)).toMatchObject({ publicStatus: "generating", elapsedMs: 4_000 });
        expect(publicGenerationTaskState({ ...base, executionPhase: "polling" }, { resultPayload: { progress: 42 } }).progress).toBe(42);
    });

    it("protects needs review and separates retryable failures", () => {
        expect(publicGenerationTaskState({ ...base, executionPhase: "needs_review" }).publicStatus).toBe("needs_review");
        expect(publicGenerationTaskState({ ...base, status: "error", retryable: true }).publicStatus).toBe("retryable");
        expect(publicGenerationTaskState({ ...base, status: "error", retryable: false }).publicStatus).toBe("failed");
        expect(publicGenerationTaskState({ ...base, status: "cancelled" }).publicStatus).toBe("cancelled");
        expect(publicGenerationTaskState({ ...base, status: "success" }).publicStatus).toBe("succeeded");
    });

    it("keeps elapsed time moving while a submission still needs review", () => {
        expect(publicGenerationTaskState({ ...base, executionPhase: "needs_review" }, undefined, 5_000).elapsedMs).toBe(4_000);
    });
});
