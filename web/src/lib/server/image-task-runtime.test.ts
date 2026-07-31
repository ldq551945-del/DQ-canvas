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
}));

vi.mock("@/app/api/image-tasks/image-task-custom", () => ({ runCustomImageTask: mocks.runCustom, pollCustomImageTask: mocks.pollCustom }));
vi.mock("@/app/api/image-tasks/image-task-gemini", () => ({ runGeminiImageTask: mocks.runGemini }));
vi.mock("@/app/api/image-tasks/image-task-openai", () => ({ runOpenAiImageTask: mocks.runOpenAi }));
vi.mock("@/app/api/image-tasks/image-task-support", () => ({
    directRemoteImageResult: vi.fn(),
    imageUnits: vi.fn(() => 1),
    ImageUpstreamTerminalError: class extends Error {},
    inlineRemoteImageResult: mocks.inlineResult,
    pollOpenAiImageTask: mocks.pollOpenAi,
}));
vi.mock("@/app/api/image-tasks/image-task-runner", () => ({ stableMediaUrl: vi.fn((value: string) => (value && !value.startsWith("data:") ? value : "")), writeImageGenerationLog: mocks.writeLog }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getSettings, refundUserPoints: mocks.refund }));
vi.mock("@/lib/server/creative-runtime-service", () => ({ registerGenerationTaskAssetsForUser: vi.fn() }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.schedule }));
vi.mock("@/lib/server/image-task-store", () => ({
    getImageTask: mocks.getTask,
    updateImageTask: mocks.updateTask,
    transitionImageTask: mocks.transitionTask,
}));
vi.mock("@/lib/server/maintenance-auth", () => ({ maintenanceWorkerContext: vi.fn(() => "worker-context") }));

import { GenerationSubmissionSafeFailure, GenerationSubmissionUncertainError } from "./generation-submission-error";
import { emptyAdvancedConfig } from "@/lib/channel-protocol-registry";
import { createImageTaskUpstreamStep } from "./image-task-runtime";
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
