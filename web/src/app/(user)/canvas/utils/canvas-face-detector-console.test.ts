import { describe, expect, it, vi } from "vitest";

import { isKnownMediaPipeDiagnostic, suppressKnownMediaPipeDiagnostics } from "./canvas-face-detector-console";

describe("MediaPipe worker diagnostics", () => {
    it.each([
        "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.",
        "W0803 14:47:14.753999 1 gl_context.cc:1118] OpenGL error checking is disabled",
        "W0803 14:47:14.812000 1 inference_feedback_manager.cc:121] Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors.",
    ])("recognizes the known non-failure diagnostic: %s", (message) => {
        expect(isKnownMediaPipeDiagnostic([message])).toBe(true);
    });

    it("keeps unrelated warnings and errors visible", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

        const restore = suppressKnownMediaPipeDiagnostics();
        console.warn("detector warning");
        console.error("detector failed");

        expect(warn).toHaveBeenCalledWith("detector warning");
        expect(error).toHaveBeenCalledWith("detector failed");
        restore();
        warn.mockRestore();
        error.mockRestore();
    });
});
