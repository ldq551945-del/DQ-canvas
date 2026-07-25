import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";

import { createLocalMediaResponse, requestedImageVariant } from "./local-media-response";

const directory = resolve(tmpdir(), `vozeb-pro-media-response-${process.pid}-${Date.now()}`);
const filePath = resolve(directory, "sample.mp4");
const imagePath = resolve(directory, "sample.png");

describe("local media response", () => {
    beforeAll(async () => {
        await mkdir(directory, { recursive: true });
        await writeFile(filePath, Buffer.from("0123456789"));
        await sharp({ create: { width: 128, height: 64, channels: 4, background: "#38a169" } })
            .png()
            .toFile(imagePath);
    });

    afterAll(() => rm(directory, { recursive: true, force: true }));

    it("streams the whole file without loading it into a response buffer", async () => {
        const response = await createLocalMediaResponse(new Request("http://localhost/media"), filePath, "video/mp4");
        expect(response?.status).toBe(200);
        expect(response?.headers.get("content-length")).toBe("10");
        expect(response?.headers.get("cross-origin-resource-policy")).toBe("same-site");
        expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response?.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
        expect(await response?.text()).toBe("0123456789");
    });

    it("streams only the requested byte range", async () => {
        const response = await createLocalMediaResponse(new Request("http://localhost/media", { headers: { range: "bytes=2-5" } }), filePath, "video/mp4");
        expect(response?.status).toBe(206);
        expect(response?.headers.get("content-range")).toBe("bytes 2-5/10");
        expect(await response?.text()).toBe("2345");
    });

    it("rejects malformed ranges instead of streaming the whole file", async () => {
        const response = await createLocalMediaResponse(new Request("http://localhost/media", { headers: { range: "bytes=invalid" } }), filePath, "video/mp4");
        expect(response?.status).toBe(416);
        expect(response?.headers.get("content-range")).toBe("bytes */10");
    });

    it("returns a bounded WebP variant for display", async () => {
        const response = await createLocalMediaResponse(new Request("http://localhost/media?format=webp&width=64"), imagePath, "image/png");
        const body = Buffer.from(await response!.arrayBuffer());
        const metadata = await sharp(body).metadata();
        expect(response?.headers.get("content-type")).toBe("image/webp");
        expect(response?.headers.get("content-disposition")).toContain("sample.webp");
        expect(metadata).toMatchObject({ format: "webp", width: 64, height: 32 });
    });

    it("normalizes arbitrary preview widths to finite transform variants", () => {
        expect(requestedImageVariant(new Request("http://localhost/media?format=webp"), "image/png")).toEqual({ format: "webp", width: 1600 });
        expect(requestedImageVariant(new Request("http://localhost/media?format=webp&width=65"), "image/png")).toEqual({ format: "webp", width: 96 });
        expect(requestedImageVariant(new Request("http://localhost/media?format=webp&width=903"), "image/png")).toEqual({ format: "webp", width: 960 });
        expect(requestedImageVariant(new Request("http://localhost/media?format=webp&width=999999"), "image/png")).toEqual({ format: "webp", width: 2048 });
    });

    it("returns the untouched original image as an attachment for download", async () => {
        const response = await createLocalMediaResponse(new Request("http://localhost/media?download=original", { headers: { accept: "image/webp", "sec-fetch-dest": "image" } }), imagePath, "image/png", {
            "Content-Disposition": 'inline; filename="uploaded-image.png"',
        });
        const body = Buffer.from(await response!.arrayBuffer());
        const metadata = await sharp(body).metadata();
        expect(response?.headers.get("content-type")).toBe("image/png");
        expect(response?.headers.get("content-disposition")).toBe('attachment; filename="uploaded-image.png"');
        expect(body.equals(await readFile(imagePath))).toBe(true);
        expect(metadata).toMatchObject({ format: "png", width: 128, height: 64 });
    });

    it("uses WebP automatically for browser image requests and supports conditional cache hits", async () => {
        const request = new Request("http://localhost/media", { headers: { accept: "image/avif,image/webp,*/*", "sec-fetch-dest": "image" } });
        const response = await createLocalMediaResponse(request, imagePath, "image/png");
        expect(response?.headers.get("content-type")).toBe("image/webp");
        const etag = response?.headers.get("etag") || "";
        const cached = await createLocalMediaResponse(new Request("http://localhost/media", { headers: { accept: "image/webp", "sec-fetch-dest": "image", "if-none-match": etag } }), imagePath, "image/png");
        expect(cached?.status).toBe(304);
        expect(cached?.headers.get("x-content-type-options")).toBe("nosniff");
    });
});
