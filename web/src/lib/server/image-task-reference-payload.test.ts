import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    writeReference: vi.fn(),
    deleteAssets: vi.fn(),
}));

vi.mock("@/lib/server/reference-asset-store", () => ({ writeReferenceImageDataUrl: mocks.writeReference }));
vi.mock("@/lib/server/local-media-storage", () => ({ deleteLocalMediaAssetsByStorageKeys: mocks.deleteAssets }));

import { IMAGE_TASK_REFERENCE_TTL_MS, persistImageTaskReferencePayload } from "./image-task-reference-payload";

describe("image task reference payload", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.deleteAssets.mockResolvedValue({ deletedFiles: 0, deletedBytes: 0, blocked: [] });
        mocks.writeReference
            .mockResolvedValueOnce({ token: "temporary/2026/08/03/images/first.png", bytes: 4, mimeType: "image/png", storage: "local" })
            .mockResolvedValueOnce({ token: "temporary/2026/08/03/images/second.jpg", bytes: 4, mimeType: "image/jpeg", storage: "local" })
            .mockResolvedValueOnce({ token: "temporary/2026/08/03/images/mask.png", bytes: 4, mimeType: "image/png", storage: "local" });
    });

    it("stores two inline references and a mask without retaining data urls in the task payload", async () => {
        const result = await persistImageTaskReferencePayload(
            [
                { id: "first", name: "first.png", type: "image/png", dataUrl: "data:image/png;base64,AAAA" },
                { id: "second", name: "second.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,BBBB", remoteUrl: "https://cdn.example/second.jpg" },
            ],
            { id: "mask", name: "mask.png", type: "image/png", dataUrl: "data:image/png;base64,CCCC" },
            { ownerUserId: "user-one", taskId: "task-one", conversationId: "conversation-one", projectId: "project-one" },
        );

        expect(JSON.stringify(result)).not.toContain("data:image");
        expect(result.references).toEqual([
            expect.objectContaining({ id: "first", dataUrl: "", url: "/api/reference-assets/temporary/2026/08/03/images/first.png", serverUrl: "/api/reference-assets/temporary/2026/08/03/images/first.png" }),
            expect.objectContaining({ id: "second", dataUrl: "", url: "/api/reference-assets/temporary/2026/08/03/images/second.jpg", serverUrl: "/api/reference-assets/temporary/2026/08/03/images/second.jpg" }),
        ]);
        expect(result.references[1]?.remoteUrl).toBeUndefined();
        expect(result.mask).toEqual(expect.objectContaining({ id: "mask", dataUrl: "", url: "/api/reference-assets/temporary/2026/08/03/images/mask.png" }));
        expect(result.storageKeys).toEqual(["temporary/2026/08/03/images/first.png", "temporary/2026/08/03/images/second.jpg", "temporary/2026/08/03/images/mask.png"]);
        expect(mocks.writeReference).toHaveBeenCalledTimes(3);
        expect(mocks.writeReference).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ ownerUserId: "user-one", taskId: "task-one", source: "image-task-reference", ttlMs: IMAGE_TASK_REFERENCE_TTL_MS }));
        expect(IMAGE_TASK_REFERENCE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it("leaves url-only references untouched", async () => {
        mocks.writeReference.mockReset();
        const reference = { id: "remote", type: "image/png", dataUrl: "", url: "https://cdn.example/reference.png" };

        const result = await persistImageTaskReferencePayload([reference], undefined, { ownerUserId: "user-one", taskId: "task-one" });

        expect(result).toEqual({ references: [reference], mask: undefined, storageKeys: [] });
        expect(mocks.writeReference).not.toHaveBeenCalled();
    });

    it("removes already written assets if a later inline reference fails", async () => {
        mocks.writeReference.mockReset().mockResolvedValueOnce({ token: "temporary/2026/08/03/images/first.png", bytes: 4, mimeType: "image/png", storage: "local" }).mockRejectedValueOnce(new Error("write failed"));

        await expect(persistImageTaskReferencePayload([{ dataUrl: "data:image/png;base64,AAAA" }, { dataUrl: "data:image/png;base64,BBBB" }], undefined, { ownerUserId: "user-one", taskId: "task-one" })).rejects.toThrow("write failed");
        expect(mocks.deleteAssets).toHaveBeenCalledWith(["temporary/2026/08/03/images/first.png"], "reference");
    });
});
