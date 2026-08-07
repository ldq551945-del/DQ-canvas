import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getByUpstream: vi.fn() }));

vi.mock("@/lib/server/generation-task-store", () => ({ getStoredGenerationTaskByUpstream: mocks.getByUpstream }));

import { userOwnsGenerationUpstreamTask } from "./generation-task-authorization";

describe("generation upstream task authorization", () => {
    beforeEach(() => mocks.getByUpstream.mockReset());

    it("requires an exact owner, channel, task type and upstream model match", async () => {
        mocks.getByUpstream.mockResolvedValue({ status: "running", payload: { config: { model: "models/VENDOR-VIDEO" } } });

        await expect(userOwnsGenerationUpstreamTask({ userId: "user", capability: "video", channelId: "channel", upstreamModel: "vendor-video", upstreamTaskId: "task", operation: "query" })).resolves.toBe(true);
        expect(mocks.getByUpstream).toHaveBeenCalledWith("video", "user", "channel", "task");

        mocks.getByUpstream.mockResolvedValue({ status: "running", payload: { config: { model: "other" } } });
        await expect(userOwnsGenerationUpstreamTask({ userId: "user", capability: "video", channelId: "channel", upstreamModel: "vendor-video", upstreamTaskId: "task", operation: "query" })).resolves.toBe(false);
    });

    it("hides cancelled tasks from queries but still permits their upstream cancellation", async () => {
        mocks.getByUpstream.mockResolvedValue({ status: "cancelled", payload: { config: { model: "vendor-video" } } });
        const input = { userId: "user", capability: "video" as const, channelId: "channel", upstreamModel: "vendor-video", upstreamTaskId: "task" };
        await expect(userOwnsGenerationUpstreamTask({ ...input, operation: "query" })).resolves.toBe(false);
        await expect(userOwnsGenerationUpstreamTask({ ...input, operation: "cancel" })).resolves.toBe(true);
    });
});
