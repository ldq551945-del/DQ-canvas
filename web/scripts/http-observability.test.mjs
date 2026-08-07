import { createServer } from "node:http";
import { once } from "node:events";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalizeObservedRoute } from "./http-observability.mjs";

describe("HTTP observability preload", () => {
    let server;

    beforeEach(() => {
        delete globalThis.__dqHttpObservability;
        process.env.DQ_HTTP_ACCESS_LOG = "off";
    });

    afterEach(async () => {
        if (server?.listening) {
            server.close();
            await once(server, "close");
        }
    });

    it("normalizes high-cardinality identifiers without retaining query strings", () => {
        expect(normalizeObservedRoute("/api/tasks/019fd360-bb4b-7640-8dbc-e6e23fcb5416?token=secret")).toBe("/api/tasks/:id");
        expect(normalizeObservedRoute("/api/public/works/summer-sale/community/like")).toBe("/api/public/works/:id/community/like");
        expect(normalizeObservedRoute("/api/reference-assets/private/user/image.png")).toBe("/api/reference-assets/:path");
        expect(normalizeObservedRoute("/api/billing/webhooks/stripe")).toBe("/api/billing/webhooks/stripe");
    });

    it("adds a request id and records the completed API response", async () => {
        server = createServer((_request, response) => {
            response.statusCode = 503;
            response.end("unavailable");
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("test server did not expose a TCP port");

        const response = await fetch(`http://127.0.0.1:${address.port}/api/tasks/123?token=secret`);
        await response.text();

        expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
        expect(globalThis.__dqHttpObservability).toMatchObject({ requests: 1, errors5xx: 1 });
        expect(globalThis.__dqHttpObservability.routes.get("GET /api/tasks/:id")).toMatchObject({ count: 1, errors5xx: 1 });
    });
});
