import { beforeEach, describe, expect, it, vi } from "vitest";

const savedChannel = { id: "saved", name: "已保存", baseUrl: "https://api.example.com/v1", apiKey: "test-secret-value", apiFormat: "openai", models: ["gpt-test", "tts-test"], enabled: true };

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "admin", role: "admin" })) }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: vi.fn(async () => ({ systemChannels: [savedChannel] })) }));
vi.mock("@/lib/server/security", () => ({ isSafeOutboundUrl: vi.fn(async () => true) }));
vi.mock("@/lib/server/proxy-dispatcher", () => ({ configureServerProxyDispatcher: vi.fn() }));

import { POST } from "./route";
import { protocolModelConfig } from "@/lib/channel-protocol-registry";

describe("admin channel health route", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        (globalThis as typeof globalThis & { __vozebProChannelHealthCooldowns?: Map<string, number> }).__vozebProChannelHealthCooldowns?.clear();
    });

    it("rejects health checks without configured credentials", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ baseUrl: "", apiKey: "", model: "gpt-test", kind: "text" }));

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "请填写 Base URL、API Key，并选择要测试的模型" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("tests text with the saved server-side API key", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200, headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);
        const response = await POST(request({ channelId: "saved", model: "gpt-test", kind: "text" }));
        const payload = await response.json();
        expect(payload.result).toMatchObject({ ok: true, kind: "text", model: "gpt-test", status: 200 });
        expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/v1/chat/completions", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer test-secret-value" }) }));
    });

    it("tests a newly discovered model with its capability-level custom operation", async () => {
        const fetchMock = vi.fn(async () => Response.json({ result: { text: "OK" } }));
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(
            request({
                channelId: "saved",
                model: "opaque-text",
                kind: "text",
                protocol: "custom",
                modelConfig: {
                    capability: "text",
                    protocol: "custom",
                    createPath: "/generate-text",
                    requestTemplate: '{"model":"{{model}}","input":"{{prompt}}"}',
                    resultField: "result.text",
                },
            }),
        );

        expect((await response.json()).result).toMatchObject({ ok: true, kind: "text", model: "opaque-text", createPath: "/generate-text" });
        expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/v1/generate-text", expect.objectContaining({ method: "POST" }));
    });

    it("tests a keyless Stable Diffusion channel with the strict request shape", async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ images: ["image-base64"] }));
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ baseUrl: "https://sd.example.com", apiKey: "", model: "sdxl", kind: "image", protocol: "stable-diffusion", authMode: "none" }));

        expect((await response.json()).result).toMatchObject({ ok: true, protocolKey: "stable-diffusion", createPath: "/sdapi/v1/txt2img" });
        expect(fetchMock.mock.calls[0][0]).toBe("https://sd.example.com/sdapi/v1/txt2img");
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBeNull();
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
            prompt: expect.any(String),
            width: 512,
            height: 512,
            batch_size: 1,
            override_settings: { sd_model_checkpoint: "sdxl" },
        });
    });

    it("recognizes a binary audio response", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } })),
        );
        const response = await POST(request({ channelId: "saved", model: "tts-test", kind: "audio" }));
        expect((await response.json()).result).toMatchObject({ ok: true, kind: "audio", model: "tts-test", createPath: "/audio/speech" });
    });

    it("tests image editing after text-to-image succeeds", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/generated.png" }] }), { status: 200, headers: { "content-type": "application/json" } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/edited.png" }] }), { status: 200, headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(request({ channelId: "saved", model: "gpt-image-2", kind: "image", protocol: "openai" }));
        const result = (await response.json()).result;
        const preset = protocolModelConfig("openai", "image")!;
        expect(result).toMatchObject({
            ok: true,
            kind: "image",
            requestTemplate: preset.requestTemplate,
            resultField: preset.resultField,
            referenceImageTest: { ok: true, status: 200, remoteUrl: "https://cdn.example.com/edited.png" },
        });
        expect(result.requestTemplate).not.toContain("response_format");
        expect(fetchMock).toHaveBeenNthCalledWith(1, "https://api.example.com/v1/images/generations", expect.objectContaining({ method: "POST" }));
        expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.example.com/v1/images/edits", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    });

    it("reports image editing failure without hiding successful text-to-image health", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: "https://cdn.example.com/generated.png" }] }), { status: 200, headers: { "content-type": "application/json" } }))
                .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "edit endpoint unavailable" } }), { status: 404, headers: { "content-type": "application/json" } })),
        );

        const response = await POST(request({ channelId: "saved", model: "gpt-image-2", kind: "image", protocol: "openai" }));
        expect((await response.json()).result).toMatchObject({ ok: true, kind: "image", referenceImageTest: { ok: false, status: 404, error: "edit endpoint unavailable" } });
    });

    it("routes a model from the GlobalAiOpc v1 catalog to its documented endpoint", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "video-task" }), { status: 200, headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);

        const response = await POST(
            request({
                channelId: "saved",
                baseUrl: "https://zcbservice.aizfw.cn/kyyReactApiServer/v1",
                model: "videos_stable",
                kind: "video",
                protocol: "auto",
            }),
        );
        const payload = await response.json();

        expect(payload.result).toMatchObject({ ok: true, protocolKey: "globalaiopc", model: "videos_stable", createPath: "/videos/videos" });
        expect(fetchMock).toHaveBeenCalledWith("https://zcbservice.aizfw.cn/kyyReactApiServer/v1/videos/videos", expect.objectContaining({ method: "POST" }));
    });

    it("redacts provider errors before returning them", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid test-secret-value" } }), { status: 401, headers: { "content-type": "application/json" } })),
        );
        const response = await POST(request({ channelId: "saved", model: "gpt-test", kind: "text" }));
        const payload = await response.json();
        expect(payload.result.error).toContain("[REDACTED]");
        expect(JSON.stringify(payload)).not.toContain("test-secret-value");
    });

    it("keeps upstream rate-limit diagnostics", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ error: { message: "rate limit exceeded" } }), { status: 429, headers: { "content-type": "application/json" } })),
        );
        const response = await POST(request({ channelId: "saved", model: "gpt-test", kind: "text" }));
        expect((await response.json()).result).toMatchObject({ ok: false, status: 429, error: "rate limit exceeded" });
    });

    it("rejects provider business errors returned with HTTP 200", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ code: "204", msg: "登录验证失败" }), { status: 200, headers: { "content-type": "application/json" } })),
        );
        const response = await POST(request({ channelId: "saved", model: "video-test", kind: "video" }));
        expect((await response.json()).result).toMatchObject({ ok: false, status: 200, error: "登录验证失败" });
    });

    it("returns an explicit timeout diagnosis", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))),
        );
        const response = await POST(request({ channelId: "saved", model: "gpt-test", kind: "text" }));
        expect((await response.json()).result).toMatchObject({ ok: false, status: 0, error: "上游接口请求超时" });
    });
});

function request(body: unknown) {
    return new Request("http://localhost/api/admin/channel-health", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
