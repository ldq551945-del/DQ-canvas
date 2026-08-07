import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingOrderRecord, BillingRefundJobRecord, PaymentTransactionRecord } from "@/lib/server/database";

const mocks = vi.hoisted(() => ({
    order: undefined as BillingOrderRecord | undefined,
    job: undefined as BillingRefundJobRecord | undefined,
    getOrderById: vi.fn(),
    updateOrder: vi.fn(),
    getRefundJobByOrderId: vi.fn(),
    upsertRefundJob: vi.fn(),
    claimDueRefundJobs: vi.fn(),
    checkpointRefundJob: vi.fn(),
    releaseRefundJob: vi.fn(),
    listPayments: vi.fn(),
    refundProvider: vi.fn(),
    reconcileProvider: vi.fn(),
    finalize: vi.fn(),
}));

vi.mock("@/lib/server/auth-mutation-lock", () => ({ lockAuthMutation: vi.fn() }));
vi.mock("@/lib/server/database", () => ({
    createPostgresRepositories: () => ({
        billing: {
            getOrderById: mocks.getOrderById,
            updateOrder: mocks.updateOrder,
            getRefundJobByOrderId: mocks.getRefundJobByOrderId,
            upsertRefundJob: mocks.upsertRefundJob,
            claimDueRefundJobs: mocks.claimDueRefundJobs,
            checkpointRefundJob: mocks.checkpointRefundJob,
            releaseRefundJob: mocks.releaseRefundJob,
            listPayments: mocks.listPayments,
        },
    }),
    ensurePostgresSchema: vi.fn(),
    isPostgresDatabaseEnabled: vi.fn(() => true),
    withPostgresTransaction: vi.fn(async (callback: (client: object) => unknown) => callback({})),
}));
vi.mock("@/lib/server/payment-refund-service", () => ({
    refundPaymentTransaction: mocks.refundProvider,
    reconcilePaymentRefund: mocks.reconcileProvider,
}));
vi.mock("@/lib/server/billing-refund-finalization-service", () => ({ finalizeBillingOrderRefund: mocks.finalize }));

import { refundBillingOrder, runBillingRefundReconciliationBatch } from "./billing-refund-orchestration-service";

const now = "2026-08-06T00:00:00.000Z";
const order = {
    id: "order-one",
    orderNo: "DQ001",
    productId: "points-500",
    userId: "user-one",
    productKind: "points",
    status: "paid",
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
    provider: "stripe",
    createdAt: now,
    updatedAt: now,
} satisfies BillingOrderRecord;
const payment = {
    id: "payment-one",
    orderId: order.id,
    userId: order.userId,
    provider: "stripe",
    channel: "checkout.session.completed",
    status: "succeeded",
    amountCents: order.amountCents,
    currency: order.currency,
    providerTradeId: "pi_payment",
    providerPaymentId: "ch_payment",
    createdAt: now,
    updatedAt: now,
} satisfies PaymentTransactionRecord;

describe("billing refund orchestration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.order = { ...order };
        mocks.job = undefined;
        mocks.getOrderById.mockImplementation(async () => mocks.order);
        mocks.updateOrder.mockImplementation(async (_id: string, patch: Partial<BillingOrderRecord>) => {
            mocks.order = mocks.order ? { ...mocks.order, ...patch } : undefined;
            return mocks.order;
        });
        mocks.getRefundJobByOrderId.mockImplementation(async () => mocks.job || null);
        mocks.upsertRefundJob.mockImplementation(async (job: BillingRefundJobRecord) => {
            mocks.job = job;
            return job;
        });
        mocks.claimDueRefundJobs.mockResolvedValue([]);
        mocks.checkpointRefundJob.mockResolvedValue(null);
        mocks.releaseRefundJob.mockResolvedValue(null);
        mocks.listPayments.mockResolvedValue({ items: [payment] });
        mocks.finalize.mockResolvedValue({ order: { ...order, status: "refunded" } });
    });

    it("persists a pending provider refund for later reconciliation", async () => {
        mocks.refundProvider.mockResolvedValue({ provider: "stripe", status: "pending", providerRefundId: "re_pending", rawPayload: { status: "pending" } });

        const result = await refundBillingOrder(order.id, { reason: "重复支付", operatorUserId: "admin" });

        expect(result).toMatchObject({ pending: true, providerRefund: { providerRefundId: "re_pending" } });
        expect(mocks.upsertRefundJob).toHaveBeenCalledWith(expect.objectContaining({ orderId: order.id, paymentId: payment.id, status: "processing", attempts: 1, workerId: expect.stringContaining("billing-refund:request:") }));
        expect(mocks.releaseRefundJob).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("billing-refund:request:"), expect.objectContaining({ status: "pending", providerRefundId: "re_pending", nextAttemptAt: expect.any(String) }));
        expect(mocks.finalize).not.toHaveBeenCalled();
    });

    it("reconciles a pending refund and finalizes local benefits", async () => {
        const job = refundJob({
            status: "processing",
            attempts: 2,
            rawPayload: { reason: "重复支付", operatorUserId: "admin", providerRefund: { provider: "stripe", status: "pending", providerRefundId: "re_pending" } },
        });
        mocks.order = { ...order, status: "refunding" };
        mocks.claimDueRefundJobs.mockResolvedValue([job]);
        mocks.reconcileProvider.mockResolvedValue({ provider: "stripe", status: "succeeded", providerRefundId: "re_pending", rawPayload: { status: "succeeded" } });

        const result = await runBillingRefundReconciliationBatch({ workerId: "refund-worker", now: new Date(now) });

        expect(result).toEqual({ claimed: 1, completed: 1, pending: 0, manual: 0, failed: 0 });
        expect(mocks.reconcileProvider).toHaveBeenCalledOnce();
        expect(mocks.refundProvider).not.toHaveBeenCalled();
        expect(mocks.checkpointRefundJob).toHaveBeenCalledWith(job.id, "refund-worker", expect.objectContaining({ status: "compensating", providerRefundId: "re_pending" }));
        expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ orderId: order.id, paymentId: payment.id, providerRefund: expect.objectContaining({ status: "succeeded" }) }));
        expect(mocks.releaseRefundJob).toHaveBeenCalledWith(job.id, "refund-worker", expect.objectContaining({ status: "completed", completedAt: expect.any(String) }));
    });

    it("retries only local compensation after the provider refund is confirmed", async () => {
        const job = refundJob({
            status: "compensating",
            attempts: 3,
            rawPayload: { reason: "重复支付", operatorUserId: "admin", providerRefund: { provider: "stripe", status: "succeeded", providerRefundId: "re_done" } },
        });
        mocks.order = { ...order, status: "refunding" };
        mocks.claimDueRefundJobs.mockResolvedValue([job]);
        mocks.finalize.mockRejectedValue(new Error("local transaction unavailable"));

        const result = await runBillingRefundReconciliationBatch({ workerId: "refund-worker", now: new Date(now) });

        expect(result).toEqual({ claimed: 1, completed: 0, pending: 1, manual: 0, failed: 0 });
        expect(mocks.refundProvider).not.toHaveBeenCalled();
        expect(mocks.reconcileProvider).not.toHaveBeenCalled();
        expect(mocks.releaseRefundJob).toHaveBeenCalledWith(job.id, "refund-worker", expect.objectContaining({ status: "compensating", lastError: "local transaction unavailable", nextAttemptAt: expect.any(String) }));
        expect(mocks.updateOrder).toHaveBeenCalledWith(order.id, expect.objectContaining({ status: "refunding" }));
    });
});

function refundJob(patch: Partial<BillingRefundJobRecord>): BillingRefundJobRecord {
    return {
        id: "refund-job-one",
        orderId: order.id,
        paymentId: payment.id,
        provider: payment.provider,
        status: "pending",
        attempts: 1,
        maxAttempts: 8,
        nextAttemptAt: now,
        workerId: "refund-worker",
        leaseUntil: "2026-08-06T00:02:00.000Z",
        rawPayload: {},
        createdAt: now,
        updatedAt: now,
        ...patch,
    };
}
