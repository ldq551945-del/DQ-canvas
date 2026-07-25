import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    appendCreativeConversationExchange: vi.fn(),
    getCreativeConversation: vi.fn(),
    registerCreativeAssets: vi.fn(),
    writePersistentMediaDataUrl: vi.fn(),
}));

vi.mock("@/lib/server/creative-runtime-store", () => ({
    appendCreativeConversationExchange: mocks.appendCreativeConversationExchange,
    createCreativeConversation: vi.fn(),
    getCreativeAsset: vi.fn(),
    getCreativeConversation: mocks.getCreativeConversation,
    listCreativeAssets: vi.fn(),
    listCreativeConversations: vi.fn(),
    listCreativeMessages: vi.fn(),
    registerCreativeAssets: mocks.registerCreativeAssets,
    updateCreativeConversation: vi.fn(),
}));
vi.mock("@/lib/server/reference-asset-store", () => ({ writePersistentMediaDataUrl: mocks.writePersistentMediaDataUrl }));

import { appendWorkbenchExchangeForUser, registerGenerationLogAssetsForUser, uploadAssetForUser } from "./creative-runtime-service";

function file(name: string, type: string, size = 4): File {
    return { name, type, size, arrayBuffer: async () => new Uint8Array(Math.min(size, 4)).buffer } as File;
}

describe("创作会话素材上传", () => {
    beforeEach(() => {
        mocks.appendCreativeConversationExchange.mockReset().mockResolvedValue({});
        mocks.getCreativeConversation.mockReset().mockResolvedValue({ id: "conversation-one", userId: "user-one", status: "active" });
        mocks.writePersistentMediaDataUrl.mockReset().mockResolvedValue({ token: "persistent-one.mp4", storage: "local", bytes: 4, mimeType: "video/mp4" });
        mocks.registerCreativeAssets.mockReset().mockImplementation(async ([input]) => [{ ...input, id: "asset-one", status: "ready", metadata: input.metadata || {}, createdAt: 1, updatedAt: 1 }]);
    });

    it("stores image, video and audio as stable assets without persisting base64", async () => {
        const asset = await uploadAssetForUser("user-one", "conversation-one", file("clip.mp4", "video/mp4"));

        expect(mocks.writePersistentMediaDataUrl).toHaveBeenCalledWith(
            expect.stringMatching(/^data:video\/mp4;base64,/),
            "video",
            expect.objectContaining({ ownerUserId: "user-one", conversationId: "conversation-one", originalName: "clip.mp4", maxBytes: 20 * 1024 * 1024 }),
        );
        expect(asset).toMatchObject({ id: "asset-one", type: "video", serverUrl: "/api/reference-assets/persistent-one.mp4", storageKey: "persistent-one.mp4" });
        expect(JSON.stringify(mocks.registerCreativeAssets.mock.calls[0][0])).not.toContain("base64");
    });

    it("keeps the internal storage key while marking object-backed uploads", async () => {
        mocks.writePersistentMediaDataUrl.mockResolvedValue({ token: "permanent/object.png", storage: "object", bytes: 4, mimeType: "image/png" });

        const asset = await uploadAssetForUser("user-one", "conversation-one", file("image.png", "image/png"));

        expect(asset).toMatchObject({ storageKind: "object", storageKey: "permanent/object.png", serverUrl: "/api/reference-assets/permanent/object.png" });
    });

    it("rejects unsupported files, oversized files and other users' conversations", async () => {
        await expect(uploadAssetForUser("user-one", "conversation-one", file("notes.pdf", "application/pdf"))).rejects.toMatchObject({ status: 400 });
        await expect(uploadAssetForUser("user-one", "conversation-one", file("vector.svg", "image/svg+xml"))).rejects.toMatchObject({ status: 400 });
        await expect(uploadAssetForUser("user-one", "conversation-one", file("limit.mp4", "video/mp4", 20 * 1024 * 1024))).resolves.toMatchObject({ id: "asset-one" });
        await expect(uploadAssetForUser("user-one", "conversation-one", file("large.mp4", "video/mp4", 20 * 1024 * 1024 + 1))).rejects.toMatchObject({ status: 413 });
        mocks.getCreativeConversation.mockResolvedValueOnce({ id: "conversation-one", userId: "user-two", status: "active" });
        await expect(uploadAssetForUser("user-one", "conversation-one", file("image.png", "image/png"))).rejects.toMatchObject({ status: 404 });
    });

    it("registers successful workbench media against the shared conversation", async () => {
        const assets = await registerGenerationLogAssetsForUser("user-one", {
            conversationId: "conversation-one",
            logId: "image-workbench:log-one",
            source: "image-workbench",
            title: "商品主图",
            assets: [{ type: "image", url: "/api/generation-log-assets/user/file.png", mimeType: "image/png", width: 1024, height: 1024 }],
        });

        expect(assets[0]).toMatchObject({ type: "image", serverUrl: "/api/generation-log-assets/user/file.png", storageKind: "local" });
        expect(mocks.registerCreativeAssets).toHaveBeenCalledWith([expect.objectContaining({ conversationId: "conversation-one", sourceRunId: "image-workbench:image-workbench:log-one" })]);
    });

    it("stores only public workbench messages without the internal plan", async () => {
        mocks.getCreativeConversation.mockResolvedValueOnce({ id: "conversation-one", userId: "user-one", status: "active", surface: "chat", source: "image-workbench" });

        await appendWorkbenchExchangeForUser("user-one", { conversationId: "conversation-one", workspace: "image", prompt: "生成商品图", reply: "已收到生成需求。" });

        expect(mocks.appendCreativeConversationExchange).toHaveBeenCalledWith({
            userId: "user-one",
            conversationId: "conversation-one",
            userContent: "生成商品图",
            assistantContent: "已收到生成需求。",
            userMetadata: { workspace: "image" },
            assistantMetadata: { workspace: "image" },
        });
        expect(JSON.stringify(mocks.appendCreativeConversationExchange.mock.calls[0][0])).not.toContain("workbenchPlan");
        expect(JSON.stringify(mocks.appendCreativeConversationExchange.mock.calls[0][0])).not.toContain("resolvedPrompt");
    });
});
