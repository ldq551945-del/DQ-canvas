import { beforeEach, describe, expect, it, vi } from "vitest";

import { listCanvasProjectSummaries } from "./canvas-projects";
import { listGenerationLogs } from "./generation-logs";

describe("result pagination clients", () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it("passes generation history page parameters to the server", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ items: [], total: 41, page: 2, pageSize: 20 }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(listGenerationLogs({ kind: "image", source: "image-workbench", page: 2, pageSize: 20 })).resolves.toMatchObject({ total: 41, page: 2, pageSize: 20 });
        expect(fetchMock).toHaveBeenCalledWith("/api/generation-logs?kind=image&source=image-workbench&page=2&pageSize=20", { cache: "no-store" });
    });

    it("normalizes the Canvas summary page response", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ code: 0, data: { projects: [{ id: "canvas-13", title: "画布 13" }], total: 13, page: 2, pageSize: 12 }, msg: "OK" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(listCanvasProjectSummaries({ page: 2, pageSize: 12 })).resolves.toMatchObject({ items: [{ id: "canvas-13" }], total: 13, page: 2, pageSize: 12 });
        expect(fetchMock).toHaveBeenCalledWith("/api/canvas/projects?page=2&pageSize=12", { cache: "no-store" });
    });
});
