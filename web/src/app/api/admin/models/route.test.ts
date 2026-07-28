import { beforeEach, describe, expect, it, vi } from "vitest";

const savedChannel = { id: "saved", name: "已保存", baseUrl: "https://api.example.com/v1", apiKey: "test-secret-value", apiFormat: "openai", models: [], enabled: true };

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "admin", role: "admin" })) }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: vi.fn(async () => ({ systemChannels: [savedChannel] })) }));
vi.mock("@/lib/server/security", () => ({ isSafeOutboundUrl: vi.fn(async () => true) }));
vi.mock("@/lib/server/proxy-dispatcher", () => ({ configureServerProxyDispatcher: vi.fn() }));

import { POST } from "./route";

describe("admin models route", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        savedChannel.apiKey = "test-secret-value";
        (globalThis as typeof globalThis & { __vozebProModelFetchCooldowns?: Map<string, number> }).__vozebProModelFetchCooldowns?.clear();
    });

    it("uses the saved server-side API key when the client sends only channelId", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "gpt-test" }] }), { status: 200, headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);
        const response = await POST(request({ channelId: "saved" }));
        expect(await response.json()).toMatchObject({ models: ["gpt-test"], modelCapabilities: { "gpt-test": "text" }, discoveredCount: 1, totalCount: 1 });
        expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/v1/models", expect.objectContaining({ headers: { authorization: "Bearer test-secret-value" } }));
    });

    it("loads every paginated provider model page and returns capability metadata", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ data: [{ id: "writer-v1", type: "text" }], has_more: true, last_id: "writer-v1" }))
            .mockResolvedValueOnce(Response.json({ data: [{ id: "image-v1", type: "image" }], has_more: false }));
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ channelId: "saved" }));
        const payload = await response.json();

        expect(payload).toMatchObject({ models: ["image-v1", "writer-v1"], modelCapabilities: { "image-v1": "image", "writer-v1": "text" }, discoveredCount: 2, totalCount: 2 });
        expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/models?after=writer-v1");
    });

    it("merges the complete Agnes official catalog when its models endpoint only returns video", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json({ data: [{ id: "agnes-video-v2.0", type: "video" }] })),
        );

        const response = await POST(request({ channelId: "saved", baseUrl: "https://apihub.agnes-ai.com/v1" }));
        const payload = await response.json();

        expect(payload.models).toEqual(expect.arrayContaining(["agnes-2.0-flash", "agnes-image-2.0-flash", "agnes-image-2.1-flash", "agnes-video-v2.0"]));
        expect(payload.modelCapabilities).toMatchObject({ "agnes-2.0-flash": "text", "agnes-image-2.0-flash": "image", "agnes-image-2.1-flash": "image", "agnes-video-v2.0": "video" });
        expect(payload).toMatchObject({
            provider: "agnes",
            recommendedConfig: { textModel: "agnes-2.0-flash", imageModel: "agnes-image-2.1-flash", videoModel: "agnes-video-v2.0" },
            modelConfigs: { "agnes-video-v2.0": { capability: "video", createPath: "/videos", queryPath: "/agnesapi?video_id=:task_id" } },
        });
    });

    it("keeps manually configured models when the provider returns a partial catalog", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json({ data: [{ id: "video-only", type: "video" }] })),
        );

        const response = await POST(request({ channelId: "saved", configuredModels: ["manual-text"], modelCapabilities: { "manual-text": "text" } }));

        expect(await response.json()).toMatchObject({ models: ["manual-text", "video-only"], modelCapabilities: { "manual-text": "text", "video-only": "video" }, discoveredCount: 1, totalCount: 2 });
    });

    it("merges company-specific text and video catalog paths", async () => {
        const fetchMock = vi.fn(async (url: string | URL | Request) => {
            const value = String(url);
            if (value.endsWith("/v1/text-models")) return Response.json({ data: { text: ["openai-text"] } });
            if (value.endsWith("/v1/video-models")) return Response.json({ data: { video: [{ id: "sd2.0", endpoint: "/videos", query_path: "/videos/:task_id" }] } });
            return Response.json({ detail: "Not Found" }, { status: 404 });
        });
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ channelId: "saved", modelCatalogPaths: ["/v1/text-models", "/v1/video-models"] }));

        expect(await response.json()).toMatchObject({
            models: ["openai-text", "sd2.0"],
            modelCapabilities: { "openai-text": "text", "sd2.0": "video" },
            modelConfigs: { "sd2.0": { capability: "video", createPath: "/videos", queryPath: "/videos/:task_id" } },
        });
    });

    it("returns the complete built-in GlobalAiOpc vendor catalog without requesting an unavailable models endpoint", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(
            request({
                channelId: "saved",
                baseUrl: "https://zcbservice.aizfw.cn/kyyReactApiServer/v1",
                protocol: "auto",
            }),
        );
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.models).toEqual(expect.arrayContaining(["gpt-4.1", "gemini-3.1-pro-preview", "gpt-image-2", "happyhorse-1.0-i2v", "videos_stable", "videos_stable_fast"]));
        expect(payload.globalAiOpcPresets).toEqual(expect.arrayContaining(["text-openai-chat", "text-gemini-native", "image-gpt-image-2", "video-happyhorse-i2v", "video-videos"]));
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("redacts an API key echoed by the upstream error", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid test-secret-value" } }), { status: 401, headers: { "content-type": "application/json" } })),
        );
        const response = await POST(request({ channelId: "saved" }));
        const payload = await response.json();
        expect(payload.error).toContain("[REDACTED]");
        expect(JSON.stringify(payload)).not.toContain("test-secret-value");
    });

    it("rejects provider business errors returned with HTTP 200", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ code: "204", msg: "登录验证失败" }), { status: 200, headers: { "content-type": "application/json" } })),
        );
        const response = await POST(request({ channelId: "saved" }));
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: "登录验证失败" });
    });

    it("explains how to configure video providers without a model catalog", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ message: "No handler found for GET /kyyReactApiServer/v1/models" }), { status: 404, headers: { "content-type": "application/json" } })),
        );

        const response = await POST(request({ channelId: "saved" }));

        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ error: "该上游未提供模型列表接口，请在高级设置的“模型列表”手动填写模型名称；手工模型会在后续拉取时保留。" });
    });

    it("returns an explicit timeout diagnosis", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))),
        );
        const response = await POST(request({ channelId: "saved" }));
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: "拉取模型超时，请稍后重试" });
    });

    it("rejects an encrypted storage value before calling the provider", async () => {
        savedChannel.apiKey = "vozeb-pro-secret:v1:iv.tag.payload";
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ channelId: "saved" }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "请先填写 Base URL 和 API Key" });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

function request(body: unknown) {
    return new Request("http://localhost/api/admin/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
