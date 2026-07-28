import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { normalizeGeneratedImageBytes } from "./generated-image-normalizer";

describe("generated image normalization", () => {
    it("resizes an upstream image to the exact requested dimensions", async () => {
        const source = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#7c8da5" } })
            .png()
            .toBuffer();
        const result = await normalizeGeneratedImageBytes(source, "image/png", "1824x1024");

        expect(result).toMatchObject({ mimeType: "image/png", width: 1824, height: 1024 });
        await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({ format: "png", width: 1824, height: 1024 });
    });

    it("keeps the upstream file unchanged when no exact target is configured", async () => {
        const source = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#506070" } })
            .jpeg({ quality: 92 })
            .toBuffer();
        const result = await normalizeGeneratedImageBytes(source, "image/jpeg", "16:9");

        expect(result).toMatchObject({ mimeType: "image/jpeg", width: 1280, height: 720 });
        expect(result.bytes).toEqual(source);
    });

    it("rejects oversized exact dimensions before allocating an output", async () => {
        const source = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#203040" } })
            .webp()
            .toBuffer();
        await expect(normalizeGeneratedImageBytes(source, "image/webp", "5000x5000")).rejects.toThrow("目标图片尺寸无效");
    });
});
