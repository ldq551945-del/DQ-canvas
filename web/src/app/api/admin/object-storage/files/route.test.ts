import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getPublicUsersByIds: vi.fn(),
    listExternalStorageFiles: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({ getPublicUsersByIds: mocks.getPublicUsersByIds }));
vi.mock("@/lib/server/object-storage-service", () => ({
    deleteExternalStorageFiles: vi.fn(),
    listExternalStorageFiles: mocks.listExternalStorageFiles,
}));

import { GET } from "./route";

describe("GET /api/admin/object-storage/files", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin" });
        mocks.listExternalStorageFiles.mockResolvedValue({ items: [{ key: "media/image.webp", ownerUserId: "user-one" }], bucket: "media", prefix: "vozeb-pro/" });
        mocks.getPublicUsersByIds.mockResolvedValue([{ id: "user-one", accountId: "0001", username: "creator", displayName: "创作者" }]);
    });

    it("requires an administrator", async () => {
        mocks.getCurrentUser.mockResolvedValueOnce({ id: "user-one", role: "user" });

        expect((await GET(new Request("http://localhost/api/admin/object-storage/files"))).status).toBe(403);
        expect(mocks.listExternalStorageFiles).not.toHaveBeenCalled();
    });

    it("adds public owner identity without replacing the internal relation key", async () => {
        const response = await GET(new Request("http://localhost/api/admin/object-storage/files?limit=30&ownerUserId=user-one"));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.listExternalStorageFiles).toHaveBeenCalledWith(expect.objectContaining({ limit: 30, ownerUserId: "user-one" }));
        expect(mocks.getPublicUsersByIds).toHaveBeenCalledWith(["user-one"]);
        expect(payload.data.items[0]).toMatchObject({ ownerUserId: "user-one", ownerAccountId: "0001", ownerUsername: "creator", ownerDisplayName: "创作者" });
    });
});
