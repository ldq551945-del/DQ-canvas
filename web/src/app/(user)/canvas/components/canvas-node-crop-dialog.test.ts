import { describe, expect, it } from "vitest";

import { cropKeyboardDelta, moveCrop, resizeCrop, type CanvasImageCropRect } from "./canvas-node-crop-dialog";

describe("Canvas crop keyboard controls", () => {
    it("maps arrow keys to precise and accelerated movement", () => {
        expect(cropKeyboardDelta("ArrowLeft")).toEqual({ dx: -0.01, dy: 0 });
        expect(cropKeyboardDelta("ArrowDown", true)).toEqual({ dx: 0, dy: 0.05 });
        expect(cropKeyboardDelta("Enter")).toBeNull();
    });

    it("keeps keyboard movement inside the image", () => {
        const crop: CanvasImageCropRect = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };

        expect(moveCrop(crop, -1, 1)).toEqual({ x: 0, y: 0.6, width: 0.5, height: 0.4 });
    });

    it("resizes the selected handle and preserves the minimum size", () => {
        const crop: CanvasImageCropRect = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
        const box = { width: 1000, height: 800 };

        expect(resizeCrop(crop, 0.1, 0, "e", false, box)).toMatchObject({ x: 0.1, width: 0.6 });
        expect(resizeCrop(crop, 1, 1, "nw", false, box)).toMatchObject({ width: 0.06, height: 0.06 });
    });
});
