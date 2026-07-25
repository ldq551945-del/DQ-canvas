import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Asset } from "@/lib/library-asset-contract";

const mocks = vi.hoisted(() => ({ files: new Map<string, unknown>() }));

vi.mock("@/lib/server/database", () => ({ ensurePostgresSchema: vi.fn(), getDatabaseProvider: vi.fn(() => "file"), postgresQuery: vi.fn() }));
vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: vi.fn(async (name: string, fallback: unknown) => structuredClone(mocks.files.has(name) ? mocks.files.get(name) : fallback)),
    writeJsonDataFile: vi.fn(async (name: string, value: unknown) => mocks.files.set(name, structuredClone(value))),
}));

import { createLibraryAsset, deleteLibraryAsset, listLibraryAssets, updateLibraryAsset } from "./library-asset-store";

describe("library asset file provider", () => {
    beforeEach(() => mocks.files.clear());

    it("keeps server-backed assets isolated by user", async () => {
        await createLibraryAsset("user-one", textAsset("one", "素材一"));
        await createLibraryAsset("user-two", textAsset("two", "素材二"));

        expect(await listLibraryAssets("user-one")).toMatchObject([{ id: "one", title: "素材一" }]);
        expect(await updateLibraryAsset("user-one", textAsset("two", "越权修改"))).toBeNull();
        expect(await deleteLibraryAsset("user-one", "two")).toBe(false);
        expect(await deleteLibraryAsset("user-one", "one")).toBe(true);
        expect(await listLibraryAssets("user-two")).toHaveLength(1);
    });
});

function textAsset(id: string, title: string): Asset {
    const now = new Date().toISOString();
    return { id, kind: "text", title, coverUrl: "", tags: [], data: { content: title }, createdAt: now, updatedAt: now };
}
