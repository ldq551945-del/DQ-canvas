import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutboundUrl: mocks.safeFetch }));

import { downloadMediaToFile } from "./media-download";

const MP4_BYTES = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32]);
const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

beforeEach(() => vi.clearAllMocks());

describe("media download", () => {
    it("uses the detected video type instead of a forged response header", async () => {
        mocks.safeFetch.mockResolvedValueOnce(new Response(MP4_BYTES, { headers: { "content-type": "text/html" } }));

        await withTempFile(async (path) => {
            await expect(downloadMediaToFile("https://cdn.example/result", path, { origin: "http://internal", maxBytes: 1024, expectedType: "video" })).resolves.toEqual({ bytes: MP4_BYTES.byteLength, mimeType: "video/mp4" });
            await expect(readFile(path)).resolves.toEqual(Buffer.from(MP4_BYTES));
        });
    });

    it("rejects HTML that only claims to be video", async () => {
        mocks.safeFetch.mockResolvedValueOnce(new Response("<html>not video</html>", { headers: { "content-type": "video/mp4" } }));

        await withTempFile(async (path) => {
            await expect(downloadMediaToFile("https://cdn.example/result", path, { origin: "http://internal", maxBytes: 1024, expectedType: "video" })).rejects.toThrow("Unsupported media content");
        });
    });

    it("rejects a valid image when the caller expects video", async () => {
        mocks.safeFetch.mockResolvedValueOnce(new Response(new Uint8Array(PNG_BYTES), { headers: { "content-type": "video/mp4" } }));

        await withTempFile(async (path) => {
            await expect(downloadMediaToFile("https://cdn.example/result", path, { origin: "http://internal", maxBytes: 1024, expectedType: "video" })).rejects.toThrow("应为视频");
        });
    });
});

async function withTempFile(run: (path: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), "dq-media-download-test-"));
    try {
        await run(join(directory, "media.bin"));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
