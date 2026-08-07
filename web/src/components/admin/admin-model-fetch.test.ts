import { describe, expect, it } from "vitest";

import { emptyAdvancedConfig } from "@/lib/channel-protocol-registry";
import type { SystemModelChannel } from "@/lib/auth/store";
import { adminModelsChannelPatch } from "./admin-model-fetch";

describe("admin model capability pulls", () => {
    it("removes models and metadata outside the selected catalog capability", () => {
        const channel: SystemModelChannel = {
            id: "grok-image",
            name: "Grok 图片渠道",
            baseUrl: "https://api.example.com",
            apiKey: "secret",
            apiFormat: "openai",
            enabled: true,
            models: ["grok-chat", "grok-imagine-image"],
            advancedConfig: {
                ...emptyAdvancedConfig(),
                protocol: "openai",
                modelCatalogCapability: "image",
                modelCapabilities: { "grok-chat": "text", "grok-imagine-image": "image", stale: "video" },
                modelConfigs: {
                    "grok-chat": { capability: "text", protocol: "openai" },
                    "grok-imagine-image": { capability: "image", protocol: "openai" },
                    stale: { capability: "video", protocol: "grok2api" },
                },
            },
        };

        const patch = adminModelsChannelPatch(channel, {
            models: ["grok-imagine-image", "grok-imagine-image-quality"],
            modelCapabilities: { "grok-imagine-image": "image", "grok-imagine-image-quality": "image" },
            modelConfigs: { "grok-imagine-image-quality": { capability: "image", protocol: "openai" } },
        });

        expect(patch.models).toEqual(["grok-imagine-image", "grok-imagine-image-quality"]);
        expect(patch.advancedConfig?.modelCapabilities).toEqual({ "grok-imagine-image": "image", "grok-imagine-image-quality": "image" });
        expect(Object.keys(patch.advancedConfig?.modelConfigs || {})).toEqual(["grok-imagine-image", "grok-imagine-image-quality"]);
    });
});
