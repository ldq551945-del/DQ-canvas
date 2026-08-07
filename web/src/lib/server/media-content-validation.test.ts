import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detectSafeMediaFile } from "./media-content-validation";

const MP4_BYTES = Uint8Array.from([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, 0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31]);

describe("media file validation", () => {
    it("detects an MP4 from its bounded file prefix", async () => {
        await withTempFile(MP4_BYTES, async (path) => {
            await expect(detectSafeMediaFile(path)).resolves.toEqual({ extension: "mp4", mimeType: "video/mp4", type: "video" });
        });
    });

    it("rejects text disguised as a media file", async () => {
        await withTempFile(Buffer.from("<html>not media</html>"), async (path) => {
            await expect(detectSafeMediaFile(path)).rejects.toMatchObject({ name: "UnsupportedMediaContentError" });
        });
    });
});

async function withTempFile(bytes: Uint8Array, run: (path: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), "dq-media-validation-test-"));
    try {
        const path = join(directory, "media.bin");
        await writeFile(path, bytes);
        await run(path);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
