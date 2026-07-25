import { describe, expect, it } from "vitest";

import { buildModelsUrl, isModelCatalogUnsupported, parseModels } from "./admin-model-catalog";

describe("admin model catalog", () => {
    it("builds OpenAI and Gemini model URLs", () => {
        expect(buildModelsUrl("https://api.example.com/v1", "openai")).toBe("https://api.example.com/v1/models");
        expect(buildModelsUrl("https://generativelanguage.googleapis.com/v1beta", "gemini")).toBe("https://generativelanguage.googleapis.com/v1beta/models");
        expect(buildModelsUrl("https://api.example.com/v1/models", "openai")).toBe("https://api.example.com/v1/models");
    });

    it("parses common and nested provider response shapes", () => {
        expect(parseModels({ data: [{ id: "gpt-test" }], models: [{ name: "models/gemini-test" }], result: { items: [{ model: "video-test" }] } })).toEqual(["gemini-test", "gpt-test", "video-test"]);
        expect(parseModels({ data: { id: "response-wrapper", models: [{ id: "nested-model" }] } })).toEqual(["nested-model"]);
        expect(parseModels({ data: [] })).toEqual([]);
    });

    it("recognizes provider routes that do not expose a model catalog", () => {
        expect(isModelCatalogUnsupported(404, { message: "No handler found for GET /kyyReactApiServer/v1/models" })).toBe(true);
        expect(isModelCatalogUnsupported(404, { message: "No handler found for GET /kyyReactApiServer/v1/videos/videos" })).toBe(false);
        expect(isModelCatalogUnsupported(401, { message: "No handler found for GET /v1/models" })).toBe(false);
    });
});
