import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    ensureSchema: vi.fn(),
    upsertEvent: vi.fn(),
    claimEvent: vi.fn(),
    markProcessed: vi.fn(),
    releaseEvent: vi.fn(),
    getOrderByOrderNo: vi.fn(),
    getPaymentConfig: vi.fn(),
    completePayment: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    createPostgresRepositories: () => ({
        billing: {
            upsertProviderEvent: mocks.upsertEvent,
            claimProviderEvent: mocks.claimEvent,
            markProviderEventProcessed: mocks.markProcessed,
            releaseProviderEvent: mocks.releaseEvent,
            getOrderByOrderNo: mocks.getOrderByOrderNo,
        },
    }),
    ensurePostgresSchema: mocks.ensureSchema,
    isPostgresDatabaseEnabled: vi.fn(() => true),
}));
vi.mock("@/lib/server/payment-config-store", () => ({
    getPaymentRuntimeConfig: mocks.getPaymentConfig,
    getPaymentRuntimeEnv: (config: PaymentConfig, name: string) => config.valuesByEnvName[name]?.trim() || "",
    getPaymentRuntimeValue: (config: PaymentConfig, ...names: string[]) => names.map((name) => config.valuesByEnvName[name]?.trim() || "").find(Boolean) || "",
}));
vi.mock("@/lib/server/billing-service", () => ({ completeBillingOrderPayment: mocks.completePayment }));

import { processPaymentWebhook } from "./payment-webhook-service";

type PaymentConfig = {
    saved: { providers: Record<string, unknown> };
    providers: Record<string, { enabled?: boolean; saved?: boolean }>;
    valuesByEnvName: Record<string, string>;
};

const webhookSecret = "payply-fixture-webhook-secret";
const rawBody = JSON.stringify({
    eventId: "event-one",
    eventType: "payment.succeeded",
    orderId: "order-one",
    status: "succeeded",
    providerTradeId: "trade-one",
    providerPaymentId: "payment-one",
    amountCents: 1299,
    currency: "CNY",
    paidAt: "2026-07-30T08:00:00.000Z",
});

describe("payment webhook processing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPaymentConfig.mockResolvedValue({
            saved: { providers: {} },
            providers: { payply: { enabled: true, saved: true } },
            valuesByEnvName: { VOZEB_PRO_PAYPLY_WEBHOOK_SECRET: webhookSecret },
        } satisfies PaymentConfig);
        mocks.upsertEvent.mockResolvedValue({ id: "provider-event-one" });
        mocks.claimEvent.mockResolvedValue({ id: "provider-event-one" });
        mocks.completePayment.mockResolvedValue({ order: { orderNo: "VZ001", status: "paid" }, pointsGranted: 500 });
        mocks.markProcessed.mockResolvedValue(undefined);
        mocks.releaseEvent.mockResolvedValue(undefined);
    });

    it("verifies a compatible callback and completes the matching order", async () => {
        const result = await processPaymentWebhook({ provider: "payply", rawBody, headers: signedHeaders(rawBody) });

        expect(result).toEqual({
            received: true,
            provider: "payply",
            eventId: "event-one",
            eventType: "payment.succeeded",
            orderId: "order-one",
            orderNo: "VZ001",
            orderStatus: "paid",
            pointsGranted: 500,
        });
        expect(mocks.completePayment).toHaveBeenCalledWith({
            orderId: "order-one",
            provider: "payply",
            channel: "payment.succeeded",
            providerTradeId: "trade-one",
            providerPaymentId: "payment-one",
            amountCents: 1299,
            currency: "CNY",
            paidAt: "2026-07-30T08:00:00.000Z",
            rawPayload: JSON.parse(rawBody),
        });
        expect(mocks.markProcessed).toHaveBeenCalledWith("provider-event-one", undefined);
        expect(mocks.releaseEvent).not.toHaveBeenCalled();
    });

    it("returns an already processed callback as a duplicate", async () => {
        mocks.upsertEvent.mockResolvedValue({ id: "provider-event-one", processedAt: "2026-07-30T08:01:00.000Z" });

        await expect(processPaymentWebhook({ provider: "payply", rawBody, headers: signedHeaders(rawBody) })).resolves.toMatchObject({ duplicate: true, eventId: "event-one", orderId: "order-one" });
        expect(mocks.claimEvent).not.toHaveBeenCalled();
        expect(mocks.completePayment).not.toHaveBeenCalled();
    });

    it("reports a callback already claimed by another worker as processing", async () => {
        mocks.claimEvent.mockResolvedValue(null);

        await expect(processPaymentWebhook({ provider: "payply", rawBody, headers: signedHeaders(rawBody) })).resolves.toMatchObject({ processing: true, eventId: "event-one", orderId: "order-one" });
        expect(mocks.completePayment).not.toHaveBeenCalled();
        expect(mocks.markProcessed).not.toHaveBeenCalled();
    });

    it("records and rejects an invalid signature before claiming the event", async () => {
        const headers = new Headers({ "x-vozeb-pro-signature": "invalid" });

        await expect(processPaymentWebhook({ provider: "payply", rawBody, headers })).rejects.toMatchObject({ message: "支付回调签名无效", status: 401 });
        expect(mocks.upsertEvent).toHaveBeenCalledWith(expect.objectContaining({ provider: "payply", eventId: expect.stringContaining("event-one:invalid:"), signatureValid: false, error: "signature invalid" }));
        expect(mocks.claimEvent).not.toHaveBeenCalled();
        expect(mocks.completePayment).not.toHaveBeenCalled();
    });

    it("releases the callback claim when order completion fails", async () => {
        mocks.completePayment.mockRejectedValue(new Error("payment amount mismatch"));

        await expect(processPaymentWebhook({ provider: "payply", rawBody, headers: signedHeaders(rawBody) })).rejects.toThrow("payment amount mismatch");
        expect(mocks.releaseEvent).toHaveBeenCalledWith("provider-event-one", "payment amount mismatch");
        expect(mocks.markProcessed).not.toHaveBeenCalled();
    });
});

function signedHeaders(body: string) {
    return new Headers({ "x-vozeb-pro-signature": createHmac("sha256", webhookSecret).update(body).digest("hex") });
}
