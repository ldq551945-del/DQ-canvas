import { afterEach, describe, expect, it, vi } from "vitest";

import { listCreativeAssetPage, listCreativeMessages } from "./creative";

describe("creative API pagination", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("requests a bounded message page", async () => {
        const fetchMock = vi.fn(async () => response({ messages: [] }));
        vi.stubGlobal("fetch", fetchMock);

        await listCreativeMessages("conversation one", 42);

        expect(fetchMock).toHaveBeenCalledWith("/api/creative/conversations/conversation%20one/messages?limit=40&beforeSequence=42", expect.objectContaining({ cache: "no-store" }));
    });

    it("posts structured selectors for assets connected to loaded messages and runs", async () => {
        const fetchMock = vi.fn(async () => response({ assets: [], hasMore: false }));
        vi.stubGlobal("fetch", fetchMock);

        await listCreativeAssetPage("conversation", { ids: ["asset-one"], messageIds: ["message-one"], runIds: ["run-one"], limit: 50, offset: 100 });

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/creative/conversations/conversation/assets",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ ids: ["asset-one"], messageIds: ["message-one"], runIds: ["run-one"], limit: 50, offset: 100 }),
            }),
        );
    });
});

function response<T>(data: T) {
    return Response.json({ code: 0, data, msg: "OK" });
}
