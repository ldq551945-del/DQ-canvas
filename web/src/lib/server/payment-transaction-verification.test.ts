import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingOrderRecord } from "@/lib/server/database";
import type { ParsedPaymentWebhook } from "@/lib/server/payment-webhook-adapters";

const mocks = vi.hoisted(() => ({
    fetchSafe: vi.fn(),
    getConfig: vi.fn(),
}));

vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutboundUrl: mocks.fetchSafe }));
vi.mock("@/lib/server/payment-config-store", () => ({
    getPaymentRuntimeConfig: mocks.getConfig,
    getPaymentRuntimeEnv: (config: PaymentConfig, name: string) => config.valuesByEnvName[name]?.trim() || "",
    getPaymentRuntimeValue: (config: PaymentConfig, ...names: string[]) => names.map((name) => config.valuesByEnvName[name]?.trim() || "").find(Boolean) || "",
}));

import { verifyPaymentTransaction } from "./payment-transaction-verification";

type PaymentConfig = {
    saved: { providers: Record<string, unknown> };
    providers: Record<string, { enabled?: boolean; saved?: boolean }>;
    valuesByEnvName: Record<string, string>;
};

const order = {
    id: "order-one",
    orderNo: "DQ001",
    productId: "points-500",
    userId: "user-one",
    productKind: "points",
    status: "pending",
    subject: "500 积分",
    listAmountCents: 1299,
    promotionDiscountCents: 0,
    couponDiscountCents: 0,
    amountCents: 1299,
    currency: "CNY",
    pointsAmount: 500,
    dailyPoints: 0,
    periodDays: 0,
    quantity: 1,
    provider: "payply",
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
} satisfies BillingOrderRecord;

const callback = {
    eventId: "event-one",
    eventType: "payment.succeeded",
    signatureValid: true,
    status: "succeeded",
    orderId: order.id,
    orderNo: order.orderNo,
    providerTradeId: "callback-trade",
    providerPaymentId: "callback-payment",
    amountCents: order.amountCents,
    currency: order.currency,
    payload: { source: "callback" },
} satisfies ParsedPaymentWebhook;

describe("payment transaction verification", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getConfig.mockResolvedValue({
            saved: { providers: {} },
            providers: { payply: { enabled: true, saved: true } },
            valuesByEnvName: {
                DQ_PAYPLY_QUERY_URL: "https://payments.example.test/orders/{{orderNo}}",
                DQ_PAYPLY_API_KEY: "provider-key",
            },
        } satisfies PaymentConfig);
    });

    it("does not trust a complete signed callback when the provider query is not successful", async () => {
        mocks.fetchSafe.mockResolvedValue(
            new Response(JSON.stringify({ status: "pending", orderId: order.id, orderNo: order.orderNo, tradeId: "query-trade", paymentId: "query-payment", amountCents: order.amountCents, currency: order.currency }), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );

        await expect(verifyPaymentTransaction("payply", callback, order)).resolves.toMatchObject({ verified: false, reason: "支付商交易尚未成功：pending" });
    });

    it("uses provider-query identity and amount as the verified payment fact", async () => {
        const queryPayload = { status: "succeeded", orderId: order.id, orderNo: order.orderNo, tradeId: "query-trade", paymentId: "query-payment", amountCents: order.amountCents, currency: order.currency, paidAt: "2026-08-06T01:00:00.000Z" };
        mocks.fetchSafe.mockResolvedValue(new Response(JSON.stringify(queryPayload), { status: 200, headers: { "content-type": "application/json" } }));

        await expect(verifyPaymentTransaction("payply", callback, order)).resolves.toEqual({
            verified: true,
            payment: {
                status: "succeeded",
                orderId: order.id,
                orderNo: order.orderNo,
                providerTradeId: "query-trade",
                providerPaymentId: "query-payment",
                amountCents: order.amountCents,
                currency: order.currency,
                paidAt: "2026-08-06T01:00:00.000Z",
                rawPayload: { callback: { source: "callback" }, query: queryPayload },
            },
        });
        expect(mocks.fetchSafe).toHaveBeenCalledWith("https://payments.example.test/orders/DQ001", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer provider-key" }) }));
    });

    it("rejects a provider-query result bound to another order", async () => {
        mocks.fetchSafe.mockResolvedValue(
            new Response(JSON.stringify({ status: "succeeded", orderId: "order-other", orderNo: "DQ999", tradeId: "query-trade", paymentId: "query-payment", amountCents: order.amountCents, currency: order.currency }), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );

        await expect(verifyPaymentTransaction("payply", callback, order)).rejects.toMatchObject({ message: "支付交易对应的订单身份不一致", status: 409 });
    });
});
