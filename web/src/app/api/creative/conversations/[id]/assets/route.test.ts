import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    listAssetPageForUser: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/creative-runtime-service", () => ({
    CreativeRuntimeServiceError: class CreativeRuntimeServiceError extends Error {
        constructor(
            message: string,
            public readonly status: number,
        ) {
            super(message);
        }
    },
    listAssetPageForUser: mocks.listAssetPageForUser,
}));

import { GET, POST } from "./route";

describe("creative conversation asset pages", () => {
    beforeEach(() => {
        mocks.getCurrentUser.mockReset().mockResolvedValue({ id: "user-one" });
        mocks.listAssetPageForUser.mockReset().mockResolvedValue({ assets: [{ id: "asset-one" }], hasMore: true });
    });

    it("forwards scoped selectors and returns the next offset", async () => {
        const response = await GET(new Request("http://localhost/api/creative/conversations/conversation/assets?ids=asset-one&messageIds=message-one&runIds=run-one&limit=25&offset=50"), {
            params: Promise.resolve({ id: "conversation" }),
        });

        expect(mocks.listAssetPageForUser).toHaveBeenCalledWith("user-one", "conversation", {
            ids: ["asset-one"],
            messageIds: ["message-one"],
            runIds: ["run-one"],
            limit: "25",
            offset: "50",
        });
        expect(await response.json()).toEqual({ code: 0, data: { assets: [{ id: "asset-one" }], hasMore: true, nextOffset: 51 }, msg: "OK" });
    });

    it("rejects anonymous requests", async () => {
        mocks.getCurrentUser.mockResolvedValueOnce(null);

        const response = await GET(new Request("http://localhost/api/creative/conversations/conversation/assets"), { params: Promise.resolve({ id: "conversation" }) });

        expect(response.status).toBe(401);
        expect(mocks.listAssetPageForUser).not.toHaveBeenCalled();
    });

    it("accepts structured POST selectors without putting them in the URL", async () => {
        const response = await POST(new Request("http://localhost/api/creative/conversations/conversation/assets", { method: "POST", body: JSON.stringify({ ids: ["asset-one"], runIds: ["run-one"], limit: 10, offset: 2 }) }), {
            params: Promise.resolve({ id: "conversation" }),
        });

        expect(mocks.listAssetPageForUser).toHaveBeenCalledWith("user-one", "conversation", { ids: ["asset-one"], runIds: ["run-one"], limit: 10, offset: 2 });
        expect(response.status).toBe(200);
    });
});
