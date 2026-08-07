import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { fetchInternalApi } from "./internal-origin";

describe("fetchInternalApi request bodies", () => {
    const servers: ReturnType<typeof createServer>[] = [];

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    });

    it("preserves native multipart form data when using the internal dispatcher", async () => {
        let contentType = "";
        let body = "";
        const server = createServer(async (request, response) => {
            contentType = request.headers["content-type"] || "";
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            body = Buffer.concat(chunks).toString("utf8");
            response.end("ok");
        });
        servers.push(server);
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const port = (server.address() as AddressInfo).port;
        const form = new FormData();
        form.set("model", "video-model");
        form.set("prompt", "slow video");

        const response = await fetchInternalApi(`http://127.0.0.1:${port}/videos`, { method: "POST", body: form });

        expect(response.status).toBe(200);
        expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
        expect(body).toContain('name="model"');
        expect(body).toContain("video-model");
        expect(body).toContain('name="prompt"');
    });
});
