import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    listStoredGenerationTaskRecords: vi.fn(),
    generationTaskPointsCost: vi.fn(() => 3),
    findPublicUserIdsByKeyword: vi.fn(),
    getPublicUsersByIds: vi.fn(),
    getAuthSettings: vi.fn(),
}));

vi.mock("@/lib/server/generation-task-store", () => ({ listStoredGenerationTaskRecords: mocks.listStoredGenerationTaskRecords, generationTaskPointsCost: mocks.generationTaskPointsCost }));
vi.mock("@/lib/auth/store", () => ({ findPublicUserIdsByKeyword: mocks.findPublicUserIdsByKeyword, getPublicUsersByIds: mocks.getPublicUsersByIds, getAuthSettings: mocks.getAuthSettings }));
vi.mock("@/lib/server/channel-runtime-health", () => ({
    getChannelRuntimeHealth: vi.fn(() => ({ channelId: "channel-one", capability: "image", consecutiveFailures: 0 })),
    isChannelRuntimeCooling: vi.fn(() => false),
}));

import { listAdminGenerationOperations } from "./generation-operations-service";

describe("generation operations aggregation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findPublicUserIdsByKeyword.mockResolvedValue(["user-one"]);
        mocks.getPublicUsersByIds.mockResolvedValue([{ id: "user-one", accountId: "0001", username: "creator", displayName: "创作者" }]);
        mocks.listStoredGenerationTaskRecords.mockResolvedValue({
            items: [task()],
            all: [task()],
            total: 1,
            page: 1,
            pageSize: 20,
            summary: { total: 1, active: 0, success: 0, failed: 1, averageDurationMs: 3000, totalPointsCost: 3, byType: { agent: 1 }, byStatus: { error: 1 } },
        });
        mocks.getAuthSettings.mockResolvedValue({
            systemChannels: [{ id: "channel-one", name: "主渠道", enabled: true }],
            logicalModels: [{ id: "image-model", name: "图片模型", capability: "image", enabled: true, bindings: [{ channelId: "channel-one", upstreamModel: "vendor/image", enabled: true }] }],
        });
    });

    it("returns traceable task, point and channel summaries without inventing currency cost", async () => {
        const result = await listAdminGenerationOperations({ page: 1, search: "0001" });

        expect(result.items[0]).toMatchObject({
            id: "task-one",
            displayName: "创作者",
            accountId: "0001",
            surface: "chat",
            conversationId: "conversation-one",
            model: "image-model",
            pointsCost: 3,
            retryTaskId: "child-failed",
        });
        expect(result.summary).toMatchObject({ total: 1, failed: 1, totalPointsCost: 3 });
        expect(result.channels).toEqual([expect.objectContaining({ id: "channel-one", capability: "image", enabled: true, runtimeHealth: { status: "healthy", consecutiveFailures: 0 } })]);
        expect(mocks.getPublicUsersByIds).toHaveBeenCalledWith(["user-one"]);
        expect(mocks.findPublicUserIdsByKeyword).toHaveBeenCalledWith("0001");
        expect(mocks.listStoredGenerationTaskRecords).toHaveBeenCalledWith({ page: 1, search: "0001", searchUserIds: ["user-one"], includeAll: false });
        expect(JSON.stringify(result)).not.toContain("amountCents");
    });
});

function task() {
    return {
        id: "task-one",
        userId: "user-one",
        type: "agent",
        status: "error",
        payload: {
            prompt: "生成商品图",
            logicalModelId: "image-model",
            pointsCost: 3,
            tasks: [{ id: "child-failed", status: "failed", error: "上游失败" }],
        },
        createdAt: 1000,
        updatedAt: 4000,
        expiresAt: 10000,
        conversationId: "conversation-one",
        runId: "task-one",
        surface: "chat",
    };
}
