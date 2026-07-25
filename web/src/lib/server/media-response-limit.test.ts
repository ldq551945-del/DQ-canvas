import { describe, expect, it } from "vitest";

import { limitMediaResponseBody, mediaResponseExceedsLimit } from "./media-response-limit";

describe("media response limits", () => {
    it("rejects a declared response above the limit", () => {
        expect(mediaResponseExceedsLimit(new Headers({ "content-length": "11" }), 10)).toBe(true);
        expect(mediaResponseExceedsLimit(new Headers({ "content-length": "10" }), 10)).toBe(false);
    });

    it("streams a response within the limit", async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
                controller.close();
            },
        });
        const result = await new Response(limitMediaResponseBody(body, 3)).arrayBuffer();
        expect(result.byteLength).toBe(3);
    });

    it("terminates a chunked response after crossing the limit", async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(6));
                controller.enqueue(new Uint8Array(6));
                controller.close();
            },
        });
        await expect(new Response(limitMediaResponseBody(body, 10)).arrayBuffer()).rejects.toThrow("Media is too large");
    });
});
