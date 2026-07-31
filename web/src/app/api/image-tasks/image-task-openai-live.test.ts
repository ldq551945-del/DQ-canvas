import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/proxy-dispatcher", () => ({ configureServerProxyDispatcher: vi.fn() }));

import { createProtocolFixtureServer } from "../../../../scripts/protocol-fixture-server.mjs";
import { runOpenAiImageTask } from "./image-task-openai";
import { runCustomImageTask } from "./image-task-custom";
import type { ImageTask } from "@/lib/server/image-task-store";
import { emptyAdvancedConfig } from "@/lib/channel-protocol-registry";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("OpenAI image provider over a live compatible fixture", () => {
    it("parses a valid PNG returned over TCP", async () => {
        const fixture = createProtocolFixtureServer();
        await new Promise<void>((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
        const address = fixture.server.address();
        if (!address || typeof address === "string") throw new Error("Protocol fixture did not bind a TCP port");
        const origin = `http://127.0.0.1:${address.port}`;
        const task: ImageTask = {
            id: "image-live",
            userId: "user-live",
            username: "user",
            displayName: "User",
            kind: "generation",
            source: "image-workbench",
            status: "running",
            createdAt: 1,
            updatedAt: 1,
            config: { baseUrl: origin, apiKey: "fixture-key", apiFormat: "openai", model: "mock-image", channelId: "fixture-image" },
            candidateConfigs: [],
            prompt: "create a blue protocol test image",
            references: [],
        };

        try {
            await expect(runOpenAiImageTask(task, "http://internal", "http://public", "", true)).resolves.toMatchObject({ dataUrl: expect.stringMatching(/^data:image\/png;base64,iVBOR/) });
            expect(fixture.requests).toHaveLength(1);
            expect(fixture.requests[0]).toMatchObject({ method: "POST", path: "/v1/images/generations" });
            expect(fixture.requests[0]?.headers.authorization).toBe("Bearer fixture-key");
            expect(JSON.parse(fixture.requests[0]?.body.toString("utf8") || "{}")).toMatchObject({ model: "mock-image", response_format: "url" });
        } finally {
            await new Promise<void>((resolve, reject) => fixture.server.close((error?: Error) => (error ? reject(error) : resolve())));
        }
    });

    it("uses the selected GlobalAiOpc image preset once and polls its declared result path", async () => {
        const fixture = createProtocolFixtureServer();
        await new Promise<void>((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
        const address = fixture.server.address();
        if (!address || typeof address === "string") throw new Error("Protocol fixture did not bind a TCP port");
        const origin = "http://127.0.0.1:" + address.port;
        const task: ImageTask = {
            id: "image-global-live",
            userId: "user-live",
            username: "user",
            displayName: "User",
            kind: "generation",
            source: "image-workbench",
            status: "running",
            createdAt: 1,
            updatedAt: 1,
            config: {
                baseUrl: origin,
                apiKey: "fixture-key",
                apiFormat: "openai",
                model: "gpt-image-2",
                channelId: "fixture-global-image",
                advancedConfig: { ...emptyAdvancedConfig(), protocol: "globalaiopc", globalAiOpcPreset: "image-gpt-image-2", createPath: "/image2/images", queryPath: "/result/:task_id" },
            },
            candidateConfigs: [],
            prompt: "create a blue protocol test image",
            references: [],
        };

        try {
            const submitted = await runOpenAiImageTask(task, "http://internal", "http://public", "", true);
            expect(submitted.pending).toMatchObject({ id: expect.stringMatching(/^fixture-image-/) });
            expect(fixture.requests).toHaveLength(1);
            expect(fixture.requests[0]).toMatchObject({ method: "POST", path: "/v1/image2/images" });
            expect(fixture.requests[0]?.headers.authorization).toBe("Bearer fixture-key");
            expect(fixture.requests[0]?.headers["idempotency-key"]).toBe("image-task:image-global-live:attempt:1");
            const body = JSON.parse(fixture.requests[0]?.body.toString("utf8") || "{}");
            expect(body).toMatchObject({ model: "gpt-image-2", prompt: "create a blue protocol test image", resolution: "2k" });

            const { pollOpenAiImageTask } = await import("./image-task-support");
            const result = await pollOpenAiImageTask(task.config, submitted.pending!.id, origin, origin, "", "", true);
            expect(result.dataUrl).toMatch(/(?:^data:image\/png;base64,|\/media\/fixture\.png$)/);
            expect(fixture.requests.map((request) => request.path)).toEqual(["/v1/image2/images", "/v1/result/" + submitted.pending!.id]);
        } finally {
            await new Promise<void>((resolve, reject) => fixture.server.close((error?: Error) => (error ? reject(error) : resolve())));
        }
    });

    it("sends sub2api edits as one JSON request with an image_urls string array", async () => {
        const fixture = createProtocolFixtureServer();
        await new Promise<void>((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
        const address = fixture.server.address();
        if (!address || typeof address === "string") throw new Error("Protocol fixture did not bind a TCP port");
        const origin = "http://127.0.0.1:" + address.port;
        const task = liveImageTask(origin, {
            id: "image-sub2api-live",
            kind: "edit",
            references: [{ type: "image/png", dataUrl: "https://cdn.example.com/reference.png" }],
            config: {
                baseUrl: origin,
                apiKey: "fixture-key",
                apiFormat: "openai",
                model: "gpt-image-1",
                channelId: "fixture-sub2api",
                advancedConfig: { ...emptyAdvancedConfig(), protocol: "sub2api", createPath: "/images/generations", editPath: "/images/generations", supportsReferenceImage: true },
            },
        });

        try {
            await expect(runOpenAiImageTask(task, "", "", "", true)).resolves.toMatchObject({ dataUrl: expect.stringMatching(/^data:image\/png;base64,/) });
            expect(fixture.requests).toHaveLength(1);
            expect(fixture.requests[0]?.path).toBe("/v1/images/generations");
            const body = JSON.parse(fixture.requests[0]?.body.toString("utf8") || "{}");
            expect(body.image_urls).toEqual(["https://cdn.example.com/reference.png"]);
            expect(body.images).toBeUndefined();
            expect(fixture.requests[0]?.headers["idempotency-key"]).toBe("image-task:image-sub2api-live:attempt:1");
        } finally {
            await new Promise<void>((resolve, reject) => fixture.server.close((error?: Error) => (error ? reject(error) : resolve())));
        }
    });

    it.each([
        ["Stable Diffusion", "stable-diffusion", "/sdapi/v1/txt2img", '{"prompt":"{{prompt}}","width":"{{width}}","height":"{{height}}","override_settings":{"sd_model_checkpoint":"{{model}}"}}', "images[0]"],
        ["custom", "custom", "/custom/images", '{"deployment":"{{model}}","input":"{{prompt}}","dimensions":"{{size}}"}', "data.image_url"],
    ] as const)("uses the exact %s image template and result field", async (_name, protocol, createPath, requestTemplate, resultField) => {
        const fixture = createProtocolFixtureServer();
        await new Promise<void>((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
        const address = fixture.server.address();
        if (!address || typeof address === "string") throw new Error("Protocol fixture did not bind a TCP port");
        const origin = "http://127.0.0.1:" + address.port;
        const task = liveImageTask(origin, {
            id: "image-" + protocol + "-live",
            config: {
                baseUrl: origin,
                apiKey: "fixture-key",
                apiFormat: "openai",
                model: "fixture-image-model",
                channelId: "fixture-" + protocol,
                size: "1024x1024",
                advancedConfig: { ...emptyAdvancedConfig(), protocol, createPath, requestTemplate, resultField },
            },
        });

        try {
            await expect(runCustomImageTask(task, "", "", "", true)).resolves.toMatchObject({ dataUrl: expect.any(String) });
            expect(fixture.requests).toHaveLength(1);
            expect(fixture.requests[0]?.path).toBe(createPath);
            expect(fixture.requests[0]?.headers["idempotency-key"]).toBe("image-task:" + task.id + ":attempt:1");
            const body = JSON.parse(fixture.requests[0]?.body.toString("utf8") || "{}");
            if (protocol === "stable-diffusion") expect(body).toMatchObject({ prompt: task.prompt, width: 1024, height: 1024, override_settings: { sd_model_checkpoint: task.config.model } });
            else expect(body).toEqual({ deployment: task.config.model, input: task.prompt, dimensions: "1024x1024" });
        } finally {
            await new Promise<void>((resolve, reject) => fixture.server.close((error?: Error) => (error ? reject(error) : resolve())));
        }
    });
});

function liveImageTask(origin: string, patch: Partial<ImageTask>): ImageTask {
    return {
        id: "image-live",
        userId: "user-live",
        username: "user",
        displayName: "User",
        kind: "generation",
        source: "image-workbench",
        status: "running",
        createdAt: 1,
        updatedAt: 1,
        config: { baseUrl: origin, apiKey: "fixture-key", apiFormat: "openai", model: "mock-image", channelId: "fixture-image" },
        candidateConfigs: [],
        prompt: "create a blue protocol test image",
        references: [],
        ...patch,
    };
}
