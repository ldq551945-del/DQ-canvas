import { mkdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = resolve(tmpdir(), `dq-reference-asset-${process.pid}-${Date.now()}`);
const previousDataDir = process.env.DQ_DATA_DIR;
const previousProvider = process.env.DQ_DATABASE_PROVIDER;

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
        const asset = await store.writeReferenceImageDataUrl("data:image/png;base64,AAAA", {
            ownerUserId: "user-one",
            source: "image-task-reference",
            taskId: "task-one",
            ttlMs: 7 * 24 * 60 * 60 * 1000,
        });
        const filePath = resolve(storage.REFERENCE_MEDIA_ROOT, asset.token);
        const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        await utimes(filePath, old, old);

        await expect(store.readReferenceAsset(asset.token)).resolves.toMatchObject({ filePath, size: 3 });
    });
});
