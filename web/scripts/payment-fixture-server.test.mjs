import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPaymentFixtureServer } from "./payment-fixture-server.mjs";

let fixture;
let origin;

beforeEach(async () => {
    fixture = createPaymentFixtureServer();
    await new Promise((resolve) => fixture.server.listen(0, "127.0.0.1", resolve));
    const address = fixture.server.address();
    origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
    await new Promise((resolve, reject) => fixture.server.close((error) => (error ? reject(error) : resolve())));
});

describe("payment fixture server", () => {
    it("exposes the Playwright health check", async () => {
        const response = await fetch(`${origin}/health`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
    });

    it("returns provider-confirmed PayPly order identity and amount", async () => {
        await fetch(`${origin}/payply/checkout`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orderId: "order-e2e", orderNo: "DQ-E2E-001", amountCents: 100, currency: "cny" }),
        });

        const response = await fetch(`${origin}/payply/query?orderId=order-e2e&orderNo=DQ-E2E-001&tradeId=trade-e2e&paymentId=payment-e2e`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            status: "succeeded",
            orderId: "order-e2e",
            orderNo: "DQ-E2E-001",
            providerTradeId: "trade-e2e",
            providerPaymentId: "payment-e2e",
            amountCents: 100,
            currency: "CNY",
        });
    });

    it("rejects PayPly queries that were not preceded by checkout", async () => {
        const response = await fetch(`${origin}/payply/query?orderId=unknown`);

        expect(response.status).toBe(404);
    });

    it("serves refund reconciliation results", async () => {
        const response = await fetch(`${origin}/payply/refund-query?refundId=refund-e2e`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ data: { status: "success", refundId: "refund-e2e" } });
    });
});
