import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    currentUser: vi.fn(),
    authSettings: vi.fn(),
    rate: vi.fn(),
    withConcurrency: vi.fn(),
    sanitizeConfigs: vi.fn(),
    assertCapability: vi.fn(),
    assertReferences: vi.fn(),
    existingTask: vi.fn(),
    createTaskId: vi.fn(),
    persistReferences: vi.fn(),
    cleanupReferences: vi.fn(),
    failSetup: vi.fn(),
    createTask: vi.fn(),
    linkTask: vi.fn(),
    scheduleTask: vi.fn(),
    recover: vi.fn(),
    publicTask: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next/server")>();
    return { ...actual, after: vi.fn() };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.authSettings, isAuthInputError: vi.fn(() => false), refundUserPoints: vi.fn() }));
vi.mock("@/lib/server/security", () => ({ checkGenerationRateLimit: mocks.rate, rateLimitHeaders: vi.fn(() => ({})) }));
vi.mock("@/lib/server/generation-task-store", () => ({
    withGenerationConcurrencyLimit: mocks.withConcurrency,
    getStoredGenerationTaskByRequest: mocks.existingTask,
    linkStoredGenerationTask: mocks.linkTask,
}));
vi.mock("@/lib/server/image-task-store", () => ({ createImageTaskId: mocks.createTaskId, createImageTask: mocks.createTask, failImageTaskSetup: mocks.failSetup }));
vi.mock("@/lib/server/image-task-reference-payload", () => ({ persistImageTaskReferencePayload: mocks.persistReferences, cleanupImageTaskReferencePayload: mocks.cleanupReferences }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.scheduleTask }));
vi.mock("@/lib/server/generation-task-recovery-service", () => ({ runGenerationTaskRecoveryBatch: mocks.recover }));
vi.mock("@/lib/server/capability-constraints", () => ({ assertCapabilityConstraints: mocks.assertCapability }));
vi.mock("@/lib/server/provider-task-config", () => ({ assertReferenceCapabilities: mocks.assertReferences }));
vi.mock("@/lib/server/internal-origin", () => ({ resolveInternalOrigin: vi.fn(() => "http://localhost") }));
vi.mock("@/lib/server/proxy-dispatcher", () => ({ configureServerProxyDispatcher: vi.fn() }));
vi.mock("@/lib/server/image-task-config", () => ({ resolveImageTaskOptions: vi.fn() }));
vi.mock("@/lib/server/generation-log-store", () => ({ isGenerationSource: vi.fn(() => true), recordGenerationLog: vi.fn() }));
vi.mock("@/lib/server/creative-runtime-service", () => ({ registerGenerationTaskAssetsForUser: vi.fn() }));
vi.mock("@/lib/server/generation-attempt", () => ({ finishGenerationAttempt: vi.fn(), startGenerationAttempt: vi.fn() }));
vi.mock("@/lib/server/logical-model-router", () => ({ resolveLogicalModelCandidates: vi.fn(() => []) }));
vi.mock("@/lib/server/generation-channel", () => ({ generationModelId: vi.fn(() => "image-model"), toSystemGenerationChannel: vi.fn() }));
vi.mock("@/lib/server/generation-errors", () => ({ toSafeGenerationErrorMessage: vi.fn() }));
vi.mock("@/lib/provider-compatibility", () => ({ isQingyanProvider: vi.fn(() => false) }));
vi.mock("@/lib/media-url", () => ({ resolveGeneratedMediaUrl: vi.fn() }));
vi.mock("@/lib/image-reference-prompt", () => ({ buildImageReferencePromptText: vi.fn() }));
vi.mock("@/app/api/image-tasks/image-task-reference-urls", () => ({ requestPublicOrigin: vi.fn(() => "https://public.example") }));
vi.mock("@/app/api/image-tasks/image-task-support", () => ({
    publicTask: mocks.publicTask,
    sanitizeConfigs: mocks.sanitizeConfigs,
    sanitizeAdvancedConfig: vi.fn(),
    textOrEmpty: vi.fn(),
    preferredImageResponseFormat: vi.fn(),
    openAiImageTaskPath: vi.fn(),
    shouldUseJsonImageEdit: vi.fn(),
    configuredImageEditReferenceMode: vi.fn(),
    resolveConfiguredApiBaseUrl: vi.fn(),
    readSystemChannelId: vi.fn(),
    shouldUseSub2ApiImageEdit: vi.fn(),
    isCode2AlitaApiBase: vi.fn(),
    matchesApiHost: vi.fn(),
    taskUrl: vi.fn(),
    normalizeApiBaseUrl: vi.fn(),
    isInternalSystemProxyBase: vi.fn(),
    taskHeaders: vi.fn(),
    taskFetch: vi.fn(),
    geminiHeaders: vi.fn(),
    geminiApiUrl: vi.fn(),
    withSystemPrompt: vi.fn(),
    parseImagePayloadOrPoll: vi.fn(),
    pollOpenAiImageTask: vi.fn(),
    parseImagePayloadCompat: vi.fn(),
    findImageResult: vi.fn(),
    resolveImageUrlLike: vi.fn(),
    resolveImageBase64Like: vi.fn(),
    isLikelyImageUrl: vi.fn(),
    readImagePayloadError: vi.fn(),
    readImageTaskId: vi.fn(),
    readImageTaskStatus: vi.fn(),
    readImagePollUrl: vi.fn(),
    findStringByKeys: vi.fn(),
    isPendingImageStatus: vi.fn(),
    imageTaskPollUrls: vi.fn(),
    resolveTaskMediaUrl: vi.fn(),
    shouldRetryInternalImageUrlAsBase64: vi.fn(),
    isInternalGeneratedImageUrl: vi.fn(),
    inlineRemoteImageResult: vi.fn(),
    directRemoteImageResult: vi.fn(),
    resolveProxiedMediaSource: vi.fn(),
    shouldFallbackToJsonImageEdit: vi.fn(),
    shouldTryNextImageResponseFormat: vi.fn(),
    shouldRetryJsonImageEditPayload: vi.fn(),
    shouldFallbackToResponsesImage: vi.fn(),
    stringField: vi.fn(),
    delay: vi.fn(),
    parseGeminiImagePayload: vi.fn(),
    toGeminiImagePart: vi.fn(),
    buildImageEditFormData: vi.fn(),
    imageReferenceToFile: vi.fn(),
    dataUrlToFile: vi.fn(),
    readFetchError: vi.fn(),
    readPointsRemaining: vi.fn(),
    readBilling: vi.fn(),
    parseChargedImageResponse: vi.fn(),
    refundChargedImageResponse: vi.fn(),
    imageUnits: vi.fn(),
    isRemoteMediaUrl: vi.fn(),
    normalizeQuality: vi.fn(),
    resolveRequestSize: vi.fn(),
    resolveSize: vi.fn(),
    parseImageRatio: vi.fn(),
    parseImageDimensions: vi.fn(),
    validateImageSize: vi.fn(),
}));

import { POST } from "./route";

describe("POST /api/image-tasks reference payload", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "user-one", username: "user", displayName: "User" });
        mocks.authSettings.mockResolvedValue({ generationConcurrency: { image: 1 } });
        mocks.rate.mockResolvedValue({ allowed: true });
        mocks.scheduleTask.mockResolvedValue(undefined);
        mocks.cleanupReferences.mockResolvedValue(undefined);
        mocks.withConcurrency.mockImplementation(async (_userId: string, _type: string, _timeout: number, _limit: number, run: () => Promise<Response>) => run());
        mocks.sanitizeConfigs.mockReturnValue([{ baseUrl: "/api/ai/system/image", apiKey: "system", apiFormat: "openai", model: "image-model", advancedConfig: {} }]);
        mocks.existingTask.mockResolvedValue(null);
        mocks.createTaskId.mockReturnValue("task-one");
        mocks.persistReferences.mockResolvedValue({
            references: [{ id: "first", dataUrl: "", url: "/api/reference-assets/temporary/first.png" }],
            mask: { id: "mask", dataUrl: "", url: "/api/reference-assets/temporary/mask.png" },
            storageKeys: ["temporary/first.png", "temporary/mask.png"],
        });
        mocks.createTask.mockImplementation(async (input: Record<string, unknown>, id: string) => ({ ...input, id, status: "pending", createdAt: 1, updatedAt: 1 }));
        mocks.failSetup.mockResolvedValue({ outcome: "missing", task: null, storageKeys: [] });
        mocks.publicTask.mockImplementation((task: { id: string }) => ({ id: task.id }));
    });

    it("persists inline media before storing the generation task", async () => {
        const response = await POST(
            new Request("http://localhost/api/image-tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    kind: "edit",
                    prompt: "change expression",
                    config: { model: "image-model" },
                    references: [{ id: "first", dataUrl: "data:image/png;base64,AAAA" }],
                    mask: { id: "mask", dataUrl: "data:image/png;base64,BBBB" },
                    context: { projectId: "project-one" },
                }),
            }),
        );

        expect(response.status).toBe(200);
        expect(mocks.persistReferences).toHaveBeenCalledWith(expect.any(Array), expect.any(Object), expect.objectContaining({ ownerUserId: "user-one", taskId: "task-one", projectId: "project-one" }));
        expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ references: [{ id: "first", dataUrl: "", url: "/api/reference-assets/temporary/first.png" }], mask: expect.objectContaining({ dataUrl: "" }) }), "task-one");
        expect(JSON.stringify(mocks.createTask.mock.calls[0]?.[0])).not.toContain("data:image");
    });

    it("removes staged references when task creation fails", async () => {
        mocks.createTask.mockRejectedValue(new Error("database failed"));

        await expect(
            POST(
                new Request("http://localhost/api/image-tasks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: "change expression", config: { model: "image-model" }, references: [{ dataUrl: "data:image/png;base64,AAAA" }] }),
                }),
            ),
        ).rejects.toThrow("database failed");
        expect(mocks.cleanupReferences).toHaveBeenCalledWith(["temporary/first.png", "temporary/mask.png"]);
    });

    it("fails an inserted task before removing its staged references when scheduling fails", async () => {
        mocks.scheduleTask.mockRejectedValue(new Error("scheduler failed"));
        mocks.failSetup.mockResolvedValue({ outcome: "failed", task: { id: "task-one", status: "error" }, storageKeys: ["temporary/first.png", "temporary/mask.png"] });

        await expect(
            POST(
                new Request("http://localhost/api/image-tasks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: "change expression", config: { model: "image-model" }, references: [{ dataUrl: "data:image/png;base64,AAAA" }] }),
                }),
            ),
        ).rejects.toThrow("scheduler failed");
        expect(mocks.failSetup.mock.invocationCallOrder[0]).toBeLessThan(mocks.cleanupReferences.mock.invocationCallOrder[0]);
        expect(mocks.failSetup).toHaveBeenCalledWith("task-one", "user-one");
        expect(mocks.cleanupReferences).toHaveBeenCalledWith(["temporary/first.png", "temporary/mask.png"]);
    });

    it("keeps staged references when setup failure cannot be atomically persisted", async () => {
        mocks.scheduleTask.mockRejectedValue(new Error("scheduler failed"));
        mocks.failSetup.mockResolvedValue({ outcome: "active", task: { id: "task-one", status: "running" }, storageKeys: [] });

        await expect(
            POST(
                new Request("http://localhost/api/image-tasks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: "change expression", config: { model: "image-model" }, references: [{ dataUrl: "data:image/png;base64,AAAA" }] }),
                }),
            ),
        ).rejects.toThrow("scheduler failed");
        expect(mocks.cleanupReferences).toHaveBeenCalledWith([]);
    });

    it("returns a client error when an inline reference cannot be persisted", async () => {
        mocks.persistReferences.mockRejectedValue(new Error("参考图文件过大"));

        const response = await POST(
            new Request("http://localhost/api/image-tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: "change expression", config: { model: "image-model" }, references: [{ dataUrl: "data:image/png;base64,AAAA" }] }),
            }),
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "参考图文件过大" });
        expect(mocks.createTask).not.toHaveBeenCalled();
    });
});
