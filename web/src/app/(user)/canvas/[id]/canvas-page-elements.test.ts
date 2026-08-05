import { describe, expect, it } from "vitest";

import { getClampedConnectionMenuPosition } from "./canvas-page-elements";

describe("connection create menu placement", () => {
    it("clamps a menu dropped past the lower-right viewport edge", () => {
        expect(getClampedConnectionMenuPosition({ x: 1000, y: 1000 }, { x: 0, y: 0, k: 1 }, { width: 900, height: 700 }, 450)).toEqual({ x: 588, y: 238 });
    });

    it("uses screen-space limits at non-unit zoom", () => {
        expect(getClampedConnectionMenuPosition({ x: -200, y: -200 }, { x: 120, y: 80, k: 0.5 }, { width: 900, height: 700 }, 450)).toEqual({ x: -200, y: -16 });
    });
});
