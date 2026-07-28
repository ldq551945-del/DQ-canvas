import { describe, expect, it } from "vitest";

import { extractImageSizeFromPrompt, normalizeImageSizeValue, parseImageDimensions } from "./image-size";

describe("image size input", () => {
    it("normalizes supported dimension separators", () => {
        expect(parseImageDimensions("1080*1213")).toEqual({ width: 1080, height: 1213 });
        expect(normalizeImageSizeValue("1080×1213")).toBe("1080x1213");
    });

    it("extracts explicit image dimensions from natural-language Agent prompts", () => {
        expect(extractImageSizeFromPrompt("生成一张 1080*1213 的商品主图")).toBe("1080x1213");
        expect(extractImageSizeFromPrompt("请按宽高比 9:16 生成竖版海报")).toBe("9:16");
        expect(extractImageSizeFromPrompt("生成一张自然风格图片")).toBe("");
    });
});
