import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutboundUrl: (url: string | URL, init?: RequestInit) => fetch(url, init) }));

import { BackgroundRemovalProviderError, cancelBackgroundRemovalWithRembg, removeBackgroundWithRembg } from "./background-removal-provider";

describe("background removal provider", () => {
    beforeEach(() => {
        process.env.DQ_REMBG_URL = "http://rembg:7000";
        process.env.DQ_REMBG_INTERNAL_TOKEN = "internal-token";
        delete process.env.DQ_REMBG_TIMEOUT_MS;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete process.env.DQ_REMBG_URL;
        delete process.env.DQ_REMBG_INTERNAL_TOKEN;
        delete process.env.DQ_REMBG_TIMEOUT_MS;
    });

    it("posts a normalized PNG and accepts a same-sized transparent PNG", async () => {
        const input = await sourceImage(2, 3, "jpeg");
        const output = await sharp({ create: { width: 2, height: 3, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .png()
            .toBuffer();
        const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(output, { status: 200, headers: { "content-type": "image/png", "x-rembg-model": "silueta" } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(removeBackgroundWithRembg({ taskId: "task-one", bytes: input, mimeType: "image/jpeg", width: 2, height: 3 })).resolves.toMatchObject({ bytes: output, width: 2, height: 3, mimeType: "image/png" });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("http://rembg:7000/v1/remove");
        expect(init).toMatchObject({
            method: "POST",
            headers: expect.objectContaining({
                "content-type": "image/png",
                authorization: "Bearer internal-token",
                "x-dq-rembg-task-id": "task-one",
                "x-dq-rembg-options": JSON.stringify({
                    version: 3,
                    model: "silueta",
                    preset: "standard",
                    alphaMatting: false,
                    foregroundThreshold: 240,
                    backgroundThreshold: 10,
                    refineRange: 10,
                    cleanMask: false,
                    outputMode: "transparent",
                    backgroundColor: [255, 255, 255, 255],
                }),
            }),
        });
        const posted = init?.body as Buffer;
        expect(posted).not.toBe(input);
        await expect(sharp(posted).metadata()).resolves.toMatchObject({ format: "png", width: 2, height: 3, channels: 4, hasAlpha: true });
        expect((init?.headers as Record<string, string>)?.["content-length"]).toBeUndefined();
    });

    it.each(["mask", "color"] as const)("rejects %s output before contacting the sidecar", async (outputMode) => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            removeBackgroundWithRembg({
                taskId: `task-${outputMode}`,
                bytes: await sourceImage(2, 3),
                mimeType: "image/png",
                width: 2,
                height: 3,
                options: { version: 3, model: "silueta", preset: "standard", alphaMatting: false, foregroundThreshold: 240, backgroundThreshold: 10, refineRange: 10, cleanMask: false, outputMode, backgroundColor: [255, 255, 255, 255] },
            }),
        ).rejects.toMatchObject({ status: 400, transient: false });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("resizes a source over 2K before contacting the sidecar", async () => {
        const output = await transparentOutput(2048, 1024);
        const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(output, { status: 200, headers: { "content-type": "image/png", "x-rembg-model": "silueta" } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            removeBackgroundWithRembg({
                taskId: "task-large",
                bytes: await sourceImage(4096, 2048),
                mimeType: "image/png",
                width: 4096,
                height: 2048,
            }),
        ).resolves.toMatchObject({ width: 2048, height: 1024 });
        expect(fetchMock).toHaveBeenCalledOnce();
        await expect(sharp(fetchMock.mock.calls[0][1]?.body as Buffer).metadata()).resolves.toMatchObject({ width: 2048, height: 1024, channels: 4 });
    });

    it("rejects malformed output and marks upstream overload as retryable", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("bad", { status: 200, headers: { "content-type": "image/png" } })),
        );
        await expect(removeBackgroundWithRembg({ taskId: "task-malformed", bytes: await sourceImage(1, 1), mimeType: "image/png", width: 1, height: 1 })).rejects.toMatchObject({ status: 502, transient: true });

        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("busy", { status: 503 })),
        );
        await expect(removeBackgroundWithRembg({ taskId: "task-overload", bytes: await sourceImage(1, 1), mimeType: "image/png", width: 1, height: 1 })).rejects.toEqual(
            expect.objectContaining<Partial<BackgroundRemovalProviderError>>({ status: 503, transient: true }),
        );
    });

    it("sends and validates the per-request model", async () => {
        const output = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .png()
            .toBuffer();
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(output, { status: 200, headers: { "content-type": "image/png", "x-rembg-model": "u2net" } })),
        );
        await expect(
            removeBackgroundWithRembg({
                taskId: "task-model",
                bytes: await sourceImage(1, 1),
                mimeType: "image/png",
                width: 1,
                height: 1,
                options: { version: 3, model: "isnet-anime", preset: "standard", alphaMatting: false, foregroundThreshold: 240, backgroundThreshold: 10, refineRange: 10, cleanMask: false, outputMode: "transparent", backgroundColor: [255, 255, 255, 255] },
            }),
        ).rejects.toMatchObject({ status: 502, transient: true });
    });

    it("waits for the sidecar to confirm cancellation", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ cancelled: true, terminated: true, wasActive: true }), { status: 200, headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(cancelBackgroundRemovalWithRembg("task/cancel")).resolves.toEqual({ terminated: true });

        expect(fetchMock).toHaveBeenCalledWith("http://rembg:7000/v1/tasks/task%2Fcancel", expect.objectContaining({ method: "DELETE", headers: { authorization: "Bearer internal-token" }, cache: "no-store" }));
    });

    it("rejects an unconfirmed cancellation so it can be retried", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ terminated: false }), { status: 200 })),
        );

        await expect(cancelBackgroundRemovalWithRembg("task-unconfirmed")).rejects.toMatchObject({ status: 502, transient: false });
    });
});

function sourceImage(width: number, height: number, format: "png" | "jpeg" = "png") {
    const image = sharp({ create: { width, height, channels: 3, background: "white" } });
    return format === "jpeg" ? image.jpeg().toBuffer() : image.png().toBuffer();
}

function transparentOutput(width: number, height: number) {
    return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .png()
        .toBuffer();
}
