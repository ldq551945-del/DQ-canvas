import { describe, expect, it } from "vitest";

import { createFreshGenerationTaskContext } from "./generation-request-context";

describe("createFreshGenerationTaskContext", () => {
    it("creates a first attempt with a traceable request id", () => {
        expect(createFreshGenerationTaskContext("image-workbench-retry", ["log-one", "result-one"], "retry-one")).toEqual({
            attemptNo: 1,
            clientRequestId: "image-workbench-retry:log-one:result-one:retry-one",
        });
    });

    it("uses a fresh request id for every standalone retry", () => {
        const first = createFreshGenerationTaskContext("canvas-video-retry", ["project", "node"]);
        const second = createFreshGenerationTaskContext("canvas-video-retry", ["project", "node"]);

        expect(first.clientRequestId).not.toBe(second.clientRequestId);
    });
});
