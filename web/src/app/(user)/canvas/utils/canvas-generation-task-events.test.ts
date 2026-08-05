import { afterEach, describe, expect, it, vi } from "vitest";

import { CANVAS_GENERATION_TASK_CREATED_EVENT, notifyCanvasGenerationTaskCreated } from "./canvas-generation-task-events";

describe("notifyCanvasGenerationTaskCreated", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("notifies the active canvas project as soon as a task is created", () => {
        const dispatchEvent = vi.fn();
        vi.stubGlobal("window", { dispatchEvent });
        vi.stubGlobal(
            "CustomEvent",
            class {
                constructor(
                    readonly type: string,
                    readonly init: { detail: { projectId: string } },
                ) {}
            },
        );

        notifyCanvasGenerationTaskCreated("canvas-one");

        expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: CANVAS_GENERATION_TASK_CREATED_EVENT, init: { detail: { projectId: "canvas-one" } } }));
    });

    it("does not emit a projectless event", () => {
        const dispatchEvent = vi.fn();
        vi.stubGlobal("window", { dispatchEvent });

        notifyCanvasGenerationTaskCreated("");

        expect(dispatchEvent).not.toHaveBeenCalled();
    });
});
