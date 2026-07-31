import { describe, expect, it } from "vitest";

import type { SystemModelChannel } from "@/lib/auth/store";
import { applyChannelProtocol, applyModelProtocol, channelCredentialsReady, channelProtocolOptions, channelProtocolValidationErrors, normalizeStrictProtocolModelConfig, protocolAuthHeaders, resolveChannelModelConfig } from "./channel-protocol-registry";

const channel = {
    id: "one",
    name: "测试渠道",
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret",
    apiFormat: "openai",
    models: ["image-one"],
    enabled: false,
} satisfies SystemModelChannel;

describe("channel protocol registry", () => {
    it("exposes SD2 video and Stable Diffusion image as separate protocols", () => {
        const protocols = channelProtocolOptions().map((item) => item.value);
        expect(protocols).toEqual(expect.arrayContaining(["openai", "seedance", "stable-diffusion", "volcengine-video", "sub2api", "newapi", "seedance-special", "custom"]));
    });

    it("applies independent image edit and image-to-video paths", () => {
        expect(applyModelProtocol({ capability: "image" }, "openai")).toMatchObject({ createPath: "/images/generations", editPath: "/images/edits" });
        expect(applyModelProtocol({ capability: "video" }, "seedance")).toMatchObject({ createPath: "/contents/generations/tasks", imageToVideoPath: "/contents/generations/tasks" });
        expect(applyModelProtocol({ capability: "video" }, "volcengine-video")).toMatchObject({ createPath: "/contents/generations/tasks", queryPath: "/contents/generations/tasks/:task_id" });
        expect(applyModelProtocol({ capability: "image" }, "stable-diffusion")).toMatchObject({ createPath: "/sdapi/v1/txt2img", editPath: "/sdapi/v1/img2img", resultField: "images[0]" });
    });

    it("supports keyless Stable Diffusion channels without an authorization header", () => {
        const configured = applyChannelProtocol({ ...channel, apiKey: "", hasApiKey: false }, "stable-diffusion");
        expect(configured.advancedConfig?.authMode).toBe("none");
        expect(channelCredentialsReady(configured)).toBe(true);
        expect(protocolAuthHeaders("", configured.advancedConfig)).toEqual({});
    });

    it("loads the documented Seedance special models and rejects preset tampering", () => {
        const configured = applyChannelProtocol(channel, "seedance-special");
        expect(configured.models).toHaveLength(10);
        expect(channelProtocolValidationErrors(configured)).toEqual([]);
        const model = configured.models[0];
        const key = model.toLowerCase();
        const tampered = {
            ...configured,
            advancedConfig: {
                ...configured.advancedConfig!,
                modelConfigs: { ...configured.advancedConfig!.modelConfigs, [key]: { ...configured.advancedConfig!.modelConfigs![key], imageToVideoPath: "/wrong" } },
            },
        };
        expect(channelProtocolValidationErrors(tampered)).toContain(`${model} 的图生视频路径必须为 /v1/seedance-special/videos`);
    });

    it("allows a model-level Seedance route inside an OpenAI channel", () => {
        const configured = applyChannelProtocol({ ...channel, models: ["writer", "sd2.0"] }, "openai");
        const mixed = {
            ...configured,
            advancedConfig: {
                ...configured.advancedConfig!,
                modelConfigs: {
                    ...configured.advancedConfig!.modelConfigs,
                    "sd2.0": applyModelProtocol({ capability: "video" }, "seedance"),
                },
                modelCapabilities: { ...configured.advancedConfig!.modelCapabilities, "sd2.0": "video" as const },
            },
        };
        expect(channelProtocolValidationErrors(mixed)).toEqual([]);
    });

    it("restores strict model presets after catalog or health detection", () => {
        const configured = applyChannelProtocol({ ...channel, models: ["gpt-image-2"] }, "openai");
        const key = "gpt-image-2";
        configured.advancedConfig!.modelConfigs![key] = normalizeStrictProtocolModelConfig(
            {
                capability: "image",
                source: "health",
                protocol: "openai",
                createPath: "/images/generations",
                requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","response_format":"url"}',
            },
            "openai",
        );

        expect(configured.advancedConfig!.modelConfigs![key]).toEqual(applyModelProtocol({ capability: "image" }, "openai"));
        expect(channelProtocolValidationErrors(configured)).toEqual([]);
    });

    it("rejects unsafe custom authentication header names", () => {
        const configured = applyChannelProtocol(channel, "custom");
        configured.advancedConfig = { ...configured.advancedConfig!, authMode: "custom-header", authHeader: "Cookie" };
        expect(channelProtocolValidationErrors(configured)).toContain("测试渠道 的自定义鉴权请求头名称无效");
    });

    it("falls back to the capability operation when a model has no dedicated config", () => {
        expect(
            resolveChannelModelConfig(
                {
                    ...applyChannelProtocol(channel, "custom").advancedConfig!,
                    modelCapabilities: { opaque: "video" },
                    operationConfigs: { video: { capability: "video", protocol: "custom", createPath: "/jobs" } },
                },
                "opaque",
            ),
        ).toMatchObject({ capability: "video", protocol: "custom", createPath: "/jobs" });
    });
});
