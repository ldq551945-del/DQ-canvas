import { describe, expect, it } from "vitest";

import { nextCanvasAddMenuIndex } from "./canvas-toolbar";

describe("canvas add menu keyboard navigation", () => {
    it("lands on the wide final row from either item above it", () => {
        expect(nextCanvasAddMenuIndex(4, "ArrowDown")).toBe(6);
        expect(nextCanvasAddMenuIndex(5, "ArrowDown")).toBe(6);
    });

    it("preserves the nearest column when moving across rows", () => {
        expect(nextCanvasAddMenuIndex(6, "ArrowUp")).toBe(4);
        expect(nextCanvasAddMenuIndex(3, "ArrowUp")).toBe(1);
        expect(nextCanvasAddMenuIndex(1, "ArrowDown")).toBe(3);
    });
});
