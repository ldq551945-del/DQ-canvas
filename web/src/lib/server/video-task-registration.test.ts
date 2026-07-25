import { describe, expect, it } from "vitest";

import { canTransitionVideoTask, sanitizeRegisteredVideoUpstream } from "./video-task-registration";

describe("sanitizeRegisteredVideoUpstream", () => {
    it("drops browser supplied billing fields", () => {
        expect(sanitizeRegisteredVideoUpstream({ id: "task-1", provider: "generation", model: "video-v1", pointsCost: 999999, pointsUnits: 999999 })).toEqual({
            id: "task-1",
            provider: "generation",
            model: "video-v1",
            pollPath: undefined,
            resultUrl: undefined,
        });
    });

    it("rejects incomplete or unsupported upstream tasks", () => {
        expect(sanitizeRegisteredVideoUpstream({ id: "", provider: "generation", model: "video-v1" })).toBeNull();
        expect(sanitizeRegisteredVideoUpstream({ id: "task-1", provider: "custom", model: "video-v1" })).toBeNull();
    });

    it("keeps video terminal states immutable", () => {
        expect(canTransitionVideoTask("running", "success")).toBe(true);
        expect(canTransitionVideoTask("running", "cancelled")).toBe(true);
        expect(canTransitionVideoTask("success", "running")).toBe(false);
        expect(canTransitionVideoTask("success", "cancelled")).toBe(false);
        expect(canTransitionVideoTask("cancelled", "running")).toBe(false);
    });
});
