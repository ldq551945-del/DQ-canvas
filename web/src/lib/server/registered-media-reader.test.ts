import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ registration: null as Record<string, unknown> | null, objectBytes: vi.fn(), config: { enabled: true } }));

vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: vi.fn(async () => mocks.registration) }));
vi.mock("@/lib/server/object-storage-client", () => ({ getObjectBytes: mocks.objectBytes }));
vi.mock("@/lib/server/object-storage-config", () => ({ getObjectStorageRuntimeConfig: vi.fn(async () => mocks.config) }));

import { REFERENCE_MEDIA_ROOT } from "./local-media-storage";
import { readRegisteredImageBytes, RegisteredMediaReadError } from "./registered-media-reader";

describe("registered media reader", () => {
    const key = "permanent/2026/08/03/images/20260803-010203-00000000-0000-0000-0000-000000000000.png";
    const filePath = resolve(REFERENCE_MEDIA_ROOT, key);

    beforeEach(async () => {
        vi.clearAllMocks();
        const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: "white" } })
            .png()
            .toBuffer();
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, bytes);
        mocks.registration = registration({ bytes: bytes.length });
    });

    afterEach(async () => {
        await rm(filePath, { force: true });
    });

    it("reads and validates an owned local image", async () => {
        await expect(readRegisteredImageBytes({ storageKey: key, ownerUserId: "user-one" })).resolves.toMatchObject({ mimeType: "image/png", width: 3, height: 2 });
    });

    it("returns display dimensions after EXIF orientation 6", async () => {
        const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: "white" } })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toBuffer();
        await writeFile(filePath, bytes);
        mocks.registration = registration({ mimeType: "image/jpeg", bytes: bytes.length });

        await expect(readRegisteredImageBytes({ storageKey: key, ownerUserId: "user-one" })).resolves.toMatchObject({ mimeType: "image/jpeg", width: 2, height: 3 });
    });

    it("hides foreign and traversal registrations", async () => {
        mocks.registration = registration({ ownerUserId: "other-user" });
        await expect(readRegisteredImageBytes({ storageKey: key, ownerUserId: "user-one" })).rejects.toMatchObject({ status: 404 });

        mocks.registration = registration({ storageKey: "../secret.png" });
        await expect(readRegisteredImageBytes({ storageKey: "../secret.png", ownerUserId: "user-one" })).rejects.toBeInstanceOf(RegisteredMediaReadError);
    });

    it("enforces registration byte and expiry limits before reading", async () => {
        mocks.registration = registration({ bytes: 31 * 1024 * 1024 });
        await expect(readRegisteredImageBytes({ storageKey: key, ownerUserId: "user-one" })).rejects.toMatchObject({ status: 413 });

        mocks.registration = registration({ expiresAt: new Date(Date.now() - 1_000).toISOString() });
        await expect(readRegisteredImageBytes({ storageKey: key, ownerUserId: "user-one" })).rejects.toMatchObject({ status: 410 });
    });

    it("enforces the configured pixel limit after decoding metadata", async () => {
        await expect(readRegisteredImageBytes({ storageKey: key, ownerUserId: "user-one", maxPixels: 5 })).rejects.toMatchObject({ status: 413, code: "too_large" });
    });

    it("accepts dimensions above the previous 100000000-pixel limit", async () => {
        const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
            .png()
            .toBuffer();
        bytes.writeUInt32BE(10_001, 16);
        bytes.writeUInt32BE(10_001, 20);
        await writeFile(filePath, bytes);
        mocks.registration = registration({ bytes: bytes.length });

        await expect(readRegisteredImageBytes({ storageKey: key, ownerUserId: "user-one" })).resolves.toMatchObject({ width: 10_001, height: 10_001 });
    });

    it("reads an object-backed historical asset when the current storage switch is off", async () => {
        const bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.5 } } })
            .png()
            .toBuffer();
        mocks.registration = registration({ storageProvider: "object", externalStorageId: "default", externalObjectKey: "dq/media/reference/source.png", bytes: bytes.length });
        mocks.objectBytes.mockResolvedValue(bytes);
        (mocks.config as Record<string, unknown>).enabled = false;
        (mocks.config as Record<string, unknown>).id = "default";

        await expect(readRegisteredImageBytes({ storageKey: key, ownerUserId: "user-one" })).resolves.toMatchObject({ mimeType: "image/png", width: 3, height: 2 });
        expect(mocks.objectBytes).toHaveBeenCalledWith(mocks.config, "dq/media/reference/source.png", expect.any(Number));
    });

    it("allows source dimensions above 64MP so preprocessing can shrink them", async () => {
        const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
            .png()
            .toBuffer();
        bytes.writeUInt32BE(20_001, 16);
        bytes.writeUInt32BE(20_001, 20);
        await writeFile(filePath, bytes);
        mocks.registration = registration({ bytes: bytes.length });

        await expect(readRegisteredImageBytes({ storageKey: key, ownerUserId: "user-one" })).resolves.toMatchObject({ width: 20_001, height: 20_001 });
        await expect(readRegisteredImageBytes({ storageKey: key, ownerUserId: "user-one", maxPixels: 64_000_000 })).rejects.toMatchObject({ status: 413, code: "too_large" });
    });

    function registration(patch: Record<string, unknown> = {}) {
        return {
            storageKey: key,
            scope: "reference",
            storageClass: "permanent",
            type: "image",
            ownerUserId: "user-one",
            source: "canvas",
            mimeType: "image/png",
            bytes: 100,
            storageProvider: "local",
            createdAt: new Date().toISOString(),
            ...patch,
        };
    }
});
