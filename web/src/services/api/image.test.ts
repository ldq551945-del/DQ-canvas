import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api/points", () => ({ refreshUserPointsIfSystem: vi.fn(async () => undefined), syncUserPointsFromHeaders: vi.fn() }));
vi.mock("@/services/image-storage", () => ({ imageToDataUrl: vi.fn() }));

import { waitForImageGenerationTask } from "./image";

describe("image API cancellation", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("continues polling after cancellation is requested and only settles on the confirmed terminal state", async () => {
        vi.useFakeTimers();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(json({ task: { id: "image-cancelled", status: "cancelled", executionPhase: "cancel_requested", message: "已提交取消，正在确认上游状态" } }))
            .mockResolvedValueOnce(json({ task: { id: "image-cancelled", status: "cancelled", executionPhase: "completed", message: "任务已取消" } }));
        vi.stubGlobal("fetch", fetchMock);

        const promise = waitForImageGenerationTask({ apiSource: "custom" } as never, { id: "image-cancelled", kind: "generation", model: "image-v1" });
        const rejection = expect(promise).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(1800);
        await rejection;
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

function json(value: unknown) {
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
