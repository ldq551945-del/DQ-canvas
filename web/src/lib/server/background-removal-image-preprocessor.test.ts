import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { backgroundRemovalTargetSize, prepareBackgroundRemovalImage } from "./background-removal-image-preprocessor";

describe("background removal image preprocessor", () => {
    it.each([
        [2048, 1024, 2048, 1024],
        [2049, 1024, 2048, 1024],
        [1024, 2049, 1024, 2048],
        [640, 480, 640, 480],
        [8000, 8000, 2048, 2048],
    ])("fits %sx%s inside 2K", (width, height, expectedWidth, expectedHeight) => {
        expect(backgroundRemovalTargetSize(width, height)).toEqual({ width: expectedWidth, height: expectedHeight });
    });

    it("normalizes EXIF orientation, resizes and emits RGBA PNG", async () => {
        const source = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "white" } })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toBuffer();

        const result = await prepareBackgroundRemovalImage(source);
        const metadata = await sharp(result.bytes).metadata();

        expect(result).toMatchObject({ mimeType: "image/png", width: 1024, height: 2048, resized: true });
        expect(metadata).toMatchObject({ format: "png", width: 1024, height: 2048, channels: 4, hasAlpha: true });
    });

    it("does not enlarge a small image", async () => {
        const source = await sharp({ create: { width: 320, height: 180, channels: 3, background: "white" } })
            .png()
            .toBuffer();
        await expect(prepareBackgroundRemovalImage(source)).resolves.toMatchObject({ width: 320, height: 180, resized: false });
    });

    it("shrinks a source above 64 million pixels to the 2K model boundary", async () => {
        const source = await sharp({ create: { width: 8_001, height: 8_000, channels: 3, background: "white" } })
            .jpeg({ quality: 1 })
            .toBuffer();

        const result = await prepareBackgroundRemovalImage(source);

        expect(result).toMatchObject({ width: 2048, height: 2048, resized: true, mimeType: "image/png" });
        await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({ channels: 4, hasAlpha: true });
    });
});
