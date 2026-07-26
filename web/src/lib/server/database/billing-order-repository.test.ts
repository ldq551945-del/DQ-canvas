import { describe, expect, it, vi } from "vitest";

import type { QueryExecutor } from "./postgres";
import { BillingOrderRepository } from "./billing-order-repository";

describe("BillingOrderRepository.getSummary", () => {
    it("returns the financial summary with one bounded aggregate query", async () => {
        const query = vi.fn(async (..._args: unknown[]) => ({
            rows: [
                {
                    order_total: "12",
                    order_pending: "2",
                    order_paid: "7",
                    order_closed: "1",
                    order_canceled: "1",
                    order_refunded: "1",
                    order_gross_amount_cents: "20800",
                    order_paid_amount_cents: "18800",
                    order_pending_amount_cents: "1200",
                    order_refunded_amount_cents: "2000",
                    payment_succeeded: "7",
                    payment_refunded: "1",
                    payment_succeeded_amount_cents: "18800",
                    payment_refunded_amount_cents: "2000",
                    providers: [
                        {
                            provider: "wechat",
                            totalOrders: 8,
                            pendingOrders: 1,
                            paidOrders: 5,
                            refundedOrders: 1,
                            paidAmountCents: 13800,
                            refundedAmountCents: 2000,
                        },
                    ],
                    paid_orders_without_succeeded_payment: "1",
                    succeeded_payments_without_paid_order: "2",
                    amount_mismatch_payments: "3",
                },
            ],
            rowCount: 1,
        }));
        const repository = new BillingOrderRepository({ query } as unknown as QueryExecutor);

        const summary = await repository.getSummary({ startDate: "2026-07-01T00:00:00.000Z", endDate: "2026-08-01T00:00:00.000Z" });

        expect(summary).toEqual({
            orders: {
                total: 12,
                pending: 2,
                paid: 7,
                closed: 1,
                canceled: 1,
                refunded: 1,
                grossAmountCents: 20800,
                paidAmountCents: 18800,
                pendingAmountCents: 1200,
                refundedAmountCents: 2000,
            },
            payments: {
                succeeded: 7,
                refunded: 1,
                succeededAmountCents: 18800,
                refundedAmountCents: 2000,
            },
            providers: [
                {
                    provider: "wechat",
                    totalOrders: 8,
                    pendingOrders: 1,
                    paidOrders: 5,
                    refundedOrders: 1,
                    paidAmountCents: 13800,
                    refundedAmountCents: 2000,
                },
            ],
            reconciliation: {
                paidOrdersWithoutSucceededPayment: 1,
                succeededPaymentsWithoutPaidOrder: 2,
                amountMismatchPayments: 3,
            },
        });
        expect(query).toHaveBeenCalledTimes(1);
        const [sql, params] = query.mock.calls[0] || [];
        expect(String(sql)).toContain("WITH scoped_orders AS MATERIALIZED");
        expect(String(sql)).toContain("scoped_payments AS MATERIALIZED");
        expect(String(sql)).toContain("order_row.status NOT IN ('paid', 'refunded')");
        expect(String(sql)).not.toMatch(/SELECT\s+\*/i);
        expect(params).toEqual(["2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"]);
    });
});
