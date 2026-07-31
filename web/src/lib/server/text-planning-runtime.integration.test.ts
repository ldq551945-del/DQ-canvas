import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SystemChannelAdvancedConfig, SystemModelChannel } from "@/lib/auth/store";
import { createProtocolFixtureServer } from "../../../scripts/protocol-fixture-server.mjs";
import { requestStructuredText, type TextPlanningCandidate } from "./text-planning-runtime";

let fixture: ReturnType<typeof createProtocolFixtureServer>;
let origin = "";

beforeAll(async () => {
    fixture = createProtocolFixtureServer();
    await new Promise<void>((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
    const address = fixture.server.address();
    if (!address || typeof address === "string") throw new Error("Protocol fixture did not expose a TCP port");
    origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => fixture.server.close((error: Error | undefined) => (error ? reject(error) : resolve())));
});

describe("text planning runtime live protocol fixture", () => {
    it.each(["openai", "sub2api", "newapi"] as const)("sends the %s preset through Chat and reads strict JSON", async (protocol) => {
        const result = await requestStructuredText(input(candidate(protocol)));

        expect(result).toMatchObject({ protocol: "chat", arguments: "{}" });
        expect(lastRequest()).toMatchObject({ path: `/api/ai/system/${protocol}/chat/completions`, body: expect.any(Buffer) });
        expect(JSON.parse(lastRequest().body.toString("utf8"))).toMatchObject({ model: "mock-text", messages: expect.any(Array) });
    });

    it("sends a configured Responses model once and reads output_text", async () => {
        const result = await requestStructuredText(input(candidate("compatible", { createPath: "/responses" })));

        expect(result).toMatchObject({ protocol: "responses", arguments: "{}" });
        expect(lastRequest().path).toBe("/api/ai/system/compatible/responses");
    });

    it("sends a native Gemini model to generateContent and reads candidate text", async () => {
        const result = await requestStructuredText(input(candidate("compatible", { apiFormat: "gemini", createPath: "/models/:model:generateContent" })));

        expect(result).toMatchObject({ protocol: "gemini", arguments: "{}" });
        expect(lastRequest().path).toBe("/api/ai/system/compatible/models/mock-text:generateContent");
    });

    it("sends a custom text template and reads the configured result field", async () => {
        const result = await requestStructuredText(input(candidate("custom", { createPath: "/planner/run", requestTemplate: '{"deployment":"{{model}}","conversation":"{{messages}}"}', resultField: "data.plan" })));

        expect(result).toMatchObject({ protocol: "custom", arguments: "{}" });
        expect(lastRequest().path).toBe("/api/ai/system/custom/planner/run");
    });
});

function input(configured: TextPlanningCandidate) {
    return {
        origin,
        cookie: "",
        candidate: configured,
        messages: [{ role: "user", content: "返回测试计划" }],
        tool: { name: "make_plan", description: "创建测试计划", parameters: { type: "object", properties: {} } },
    };
}

function candidate(protocol: SystemChannelAdvancedConfig["protocol"], options: Partial<SystemChannelAdvancedConfig> & { apiFormat?: "openai" | "gemini" } = {}): TextPlanningCandidate {
    const advancedConfig = {
        protocol,
        textModel: "mock-text",
        imageModel: "",
        videoModel: "",
        createPath: "",
        queryPath: "",
        requestTemplate: "",
        resultField: "",
        statusField: "",
        durationRange: "",
        referenceRule: "",
        supportsReferenceImage: false,
        supportsReferenceVideo: false,
        supportsReferenceAudio: false,
        ...options,
    } satisfies SystemChannelAdvancedConfig;
    const channel = { id: protocol, name: protocol, baseUrl: origin, apiKey: "fixture", apiFormat: options.apiFormat || "openai", models: ["mock-text"], enabled: true, advancedConfig } satisfies SystemModelChannel;
    return { channelId: channel.id, upstreamModel: "mock-text", channel };
}

function lastRequest() {
    const request = fixture.requests.at(-1);
    if (!request) throw new Error("Protocol fixture did not receive a request");
    return request;
}
