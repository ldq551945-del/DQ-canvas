import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = resolve(tmpdir(), `dq-reference-asset-${process.pid}-${Date.now()}`);
const previousDataDir = process.env.DQ_DATA_DIR;
const previousProvider = process.env.DQ_DATABASE_PROVIDER;
const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

describe("reference asset store", () => {
    beforeAll(async () => {
        process.env.DQ_DATA_DIR = dataDir;
        process.env.DQ_DATABASE_PROVIDER = "file";
        await mkdir(dataDir, { recursive: true });
        vi.resetModules();
    });

    afterAll(async () => {
        if (previousDataDir === undefined) delete process.env.DQ_DATA_DIR;
        else process.env.DQ_DATA_DIR = previousDataDir;
        if (previousProvider === undefined) delete process.env.DQ_DATABASE_PROVIDER;
        else process.env.DQ_DATABASE_PROVIDER = previousProvider;
        await rm(dataDir, { recursive: true, force: true });
    });

    it("uses the registered expiry instead of the legacy 24 hour file age", async () => {
        const store = await import("./reference-asset-store");
        const storage = await import("./local-media-storage");
        const asset = await store.writeReferenceImageDataUrl(`data:image/png;base64,${PNG_BYTES.toString("base64")}`, {
            ownerUserId: "user-one",
            source: "image-task-reference",
            taskId: "task-one",
            ttlMs: 7 * 24 * 60 * 60 * 1000,
        });
        const filePath = resolve(storage.REFERENCE_MEDIA_ROOT, asset.token);
        const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        await utimes(filePath, old, old);

        await expect(store.readReferenceAsset(asset.token)).resolves.toMatchObject({ filePath, size: PNG_BYTES.length });
    });

    it("rejects executable content that forges an image data URL", async () => {
        const store = await import("./reference-asset-store");
        const forged = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");

        await expect(
            store.writeReferenceImageDataUrl(`data:image/png;base64,${forged}`, {
                ownerUserId: "user-one",
                source: "image-task-reference",
                taskId: "task-forged",
            }),
        ).rejects.toThrow("实际文件类型不正确");
    });

    it("rejects media bytes that do not match the requested capability", async () => {
        const store = await import("./reference-asset-store");

        await expect(
            store.writePersistentMediaDataUrl(`data:video/mp4;base64,${PNG_BYTES.toString("base64")}`, "video", {
                ownerUserId: "user-one",
                source: "video-task",
                taskId: "task-mismatch",
            }),
        ).rejects.toThrow("实际文件类型不正确");
    });

    it("rechecks the file signature before copying a media file", async () => {
        const store = await import("./reference-asset-store");
        const sourcePath = resolve(dataDir, "forged-video.mp4");
        await writeFile(sourcePath, "<html><script>alert(1)</script></html>", "utf8");

        await expect(
            store.writeReferenceMediaFile(sourcePath, "video", "video/mp4", true, {
                ownerUserId: "user-one",
                source: "video-task",
                taskId: "task-file-forged",
            }),
        ).rejects.toThrow("媒体文件实际类型与声明不一致");
    });
});
