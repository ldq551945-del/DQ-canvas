import { describe, expect, it } from "vitest";

import type { LogicalModel, SystemModelChannel } from "@/lib/auth/store";
import { isLogicalModelResolvable, modelRoutingValidationErrors, normalizeDefaultModelsConfig, normalizeLogicalModelsConfig, resolveLogicalModelConfig } from "./model-routing-config";

const channel = (id: string, models: string[], enabled = true): SystemModelChannel => ({ id, name: id, baseUrl: `https://${id}.example.com/v1`, apiKey: "test-secret", apiFormat: "openai", models, enabled });

describe("model routing config", () => {
    it("removes missing, unsupported, and duplicate bindings", () => {
        const channels = [channel("one", ["models/GPT-TEST"]), channel("two", ["gpt-test-2"], false)];
        const models: LogicalModel[] = [
            {
                id: "writer",
                name: "Writer",
                capability: "text",
                enabled: true,
                bindings: [
                    { id: "one", channelId: "one", upstreamModel: "gpt-test", enabled: true, priority: 2 },
                    { id: "duplicate", channelId: "one", upstreamModel: "models/GPT-TEST", enabled: true, priority: 1 },
                    { id: "missing", channelId: "missing", upstreamModel: "gpt-test", enabled: true, priority: 3 },
                    { id: "unsupported", channelId: "two", upstreamModel: "other", enabled: true, priority: 4 },
                ],
            },
        ];
        expect(normalizeLogicalModelsConfig(models, channels)[0].bindings).toEqual([{ id: "one", channelId: "one", upstreamModel: "gpt-test", enabled: true, priority: 2 }]);
    });

    it("preserves an explicitly empty logical model catalog", () => {
        const channels = [channel("one", ["writer"])];

        expect(normalizeLogicalModelsConfig([], channels)).toEqual([]);
        expect(normalizeLogicalModelsConfig(undefined, channels)).toHaveLength(1);
    });

    it("classifies short Stable Diffusion channel models as image models", () => {
        const models = normalizeLogicalModelsConfig(undefined, [channel("one", ["sd2", "sd3-medium", "video-v1"])]);

        expect(models.find((model) => model.id === "sd2")?.capability).toBe("image");
        expect(models.find((model) => model.id === "sd3-medium")?.capability).toBe("image");
        expect(models.find((model) => model.id === "video-v1")?.capability).toBe("video");
    });

    it("normalizes an existing Stable Diffusion logical model away from video", () => {
        const channels = [channel("one", ["sd2"])];
        const models = normalizeLogicalModelsConfig([{ id: "sd2", name: "Stable Diffusion", capability: "video", enabled: true, bindings: [{ id: "one", channelId: "one", upstreamModel: "sd2", enabled: true, priority: 1 }] }], channels);

        expect(models[0]?.capability).toBe("image");
        expect(normalizeDefaultModelsConfig({ textModel: "", imageModel: "", videoModel: "sd2", audioModel: "" }, models, channels).videoModel).toBe("");
    });

    it("requires an enabled matching binding for defaults", () => {
        const channels = [channel("one", ["vendor/writer"]), channel("off", ["voice"], false)];
        const models: LogicalModel[] = [
            { id: "writer", name: "Writer", capability: "text", enabled: true, bindings: [{ id: "one", channelId: "one", upstreamModel: "vendor/writer", enabled: true, priority: 1 }] },
            { id: "voice", name: "Voice", capability: "audio", enabled: true, bindings: [{ id: "two", channelId: "off", upstreamModel: "voice", enabled: true, priority: 1 }] },
        ];
        expect(isLogicalModelResolvable(models, channels, "text", "writer")).toBe(true);
        expect(normalizeDefaultModelsConfig({ textModel: "writer", imageModel: "writer", videoModel: "", audioModel: "voice" }, models, channels)).toEqual({ textModel: "writer", imageModel: "", videoModel: "", audioModel: "" });
    });

    it("uses binding priority and falls back from a disabled channel", () => {
        const channels = [channel("primary", ["writer-v1"], false), channel("backup", ["writer-v2"])];
        const models: LogicalModel[] = [
            {
                id: "writer",
                name: "Writer",
                capability: "text",
                enabled: true,
                bindings: [
                    { id: "one", channelId: "primary", upstreamModel: "writer-v1", enabled: true, priority: 1 },
                    { id: "two", channelId: "backup", upstreamModel: "writer-v2", enabled: true, priority: 2 },
                ],
            },
        ];
        expect(resolveLogicalModelConfig(models, channels, "text", "writer")).toMatchObject({ channel: { id: "backup" }, binding: { upstreamModel: "writer-v2" } });
    });

    it("normalizes binding weight and capability profile limits", () => {
        const channels = [channel("one", ["video-model"])];
        const models = normalizeLogicalModelsConfig(
            [
                {
                    id: "video",
                    name: "Video",
                    capability: "video",
                    enabled: true,
                    bindings: [
                        {
                            id: "one",
                            channelId: "one",
                            upstreamModel: "video-model",
                            enabled: true,
                            priority: 1,
                            weight: 250,
                            capabilityProfile: {
                                supportsReferenceImage: true,
                                maxReferenceImages: 4,
                                aspectRatios: ["16:9", "16:9", "9:16"],
                                maxDurationSeconds: 10,
                                maxBatchSize: 2,
                                timeoutMs: 600000,
                                concurrencyLimit: 3,
                                unitCost: 0.25,
                                unitCostCurrency: "USD",
                            },
                        },
                    ],
                },
            ],
            channels,
        );

        expect(models[0].bindings[0]).toMatchObject({
            weight: 250,
            capabilityProfile: { supportsReferenceImage: true, maxReferenceImages: 4, aspectRatios: ["16:9", "9:16"], maxDurationSeconds: 10, maxBatchSize: 2, timeoutMs: 600000, concurrencyLimit: 3, unitCost: 0.25, unitCostCurrency: "USD" },
        });
    });

    it("reports duplicate bindings and invalid defaults", () => {
        const channels = [channel("one", ["writer"])];
        const models: LogicalModel[] = [
            {
                id: "writer",
                name: "Writer",
                capability: "text",
                enabled: true,
                bindings: [
                    { id: "one", channelId: "one", upstreamModel: "writer", enabled: true, priority: 1 },
                    { id: "two", channelId: "one", upstreamModel: "models/WRITER", enabled: true, priority: 2 },
                ],
            },
        ];
        expect(modelRoutingValidationErrors(models, channels, { textModel: "missing", imageModel: "", videoModel: "", audioModel: "" })).toEqual(expect.arrayContaining(["逻辑模型 writer 存在重复绑定", "默认文本模型不可解析：missing"]));
    });

    it("reports Stable Diffusion models saved with the wrong capability", () => {
        const channels = [channel("one", ["sd2"])];
        const models: LogicalModel[] = [{ id: "sd2", name: "Stable Diffusion", capability: "video", enabled: true, bindings: [{ id: "one", channelId: "one", upstreamModel: "sd2", enabled: true, priority: 1 }] }];

        expect(modelRoutingValidationErrors(models, channels, { textModel: "", imageModel: "", videoModel: "sd2", audioModel: "" })).toEqual(expect.arrayContaining(["逻辑模型 sd2 更像图片模型，请调整能力类型"]));
    });
});
