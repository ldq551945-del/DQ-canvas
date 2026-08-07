import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutboundUrl: mocks.safeFetch }));

import { MAX_GENERATION_LOG_ASSETS, normalizeStoredLog, writeDataUrlAsset, writeRemoteAsset } from "./generation-log-repository";

beforeEach(() => vi.clearAllMocks());

function storedLogWithAssets(count: number) {
    return normalizeStoredLog({
        id: "image-workbench:batch",
        userId: "user-1",
        username: "user",
        displayName: "User",
        kind: "image",
        source: "image-workbench",
        status: "success",
        title: "Batch",
        prompt: "Prompt",
        model: "image-model",
        summary: "Done",
        durationMs: 100,
        count,
        successCount: count,
        failCount: 0,
        assets: Array.from({ length: count }, (_, index) => ({ type: "image" as const, url: `/api/generation-log-assets/result-${index}.png` })),
        createdAt: "2026-07-28T00:00:00.000Z",
        updatedAt: "2026-07-28T00:00:00.000Z",
    });
}

describe("generation log asset normalization", () => {
    it("keeps all eight successful images in a workbench batch", () => {
        expect(storedLogWithAssets(8).assets).toHaveLength(8);
    });

    it("rejects forged remote video content before writing an asset", async () => {
        mocks.safeFetch.mockResolvedValueOnce(new Response("<html>not a video</html>", { status: 200, headers: { "content-type": "video/mp4" } }));

        await expect(writeRemoteAsset("https://cdn.example/result.mp4", "video", { ownerUserId: "user-1", source: "video-workbench" })).resolves.toBeNull();
        expect(mocks.safeFetch).toHaveBeenCalledWith("https://cdn.example/result.mp4", expect.objectContaining({ cache: "no-store" }), { allowPrivateUpstreams: false });
    });

    it("rejects a forged data URL before writing an image asset", async () => {
        const forged = `data:image/png;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`;

        await expect(writeDataUrlAsset(forged, "image", { ownerUserId: "user-1", source: "image-workbench" })).rejects.toThrow();
    });

    it("retains a bounded per-record asset limit", () => {
        expect(storedLogWithAssets(MAX_GENERATION_LOG_ASSETS + 5).assets).toHaveLength(MAX_GENERATION_LOG_ASSETS);
    });

    it("persists the bounded public user prompt separately from task prompts", () => {
        const log = normalizeStoredLog({
            ...storedLogWithAssets(1),
            prompt: "内部执行提示词",
            requestSnapshot: { version: 1, userPrompt: "用户原始需求", parameters: {}, references: [], slots: [{ id: "slot-1", index: 0, status: "pending", prompt: "内部执行提示词" }] },
        });

        expect(log.prompt).toBe("内部执行提示词");
        expect(log.requestSnapshot).toMatchObject({ userPrompt: "用户原始需求", slots: [{ prompt: "内部执行提示词" }] });
    });
});
