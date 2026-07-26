import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), getPublicUsersByIds: vi.fn(), getLocalMediaAssetSummary: vi.fn(), listLocalMediaAssets: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/store", () => ({ getPublicUsersByIds: mocks.getPublicUsersByIds }));
vi.mock("@/lib/server/local-media-storage", () => ({
    cleanupExpiredLocalMediaAssets: vi.fn(),
    deleteLocalMediaAssets: vi.fn(),
    getLocalMediaAssetSummary: mocks.getLocalMediaAssetSummary,
    listLocalMediaAssets: mocks.listLocalMediaAssets,
}));

import { GET } from "./route";

describe("GET /api/admin/generation-assets", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "admin", role: "admin" });
        mocks.getLocalMediaAssetSummary.mockResolvedValue({ totalFiles: 2, totalBytes: 30, permanentFiles: 2, permanentBytes: 30, temporaryFiles: 0, temporaryBytes: 0, expiredTemporaryFiles: 0 });
    });

    it("returns summary-only data without loading media rows or users", async () => {
        const response = await GET(new Request("http://localhost/api/admin/generation-assets?summaryOnly=1"));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ code: 0, data: { summary: { totalFiles: 2, totalBytes: 30 } }, msg: "OK" });
        expect(mocks.getLocalMediaAssetSummary).toHaveBeenCalledTimes(1);
        expect(mocks.listLocalMediaAssets).not.toHaveBeenCalled();
        expect(mocks.getPublicUsersByIds).not.toHaveBeenCalled();
    });
});
