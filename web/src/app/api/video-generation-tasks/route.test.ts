import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    after: vi.fn(),
    fetchInternalApi: vi.fn(),
    createVideoTask: vi.fn(),
    claimVideoTaskPoll: vi.fn(),
    completeReconciledVideoTask: vi.fn(),
    failReconciledVideoTask: vi.fn(),
    getAuthSettings: vi.fn(),
    getVideoTask: vi.fn(),
    linkStoredGenerationTask: vi.fn(),
    getStoredGenerationTaskByRequest: vi.fn(),
    touchVideoTask: vi.fn(),
    transitionVideoTask: vi.fn(),
    updateVideoTask: vi.fn(),
    scheduleGenerationTask: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: mocks.after };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user", pointsBalance: 100 })) }));
vi.mock("@/lib/auth/store", () => {
    class AuthInputError extends Error {
        status = 400;
    }
    return { AuthInputError, getAuthSettings: mocks.getAuthSettings, isAuthInputError: (error: unknown) => error instanceof AuthInputError, refundUserPoints: vi.fn() };
});
vi.mock("@/lib/server/internal-origin", () => ({ fetchInternalApi: mocks.fetchInternalApi, resolveInternalOrigin: vi.fn(() => "http://localhost") }));
vi.mock("@/lib/server/generation-task-store", () => ({
    withGenerationConcurrencyLimit: vi.fn(async (_userId, _type, _staleMs, _limit, handler) => handler()),
    linkStoredGenerationTask: mocks.linkStoredGenerationTask,
    getStoredGenerationTaskByRequest: mocks.getStoredGenerationTaskByRequest,
}));
vi.mock("@/lib/server/security", () => ({
    checkGenerationRateLimit: vi.fn(async () => ({ allowed: true, remaining: 5, resetAt: Date.now() + 60_000 })),
    rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: vi.fn() }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.scheduleGenerationTask }));
vi.mock("@/lib/server/video-task-store", () => ({
    createVideoTask: mocks.createVideoTask,
    claimVideoTaskPoll: mocks.claimVideoTaskPoll,
    completeReconciledVideoTask: mocks.completeReconciledVideoTask,
    failReconciledVideoTask: mocks.failReconciledVideoTask,
    getVideoTask: mocks.getVideoTask,
    touchVideoTask: mocks.touchVideoTask,
    transitionVideoTask: mocks.transitionVideoTask,
    updateVideoTask: mocks.updateVideoTask,
}));

import { POST } from "./route";
import { resetChannelRuntimeHealth } from "@/lib/server/channel-runtime-health";

const channels = [
    { id: "one", name: "主渠道", baseUrl: "https://one.example.com/v1", apiKey: "one-secret", apiFormat: "openai", models: ["video-one"], enabled: true, advancedConfig: { protocol: "openai" } },
    { id: "two", name: "备用渠道", baseUrl: "https://two.example.com/v1", apiKey: "two-secret", apiFormat: "openai", models: ["video-two"], enabled: true, advancedConfig: { protocol: "openai" } },
] as const;

const settings = {
    systemChannels: channels,
    logicalModels: [
        {
            id: "video",
            name: "Video",
            capability: "video",
            enabled: true,
            bindings: [
                { id: "one", channelId: "one", upstreamModel: "video-one", enabled: true, priority: 1 },
                { id: "two", channelId: "two", upstreamModel: "video-two", enabled: true, priority: 2 },
            ],
        },
    ],
    defaultModels: { videoModel: "video" },
    generationConcurrency: { video: 2 },
    generationDefaults: { imageSize: "16:9", videoQuality: "720", videoSeconds: 5 },
    generationPointMultipliers: { videoQuality: { "720": 1 }, videoSeconds: { "5": 1 } },
};

describe("video generation candidate failover", () => {
    let storedTask: Record<string, unknown> | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.fetchInternalApi.mockReset();
        resetChannelRuntimeHealth();
        mocks.getAuthSettings.mockResolvedValue(settings);
        storedTask = undefined;
        mocks.createVideoTask.mockImplementation(async (input) => {
            storedTask = { ...input, id: "local-task", status: "running", createdAt: Date.now(), updatedAt: Date.now() };
            return storedTask;
        });
        mocks.getVideoTask.mockImplementation(async () => storedTask);
        mocks.claimVideoTaskPoll.mockImplementation(async () => storedTask);
        mocks.after.mockImplementation(() => undefined);
    });

    it("tries the next binding after explicit route failures", async () => {
        mocks.fetchInternalApi.mockImplementation(async (url: string) => (url.includes("/api/ai/system/one/") ? json({ error: "not found" }, 404) : json({ id: "upstream-two", status: "queued" })));

        const response = await POST(request());
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.task).toMatchObject({ id: "local-task", model: "video", upstreamId: "upstream-two" });
        expect(mocks.fetchInternalApi.mock.calls.some(([url]) => String(url).includes("/api/ai/system/one/"))).toBe(true);
        expect(mocks.fetchInternalApi.mock.calls.some(([url]) => String(url).includes("/api/ai/system/two/"))).toBe(true);
    });

    it("does not retry another binding after an ambiguous 2xx response", async () => {
        mocks.fetchInternalApi.mockResolvedValue(new Response("not-json", { status: 200 }));

        const response = await POST(request());

        expect(response.status).toBe(202);
        expect(mocks.fetchInternalApi.mock.calls.some(([url]) => String(url).includes("/api/ai/system/two/"))).toBe(false);
        expect(mocks.createVideoTask).toHaveBeenCalledOnce();
        expect(mocks.scheduleGenerationTask).toHaveBeenLastCalledWith("video", "local-task", expect.objectContaining({ executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "submission_outcome_unknown" }));
    });

    it("does not retry another path or binding after an ambiguous server failure", async () => {
        mocks.fetchInternalApi.mockResolvedValue(json({ error: "gateway failed" }, 502));

        const response = await POST(request());

        expect(response.status).toBe(202);
        expect(mocks.fetchInternalApi).toHaveBeenCalledTimes(1);
        expect(mocks.fetchInternalApi.mock.calls.some(([url]) => String(url).includes("/api/ai/system/two/"))).toBe(false);
        expect(mocks.createVideoTask).toHaveBeenCalledOnce();
    });

    it("surfaces an explicit HTTP 200 business failure after safe candidate fallback", async () => {
        mocks.fetchInternalApi.mockImplementation(async () => json({ code: "204", msg: "登录验证失败" }));

        const response = await POST(request());

        expect(response.status).toBe(502);
        expect((await response.json()).error).toBe("登录验证失败");
        expect(mocks.createVideoTask).toHaveBeenCalledOnce();
    });

    it("enqueues a GlobalAiOpc task for the recovery worker after creation", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [{ ...channels[0], advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "video-videos" } }],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockResolvedValueOnce(json({ id: "global-video-task", status: "queued" }));

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.scheduleGenerationTask).toHaveBeenLastCalledWith("video", "local-task", expect.objectContaining({ executionPhase: "submitted", upstreamTaskId: "global-video-task" }));
        expect(mocks.after).toHaveBeenCalledWith(expect.any(Function));
    });

    it("uses the backend default logical model when the client omits a model", async () => {
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-default", status: "queued" }));

        const response = await POST(request({}));

        expect(response.status).toBe(200);
        expect((await response.json()).task.model).toBe("video");
    });

    it("forwards the authenticated maintenance worker identity to the internal system proxy", async () => {
        const token = "maintenance-token-used-by-generation-worker";
        vi.stubEnv("VOZEB_PRO_MAINTENANCE_TOKEN", token);
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-worker", status: "queued" }));

        const response = await POST(
            new Request("http://localhost/api/video-generation-tasks", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                    "x-vozeb-pro-worker-user-id": "user",
                },
                body: JSON.stringify({ config: { model: "video" }, prompt: "A test video", references: [] }),
            }),
        );
        const headers = new Headers((mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit).headers);

        expect(response.status).toBe(200);
        expect(headers.get("authorization")).toBe(`Bearer ${token}`);
        expect(headers.get("x-vozeb-pro-worker-user-id")).toBe("user");
        expect(headers.has("cookie")).toBe(false);
        vi.unstubAllEnvs();
    });

    it("uses the SD2.0 model route without affecting OpenAI models on the same channel", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    models: ["openai-text", "sd2.0"],
                    advancedConfig: {
                        protocol: "auto",
                        createPath: "/wrong-channel-path",
                        modelConfigs: { "sd2.0": { capability: "video", protocol: "seedance", createPath: "/sd2/videos", queryPath: "/sd2/videos/:task_id" } },
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [{ ...settings.logicalModels[0].bindings[0], upstreamModel: "sd2.0" }] }],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-sd2", status: "queued" }));

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.fetchInternalApi.mock.calls[0][0]).toContain("/api/ai/system/one/sd2/videos");
    });

    it("uses separate text-to-video and image-to-video paths with trusted billing headers", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    advancedConfig: {
                        protocol: "custom",
                        modelConfigs: {
                            "video-one": {
                                capability: "video",
                                protocol: "custom",
                                createPath: "/text-to-video",
                                imageToVideoPath: "/image-to-video",
                                requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","images":"{{images}}"}',
                                resultField: "id",
                                supportsReferenceImage: true,
                            },
                        },
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockImplementation(async () => json({ id: "upstream-custom", status: "queued" }));

        const textResponse = await POST(request({ model: "video" }, [], { clientRequestId: "video-text" }));
        const imageResponse = await POST(request({ model: "video" }, [{ type: "image", url: "https://cdn.example.com/reference.jpg" }], { clientRequestId: "video-image" }));
        const imagePayload = await imageResponse.clone().json();
        const [textUrl, textInit] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];
        const [imageUrl, imageInit] = mocks.fetchInternalApi.mock.calls[1] as [string, RequestInit];
        const textHeaders = new Headers(textInit.headers);
        const imageHeaders = new Headers(imageInit.headers);

        expect(textResponse.status).toBe(200);
        expect(imageResponse.status, JSON.stringify(imagePayload)).toBe(200);
        expect(textUrl).toContain("/api/ai/system/one/text-to-video");
        expect(imageUrl).toContain("/api/ai/system/one/image-to-video");
        expect(textHeaders.get("x-vozeb-pro-logical-model")).toBe("video");
        expect(textHeaders.get("x-vozeb-pro-upstream-model")).toBe("video-one");
        expect(textHeaders.get("x-vozeb-pro-points-idempotency-key")).toBe("video-request:video-text");
        expect(imageHeaders.get("x-vozeb-pro-points-idempotency-key")).toBe("video-request:video-image");
    });

    it("builds an OpenAI video multipart request and uses its image-to-video path", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    advancedConfig: {
                        protocol: "openai",
                        modelConfigs: {
                            "video-one": {
                                capability: "video",
                                protocol: "openai",
                                createPath: "/videos",
                                imageToVideoPath: "/videos",
                                queryPath: "/videos/:task_id",
                                requestTemplate: "multipart/form-data: model、prompt、seconds、size、input_reference",
                                resultField: "/videos/:task_id/content",
                                statusField: "status",
                                supportsReferenceImage: true,
                            },
                        },
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-openai", status: "queued" }));
        const reference = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

        const response = await POST(request({ model: "video", videoSeconds: "5", size: "16:9" }, [{ type: "image", url: reference }]));
        const [url, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];
        const body = init.body as FormData;

        expect(response.status).toBe(200);
        expect(url).toContain("/api/ai/system/one/videos");
        expect(init.body).toBeInstanceOf(FormData);
        expect(new Headers(init.headers).has("content-type")).toBe(false);
        expect(body.get("model")).toBe("video-one");
        expect(body.get("seconds")).toBe("5");
        expect(body.get("size")).toBe("1280x720");
        expect(body.get("input_reference")).toBeInstanceOf(File);
    });

    it("persists the Drama project, episode and shot task context", async () => {
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-drama", status: "queued" }));
        const context = { surface: "drama", projectId: "drama-one", episodeId: "episode-one", shotId: "shot-one", estimatedPoints: 8, attemptNo: 2, clientRequestId: "drama-video:one" };

        const response = await POST(request({ model: "video" }, [], context));

        expect(response.status).toBe(200);
        expect(mocks.createVideoTask).toHaveBeenCalledWith(expect.objectContaining(context));
        expect(mocks.linkStoredGenerationTask).toHaveBeenCalledWith("video", "local-task", context);
    });

    it("rejects a raw upstream model when the logical catalog exists", async () => {
        const response = await POST(request({ model: "video-one" }));

        expect(response.status).toBe(400);
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("rejects an image logical model for a video task", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [...channels, { id: "image", name: "图片渠道", baseUrl: "https://image.example.com/v1", apiKey: "image-secret", apiFormat: "openai", models: ["stable-diffusion-2.0"], enabled: true, advancedConfig: { protocol: "openai" } }],
            logicalModels: [
                ...settings.logicalModels,
                {
                    id: "stable-diffusion-2.0",
                    name: "Stable Diffusion",
                    capability: "image",
                    enabled: true,
                    bindings: [{ id: "image-binding", channelId: "image", upstreamModel: "stable-diffusion-2.0", enabled: true, priority: 1 }],
                },
            ],
        });

        const response = await POST(request({ model: "stable-diffusion-2.0" }));

        expect(response.status).toBe(400);
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("sends a Qingyan image-to-video request with the real reference and current parameters", async () => {
        mocks.getAuthSettings.mockResolvedValue(qingyanSettings());
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-image-video", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: "10", size: "9:16", vquality: "1080" }, [{ type: "image", url: "https://cdn.example.com/reference.jpg" }]));
        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;
        const upstreamBody = JSON.parse(String(init.body));

        expect(response.status).toBe(200);
        expect(upstreamBody).toMatchObject({ model: "video-one", duration: 10, ratio: "9:16", image: "https://cdn.example.com/reference.jpg" });
        expect(upstreamBody.prompt).toContain("A test video");
        expect(upstreamBody.prompt).toContain("将参考图作为首帧、主体身份、外观和场景的主要依据");
        expect(upstreamBody.prompt).toContain("禁止替换主体");
        expect(upstreamBody).not.toHaveProperty("images");
    });

    it("sends a Qingyan text-to-video request without empty reference fields", async () => {
        mocks.getAuthSettings.mockResolvedValue(qingyanSettings());
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-text-video", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: "5", size: "16:9", vquality: "720" }));
        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;
        const upstreamBody = JSON.parse(String(init.body));

        expect(response.status).toBe(200);
        expect(upstreamBody).toMatchObject({ model: "video-one", duration: 5, ratio: "16:9", prompt: "A test video" });
        expect(mocks.createVideoTask).toHaveBeenCalledWith(expect.objectContaining({ requestedDurationSeconds: 5 }));
        expect(upstreamBody).not.toHaveProperty("image");
        expect(upstreamBody).not.toHaveProperty("images");
        expect(upstreamBody.prompt).not.toContain("参考素材一致性要求");
    });

    it("converts workbench pixel sizes into the provider ratio field", async () => {
        mocks.getAuthSettings.mockResolvedValue(qingyanSettings());
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-pixel-ratio", status: "queued" }));

        const response = await POST(request({ model: "video", size: "1280x720" }));
        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;

        expect(response.status).toBe(200);
        expect(JSON.parse(String(init.body))).toMatchObject({ ratio: "16:9" });
    });

    it("rounds a requested duration up to the next duration supported by the selected upstream", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    advancedConfig: {
                        protocol: "custom",
                        modelConfigs: {
                            "video-one": {
                                capability: "video",
                                protocol: "custom",
                                createPath: "/videos",
                                queryPath: "/videos/:task_id",
                                requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","duration":"{{duration}}"}',
                                resultField: "id",
                                durationRange: "5、8、10 秒",
                            },
                        },
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "upstream-duration", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: 7 }));
        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;

        expect(response.status).toBe(200);
        expect(JSON.parse(String(init.body))).toMatchObject({ duration: 8 });
        expect(mocks.createVideoTask).toHaveBeenCalledWith(expect.objectContaining({ requestedDurationSeconds: 8 }));
        expect((await response.json()).task.durationSeconds).toBe(8);
    });

    it("uses the selected GlobalAiOpc preset path and Seedance content request body", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    advancedConfig: {
                        protocol: "globalaiopc",
                        globalAiOpcPreset: "video-seedance-discount",
                        createPath: "/seedance-discount/videos",
                        queryPath: "/result/:task_id",
                        supportsReferenceImage: true,
                        supportsReferenceVideo: true,
                        supportsReferenceAudio: true,
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "global-seedance-task", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: "5", size: "16:9" }, [{ type: "image", url: "https://cdn.example.com/reference.jpg" }]));
        const [url, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];

        expect(response.status).toBe(200);
        expect(url).toContain("/api/ai/system/one/seedance-discount/videos");
        expect(JSON.parse(String(init.body))).toMatchObject({
            model: "video-one",
            duration: 5,
            ratio: "16:9",
            content: [expect.objectContaining({ type: "text", text: expect.stringContaining("A test video") }), { type: "image_url", role: "reference_image", image_url: { url: "https://cdn.example.com/reference.jpg" } }],
        });
    });

    it("ignores legacy GlobalAiOpc sample references for text-to-video requests", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    advancedConfig: {
                        protocol: "globalaiopc",
                        createPath: "/videos/videos",
                        queryPath: "/result/:task_id",
                        requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","referenceImages":["https://example.com/rabbit.png"],"referenceAudios":["{{image}}"]}',
                        supportsReferenceImage: true,
                        supportsReferenceVideo: true,
                        supportsReferenceAudio: true,
                    },
                },
            ],
            logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "global-videos-task", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: "5", size: "16:9", vquality: "720" }));
        const [url, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];
        const upstreamBody = JSON.parse(String(init.body));

        expect(response.status).toBe(200);
        expect(url).toContain("/api/ai/system/one/videos/videos");
        expect(upstreamBody).toEqual({ model: "video-one", prompt: "A test video", duration: 5, ratio: "16:9", resolution: "720p" });
        expect(upstreamBody).not.toHaveProperty("referenceImages");
        expect(upstreamBody).not.toHaveProperty("referenceVideos");
        expect(upstreamBody).not.toHaveProperty("referenceAudios");
    });

    it("selects the matching endpoint from a multi-preset GlobalAiOpc channel", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [
                {
                    ...channels[0],
                    models: ["happyhorse-1.0-i2v", "videos_stable"],
                    advancedConfig: {
                        protocol: "globalaiopc",
                        globalAiOpcPresets: ["video-happyhorse-i2v", "video-videos"],
                        supportsReferenceImage: true,
                        supportsReferenceVideo: true,
                        supportsReferenceAudio: true,
                    },
                },
            ],
            logicalModels: [
                {
                    ...settings.logicalModels[0],
                    bindings: [{ ...settings.logicalModels[0].bindings[0], upstreamModel: "videos_stable" }],
                },
            ],
        });
        mocks.fetchInternalApi.mockResolvedValue(json({ id: "global-multi-task", status: "queued" }));

        const response = await POST(request({ model: "video", videoSeconds: "5", size: "16:9", vquality: "720" }));
        const [url, init] = mocks.fetchInternalApi.mock.calls[0] as [string, RequestInit];

        expect(response.status).toBe(200);
        expect(url).toContain("/api/ai/system/one/videos/videos");
        expect(JSON.parse(String(init.body))).toEqual({ model: "videos_stable", prompt: "A test video", duration: 5, ratio: "16:9", resolution: "720p" });
    });

    it("rejects local reference URLs before creating a public-URL provider task", async () => {
        mocks.getAuthSettings.mockResolvedValue(qingyanSettings());

        const response = await POST(request({ model: "video" }, [{ type: "image", url: "http://127.0.0.1:3000/api/reference-assets/reference.jpg" }]));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("站内参考素材");
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("returns 400 for malformed JSON", async () => {
        const response = await POST(new Request("http://localhost/api/video-generation-tasks", { method: "POST", body: "{" }));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe("请求内容不是有效 JSON");
    });

    it("returns 413 before reading an oversized JSON body", async () => {
        const response = await POST(
            new Request("http://localhost/api/video-generation-tasks", {
                method: "POST",
                headers: { "content-length": String(4 * 1024 * 1024 + 1) },
                body: "{}",
            }),
        );

        expect(response.status).toBe(413);
        expect((await response.json()).error).toBe("请求体过大");
    });
});

function request(config: Record<string, unknown> = { model: "video" }, references: Array<{ type: string; url: string }> = [], context?: Record<string, unknown>) {
    return new Request("http://localhost/api/video-generation-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, prompt: "A test video", references, context }) });
}

function qingyanSettings() {
    return {
        ...settings,
        systemChannels: [
            {
                ...channels[0],
                advancedConfig: {
                    protocol: "qingyan",
                    supportsReferenceImage: true,
                    supportsReferenceVideo: false,
                    supportsReferenceAudio: false,
                    referenceRule: "图生视频使用公网图片 URL；单图字段 image，多图字段 images。",
                    requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","duration":5,"ratio":"16:9","image":"https://...","images":["https://..."]}',
                },
            },
        ],
        logicalModels: [{ ...settings.logicalModels[0], bindings: [settings.logicalModels[0].bindings[0]] }],
    };
}

function json(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
