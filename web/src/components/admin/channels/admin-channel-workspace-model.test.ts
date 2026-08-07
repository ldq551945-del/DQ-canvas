import { describe, expect, it } from "vitest";

import type { SystemModelChannel } from "@/lib/auth/store";
import { applyChannelProtocol } from "@/lib/channel-protocol-registry";
import {
    channelProtocolLabel,
    channelWorkspaceStatus,
    channelWorkspaceStatusLabel,
    defaultModelField,
    removeChannelFromWorkspace,
    switchChannelBindingUpstream,
    updateChannelInWorkspace,
    validChannelBindingUpstream,
} from "./admin-channel-workspace-model";

const channel = applyChannelProtocol({ id: "sd2", name: "SD2 渠道", baseUrl: "https://api.example.com", apiKey: "secret", apiFormat: "openai", models: ["seedance-pro"], enabled: true } satisfies SystemModelChannel, "seedance");

describe("admin channel workspace model", () => {
    it("keeps SD2 and Stable Diffusion labels distinct", () => {
        const stableDiffusion = applyChannelProtocol({ ...channel, id: "sd", models: ["sdxl"] }, "stable-diffusion");
        expect(channelProtocolLabel(channel)).toContain("SD2");
        expect(channelProtocolLabel(stableDiffusion)).toContain("Stable Diffusion");
    });

    it("derives channel health from the current validation results", () => {
        expect(channelWorkspaceStatus(channel, {})).toBe("untested");
        expect(channelWorkspaceStatus(channel, { "sd2:video": { ok: true, kind: "video", model: "seedance-pro", status: 200 } })).toBe("healthy");
        expect(channelWorkspaceStatus(channel, { "sd2:video": { ok: false, kind: "video", model: "seedance-pro", status: 502 } })).toBe("warning");
    });

    it("restores a persisted successful check after the page reloads", () => {
        const persistedChannel = {
            id: "channel",
            name: "主渠道",
            baseUrl: "https://api.example.com",
            apiKey: "",
            apiFormat: "openai" as const,
            models: ["gpt-test"],
            enabled: true,
            healthResults: {
                text: { kind: "text" as const, model: "gpt-test", ok: true, status: 200, checkedAt: "2026-08-01T00:00:00.000Z" },
            },
        };

        expect(channelWorkspaceStatus(persistedChannel, {})).toBe("healthy");
        expect(channelWorkspaceStatusLabel(channelWorkspaceStatus(persistedChannel, {}))).toBe("正常");
    });

    it("removes dead bindings and defaults with a deleted channel", () => {
        const settings = {
            systemChannels: [channel],
            logicalModels: [{ id: "video-pro", name: "专业视频", capability: "video" as const, enabled: true, bindings: [{ id: "binding", channelId: channel.id, upstreamModel: "seedance-pro", enabled: true, priority: 1 }] }],
            defaultModels: { textModel: "", imageModel: "", videoModel: "video-pro", audioModel: "" },
        };
        expect(removeChannelFromWorkspace(settings, channel.id)).toEqual({ systemChannels: [], logicalModels: [], defaultModels: { textModel: "", imageModel: "", videoModel: "", audioModel: "" } });
        expect(defaultModelField("video")).toBe("videoModel");
    });

    it("clears stale logical-model fields when the upstream model changes", () => {
        expect(switchChannelBindingUpstream("image-upstream")).toEqual({ upstreamModel: "image-upstream", logicalId: "", newLogicalId: "", newLogicalName: "" });
    });

    it("does not carry an upstream model into another channel", () => {
        expect(validChannelBindingUpstream({ models: ["image-upstream"] }, "text-upstream")).toBe("image-upstream");
        expect(validChannelBindingUpstream({ models: ["image-upstream"] }, "image-upstream")).toBe("image-upstream");
        expect(validChannelBindingUpstream({ models: [] }, "image-upstream")).toBe("");
    });

    it("clears an unresolved default as soon as its only channel is disabled", () => {
        const settings = {
            systemChannels: [channel],
            logicalModels: [{ id: "video-pro", name: "专业视频", capability: "video" as const, enabled: true, bindings: [{ id: "binding", channelId: channel.id, upstreamModel: "seedance-pro", enabled: true, priority: 1 }] }],
            defaultModels: { textModel: "", imageModel: "", videoModel: "video-pro", audioModel: "" },
        };

        expect(updateChannelInWorkspace(settings, channel.id, { enabled: false }).defaultModels.videoModel).toBe("");
    });

    it("removes generated bindings when the channel model list is narrowed", () => {
        const settings = {
            systemChannels: [{ ...channel, models: ["video-a", "video-b"] }],
            logicalModels: [
                { id: "video-a", name: "Video A", capability: "video" as const, enabled: true, bindings: [{ id: "binding-a", channelId: channel.id, upstreamModel: "video-a", enabled: true, priority: 1 }] },
                { id: "video-b", name: "Video B", capability: "video" as const, enabled: true, bindings: [{ id: "binding-b", channelId: channel.id, upstreamModel: "video-b", enabled: true, priority: 1 }] },
            ],
            defaultModels: { textModel: "", imageModel: "", videoModel: "video-b", audioModel: "" },
        };

        const updated = updateChannelInWorkspace(settings, channel.id, { models: ["video-a"] });

        expect(updated.logicalModels.map((model) => model.id)).toEqual(["video-a"]);
        expect(updated.defaultModels.videoModel).toBe("video-a");
    });

    it("keeps channels with the same address and key independent", () => {
        const textChannel = {
            ...channel,
            id: "grok-text",
            models: ["grok-text"],
            advancedConfig: { ...channel.advancedConfig!, modelCatalogCapability: "text" as const },
        };
        const imageChannel = {
            ...channel,
            id: "grok-image",
            models: ["grok-image"],
            advancedConfig: { ...channel.advancedConfig!, modelCatalogCapability: "image" as const },
        };
        const settings = {
            systemChannels: [textChannel, imageChannel],
            logicalModels: [],
            defaultModels: { textModel: "", imageModel: "", videoModel: "", audioModel: "" },
        };

        const updated = updateChannelInWorkspace(settings, imageChannel.id, { models: ["grok-image", "grok-image-edit"] });

        expect(updated.systemChannels).toHaveLength(2);
        expect(updated.systemChannels[0]).toMatchObject({ id: "grok-text", baseUrl: channel.baseUrl, apiKey: channel.apiKey, models: ["grok-text"] });
        expect(updated.systemChannels[1]).toMatchObject({ id: "grok-image", baseUrl: channel.baseUrl, apiKey: channel.apiKey, models: ["grok-image", "grok-image-edit"] });
    });
});
