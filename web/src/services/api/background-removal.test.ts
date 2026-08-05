import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelBackgroundRemovalTask, createBackgroundRemovalTask, removeBackgroundImage } from "./background-removal";

describe("background removal API client", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("sends the canonical options and returns the persisted parameter snapshot", async () => {
        const options = {
            version: 3 as const,
            model: "u2net_human_seg" as const,
            preset: "hair" as const,
            alphaMatting: true,
            foregroundThreshold: 240,
            backgroundThreshold: 10,
            refineRange: 10,
            cleanMask: false,
            outputMode: "transparent" as const,
            backgroundColor: [255, 255, 255, 255] as [number, number, number, number],
        };
        const optionsHash = "4c9adc627cdade8e818d1ef5f59a81b99c2dd8db4b87152da1ce7f1d2a23007e";
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task: { id: "task-one", status: "pending", model: "u2net_human_seg" } }, msg: "OK" }), { status: 200, headers: { "content-type": "application/json" } }))
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        code: 0,
                        data: {
                            task: {
                                id: "task-one",
                                status: "success",
                                result: { storageKey: "permanent/result.png", serverUrl: "/api/reference-assets/permanent/result.png", width: 4, height: 2, bytes: 128, mimeType: "image/png", options, optionsHash },
                            },
                        },
                        msg: "OK",
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                ),
            );
        vi.stubGlobal("fetch", fetchMock);

        const result = await removeBackgroundImage({ sourceStorageKey: "permanent/source.png", projectId: "canvas-one", sourceNodeId: "node-one", options });

        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ sourceStorageKey: "permanent/source.png", options, context: { projectId: "canvas-one", sourceNodeId: "node-one" } });
        expect(result).toMatchObject({
            storageKey: "permanent/result.png",
            width: 4,
            height: 2,
            backgroundRemovalOptions: options,
            backgroundRemovalOptionsHash: optionsHash,
        });
    });

    it("returns the task identifier before polling so callers can persist it", async () => {
        const onTaskCreated = vi.fn();
        const fetchMock = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify({ code: 0, data: { task: { id: "task-persist", status: "pending", sourceStorageKey: "permanent/source.png", sourceNodeId: "node-one" } }, msg: "OK" }), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(createBackgroundRemovalTask({ sourceStorageKey: "permanent/source.png", projectId: "canvas-one", sourceNodeId: "node-one", onTaskCreated })).resolves.toMatchObject({ id: "task-persist", status: "pending" });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/background-removal-tasks");
        expect(onTaskCreated).toHaveBeenCalledWith({ id: "task-persist", type: "image_process" });
    });

    it("normalizes a legacy non-transparent preference before creating a new task", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task: { id: "task-transparent", status: "pending" } }, msg: "OK" }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await createBackgroundRemovalTask({
            sourceStorageKey: "permanent/source.png",
            projectId: "canvas-one",
            sourceNodeId: "node-one",
            options: { version: 3, model: "silueta", preset: "standard", alphaMatting: false, foregroundThreshold: 240, backgroundThreshold: 10, refineRange: 10, cleanMask: false, outputMode: "mask", backgroundColor: [255, 255, 255, 255] },
        });

        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).options.outputMode).toBe("transparent");
    });

    it("does not abort task creation before a committed task id can be cancelled", async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task: { id: "task-race", status: "pending" } }, msg: "OK" }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task: { id: "task-race", status: "cancelled" }, cancellationConfirmed: true }, msg: "抠图任务已终止" }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(createBackgroundRemovalTask({ sourceStorageKey: "permanent/source.png", projectId: "canvas-one", sourceNodeId: "node-one", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeUndefined();
        expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/background-removal-tasks/task-race");
        expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
    });

    it("requires explicit server termination confirmation", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { task: { id: "task-one", status: "cancelled" }, cancellationConfirmed: false }, msg: "尚未确认" }), { status: 200 })),
        );

        await expect(cancelBackgroundRemovalTask("task-one")).rejects.toThrow("尚未确认");
    });

    it("confirms server cancellation when polling is aborted after creation", async () => {
        const controller = new AbortController();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task: { id: "task-poll", status: "pending" } }, msg: "OK" }), { status: 200 }))
            .mockImplementationOnce(async () => {
                controller.abort();
                throw new DOMException("请求已取消", "AbortError");
            })
            .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { task: { id: "task-poll", status: "cancelled" }, cancellationConfirmed: true }, msg: "抠图任务已终止" }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(removeBackgroundImage({ sourceStorageKey: "permanent/source.png", projectId: "canvas-one", sourceNodeId: "node-one", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/background-removal-tasks/task-poll");
        expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "PATCH" });
    });
});
