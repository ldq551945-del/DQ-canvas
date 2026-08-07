import { describe, expect, it } from "vitest";

import type { SystemModelChannel } from "@/lib/auth/store";
import { applyChannelProtocol } from "@/lib/channel-protocol-registry";
import { buildAdvancedConfigFromHealth } from "./admin-channel-health-config";

describe("buildAdvancedConfigFromHealth", () => {
    it("keeps a mixed provider on its channel protocol and stores the video override per model", () => {
        const channel = applyChannelProtocol(
            {
                id: "mixed",
                name: "Mixed provider",
                baseUrl: "https://api.example.com",
                apiKey: "secret",
                apiFormat: "openai",
                models: ["grok-chat", "grok-imagine-image", "grok-imagine-video"],
                enabled: false,
            } satisfies SystemModelChannel,
            "openai",
        );
        const currentCreatePath = channel.advancedConfig?.createPath;

        const config = buildAdvancedConfigFromHealth(channel, [
            { ok: true, kind: "text", model: "grok-chat", status: 200, protocolKey: "openai", createPath: "/responses" },
            { ok: true, kind: "image", model: "grok-imagine-image", status: 200, protocolKey: "openai", createPath: "/images/generations" },
            {
                ok: true,
                kind: "video",
                model: "grok-imagine-video",
                status: 200,
                protocolKey: "grok2api",
                createPath: "/v1/videos/generations",
                queryPath: "/v1/videos/:task_id",
            },
        ]);

        expect(config.protocol).toBe("openai");
        expect(config.createPath).toBe(currentCreatePath);
        expect(config.modelConfigs?.["grok-chat"]).toMatchObject({ capability: "text", protocol: "openai" });
        expect(config.modelConfigs?.["grok-imagine-image"]).toMatchObject({ capability: "image", protocol: "openai" });
        expect(config.modelConfigs?.["grok-imagine-video"]).toMatchObject({
            capability: "video",
            protocol: "grok2api",
            createPath: "/v1/videos/generations",
            queryPath: "/v1/videos/:task_id",
        });
    });

    it("still adopts a single detected protocol", () => {
        const channel = applyChannelProtocol(
            {
                id: "video",
                name: "Video provider",
                baseUrl: "https://api.example.com",
                apiKey: "secret",
                apiFormat: "openai",
                models: ["video-model"],
                enabled: false,
            } satisfies SystemModelChannel,
            "openai",
        );

        const config = buildAdvancedConfigFromHealth(channel, [{ ok: true, kind: "video", model: "video-model", status: 200, protocolKey: "grok2api", createPath: "/v1/videos/generations" }]);

        expect(config.protocol).toBe("grok2api");
        expect(config.createPath).toBe("/v1/videos/generations");
    });
});
