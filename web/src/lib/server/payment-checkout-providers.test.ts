import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingOrderRecord } from "@/lib/server/database";
import type { PaymentRuntimeConfig } from "@/lib/server/payment-config-store";
import { checkoutFromMetadata, checkoutMetadata, createProviderCheckout } from "./payment-checkout-providers";

const order = {
    id: "order-one",
    orderNo: "VZ001",
    productId: "product",
    userId: "user",
    productKind: "plan",
    planId: "pro",
    status: "pending",
    subject: "Pro",
    amountCents: 1299,
    currency: "USD",
    pointsAmount: 100,
    dailyPoints: 20,
    periodDays: 30,
    quantity: 1,
    provider: "stripe",
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies BillingOrderRecord;

const config: PaymentRuntimeConfig = {
    saved: { providers: {} },
    providers: {},
    valuesByEnvName: {
        VOZEB_PRO_STRIPE_SECRET_KEY: "sk_test_secret",
        VOZEB_PRO_STRIPE_API_BASE: "https://stripe.test",
    },
};

describe("payment checkout providers", () => {
    beforeEach(() => vi.unstubAllGlobals());

    it("uses a stable Stripe idempotency key for one local order", async () => {
        const fetchMock = vi.fn(async () => Response.json({ id: "cs_test_session", url: "https://checkout.stripe.test/session", expires_at: 4070908800 }));
        vi.stubGlobal("fetch", fetchMock);

        await createProviderCheckout("stripe", order, { origin: "https://app.test" }, config);

        expect(fetchMock).toHaveBeenCalledWith(
            "https://stripe.test/v1/checkout/sessions",
            expect.objectContaining({
                headers: expect.objectContaining({ "Idempotency-Key": "vozeb-pro-checkout-order-one" }),
            }),
        );
    });

    it("restores a reusable checkout result from order metadata", () => {
        const checkout = {
            provider: "stripe",
            orderId: order.id,
            orderNo: order.orderNo,
            kind: "redirect" as const,
            url: "https://checkout.stripe.test/session",
            providerOrderId: "cs_test_session",
            expiresAt: "2099-01-01T00:00:00.000Z",
        };

        expect(checkoutFromMetadata({ ...order, metadata: { checkout: checkoutMetadata(checkout) } }, "stripe")).toEqual(checkout);
    });
});
