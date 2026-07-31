import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    checkMediaProxyRateLimit: vi.fn(),
    consumeUserPoints: vi.fn(),
    getAuthSettings: vi.fn(),
    refundUserPoints: vi.fn(),
    safeUrl: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user-one" })) }));
vi.mock("@/lib/auth/store", () => ({
    consumeUserPoints: mocks.consumeUserPoints,
    getAuthSettings: mocks.getAuthSettings,
    isQuotaExceededError: vi.fn(() => false),
    refundUserPoints: mocks.refundUserPoints,
}));
vi.mock("@/lib/server/proxy-dispatcher", () => ({ configureServerProxyDispatcher: vi.fn() }));
vi.mock("@/lib/server/security", () => ({
    checkMediaProxyRateLimit: mocks.checkMediaProxyRateLimit,
    isSafeOutboundUrl: mocks.safeUrl,
    rateLimitHeaders: vi.fn(() => ({ "Retry-After": "60" })),
}));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ channelId: "channel-one", path: ["_media"] }) };

describe("system media proxy", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.checkMediaProxyRateLimit.mockResolvedValue({ allowed: true, remaining: 119, resetAt: Date.now() + 60_000 });
        mocks.safeUrl.mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", apiFormat: "openai", models: [] }],
        });
    });

    it("blocks authenticated media requests when the rate limit is exhausted", async () => {
        mocks.checkMediaProxyRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });
        const fetchMock = vi.spyOn(globalThis, "fetch");

        const response = await GET(request(), context);

        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("60");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects oversized upstream media", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { headers: { "content-length": String(300 * 1024 * 1024 + 1) } }));

        const response = await GET(request(), context);

        expect(response.status).toBe(413);
    });

    it("forces private caching for channel media", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("media", { headers: { "cache-control": "public, max-age=86400", "content-type": "image/png" } }));

        const response = await GET(request(), context);

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, max-age=600");
    });

    it("checks every media redirect before fetching the next hop", async () => {
        mocks.safeUrl.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private.png" } }));

        const response = await GET(request(), context);

        expect(response.status).toBe(502);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("uses Bearer authentication for GlobalAiOpc media even when its API format is Gemini", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://zcbservice.aizfw.cn/kyyReactApiServer",
                    apiKey: "secret",
                    apiFormat: "gemini",
                    models: [],
                    advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "video-seedance-x1" },
                },
            ],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("media", { headers: { "content-type": "video/mp4" } }));

        const response = await GET(request("/v1/result/task-one"), context);

        expect(response.status).toBe(200);
        const [, init] = fetchMock.mock.calls[0];
        expect(fetchMock.mock.calls[0][0]).toBe("https://zcbservice.aizfw.cn/v1/result/task-one");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBeNull();
    });
});

describe("GlobalAiOpc native text proxy", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "http://apillm.globalaiopc.com/gw_llm_power",
                    apiKey: "secret",
                    apiFormat: "gemini",
                    models: ["gemini-3.1-pro-preview"],
                    advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "text-gemini-native" },
                },
            ],
        });
    });

    it("maps internal Chat calls to Gemini native paths, payloads, and Bearer authentication", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }] }), { headers: { "content-type": "application/json" } }));

        const response = await POST(chatRequest({ model: "gemini-3.1-pro-preview", messages: [{ role: "user", content: "hello" }] }), textContext());

        expect(response.status).toBe(200);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("http://apillm.globalaiopc.com/gw_llm_power/v1/models/gemini-3.1-pro-preview:generateContent");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBeNull();
        expect(JSON.parse(String(init?.body))).toMatchObject({ contents: [{ role: "user", parts: [{ text: "hello" }] }] });
        expect(await response.json()).toMatchObject({ choices: [{ message: { role: "assistant", content: "OK" } }] });
    });

    it("charges text calls with the logical model id instead of the upstream alias", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [
                {
                    id: "writer",
                    name: "写作模型",
                    capability: "text",
                    enabled: true,
                    bindings: [{ id: "writer-binding", channelId: "channel-one", upstreamModel: "vendor-text", enabled: true, priority: 1 }],
                },
            ],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["vendor-text"] }],
        });
        vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }] }));

        const response = await POST(chatRequest({ model: "vendor-text", messages: [{ role: "user", content: "hello" }] }), textContext());

        expect(response.status).toBe(200);
        expect(mocks.consumeUserPoints).toHaveBeenCalledWith("user-one", "writer", 1, "text", undefined);
    });

    it("uses the validated preferred logical model and stable idempotency key when aliases are shared", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [
                { id: "writer-basic", name: "基础写作", capability: "text", enabled: true, bindings: [{ id: "basic", channelId: "channel-one", upstreamModel: "vendor-shared", enabled: true, priority: 1 }] },
                { id: "writer-pro", name: "专业写作", capability: "text", enabled: true, bindings: [{ id: "pro", channelId: "channel-one", upstreamModel: "vendor-shared", enabled: true, priority: 2 }] },
            ],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://api.example.com/v1", apiKey: "secret", apiFormat: "openai", models: ["vendor-shared"] }],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "OK" } }] }));
        const request = new Request("http://localhost/api/ai/system/channel-one/chat/completions", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "idempotency-key": "upstream-request-one",
                "x-client-request-id": "client-request-one",
                "x-vozeb-pro-logical-model": "writer-pro",
                "x-vozeb-pro-points-idempotency-key": "text-task:one:attempt:1",
            },
            body: JSON.stringify({ model: "vendor-shared", messages: [{ role: "user", content: "hello" }] }),
        });

        const response = await POST(request, textContext());

        expect(response.status).toBe(200);
        expect(mocks.consumeUserPoints).toHaveBeenCalledWith("user-one", "writer-pro", 1, "text", "system-ai:text-task:one:attempt:1:chat/completions");
        const upstreamHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
        expect(upstreamHeaders.get("idempotency-key")).toBe("upstream-request-one");
        expect(upstreamHeaders.get("x-client-request-id")).toBe("client-request-one");
    });

    it("routes GlobalAiOpc media models from one catalog channel to the matching service endpoint", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://zcbservice.aizfw.cn/kyyReactApiServer/v1",
                    apiKey: "secret",
                    apiFormat: "openai",
                    models: ["happyhorse-1.0-i2v", "videos_stable"],
                    advancedConfig: { protocol: "globalaiopc", globalAiOpcPresets: ["video-happyhorse-i2v", "video-videos"] },
                },
            ],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "task" }), { headers: { "content-type": "application/json" } }));

        const response = await POST(chatRequest({ model: "videos_stable", prompt: "hello" }), { params: Promise.resolve({ channelId: "channel-one", path: ["videos", "videos"] }) });

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://zcbservice.aizfw.cn/kyyReactApiServer/v1/videos/videos");
    });

    it("keeps the GlobalAiOpc service prefix and v1 version when polling a video task", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://zcbservice.aizfw.cn/kyyReactApiServer/v1",
                    apiKey: "secret",
                    apiFormat: "openai",
                    models: ["videos_stable"],
                    advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "video-videos" },
                },
            ],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "video-one", status: "processing" }), { headers: { "content-type": "application/json" } }));

        const response = await GET(new Request("http://localhost/api/ai/system/channel-one/result/video-one"), { params: Promise.resolve({ channelId: "channel-one", path: ["result", "video-one"] }) });

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://zcbservice.aizfw.cn/kyyReactApiServer/v1/result/video-one");
    });

    it("maps internal Chat calls to Claude Messages and leaves Responses for Chat fallback", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "http://apillm.globalaiopc.com/gw_llm_power",
                    apiKey: "secret",
                    apiFormat: "openai",
                    models: ["claude-opus-4-6"],
                    advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "text-claude-native" },
                },
            ],
        });
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" }), { headers: { "content-type": "application/json" } }));

        const response = await POST(chatRequest({ model: "claude-opus-4-6", messages: [{ role: "user", content: "hello" }] }), textContext());

        expect(fetchMock.mock.calls[0][0]).toBe("http://apillm.globalaiopc.com/gw_llm_power/v1/messages");
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ model: "claude-opus-4-6", messages: [{ role: "user", content: "hello" }] });
        expect(await response.json()).toMatchObject({ choices: [{ message: { role: "assistant", content: "OK" } }] });

        fetchMock.mockClear();
        const fallback = await POST(new Request("http://localhost/api/ai/system/channel-one/responses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude-opus-4-6", input: "hello" }) }), {
            params: Promise.resolve({ channelId: "channel-one", path: ["responses"] }),
        });
        expect(fallback.status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("Agnes video polling proxy", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [],
            systemChannels: [{ id: "channel-one", enabled: true, baseUrl: "https://apihub.agnes-ai.com/v1", apiKey: "secret", apiFormat: "openai", models: ["agnes-video-v2.0"] }],
        });
    });

    it("queries the documented root agnesapi endpoint instead of nesting it under v1", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "video-one", status: "processing" }));

        const response = await GET(new Request("http://localhost/api/ai/system/channel-one/agnesapi?video_id=video-one"), {
            params: Promise.resolve({ channelId: "channel-one", path: ["agnesapi"] }),
        });

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://apihub.agnes-ai.com/agnesapi?video_id=video-one");
    });
});

describe("Stable Diffusion proxy", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [
                {
                    id: "image-local",
                    name: "本地图片",
                    capability: "image",
                    enabled: true,
                    bindings: [{ id: "sd-binding", channelId: "channel-one", upstreamModel: "sdxl", enabled: true, priority: 1 }],
                },
            ],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://sd.example.com",
                    apiKey: "",
                    apiFormat: "openai",
                    models: ["sdxl"],
                    advancedConfig: { protocol: "stable-diffusion", authMode: "none", createPath: "/sdapi/v1/txt2img" },
                },
            ],
        });
    });

    it("keeps the sdapi path literal and omits authentication", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ images: ["image-base64"] }));
        const response = await POST(
            new Request("http://localhost/api/ai/system/channel-one/sdapi/v1/txt2img", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-vozeb-pro-logical-model": "image-local",
                    "x-vozeb-pro-upstream-model": "sdxl",
                },
                body: JSON.stringify({ prompt: "test", width: 1024, height: 1024 }),
            }),
            { params: Promise.resolve({ channelId: "channel-one", path: ["sdapi", "v1", "txt2img"] }) },
        );

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://sd.example.com/sdapi/v1/txt2img");
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBeNull();
    });
});

describe("custom protocol model routing", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.consumeUserPoints.mockReset().mockResolvedValue(undefined);
        mocks.refundUserPoints.mockReset();
        mocks.safeUrl.mockResolvedValue(true);
        mocks.getAuthSettings.mockResolvedValue({
            generationPointMultipliers: {},
            logicalModels: [
                {
                    id: "image-tool",
                    name: "图片工具",
                    capability: "image",
                    enabled: true,
                    bindings: [{ id: "image-binding", channelId: "channel-one", upstreamModel: "engine-one", enabled: true, priority: 1 }],
                },
            ],
            systemChannels: [
                {
                    id: "channel-one",
                    enabled: true,
                    baseUrl: "https://api.example.com/v1",
                    apiKey: "secret",
                    apiFormat: "openai",
                    models: ["engine-one"],
                    advancedConfig: {
                        protocol: "custom",
                        modelConfigs: { "engine-one": { capability: "image", protocol: "custom", createPath: "/jobs/image" } },
                    },
                },
            ],
        });
    });

    it("uses the trusted upstream model header when a custom body has no model field", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ url: "https://cdn.example.com/result.png" }));
        const response = await POST(
            new Request("http://localhost/api/ai/system/channel-one/jobs/image", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-vozeb-pro-logical-model": "image-tool",
                    "x-vozeb-pro-upstream-model": "engine-one",
                },
                body: JSON.stringify({ engine: "engine-one", prompt: "test" }),
            }),
            { params: Promise.resolve({ channelId: "channel-one", path: ["jobs", "image"] }) },
        );

        expect(response.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/jobs/image");
        expect(mocks.consumeUserPoints).toHaveBeenCalledWith("user-one", "image-tool", 1, "image", undefined);
    });
});

function request(url = "https://cdn.example.com/media.png") {
    return new Request(`http://localhost/api/ai/system/channel-one/_media?url=${encodeURIComponent(url)}`);
}

function textContext() {
    return { params: Promise.resolve({ channelId: "channel-one", path: ["chat", "completions"] }) };
}

function chatRequest(body: unknown) {
    return new Request("http://localhost/api/ai/system/channel-one/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
