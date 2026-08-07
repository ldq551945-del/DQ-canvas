import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ safeExternalFetch: vi.fn(), safeOutboundFetch: vi.fn() }));

vi.mock("@/lib/server/media-download", () => ({ fetchSafeExternalMedia: mocks.safeExternalFetch }));
vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutboundUrl: mocks.safeOutboundFetch }));
vi.mock("@/lib/server/internal-origin", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/server/internal-origin")>();
    return { ...actual, fetchInternalApi: (url: string | URL, init?: RequestInit) => fetch(url, init) };
});

import { GenerationSubmissionSafeFailure } from "@/lib/server/generation-submission-error";
import { workerContext } from "@/lib/server/maintenance-auth";
import {
    allowsImageProtocolFallback,
    imageRequestAspectRatio,
    imageTaskPollAttempts,
    imageTaskPollUrls,
    imageTaskRequestTimeoutMs,
    openAiImageTaskPath,
    resolveRequestSize,
    shouldFallbackToJsonImageEdit,
    shouldRetryJsonImageEditPayload,
    taskFetch,
    taskHeaders,
    imageReferenceToDataUrl,
} from "./image-task-support";

const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

beforeEach(() => vi.clearAllMocks());

const config = {
    baseUrl: "/api/ai/system/global-image",
    apiFormat: "openai",
    advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "image-gpt-image-2", createPath: "/image2/images", queryPath: "/result/:task_id" },
} as never;

describe("GlobalAiOpc image task paths", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("preserves maintenance authorization for the internal system proxy", () => {
        const token = "m".repeat(32);
        vi.stubEnv("DQ_WORKER_TOKEN", token);
        const headers = taskHeaders(
            {
                baseUrl: "/api/ai/system/channel-one",
                apiKey: "system",
                apiFormat: "openai",
                model: "image-model",
                logicalModel: "image-logical",
            } as never,
            workerContext("user-one"),
            "image-task:test:attempt:1",
        );

        expect(headers.get("authorization")).toBe(`Bearer ${token}`);
        expect(headers.get("x-dq-worker-user-id")).toBe("user-one");
        expect(headers.get("x-dq-logical-model")).toBe("image-logical");
    });

    it("upscales small exact dimensions for the provider instead of rejecting the task", () => {
        expect(resolveRequestSize(undefined, "400x600")).toBe("672x1008");
        expect(resolveRequestSize(undefined, "512x512")).toBe("816x816");
    });

    it("passes exact dimensions through without a platform resolution ceiling", () => {
        expect(resolveRequestSize(undefined, "5000x5000")).toBe("5000x5000");
        expect(resolveRequestSize(undefined, "1200x7200")).toBe("1200x7200");
    });

    it("uses the model binding timeout for synchronous requests and asynchronous polling", () => {
        const configured = {
            baseUrl: "/api/ai/system/global-image",
            apiFormat: "openai",
            model: "gemini-3-pro-image-preview",
            advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "image-gpt-image-2", createPath: "/image2/images", queryPath: "/result/:task_id" },
            capabilityProfile: { timeoutMs: 12 * 60_000 },
        } as never;
        expect(imageTaskRequestTimeoutMs(configured)).toBe(12 * 60_000);
        expect(imageTaskPollAttempts(configured)).toBe(288);
        expect(imageTaskRequestTimeoutMs(config)).toBe(10 * 60_000);
    });

    it.each([
        ["1080*1213", "1080x1213"],
        ["1080×1213", "1080x1213"],
        ["1080 X 1213", "1080x1213"],
    ])("normalizes custom image dimensions written as %s", (input, expected) => {
        expect(resolveRequestSize(undefined, input)).toBe(expected);
    });

    it("keeps a compatible ratio alongside exact custom dimensions", () => {
        expect(imageRequestAspectRatio("1824x1024")).toBe("16:9");
        expect(imageRequestAspectRatio("1024x1536")).toBe("2:3");
        expect(imageRequestAspectRatio("9:16")).toBe("9:16");
    });

    it("uses the configured create and result endpoints instead of OpenAI defaults", async () => {
        await expect(openAiImageTaskPath(config, "generation")).resolves.toBe("/image2/images");
        expect(imageTaskPollUrls(config, "http://localhost:3000/api/ai/system/global-image/image2/images", "task 1")[0]).toBe("http://localhost:3000/api/ai/system/global-image/result/task%201");
    });

    it("routes standard OpenAI generations and edits to their matching endpoints", async () => {
        const openAiConfig = {
            baseUrl: "https://provider.example/v1",
            model: "gpt-image-1",
            apiFormat: "openai",
            advancedConfig: { createPath: "/images/generations" },
        } as never;

        await expect(openAiImageTaskPath(openAiConfig, "generation")).resolves.toBe("/images/generations");
        await expect(openAiImageTaskPath(openAiConfig, "edit")).resolves.toBe("/images/edits");
    });

    it("routes an external model request through the checked outbound transport", async () => {
        mocks.safeOutboundFetch.mockResolvedValueOnce(Response.json({ ok: true }));
        const externalConfig = { baseUrl: "https://provider.example/v1", apiFormat: "openai", model: "gpt-image-1" } as never;

        await taskFetch(externalConfig, "https://provider.example/v1/images/generations", { method: "POST" });

        expect(mocks.safeOutboundFetch).toHaveBeenCalledWith("https://provider.example/v1/images/generations", expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }));
    });

    it("prefers the edit endpoint declared by the channel reference rule", async () => {
        const openAiConfig = {
            baseUrl: "https://provider.example/v1",
            model: "gpt-image-1",
            apiFormat: "openai",
            advancedConfig: { createPath: "/images/generations", referenceRule: "图生图使用 /images/edits；按 multipart/form-data 上传" },
        } as never;

        await expect(openAiImageTaskPath(openAiConfig, "edit")).resolves.toBe("/images/edits");
    });

    it("keeps Sub2API image edits on the configured shared endpoint", async () => {
        const sub2ApiConfig = {
            baseUrl: "https://provider.example/v1",
            model: "gpt-image-1",
            apiFormat: "openai",
            advancedConfig: { protocol: "sub2api", createPath: "/images/generations" },
        } as never;

        await expect(openAiImageTaskPath(sub2ApiConfig, "edit")).resolves.toBe("/images/generations");
    });

    it("treats a model-level protocol as strict even when the parent channel is legacy auto", () => {
        const modelConfig = {
            baseUrl: "https://provider.example/v1",
            model: "gpt-image-1",
            apiFormat: "openai",
            advancedConfig: {
                protocol: "auto",
                modelConfigs: {
                    "gpt-image-1": {
                        capability: "image",
                        protocol: "sub2api",
                        createPath: "/images/generations",
                        editPath: "/images/generations",
                        requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","image_urls":"{{images}}"}',
                        resultField: "data[0].url",
                    },
                },
            },
        } as never;

        expect(allowsImageProtocolFallback(modelConfig)).toBe(false);
    });

    it("recognizes Pydantic dictionary errors as an incompatible edit payload", () => {
        const message = "Input should be a valid dictionary or object to extract fields from";

        expect(shouldFallbackToJsonImageEdit(422, message)).toBe(true);
        expect(shouldRetryJsonImageEditPayload(422, message)).toBe(true);
    });
});

describe("image reference hydration", () => {
    it("reads an internal reference with the worker identity and converts it back to a data url", async () => {
        const token = "m".repeat(32);
        vi.stubEnv("DQ_WORKER_TOKEN", token);
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Uint8Array(PNG_BYTES), { status: 200, headers: { "content-type": "text/html", "content-length": String(PNG_BYTES.length) } }));

        await expect(imageReferenceToDataUrl({ dataUrl: "", url: "/api/reference-assets/temporary/2026/08/03/images/reference.png", type: "image/png" }, "reference.png", "http://internal", workerContext("user-one"))).resolves.toBe(
            `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
        );
        expect(fetchMock).toHaveBeenCalledWith(
            "http://internal/api/reference-assets/temporary/2026/08/03/images/reference.png",
            expect.objectContaining({ headers: expect.objectContaining({ authorization: `Bearer ${token}`, "x-dq-worker-user-id": "user-one" }) }),
        );
        fetchMock.mockRestore();
    });

    it("prefers a persisted internal reference over a stale external candidate", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Uint8Array(PNG_BYTES), { status: 200, headers: { "content-type": "image/png" } }));

        await imageReferenceToDataUrl(
            {
                dataUrl: "",
                remoteUrl: "https://stale.example/reference.png",
                url: "/api/reference-assets/temporary/2026/08/03/images/reference.png",
                type: "image/png",
            },
            "reference.png",
            "http://internal",
            "session=one",
        );

        expect(fetchMock).toHaveBeenCalledWith("http://internal/api/reference-assets/temporary/2026/08/03/images/reference.png", expect.objectContaining({ headers: { cookie: "session=one" } }));
        expect(mocks.safeExternalFetch).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it("hydrates legacy external-only references through the checked downloader", async () => {
        mocks.safeExternalFetch.mockResolvedValueOnce(new Response(new Uint8Array(PNG_BYTES), { status: 200, headers: { "content-type": "application/octet-stream" } }));
        const fetchMock = vi.spyOn(globalThis, "fetch");

        await expect(imageReferenceToDataUrl({ dataUrl: "", remoteUrl: "https://cdn.example/reference.png", type: "image/png" }, "reference.png", "http://internal", "")).resolves.toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);

        expect(mocks.safeExternalFetch).toHaveBeenCalledWith("https://cdn.example/reference.png", 30_000, { allowPrivateUpstreams: false });
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it("rejects a response that only claims to be an image", async () => {
        mocks.safeExternalFetch.mockResolvedValueOnce(new Response("<html>not an image</html>", { status: 200, headers: { "content-type": "image/png" } }));

        await expect(imageReferenceToDataUrl({ dataUrl: "", remoteUrl: "https://cdn.example/reference.png", type: "image/png" }, "reference.png", "http://internal", "")).rejects.toThrow();
    });
});
