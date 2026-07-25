import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getPublicUsersByIds: vi.fn(),
    listPointRecordsPage: vi.fn(),
    listPrompts: vi.fn(),
    listCanvasProjects: vi.fn(),
    listCreativeAssets: vi.fn(),
    listCreativeConversations: vi.fn(),
    listCreativeMessages: vi.fn(),
    createPostgresRepositories: vi.fn(),
    ensurePostgresSchema: vi.fn(),
    isPostgresDatabaseEnabled: vi.fn(),
    getDramaProject: vi.fn(),
    listDramaProjectSummaries: vi.fn(),
    listGenerationLogs: vi.fn(),
    listLibraryAssets: vi.fn(),
    listLocalMediaRegistrationsForUser: vi.fn(),
    getOwnAccountDeletionRequest: vi.fn(),
}));

vi.mock("@/lib/auth/store", () => ({ getPublicUsersByIds: mocks.getPublicUsersByIds, listPointRecordsPage: mocks.listPointRecordsPage }));
vi.mock("@/lib/prompts/store", () => ({ listPrompts: mocks.listPrompts }));
vi.mock("@/lib/server/canvas-project-store", () => ({ listCanvasProjects: mocks.listCanvasProjects }));
vi.mock("@/lib/server/creative-runtime-store", () => ({
    listCreativeAssets: mocks.listCreativeAssets,
    listCreativeConversations: mocks.listCreativeConversations,
    listCreativeMessages: mocks.listCreativeMessages,
}));
vi.mock("@/lib/server/database", () => ({
    createPostgresRepositories: mocks.createPostgresRepositories,
    ensurePostgresSchema: mocks.ensurePostgresSchema,
    isPostgresDatabaseEnabled: mocks.isPostgresDatabaseEnabled,
}));
vi.mock("@/lib/server/drama-project-store", () => ({ getDramaProject: mocks.getDramaProject, listDramaProjectSummaries: mocks.listDramaProjectSummaries }));
vi.mock("@/lib/server/generation-log-store", () => ({ listGenerationLogs: mocks.listGenerationLogs }));
vi.mock("@/lib/server/library-asset-store", () => ({ listLibraryAssets: mocks.listLibraryAssets }));
vi.mock("@/lib/server/local-media-registry", () => ({ listLocalMediaRegistrationsForUser: mocks.listLocalMediaRegistrationsForUser }));
vi.mock("@/lib/server/account-deletion-request-service", () => ({ getOwnAccountDeletionRequest: mocks.getOwnAccountDeletionRequest }));

import { buildUserDataExport } from "./user-data-export-service";

describe("buildUserDataExport", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isPostgresDatabaseEnabled.mockReturnValue(false);
        mocks.getPublicUsersByIds.mockResolvedValue([{ id: "user-one", username: "one", displayName: "用户一", role: "user", status: "active" }]);
        mocks.listPointRecordsPage.mockResolvedValue({ records: [], total: 0 });
        mocks.listPrompts.mockResolvedValue({ items: [], total: 0 });
        mocks.listCanvasProjects.mockResolvedValue([]);
        mocks.listCreativeConversations.mockResolvedValue([]);
        mocks.listCreativeAssets.mockResolvedValue([]);
        mocks.listCreativeMessages.mockResolvedValue([]);
        mocks.listDramaProjectSummaries.mockResolvedValue([]);
        mocks.listGenerationLogs.mockResolvedValue({ items: [], total: 0 });
        mocks.listLibraryAssets.mockResolvedValue([]);
        mocks.listLocalMediaRegistrationsForUser.mockResolvedValue([]);
        mocks.getOwnAccountDeletionRequest.mockResolvedValue(null);
    });

    it("exports only the requested user's portable records and strips sensitive fields", async () => {
        mocks.listPointRecordsPage
            .mockResolvedValueOnce({ records: [{ id: "point-1", userId: "user-one", amount: 1, idempotencyKey: "hidden" }], total: 2 })
            .mockResolvedValueOnce({ records: [{ id: "point-2", userId: "user-one", amount: -1 }], total: 2 });
        mocks.listPrompts.mockResolvedValue({ items: [{ id: "prompt-1", ownerUserId: "user-one", prompt: "用户提示词", dataUrl: "data:image/png;base64,AAAA" }], total: 1 });
        mocks.listCreativeConversations
            .mockResolvedValueOnce([{ id: "conversation-1", userId: "user-one", surface: "chat", source: "agent", title: "会话", status: "active", contextSummary: "内部摘要", createdAt: 1, updatedAt: 2, lastMessageAt: 2 }])
            .mockResolvedValueOnce([]);
        mocks.listCreativeMessages.mockResolvedValue([
            { id: "message-1", conversationId: "conversation-1", sequence: 1, role: "user", status: "completed", content: "用户输入", metadata: { workbenchPlan: { resolvedPrompt: "内部提示词" } }, createdAt: 1, updatedAt: 1 },
            { id: "message-2", conversationId: "conversation-1", sequence: 2, role: "system", status: "completed", content: "系统消息", metadata: {}, createdAt: 1, updatedAt: 1 },
        ]);
        mocks.listCreativeAssets.mockResolvedValue([
            {
                id: "asset-1",
                userId: "user-one",
                conversationId: "conversation-1",
                ordinal: 0,
                type: "image",
                status: "ready",
                title: "图片",
                serverUrl: "/api/reference-assets/user/image.png",
                remoteUrl: "https://provider.example/image.png",
                metadata: { planningPrompt: "hidden" },
                createdAt: 1,
                updatedAt: 1,
            },
        ]);
        mocks.listGenerationLogs.mockResolvedValue({
            items: [
                {
                    id: "log-1",
                    userId: "user-one",
                    username: "one",
                    displayName: "用户一",
                    kind: "image",
                    source: "agent",
                    status: "success",
                    title: "图片",
                    prompt: "用户提示词",
                    model: "image-model",
                    summary: "完成",
                    durationMs: 100,
                    count: 1,
                    successCount: 1,
                    failCount: 0,
                    assets: [{ type: "image", url: "/api/generation-log-assets/user/image.png", remoteUrl: "https://provider.example/image.png" }],
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                },
            ],
            total: 1,
        });
        mocks.listLocalMediaRegistrationsForUser.mockResolvedValue([{ storageKey: "user/image.png", ownerUserId: "user-one", externalObjectKey: "private/object.png", type: "image", source: "agent" }]);
        mocks.getOwnAccountDeletionRequest.mockResolvedValue({ id: "delete-one", status: "pending", note: "不再使用", reviewNote: "", requestedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

        const result = await buildUserDataExport("user-one");

        expect(mocks.getPublicUsersByIds).toHaveBeenCalledWith(["user-one"]);
        expect(mocks.listLocalMediaRegistrationsForUser).toHaveBeenCalledWith("user-one");
        expect(result.points).toEqual([
            { id: "point-1", amount: 1 },
            { id: "point-2", amount: -1 },
        ]);
        expect(result.prompts).toEqual([{ id: "prompt-1", prompt: "用户提示词" }]);
        expect(result.creative[0].conversation).not.toHaveProperty("contextSummary");
        expect(result.creative[0].messages).toHaveLength(1);
        expect(result.creative[0].messages[0]).not.toHaveProperty("metadata");
        expect(result.creative[0].assets[0]).toMatchObject({ serverUrl: "/api/reference-assets/user/image.png" });
        expect(result.creative[0].assets[0]).not.toHaveProperty("remoteUrl");
        expect(result.generationLogs[0]).not.toHaveProperty("userId");
        expect(result.generationLogs[0]).not.toHaveProperty("username");
        expect((result.generationLogs[0] as { assets: unknown[] }).assets[0]).not.toHaveProperty("remoteUrl");
        expect(result.media[0]).not.toHaveProperty("externalObjectKey");
        expect(result.accountDeletionRequest).toMatchObject({ id: "delete-one", status: "pending" });
    });

    it("reads billing pages by user in PostgreSQL and removes provider payload details", async () => {
        const billing = {
            listOrders: vi.fn().mockResolvedValue({ items: [{ id: "order-1", userId: "user-one", metadata: { checkout: { url: "secret" } }, providerPaymentId: "provider-payment" }], total: 1 }),
            listPayments: vi.fn().mockResolvedValue({ items: [{ id: "payment-1", userId: "user-one", rawPayload: { secret: true }, providerTradeId: "trade" }], total: 1 }),
            listPlanAssignments: vi.fn().mockResolvedValue({ items: [{ id: "assignment-1", userId: "user-one", sourceId: "order-1", metadata: { internal: true } }], total: 1 }),
        };
        mocks.isPostgresDatabaseEnabled.mockReturnValue(true);
        mocks.createPostgresRepositories.mockReturnValue({ billing });

        const result = await buildUserDataExport("user-one");

        expect(billing.listOrders).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one" }));
        expect(billing.listPayments).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one" }));
        expect(billing.listPlanAssignments).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one" }));
        expect(result.billing.orders).toEqual([{ id: "order-1" }]);
        expect(result.billing.payments).toEqual([{ id: "payment-1" }]);
        expect(result.billing.planAssignments).toEqual([{ id: "assignment-1" }]);
    });
});
