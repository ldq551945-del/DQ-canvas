import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WorkerMessage = { id: number; image: ImageBitmap };

class MockWorker {
    static instances: MockWorker[] = [];

    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage = vi.fn<(message: WorkerMessage, transfer: Transferable[]) => void>();
    terminate = vi.fn();

    constructor(
        readonly url: URL,
        readonly options: WorkerOptions,
    ) {
        MockWorker.instances.push(this);
    }
}

const bitmap = { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap;

describe("canvas face detection", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        MockWorker.instances = [];
        (bitmap.close as ReturnType<typeof vi.fn>).mockClear();
        vi.stubGlobal("Worker", MockWorker);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(new Blob()) }));
        vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("does not decode or start a worker when already aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        const { detectCanvasFaces } = await import("./canvas-face-detection");

        await expect(detectCanvasFaces("data:image/png;base64,AA==", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        expect(fetch).not.toHaveBeenCalled();
        expect(MockWorker.instances).toHaveLength(0);
    });

    it("closes a decoded bitmap when cancellation wins the decode race", async () => {
        const controller = new AbortController();
        let finishDecode: ((value: ImageBitmap) => void) | undefined;
        vi.stubGlobal(
            "createImageBitmap",
            vi.fn().mockImplementation(
                () =>
                    new Promise<ImageBitmap>((resolve) => {
                        finishDecode = resolve;
                    }),
            ),
        );
        const { detectCanvasFaces } = await import("./canvas-face-detection");
        const pending = detectCanvasFaces("data:image/png;base64,AA==", controller.signal);
        await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
        controller.abort();
        finishDecode?.(bitmap);

        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(bitmap.close).toHaveBeenCalledOnce();
        expect(MockWorker.instances).toHaveLength(0);
    });

    it("transfers the decoded bitmap and resolves the matching worker response", async () => {
        const { detectCanvasFaces } = await import("./canvas-face-detection");
        const pending = detectCanvasFaces("data:image/png;base64,AA==");
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        const worker = MockWorker.instances[0];
        const request = worker.postMessage.mock.calls[0][0];

        expect(worker.options).toEqual({ type: "module" });
        expect(request.image).toBe(bitmap);
        expect(worker.postMessage.mock.calls[0][1]).toEqual([bitmap]);
        worker.onmessage?.({
            data: {
                id: request.id,
                faces: [{ id: "face-1-0", x: 10, y: 20, width: 30, height: 40, confidence: 0.9, source: "detected" }],
                imageWidth: 640,
                imageHeight: 480,
            },
        } as MessageEvent);

        await expect(pending).resolves.toMatchObject({
            imageWidth: 640,
            imageHeight: 480,
            faces: [{ id: "face-1-0", confidence: 0.9 }],
        });
    });

    it("removes an aborted request and ignores its late response", async () => {
        const controller = new AbortController();
        const { detectCanvasFaces } = await import("./canvas-face-detection");
        const pending = detectCanvasFaces("data:image/png;base64,AA==", controller.signal);
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        const worker = MockWorker.instances[0];
        const request = worker.postMessage.mock.calls[0][0];

        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(() => worker.onmessage?.({ data: { id: request.id, faces: [], imageWidth: 640, imageHeight: 480 } } as MessageEvent)).not.toThrow();
    });

    it("rejects all pending work, terminates a failed worker and recreates it", async () => {
        const { detectCanvasFaces } = await import("./canvas-face-detection");
        const first = detectCanvasFaces("data:image/png;base64,AA==");
        const second = detectCanvasFaces("data:image/png;base64,AA==");
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        const failedWorker = MockWorker.instances[0];

        failedWorker.onerror?.({ message: "worker crashed" } as ErrorEvent);
        await expect(first).rejects.toThrow("worker crashed");
        await expect(second).rejects.toThrow("worker crashed");
        expect(failedWorker.terminate).toHaveBeenCalledOnce();

        const recreated = detectCanvasFaces("data:image/png;base64,AA==");
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(2));
        const replacement = MockWorker.instances[1];
        const request = replacement.postMessage.mock.calls[0][0];
        replacement.onmessage?.({ data: { id: request.id, faces: [], imageWidth: 640, imageHeight: 480 } } as MessageEvent);
        await expect(recreated).resolves.toMatchObject({ faces: [] });
    });
});
