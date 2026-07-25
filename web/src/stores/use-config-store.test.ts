import { describe, expect, it } from "vitest";

import { applyPublicSystemSettings, defaultConfig, modelMatchesCapability, modelOptionLabel, type PublicSystemSettings } from "./use-config-store";

const audioSettings: PublicSystemSettings = {
    systemChannels: [
        {
            id: "audio-channel",
            name: "音频渠道",
            baseUrl: "https://api.example.com/v1",
            apiKey: "",
            apiFormat: "openai",
            models: ["speech-v1"],
            enabled: true,
            hasApiKey: true,
        },
    ],
    logicalModels: [
        {
            id: "speech-v1",
            name: "语音模型",
            capability: "audio",
            enabled: true,
            bindings: [{ id: "audio-binding", channelId: "audio-channel", upstreamModel: "speech-v1", enabled: true, priority: 0 }],
        },
    ],
};

describe("applyPublicSystemSettings", () => {
    it("does not reuse a persisted audio model when the administrator has no default", () => {
        const config = applyPublicSystemSettings({ ...defaultConfig, audioModel: "speech-v1" }, audioSettings);

        expect(config.audioModels).toEqual(["speech-v1"]);
        expect(config.audioModel).toBe("");
    });

    it("uses the administrator default audio model when it is resolvable", () => {
        const config = applyPublicSystemSettings(defaultConfig, {
            ...audioSettings,
            defaultModels: { audioModel: "speech-v1" },
        });

        expect(config.audioModel).toBe("speech-v1");
    });

    it("keeps short Stable Diffusion model names out of video and text candidates", () => {
        expect(modelMatchesCapability("sd2", "image")).toBe(true);
        expect(modelMatchesCapability("sd2", "video")).toBe(false);
        expect(modelMatchesCapability("sd2", "text")).toBe(false);
        expect(modelMatchesCapability("sd3-medium", "image")).toBe(true);
    });

    it("falls back from a persisted image model to the administrator video default", () => {
        const config = applyPublicSystemSettings({ ...defaultConfig, model: "sd2", videoModel: "sd2" }, rawModelSettings());

        expect(config.imageModels).toEqual(["sd2"]);
        expect(config.videoModels).toEqual(["video-v1"]);
        expect(config.videoModel).toBe("video-v1");
    });

    it("normalizes public logical models before building video candidates", () => {
        const config = applyPublicSystemSettings({ ...defaultConfig, model: "sd2", videoModel: "sd2" }, mislabeledLogicalSettings());

        expect(config.logicalModels.find((model) => model.id === "sd2")?.capability).toBe("image");
        expect(config.imageModels).toEqual(["sd2"]);
        expect(config.videoModels).toEqual(["video-v1"]);
        expect(config.videoModel).toBe("video-v1");
    });

    it("does not expose misleading image-like names on public video models", () => {
        const config = applyPublicSystemSettings(defaultConfig, misleadingVideoNameSettings());

        expect(config.videoModels).toEqual(["video-v1"]);
        expect(modelOptionLabel(config, "video-v1")).toBe("sd2");
    });

    it("keeps a configured logical default when casing or the upstream alias differs", () => {
        const config = applyPublicSystemSettings(defaultConfig, {
            ...rawModelSettings(),
            defaultModels: { videoModel: "VENDOR/VIDEO-V1" },
            logicalModels: [
                {
                    id: "video-v1",
                    name: "默认视频模型",
                    capability: "video",
                    enabled: true,
                    bindings: [{ id: "video-binding", channelId: "mixed-channel", upstreamModel: "video-v1", enabled: true, priority: 1 }],
                },
            ],
        });

        expect(config.videoModel).toBe("video-v1");
    });

    it("uses an existing upstream point price for the logical model estimate", () => {
        const config = applyPublicSystemSettings(defaultConfig, {
            ...audioSettings,
            modelPointCosts: { "speech-v1": 2.5 },
            logicalModels: [{ ...audioSettings.logicalModels![0], id: "voice-pro" }],
        });

        expect(config.modelPointCosts["voice-pro"]).toBe(2.5);
    });
});

function rawModelSettings(): PublicSystemSettings {
    return {
        systemChannels: [
            {
                id: "mixed-channel",
                name: "混合渠道",
                baseUrl: "https://api.example.com/v1",
                apiKey: "",
                apiFormat: "openai",
                models: ["sd2", "video-v1"],
                enabled: true,
                hasApiKey: true,
            },
        ],
        defaultModels: { videoModel: "video-v1" },
    };
}

function mislabeledLogicalSettings(): PublicSystemSettings {
    return {
        ...rawModelSettings(),
        logicalModels: [
            {
                id: "sd2",
                name: "Stable Diffusion",
                capability: "video",
                enabled: true,
                bindings: [{ id: "sd-binding", channelId: "mixed-channel", upstreamModel: "sd2", enabled: true, priority: 1 }],
            },
            {
                id: "video-v1",
                name: "文生视频",
                capability: "video",
                enabled: true,
                bindings: [{ id: "video-binding", channelId: "mixed-channel", upstreamModel: "video-v1", enabled: true, priority: 2 }],
            },
        ],
    };
}

function misleadingVideoNameSettings(): PublicSystemSettings {
    return {
        ...rawModelSettings(),
        logicalModels: [
            {
                id: "video-v1",
                name: "sd2",
                capability: "video",
                enabled: true,
                bindings: [{ id: "video-binding", channelId: "mixed-channel", upstreamModel: "video-v1", enabled: true, priority: 1 }],
            },
        ],
    };
}
