import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    provider: "postgres",
    query: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: vi.fn(),
    getDatabaseProvider: vi.fn(() => mocks.provider),
    withPostgresTransaction: vi.fn(async (handler: (client: { query: typeof mocks.query }) => unknown) => handler({ query: mocks.query })),
}));

import { GenerationWebhookError, recordGenerationWebhook, verifyGenerationWebhookSignature } from "./generation-task-webhook";

describe("generation task webhook", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.provider = "postgres";
        vi.stubEnv("VOZEB_PRO_GENERATION_WEBHOOK_SECRET", "0123456789abcdef0123456789abcdef");
    });

    it("accepts only an exact HMAC-SHA256 signature", () => {
        const body = JSON.stringify({ id: "event-one" });
        const signature = createHmac("sha256", process.env.VOZEB_PRO_GENERATION_WEBHOOK_SECRET!).update(body).digest("hex");

        expect(verifyGenerationWebhookSignature(body, `sha256=${signature}`)).toBe(true);
        expect(verifyGenerationWebhookSignature(`${body} `, `sha256=${signature}`)).toBe(false);
        expect(verifyGenerationWebhookSignature(body, "invalid")).toBe(false);
    });

    it("deduplicates events before moving a matched media task to result_ready", async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [{ event_id: "event-one" }] })
            .mockResolvedValueOnce({ rows: [{ id: "video-one", task_type: "video" }] })
            .mockResolvedValueOnce({ rows: [] });

        const result = await recordGenerationWebhook({
            channelId: "channel-one",
            eventId: "event-one",
            upstreamTaskId: "upstream-one",
            upstreamStatus: "completed",
            resultUrl: "https://cdn.example/video.mp4",
            rawBody: "{}",
        });

        expect(result).toMatchObject({ duplicate: false, matched: true, taskId: "video-one", taskType: "video", resultReady: true });
        expect(String(mocks.query.mock.calls[0]?.[0])).toContain("ON CONFLICT (channel_id, event_id) DO NOTHING");
        expect(String(mocks.query.mock.calls[1]?.[0])).toContain("worker_id = NULL, lease_until = NULL");
        expect(String(mocks.query.mock.calls[1]?.[0])).toContain("'result_ready'");
    });

    it("does not apply a duplicate event twice", async () => {
        mocks.query.mockResolvedValueOnce({ rows: [] });

        await expect(recordGenerationWebhook({ channelId: "channel-one", eventId: "event-one", upstreamTaskId: "upstream-one", rawBody: "{}" })).resolves.toEqual({ duplicate: true, matched: false });
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });

    it("requires PostgreSQL for durable webhook idempotency", async () => {
        mocks.provider = "file";

        await expect(recordGenerationWebhook({ channelId: "channel-one", eventId: "event-one", upstreamTaskId: "upstream-one", rawBody: "{}" })).rejects.toEqual(expect.objectContaining<Partial<GenerationWebhookError>>({ status: 409 }));
    });
});
