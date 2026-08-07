import { describe, expect, it } from "vitest";

import { buildGrok2ApiImageRequest, buildGrok2ApiVideoRequest, grok2ApiCatalogModelConfig, grok2ApiImageResolution, isGrok2ApiImageModel } from "./grok2api";

describe("grok2api image protocol", () => {
    it("uses aspect_ratio and resolution instead of OpenAI pixel size and quality", () => {
        expect(
            buildGrok2ApiImageRequest({
                model: "grok-imagine-image",
                prompt: "draw a blue logo",
                aspectRatio: "1:1",
                resolution: "2k",
                responseFormat: "url",
            }),
        ).toEqual({
            model: "grok-imagine-image",
            prompt: "draw a blue logo",
            n: 1,
            aspect_ratio: "1:1",
            resolution: "2k",
            response_format: "url",
        });
    });

    it("uses the documented image object shape for edits", () => {
        expect(
            buildGrok2ApiImageRequest({
                model: "grok-imagine-image-edit",
                prompt: "change the background",
                aspectRatio: "16:9",
                resolution: "1k",
                responseFormat: "b64_json",
                images: ["https://cdn.example.com/first.png", "https://cdn.example.com/second.png"],
            }),
        ).toMatchObject({
            image: { url: "https://cdn.example.com/first.png" },
            images: [{ url: "https://cdn.example.com/second.png" }],
        });
    });

    it("recognizes Grok image variants and maps workbench quality to supported resolutions", () => {
        expect(isGrok2ApiImageModel("Console/grok-imagine-image-quality")).toBe(true);
        expect(isGrok2ApiImageModel("grok-imagine-video")).toBe(false);
        expect(grok2ApiImageResolution("high")).toBe("2k");
        expect(grok2ApiImageResolution("medium")).toBe("1k");
    });
});

describe("grok2api video protocol", () => {
    it("builds only the documented text-to-video fields", () => {
        expect(
            buildGrok2ApiVideoRequest({
                model: "grok-imagine-video",
                prompt: "animate a blue logo",
                duration: 8,
                aspectRatio: "16:9",
                resolution: "720p",
            }),
        ).toEqual({
            model: "grok-imagine-video",
            prompt: "animate a blue logo",
            duration: 8,
            aspect_ratio: "16:9",
            resolution: "720p",
        });
    });

    it("maps the first image to image.url and the rest to reference_images", () => {
        expect(
            buildGrok2ApiVideoRequest({
                model: "grok-imagine-video",
                prompt: "animate references",
                duration: 5,
                aspectRatio: "9:16",
                resolution: "1080p",
                images: ["https://cdn.example.com/first.png", "https://cdn.example.com/second.png", "https://cdn.example.com/second.png"],
            }),
        ).toEqual({
            model: "grok-imagine-video",
            prompt: "animate references",
            duration: 5,
            aspect_ratio: "9:16",
            resolution: "1080p",
            image: { url: "https://cdn.example.com/first.png" },
            reference_images: [{ url: "https://cdn.example.com/second.png" }],
        });
    });

    it("only creates a provider override for Grok2API video models", () => {
        expect(grok2ApiCatalogModelConfig({ owned_by: "grok2api" }, "video")).toMatchObject({ protocol: "grok2api", createPath: "/v1/videos/generations" });
        expect(grok2ApiCatalogModelConfig({ owned_by: "grok2api" }, "text")).toBeUndefined();
        expect(grok2ApiCatalogModelConfig({ owned_by: "another-provider" }, "video")).toBeUndefined();
    });
});
