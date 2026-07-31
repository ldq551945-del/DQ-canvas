import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import { createProtocolFixtureServer } from "./protocol-fixture-server.mjs";

let fixture;
let origin;

beforeEach(async () => {
    fixture = createProtocolFixtureServer();
    await new Promise((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
    const address = fixture.server.address();
    origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
    await new Promise((resolve, reject) => fixture.server.close((error) => (error ? reject(error) : resolve())));
});

describe("protocol fixture server", () => {
    it("serves a categorized model catalog and structured text tools", async () => {
        const catalog = await fetch(`${origin}/v1/models`).then((response) => response.json());
        expect(catalog.data.map((model) => model.capability)).toEqual(["text", "image", "video", "audio"]);

        const response = await fetch(`${origin}/v1/responses`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tools: [{ type: "function", name: "create_agent_plan" }], tool_choice: { type: "function", name: "create_agent_plan" } }),
        }).then((value) => value.json());
        expect(JSON.parse(response.output[0].arguments)).toMatchObject({ intent: "generation", deliverables: [{ type: "image", model: "mock-image", ratio: "16:9" }] });
    });

    it("serves OpenAI and Stable Diffusion image results", async () => {
        const openAi = await fetch(`${origin}/v1/images/generations`, { method: "POST" }).then((response) => response.json());
        const stableDiffusion = await fetch(`${origin}/sdapi/v1/txt2img`, { method: "POST" }).then((response) => response.json());
        expect(openAi.data[0].b64_json).toMatch(/^iVBOR/);
        expect(stableDiffusion.images[0]).toBe(openAi.data[0].b64_json);
        await expect(sharp(Buffer.from(openAi.data[0].b64_json, "base64")).metadata()).resolves.toMatchObject({ format: "png", width: 2, height: 2 });
    });

    it.each([
        ["OpenAI", "/v1/videos", "/v1/videos/fixture-video-1"],
        ["Seedance", "/contents/generations/tasks", "/contents/generations/tasks/fixture-video-1"],
        ["Seedance special", "/v1/seedance-special/videos", "/v1/result/fixture-video-1"],
    ])("serves %s asynchronous video creation and polling", async (_name, createPath, queryPath) => {
        const created = await fetch(`${origin}${createPath}`, { method: "POST" }).then((response) => response.json());
        const completed = await fetch(`${origin}${queryPath}`).then((response) => response.json());
        const media = await fetch(completed.video_url);
        expect(created.task_id).toBe("fixture-video-1");
        expect(completed).toMatchObject({ status: "completed", video_url: `${origin}/media/fixture.mp4` });
        expect(media.headers.get("content-type")).toBe("video/mp4");
    });

    it("serves synchronous audio bytes", async () => {
        const response = await fetch(`${origin}/v1/audio/speech`, { method: "POST" });
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(response.headers.get("content-type")).toBe("audio/wav");
        expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    });

    it("can delay POST responses for task-control regression", async () => {
        await new Promise((resolve, reject) => fixture.server.close((error) => (error ? reject(error) : resolve())));
        fixture = createProtocolFixtureServer({ responseDelayMs: 40 });
        await new Promise((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
        const address = fixture.server.address();
        origin = `http://127.0.0.1:${address.port}`;
        const startedAt = Date.now();

        await fetch(`${origin}/v1/chat/completions`, { method: "POST" });

        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30);
    });

    it("can return an explicit image failure for task-retry regression", async () => {
        await new Promise((resolve, reject) => fixture.server.close((error) => (error ? reject(error) : resolve())));
        fixture = createProtocolFixtureServer({ failImage: true });
        await new Promise((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
        const address = fixture.server.address();
        origin = `http://127.0.0.1:${address.port}`;

        const response = await fetch(`${origin}/v1/images/generations`, { method: "POST" });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ error: { message: "fixture image failure" } });
    });
});
