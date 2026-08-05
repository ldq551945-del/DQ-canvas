import { describe, expect, it } from "vitest";

import { normalizeCanvasPerformanceMode, shouldReduceCanvasEffects } from "./canvas-performance-mode";

describe("canvas performance mode", () => {
    it("reduces effects automatically at the canvas thresholds", () => {
        const nodes = Array.from({ length: 80 }, (_, index) => ({ id: String(index), type: "text", title: "", position: { x: 0, y: 0 }, width: 1, height: 1 }) as never);
        expect(shouldReduceCanvasEffects("auto", nodes)).toBe(true);
        expect(shouldReduceCanvasEffects("quality", nodes)).toBe(false);
        expect(shouldReduceCanvasEffects("performance", [])).toBe(true);
    });

    it("normalizes unknown values to auto", () => {
        expect(normalizeCanvasPerformanceMode("quality")).toBe("quality");
        expect(normalizeCanvasPerformanceMode("invalid")).toBe("auto");
    });
});
