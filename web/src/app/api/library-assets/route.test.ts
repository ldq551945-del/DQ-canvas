import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    listAll: vi.fn(),
    listPage: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/library-asset-service", () => ({
    LibraryAssetServiceError: class LibraryAssetServiceError extends Error {},
    createLibraryAssetForUser: vi.fn(),
    listLibraryAssetsForUser: mocks.listAll,
    listLibraryAssetPageForUser: mocks.listPage,
}));

import { GET } from "./route";

describe("library assets route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.listAll.mockResolvedValue([]);
        mocks.listPage.mockResolvedValue({ items: [{ id: "asset-one" }], total: 21, page: 2, pageSize: 10 });
    });

    it("keeps the legacy unpaged response for existing lazy pickers", async () => {
        const response = await GET(new Request("http://localhost/api/library-assets"));

        expect(await response.json()).toEqual({ code: 0, data: { assets: [] }, msg: "OK" });
        expect(mocks.listAll).toHaveBeenCalledWith("user-one");
        expect(mocks.listPage).not.toHaveBeenCalled();
    });

    it("passes page filters to the server-side page query", async () => {
        const response = await GET(new Request("http://localhost/api/library-assets?page=2&pageSize=10&kind=image&keyword=logo"));

        expect(mocks.listPage).toHaveBeenCalledWith("user-one", { page: "2", pageSize: "10", kind: "image", keyword: "logo" });
        expect(await response.json()).toEqual({ code: 0, data: { assets: [{ id: "asset-one" }], total: 21, page: 2, pageSize: 10 }, msg: "OK" });
    });
});
