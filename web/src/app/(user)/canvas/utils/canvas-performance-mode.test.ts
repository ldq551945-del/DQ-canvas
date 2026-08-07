import { describe, expect, it } from "vitest";

import { canvasWebGlAvailable, normalizeCanvasPerformanceMode, shouldReduceCanvasEffects, shouldUseCanvasPerformanceFallback } from "./canvas-performance-mode";

describe("canvas performance mode", () => {
    it("reduces effects automatically at the canvas thresholds", () => {
        const nodes = Array.from({ length: 80 }, (_, index) => ({ id: String(index), type: "text", title: "", position: { x: 0, y: 0 }, width: 1, height: 1 }) as never);
        expect(shouldReduceCanvasEffects("auto", nodes)).toBe(true);
        expect(shouldReduceCanvasEffects("quality", nodes)).toBe(false);
        expect(shouldReduceCanvasEffects("performance", [])).toBe(true);
    });

    it("uses low-performance device signals only for automatic mode", () => {
        const nodes = Array.from({ length: 8 }, (_, index) => ({ id: String(index), type: "text", title: "", position: { x: 0, y: 0 }, width: 1, height: 1 }) as never);
        expect(shouldUseCanvasPerformanceFallback({ hardwareConcurrency: 2 })).toBe(true);
        expect(shouldUseCanvasPerformanceFallback({ deviceMemory: 2 })).toBe(true);
        expect(shouldUseCanvasPerformanceFallback({ saveData: true })).toBe(true);
        expect(shouldReduceCanvasEffects("auto", nodes, true)).toBe(true);
        expect(shouldReduceCanvasEffects("quality", nodes, true)).toBe(false);
    });

    it("normalizes unknown values to auto", () => {
        expect(normalizeCanvasPerformanceMode("quality")).toBe("quality");
        expect(normalizeCanvasPerformanceMode("invalid")).toBe("auto");
    });

    it("detects WebGL2 failures without throwing", () => {
        expect(canvasWebGlAvailable(() => ({ getContext: () => ({}) }))).toBe(true);
        expect(canvasWebGlAvailable(() => ({ getContext: () => null }))).toBe(false);
        expect(
            canvasWebGlAvailable(() => ({
                getContext: () => {
                    throw new Error("context unavailable");
                },
            })),
        ).toBe(false);
    });
});
