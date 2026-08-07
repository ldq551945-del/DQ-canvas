import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPublicSession, resetPublicSession, usePublicSessionStore } from "@/stores/use-public-session-store";

afterEach(() => {
    resetPublicSession();
    vi.unstubAllGlobals();
});

describe("public session refresh", () => {
    it("can replace a cached public model catalog after an administrator saves settings", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ user: null, settings: { logicalModels: [] } }))
            .mockResolvedValueOnce(Response.json({ user: null, settings: { logicalModels: [{ id: "video-one", name: "视频一", capability: "video", enabled: true, bindings: [] }] } }));
        vi.stubGlobal("fetch", fetchMock);

        expect((await loadPublicSession()).settings?.logicalModels).toEqual([]);
        expect((await loadPublicSession()).settings?.logicalModels).toEqual([]);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const refreshed = await loadPublicSession({ force: true });

        expect(refreshed.settings?.logicalModels?.map((model) => model.id)).toEqual(["video-one"]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(usePublicSessionStore.getState().payload).toEqual(refreshed);
    });
});
