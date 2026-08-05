import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    currentUser: vi.fn(),
    settings: vi.fn(),
    readJsonBody: vi.fn(),
    resolveLogicalModel: vi.fn(),
    createVideoTask: vi.fn(),
    scheduleGenerationTask: vi.fn(),
    checkGenerationRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth/request", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.settings, isAuthInputError: vi.fn(() => false) }));
vi.mock("@/lib/server/generation-channel", () => ({
    generationModelId: (config: { logicalModel?: string; model: string }) => config.logicalModel || config.model,
    rawModelName: (value: string) => value,
    toSystemGenerationChannel: vi.fn(() => ({ apiSource: "system", baseUrl: "/api/ai/system/channel-one", apiKey: "system", apiFormat: "openai", model: "video-model", logicalModel: "video-logical", channelId: "channel-one" })),
}));
vi.mock("@/lib/server/generation-task-store", () => ({ withGenerationConcurrencyLimit: (_userId: string, _type: string, _timeout: number, _limit: number, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/server/generation-task-scheduler", () => ({ scheduleGenerationTask: mocks.scheduleGenerationTask }));
vi.mock("@/lib/server/logical-model-router", () => ({ resolveLogicalModel: mocks.resolveLogicalModel }));
vi.mock("@/lib/server/video-task-store", () => ({ createVideoTask: mocks.createVideoTask }));
vi.mock("@/lib/server/security", () => ({ checkGenerationRateLimit: mocks.checkGenerationRateLimit, rateLimitHeaders: vi.fn(() => ({ "Retry-After": "60" })) }));

import { POST } from "./route";

describe("POST /api/video-tasks", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUser.mockResolvedValue({ id: "user-one" });
        mocks.settings.mockResolvedValue({ defaultModels: { videoModel: "video-logical" }, generationConcurrency: { video: 2 } });
        mocks.readJsonBody.mockResolvedValue({ config: { model: "video-logical" }, upstream: { id: "upstream-one", model: "video-model", provider: "generation", pollPath: "/videos" } });
        mocks.resolveLogicalModel.mockReturnValue({ logicalModelId: "video-logical" });
        mocks.createVideoTask.mockResolvedValue({ id: "task-one", status: "running", config: { model: "video-model", logicalModel: "video-logical" }, upstream: { id: "upstream-one", model: "video-model", provider: "generation", pollPath: "/videos" } });
        mocks.scheduleGenerationTask.mockResolvedValue(undefined);
        mocks.checkGenerationRateLimit.mockResolvedValue({ allowed: true, remaining: 5, resetAt: Date.now() + 60_000 });
    });

    it("schedules a registered upstream task for immediate worker pickup", async () => {
        const before = Date.now();
        const response = await POST(new Request("http://localhost/api/video-tasks", { method: "POST", body: "{}" }));

        expect(response.status).toBe(200);
        expect(mocks.scheduleGenerationTask).toHaveBeenCalledWith(
            "video",
            "task-one",
            expect.objectContaining({ executionPhase: "submitted", upstreamTaskId: "upstream-one", channelId: "channel-one", provider: "generation", queryPath: "/videos", lastUpstreamStatus: "submitted" }),
        );
        expect(mocks.scheduleGenerationTask.mock.calls[0][2].nextPollAt).toBeGreaterThanOrEqual(before);
    });
});
