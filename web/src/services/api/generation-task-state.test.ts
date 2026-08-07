import { describe, expect, it } from "vitest";

import { GenerationTaskStatePersistenceGate } from "./generation-task-state";

describe("generation task state persistence gate", () => {
    it("persists the first state, phase changes, and periodic snapshots", () => {
        const gate = new GenerationTaskStatePersistenceGate(5_000);
        const key = "task-one";

        expect(gate.shouldPersist(key, { publicStatus: "queued", executionPhase: "created" }, 1_000)).toBe(true);
        expect(gate.shouldPersist(key, { publicStatus: "queued", executionPhase: "created", elapsedMs: 2_000 }, 2_000)).toBe(false);
        expect(gate.shouldPersist(key, { publicStatus: "generating", executionPhase: "submitted" }, 2_100)).toBe(true);
        expect(gate.shouldPersist(key, { publicStatus: "generating", executionPhase: "submitted", progress: 40 }, 6_000)).toBe(false);
        expect(gate.shouldPersist(key, { publicStatus: "generating", executionPhase: "submitted", progress: 60 }, 7_100)).toBe(true);
    });

    it("can forget a completed attempt before the same key is reused", () => {
        const gate = new GenerationTaskStatePersistenceGate();
        const state = { publicStatus: "generating" as const, executionPhase: "polling" };

        expect(gate.shouldPersist("task-one", state, 1_000)).toBe(true);
        gate.forget("task-one");
        expect(gate.shouldPersist("task-one", state, 1_100)).toBe(true);
    });
});
