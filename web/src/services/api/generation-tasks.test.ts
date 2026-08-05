import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelCanvasGenerationTask, listCanvasGenerationTasks } from "./generation-tasks";

describe("canvas generation task API", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("requests active tasks for the selected project without caching", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { tasks: [{ id: "task-1", type: "image", status: "running", createdAt: 1, updatedAt: 2 }] } }), { status: 200, headers: { "Content-Type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(listCanvasGenerationTasks("canvas one", { activeOnly: true, limit: 5 })).resolves.toEqual([expect.objectContaining({ id: "task-1" })]);
        expect(fetchMock).toHaveBeenCalledWith("/api/generation-tasks?surface=canvas&projectId=canvas+one&activeOnly=true&limit=5", expect.objectContaining({ cache: "no-store" }));
    });

    it("surfaces server errors", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ msg: "session expired" }), { status: 401 })));

        await expect(listCanvasGenerationTasks("canvas-one")).rejects.toThrow("session expired");
    });

    it("cancels each persisted canvas task through its typed endpoint", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await cancelCanvasGenerationTask({ id: "task-video", type: "video" });

        expect(fetchMock).toHaveBeenCalledWith("/api/video-tasks/task-video", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "cancelled" }), cache: "no-store" }));
    });

    it("treats a terminal cancellation race as already settled", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "当前任务无法取消" }), { status: 409 })));

        await expect(cancelCanvasGenerationTask({ id: "task-image", type: "image" })).resolves.toBeUndefined();
    });
});
