import { describe, expect, it, vi } from "vitest";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "../types";
import { emotionSourceIdentity, resolveEmotionEditRequestConfig, resolveEmotionFirstRetryInputs, resolveEmotionSource } from "./canvas-emotion-request";

describe("canvas emotion request routing", () => {
    it("uses model-level API format, protocol, and edit path", () => {
        const generationConfig = {
            ...defaultConfig,
            model: "image-model",
            imageModel: "image-model",
            channels: [
                {
                    id: "images",
                    name: "Images",
                    baseUrl: "/api/ai/system/images",
                    apiKey: "system",
                    apiFormat: "gemini",
                    models: ["image-model"],
                    advancedConfig: {
                        protocol: "custom",
                        textModel: "",
                        imageModel: "image-model",
                        videoModel: "",
                        createPath: "/global/generate",
                        queryPath: "",
                        requestTemplate: "",
                        resultField: "",
                        statusField: "",
                        durationRange: "",
                        referenceRule: "",
                        supportsReferenceImage: false,
                        supportsReferenceVideo: false,
                        supportsReferenceAudio: false,
                        modelConfigs: {
                            "image-model": {
                                capability: "image",
                                apiFormat: "openai",
                                protocol: "newapi",
                                editPath: "/model/images/edits",
                                supportsReferenceImage: true,
                            },
                        },
                    },
                },
            ],
        } satisfies AiConfig;

        const result = resolveEmotionEditRequestConfig(generationConfig);

        expect(result.supportsMaskedOpenAiEdit).toBe(true);
        expect(result.requestConfig.apiFormat).toBe("openai");
        expect(result.requestConfig.advancedConfig?.protocol).toBe("newapi");
        expect(result.requestConfig.advancedConfig?.editPath).toBe("/model/images/edits");
    });

    it("does not treat a sub2api edit path as masked multipart support without an explicit mask contract", () => {
        const generationConfig = {
            ...defaultConfig,
            model: "image-model",
            imageModel: "image-model",
            channels: [
                {
                    id: "images",
                    name: "Images",
                    baseUrl: "/api/ai/system/images",
                    apiKey: "system",
                    apiFormat: "openai",
                    models: ["image-model"],
                    advancedConfig: {
                        protocol: "sub2api",
                        textModel: "",
                        imageModel: "image-model",
                        videoModel: "",
                        createPath: "/v1/images/generations",
                        editPath: "/v1/images/edits",
                        queryPath: "",
                        requestTemplate: "",
                        resultField: "",
                        statusField: "",
                        durationRange: "",
                        supportsReferenceImage: true,
                        supportsReferenceVideo: false,
                        supportsReferenceAudio: false,
                        referenceRule: "",
                    },
                },
            ],
        } satisfies AiConfig;

        expect(resolveEmotionEditRequestConfig(generationConfig).supportsMaskedOpenAiEdit).toBe(false);
    });

    it("checks the emotion source before resolving ordinary saved references", async () => {
        const resolveStandardReferences = vi.fn(async () => ["ordinary-reference"]);

        await expect(resolveEmotionFirstRetryInputs({ sourceNodeId: "deleted-source" }, [], resolveStandardReferences)).rejects.toThrow("情绪编辑源图片已删除，无法重试");
        expect(resolveStandardReferences).not.toHaveBeenCalled();
    });

    it("skips ordinary saved references for a valid emotion retry", async () => {
        const source = { id: "source", metadata: { content: "data:image/png;base64,source" } } as CanvasNodeData;
        const resolveStandardReferences = vi.fn(async () => ["ordinary-reference"]);

        await expect(resolveEmotionFirstRetryInputs({ sourceNodeId: source.id }, [source], resolveStandardReferences)).resolves.toEqual({ kind: "emotion", source });
        expect(resolveStandardReferences).not.toHaveBeenCalled();
    });

    it("records and validates the submitted source asset before completing", () => {
        const source = { id: "source", metadata: { content: "/api/reference-assets/source", storageKey: "image:source" } } as CanvasNodeData;
        const descriptor = { sourceNodeId: source.id, ...emotionSourceIdentity(source) };

        expect(resolveEmotionSource(descriptor, [source])).toBe(source);
        expect(() => resolveEmotionSource(descriptor, [{ ...source, metadata: { ...source.metadata, content: "/api/reference-assets/replacement", storageKey: "image:replacement" } }])).toThrow("情绪编辑源图片已变化，未应用旧任务结果");
    });

    it("uses stable storage identity across page hydration and rejects changed transient content", () => {
        const stored = { id: "source", metadata: { content: "/signed/source?token=old", storageKey: "image:source" } } as CanvasNodeData;
        const transient = { id: "transient", metadata: { content: "blob:old" } } as CanvasNodeData;

        expect(resolveEmotionSource({ sourceNodeId: stored.id, ...emotionSourceIdentity(stored) }, [{ ...stored, metadata: { ...stored.metadata, content: "/signed/source?token=new" } }])).toBeTruthy();
        expect(() => resolveEmotionSource({ sourceNodeId: transient.id, ...emotionSourceIdentity(transient) }, [{ ...transient, metadata: { content: "blob:new" } }], "retry")).toThrow("情绪编辑源图片已变化，请重新选择表情后重试");
    });
});
