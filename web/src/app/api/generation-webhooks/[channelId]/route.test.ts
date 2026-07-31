import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    configured: vi.fn(),
    verify: vi.fn(),
    record: vi.fn(),
    getAuthSettings: vi.fn(),
}));

vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings }));
vi.mock("@/lib/server/generation-task-webhook", () => ({
    GenerationWebhookError: class GenerationWebhookError extends Error {
        constructor(
            message: string,
            readonly status: number,
        ) {
            super(message);
        }
    },
    isGenerationWebhookConfigured: mocks.configured,
    verifyGenerationWebhookSignature: mocks.verify,
    recordGenerationWebhook: mocks.record,
}));

import { POST } from "./route";

describe("POST /api/generation-webhooks/:channelId", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.configured.mockReturnValue(true);
        mocks.verify.mockReturnValue(true);
        mocks.getAuthSettings.mockResolvedValue({ systemChannels: [{ id: "channel-one", enabled: true, advancedConfig: { resultField: "data.url", statusField: "data.status" } }] });
        mocks.record.mockResolvedValue({ duplicate: false, matched: true, taskId: "video-one", resultReady: true });
    });

    it("rejects unsigned callbacks", async () => {
        mocks.verify.mockReturnValue(false);
        const response = await POST(request({}), context());
        expect(response.status).toBe(401);
        expect(mocks.record).not.toHaveBeenCalled();
    });

    it("parses configured result fields and forwards the raw body for idempotent processing", async () => {
        const body = { event: { id: "event-one" }, task_id: "upstream-one", data: { status: "completed", url: "https://cdn.example/video.mp4" }, metadata: { clientRequestId: "request-one" } };
        const response = await POST(request(body), context());

        expect(response.status).toBe(200);
        expect(mocks.record).toHaveBeenCalledWith({
            channelId: "channel-one",
            eventId: "event-one",
            upstreamTaskId: "upstream-one",
            clientRequestId: "request-one",
            upstreamStatus: "completed",
            resultUrl: "https://cdn.example/video.mp4",
            rawBody: JSON.stringify(body),
        });
    });
});

function request(body: unknown) {
    return new Request("http://localhost/api/generation-webhooks/channel-one", {
        method: "POST",
        headers: { "content-type": "application/json", "x-vozeb-pro-signature": "signature" },
        body: JSON.stringify(body),
    });
}

function context() {
    return { params: Promise.resolve({ channelId: "channel-one" }) };
}
