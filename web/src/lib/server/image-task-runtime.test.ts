import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    runCustom: vi.fn(),
    pollCustom: vi.fn(),
    runGemini: vi.fn(),
    runOpenAi: vi.fn(),
    pollOpenAi: vi.fn(),
    getTask: vi.fn(),
    updateTask: vi.fn(),
    transitionTask: vi.fn(),
    schedule: vi.fn(),
    writeLog: vi.fn(),
    inlineResult: vi.fn(),
    getSettings: vi.fn(),
    refund: vi.fn(),
    resolveProxy: vi.fn(),
    normalizeResultUrl: vi.fn(),
    register: vi.fn(),
}));

vi.mock("@/app/api/image-tasks/image-task-custom", () => ({ runCustomImageTask: mocks.runCustom, pollCustomImageTask: mocks.pollCustom }));
vi.mock("@/app/api/image-tasks/image-task-gemini", () => ({ runGeminiImageTask: mocks.runGemini }));
vi.mock("@/app/api/image-tasks/image-task-openai", () => ({ runOpenAiImageTask: mocks.runOpenAi }));
vi.mock("@/app/api/image-tasks/image-task-support", () => ({
    directRemoteImageResult: vi.fn(),
    imageUnits: vi.fn(() => 1),
    ImageUpstreamTerminalError: class extends Error {},
    inlineRemoteImageResult: mocks.inlineResult,
    normalizeImageResultUrlForPersistence: mocks.normalizeResultUrl,
    pollOpenAiImageTask: mocks.pollOpenAi,
    resolveProxiedMediaSource: mocks.resolveProxy,
}));
vi.mock("@/app/api/image-tasks/image-task-runner", () => ({ stableMediaUrl: vi.fn((value: string) => (value && !value.startsWith("data:") ? value : "")), writeImageGenerationLog: mocks.writeLog }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getSettings, refundUserPoints: mocks.refund }));
vi.mock("@/lib/server/creative-runtime-service", () => ({ registerGenerationTaskAssetsForUser: mocks.register }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.schedule }));
vi.mock("@/lib/server/image-task-store", () => ({
    getImageTask: mocks.getTask,
    updateImageTask: mocks.updateTask,
    transitionImageTask: mocks.transitionTask,
}));
vi.mock("@/lib/server/maintenance-auth", () => ({ workerContext: vi.fn(() => "worker-context") }));
vi.mock("@/lib/server/generation-media-authorization", () => ({ generationMediaProxyHeaders: vi.fn(() => ({ "x-dq-media-authorization": "signed" })) }));

import { GenerationSubmissionSafeFailure, GenerationSubmissionUncertainError } from "./generation-submission-error";
import { emptyAdvancedConfig } from "@/lib/channel-protocol-registry";
import { createImageTaskUpstreamStep, persistImageTaskResult } from "./image-task-runtime";
import type { ImageTask } from "./image-task-store";

describe("image task runtime submission safety", () => {
    let state: ImageTask;

    beforeEach(() => {
        vi.clearAllMocks();
        state = imageTask();
        mocks.getTask.mockImplementation(async () => state);
        mocks.updateTask.mockImplementation(async (_id: string, patch: Partial<ImageTask>) => {
            state = { ...state, ...patch };
            return state;
        });
        mocks.transitionTask.mockImplementation(async (_task: ImageTask, allowed: string[], patch: Partial<ImageTask>) => {
            if (!allowed.includes(state.status)) return null;
            state = { ...state, ...patch };
            return state;
        });
        mocks.getSettings.mockResolvedValue({ generationPointMultipliers: { imageQuality: {} } });
        mocks.inlineResult.mockImplementation(async (dataUrl: string) => ({ dataUrl }));
        mocks.normalizeResultUrl.mockImplementation(async (_config: unknown, value: string) => value);
        mocks.resolveProxy.mockReturnValue({});
        mocks.register.mockResolvedValue(undefined);
    });

    it("switches candidates only after an explicit safe rejection", async () => {
        mocks.runCustom.mockRejectedValueOnce(new GenerationSubmissionSafeFailure("参数不受支持", 422));
        mocks.runGemini.mockResolvedValueOnce({ dataUrl: "", pending: { id: "upstream-two", mediaBaseUrl: "https://two.example", pollBaseUrl: "https://two.example" } });

        await expect(createImageTaskUpstreamStep(state, "http://internal", "https://public.example")).resolves.toMatchObject({
            state: "pending",
            upstream: { id: "upstream-two" },
        });
        expect(mocks.runCustom).toHaveBeenCalledTimes(1);
        expect(mocks.runGemini).toHaveBeenCalledTimes(1);
        expect(state.config.channelId).toBe("channel-two");
        expect(state.candidateConfigs).toEqual([]);
        expect(state.attempts?.map(({ status }) => status)).toEqual(["failed", "running"]);
        expect(mocks.schedule).toHaveBeenLastCalledWith("image", "image-one", expect.objectContaining({ channelId: "channel-two", provider: "gemini" }));
    });

    it("does not switch candidates when the submission outcome is unknown", async () => {
        mocks.runCustom.mockRejectedValueOnce(new Error("socket closed"));

        await expect(createImageTaskUpstreamStep(state, "http://internal", "https://public.example")).rejects.toBeInstanceOf(GenerationSubmissionUncertainError);
        expect(mocks.runGemini).not.toHaveBeenCalled();
        expect(state.config.channelId).toBe("channel-one");
        expect(state.candidateConfigs).toHaveLength(1);
        expect(state.attempts?.map(({ status }) => status)).toEqual(["running"]);
    });

    it("fails and refunds a corrupt synchronous image result without manual review", async () => {
        state = imageTask();
        state.config = { ...state.config, advancedConfig: { ...emptyAdvancedConfig(), protocol: "openai" } };
        state.candidateConfigs = [];
        mocks.runOpenAi.mockResolvedValueOnce({ dataUrl: "data:image/png;base64,broken", pointsCost: 1, pointsRecordId: "record-one" });
        mocks.writeLog.mockRejectedValueOnce(new Error("pngload_buffer: libspng read error"));

        await expect(createImageTaskUpstreamStep(state, "http://internal", "https://public.example")).resolves.toMatchObject({
            state: "failed",
            error: "上游返回的图片文件无效或保存失败",
        });
        expect(mocks.refund).toHaveBeenCalledWith("user-one", "image-one", 1, "image", 1, "image-task:image-one:attempt:1:refund", "record-one");
        expect(state.attempts?.map(({ status }) => status)).toEqual(["failed"]);
    });

    it("passes persisted internal reference urls unchanged to a recovered worker submission", async () => {
        state = imageTask();
        state.config = { ...state.config, advancedConfig: { ...emptyAdvancedConfig(), protocol: "openai" } };
        state.candidateConfigs = [];
        state.kind = "edit";
        state.references = [
            { id: "first", dataUrl: "", url: "/api/reference-assets/temporary/2026/08/03/images/first.png" },
            { id: "second", dataUrl: "", url: "/api/reference-assets/temporary/2026/08/03/images/second.png" },
        ];
        state.mask = { id: "mask", dataUrl: "", url: "/api/reference-assets/temporary/2026/08/03/images/mask.png" };
        mocks.runOpenAi.mockResolvedValueOnce({ dataUrl: "", pending: { id: "upstream-one", mediaBaseUrl: "https://provider.example", pollBaseUrl: "https://provider.example" } });

        await createImageTaskUpstreamStep(state, "http://internal", "https://public.example", "", "user-one");

        expect(mocks.runOpenAi).toHaveBeenCalledWith(
            expect.objectContaining({
                references: [expect.objectContaining({ dataUrl: "", url: "/api/reference-assets/temporary/2026/08/03/images/first.png" }), expect.objectContaining({ dataUrl: "", url: "/api/reference-assets/temporary/2026/08/03/images/second.png" })],
                mask: expect.objectContaining({ dataUrl: "", url: "/api/reference-assets/temporary/2026/08/03/images/mask.png" }),
            }),
            "http://internal",
            "https://public.example",
            "worker-context",
            true,
        );
    });

    it("adds a task-bound capability when persisting a proxied image result", async () => {
        state = imageTask();
        state.status = "running";
        state.config = { ...state.config, baseUrl: "/api/ai/system/channel-one", channelId: "channel-one" };
        const proxyUrl = "/api/ai/system/channel-one/_media?url=https%3A%2F%2Fcdn.example.com%2Fresult.png";
        mocks.resolveProxy.mockReturnValue({ proxyUrl, remoteUrl: "https://cdn.example.com/result.png" });
        mocks.inlineResult.mockResolvedValue({ dataUrl: "data:image/png;base64,c2FmZQ==", remoteUrl: "https://cdn.example.com/result.png" });
        mocks.writeLog.mockResolvedValue({});

        await persistImageTaskResult(state, "http://internal", proxyUrl);

        expect(mocks.inlineResult).toHaveBeenCalledWith(proxyUrl, "http://internal", "worker-context", undefined, { "x-dq-media-authorization": "signed" });
    });

    it("normalizes an old Grok loopback result before persistence", async () => {
        state = imageTask();
        state.status = "running";
        state.config = { ...state.config, baseUrl: "/api/ai/system/channel-one", channelId: "channel-one", model: "grok-imagine-image" };
        const loopbackUrl = "http://127.0.0.1:8000/v1/media/images/image-one";
        const proxyUrl = "/api/ai/system/channel-one/_media?url=https%3A%2F%2Fgrok.example%2Fv1%2Fmedia%2Fimages%2Fimage-one";
        const config = state.config;
        mocks.normalizeResultUrl.mockResolvedValue(proxyUrl);
        mocks.resolveProxy.mockReturnValue({ proxyUrl, remoteUrl: "https://grok.example/v1/media/images/image-one" });
        mocks.inlineResult.mockResolvedValue({ dataUrl: "data:image/png;base64,c2FmZQ==", remoteUrl: "https://grok.example/v1/media/images/image-one" });
        mocks.writeLog.mockResolvedValue({});

        await persistImageTaskResult(state, "http://internal", loopbackUrl);

        expect(mocks.normalizeResultUrl).toHaveBeenCalledWith(config, loopbackUrl, "http://internal");
        expect(mocks.inlineResult).toHaveBeenCalledWith(proxyUrl, "http://internal", "worker-context", undefined, { "x-dq-media-authorization": "signed" });
    });
});

function imageTask(): ImageTask {
    const second = { baseUrl: "https://two.example", apiKey: "two", apiFormat: "gemini" as const, model: "image-two", channelId: "channel-two" };
    return {
        id: "image-one",
        userId: "user-one",
        username: "user",
        displayName: "User",
        kind: "generation",
        source: "image-workbench",
        status: "pending",
        createdAt: 1,
        updatedAt: 1,
        config: {
            baseUrl: "https://one.example",
            apiKey: "one",
            apiFormat: "openai",
            model: "image-one",
            channelId: "channel-one",
            advancedConfig: { ...emptyAdvancedConfig(), protocol: "custom", createPath: "/images", requestTemplate: "{}", resultField: "url" },
        },
        candidateConfigs: [second],
        prompt: "test",
        references: [],
    };
}
