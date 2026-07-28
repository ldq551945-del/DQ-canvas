import { randomUUID } from "node:crypto";

import { lockBillingOrderCoupon, prepareBillingOrderCommerce, redeemBillingOrderCoupon, refundBillingOrderCoupon, releaseBillingOrderCoupon } from "@/lib/server/billing-commerce-service";
import { BillingInputError, isBillingInputError } from "@/lib/server/billing-errors";
import { lockAuthMutation } from "@/lib/server/auth-mutation-lock";
import { expirePendingBillingOrders } from "@/lib/server/billing-order-expiration-service";
import {
    createPostgresRepositories,
    ensurePostgresSchema,
    isPostgresDatabaseEnabled,
    withPostgresTransaction,
    type BillingOrderRecord,
    type BillingOrderStatus,
    type BillingProductRecord,
    type JsonValue,
    type PaymentTransactionRecord,
    type QueryExecutor,
    type UserPlanAssignmentRecord,
} from "@/lib/server/database";
import { refundPaymentTransaction, type PaymentRefundResult } from "@/lib/server/payment-refund-service";
import { getPaymentRuntimeConfig, isPaymentRuntimeProviderCheckoutReady } from "@/lib/server/payment-config-store";
import { adjustPermanentPointsInPostgresTransaction } from "@/lib/server/points-wallet-service";
import { resolveBillingProductPrices } from "@/lib/server/promotion-service";
import { prepareReferralRewardsForPaidOrder, reverseReferralRewardsForRefundedOrder } from "@/lib/server/referral-service";
import {
    assertBillingDatabaseReady,
    buildPaidOrderResult,
    buildRefundedOrderResult,
    createOrderPlanAssignment,
    deterministicPaymentId,
    generateOrderNo,
    isAutomaticallyExpiredOrder,
    isRefundClaimStale,
    mergeJson,
    normalizeBillingProductInput,
    normalizeBillingProductPatch,
    normalizeCurrency,
    normalizeId,
    normalizeIso,
    normalizeMoneyLike,
    normalizeOptionalDate,
    normalizeOptionalText,
    normalizePositiveInteger,
    normalizeProvider,
    normalizeText,
    orderExpiresMinutes,
    paymentRefundMetadata,
    readRefundAttempt,
    resolveEnabledPlan,
    roundAmount,
    sanitizeJson,
} from "@/lib/server/billing-service-helpers";

export { BillingInputError, isBillingInputError };
export { expirePendingBillingOrders };

export type BillingProductInput = {
    id?: unknown;
    productKind?: unknown;
    planId?: unknown;
    name?: unknown;
    description?: unknown;
    amountCents?: unknown;
    currency?: unknown;
    pointsAmount?: unknown;
    dailyPoints?: unknown;
    periodDays?: unknown;
    enabled?: unknown;
    sortOrder?: unknown;
    metadata?: unknown;
};

type CreateBillingOrderInput = {
    userId: string;
    productId?: unknown;
    quantity?: unknown;
    provider?: unknown;
    userCouponId?: unknown;
};

type CompleteBillingOrderPaymentInput = {
    orderId: string;
    provider?: unknown;
    channel?: unknown;
    providerTradeId?: unknown;
    providerPaymentId?: unknown;
    amountCents?: unknown;
    currency?: unknown;
    rawPayload?: unknown;
    paidAt?: unknown;
};

type BillingOperationInput = {
    reason?: unknown;
    operatorUserId?: unknown;
    rawPayload?: unknown;
};

export async function listBillingProducts(includeDisabled = false) {
    await assertBillingDatabaseReady();
    return resolveBillingProductPrices(await createPostgresRepositories().billing.listProducts(includeDisabled));
}

export async function upsertBillingProduct(input: BillingProductInput) {
    await assertBillingDatabaseReady();
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const product = await normalizeBillingProductInput(input, client);
        return repos.billing.upsertProduct(product);
    });
}

export async function updateBillingProduct(id: string, input: BillingProductInput) {
    await assertBillingDatabaseReady();
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const current = await repos.billing.getProductById(normalizeId(id));
        if (!current) throw new BillingInputError("套餐商品不存在", 404);
        const patch = await normalizeBillingProductPatch(input, current, client);
        const product = await repos.billing.updateProduct(current.id, patch);
        if (!product) throw new BillingInputError("套餐商品不存在", 404);
        return product;
    });
}

export async function deleteBillingProduct(id: string) {
    await assertBillingDatabaseReady();
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const productId = normalizeId(id);
        const current = await repos.billing.getProductById(productId);
        if (!current) throw new BillingInputError("套餐商品不存在", 404);
        const deleted = await repos.billing.deleteProductIfUnused(productId);
        if (!deleted) throw new BillingInputError("该商品已有订单记录，不能永久删除，请改为下架", 409);
        return deleted;
    });
}

export async function listUserBillingOrders(userId: string, input: { page?: number; pageSize?: number; status?: BillingOrderStatus } = {}) {
    await expirePendingBillingOrders();
    return createPostgresRepositories().billing.listOrders({ ...input, userId });
}

export async function listAdminBillingOrders(input: { page?: number; pageSize?: number; status?: BillingOrderStatus; userId?: string; productId?: string; keyword?: string } = {}) {
    await expirePendingBillingOrders();
    return createPostgresRepositories().billing.listOrders(input);
}

export async function getAdminBillingSummary(input: { startDate?: unknown; endDate?: unknown } = {}) {
    await expirePendingBillingOrders();
    return createPostgresRepositories().billing.getSummary({
        startDate: normalizeOptionalDate(input.startDate, "start"),
        endDate: normalizeOptionalDate(input.endDate, "end"),
    });
}

export async function getBillingOrderForUser(userId: string, orderId: string) {
    await expirePendingBillingOrders({ orderId });
    const order = await createPostgresRepositories().billing.getOrderById(normalizeId(orderId));
    if (!order || order.userId !== userId) throw new BillingInputError("订单不存在", 404);
    return order;
}

export async function cancelBillingOrderForUser(userId: string, orderId: string) {
    await assertBillingDatabaseReady();
    await expirePendingBillingOrders({ orderId });
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const order = await repos.billing.getOrderById(normalizeId(orderId), true);
        if (!order || order.userId !== userId) throw new BillingInputError("订单不存在", 404);
        if (order.status === "canceled" || order.status === "closed" || order.status === "paid") return order;
        if (order.status !== "pending") throw new BillingInputError("当前订单状态不能取消", 409);
        await releaseBillingOrderCoupon(client, order);
        const canceled = await repos.billing.updateOrder(order.id, { status: "canceled", closedAt: new Date().toISOString() });
        if (!canceled) throw new BillingInputError("订单不存在", 404);
        return canceled;
    });
}

export async function createBillingOrder(input: CreateBillingOrderInput) {
    await assertBillingDatabaseReady();
    const paymentConfig = await getPaymentRuntimeConfig();
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const user = await repos.users.getById(input.userId);
        if (!user || user.status !== "active") throw new BillingInputError("用户不可用", 403);

        const productId = normalizeId(input.productId);
        if (!productId) throw new BillingInputError("请选择商品");
        const product = await repos.billing.getProductById(productId, true);
        if (!product || !product.enabled) throw new BillingInputError("商品不存在或已下架", 404);

        const plan = product.productKind === "plan" ? await resolveEnabledPlan(product.planId || "", client) : undefined;
        const quantity = normalizePositiveInteger(input.quantity, 1, 100, 1);
        const provider = normalizeProvider(input.provider);
        if (!isPaymentRuntimeProviderCheckoutReady(paymentConfig, provider)) throw new BillingInputError("该支付渠道未启用或配置不完整", 400);
        const now = new Date();
        const nowIso = now.toISOString();
        const commerce = await prepareBillingOrderCommerce({
            db: client,
            product,
            userId: user.id,
            quantity,
            userCouponId: normalizeId(input.userCouponId) || undefined,
            now,
        });
        const order: BillingOrderRecord = {
            id: randomUUID(),
            orderNo: generateOrderNo(),
            productId: product.id,
            userId: user.id,
            productKind: product.productKind,
            planId: plan?.id,
            status: "pending",
            subject: product.name,
            listAmountCents: commerce.price.listAmountCents,
            promotionDiscountCents: commerce.price.promotionDiscountCents,
            couponDiscountCents: commerce.price.couponDiscountCents,
            amountCents: commerce.price.payableAmountCents,
            currency: product.currency,
            pointsAmount: roundAmount(product.pointsAmount * quantity),
            dailyPoints: product.dailyPoints,
            periodDays: product.productKind === "plan" ? product.periodDays * quantity : 0,
            quantity,
            provider,
            promotionCampaignId: commerce.price.promotion?.id,
            userCouponId: commerce.coupon?.id,
            expiresAt: new Date(now.getTime() + orderExpiresMinutes() * 60_000).toISOString(),
            pricingSnapshot: commerce.pricingSnapshot,
            metadata: {
                product: {
                    id: product.id,
                    kind: product.productKind,
                    name: product.name,
                    description: product.description,
                    unitAmountCents: product.amountCents,
                    unitPointsAmount: product.pointsAmount,
                    dailyPoints: product.dailyPoints,
                    unitPeriodDays: product.periodDays,
                },
                ...(plan ? { plan: { id: plan.id, name: plan.name } } : {}),
            },
            createdAt: nowIso,
            updatedAt: nowIso,
        };
        const created = await repos.billing.createOrder(order);
        await lockBillingOrderCoupon(client, created, commerce.coupon, nowIso);
        return created;
    });
}

export async function completeBillingOrderPayment(input: CompleteBillingOrderPaymentInput) {
    await assertBillingDatabaseReady();
    return withPostgresTransaction(async (client) => {
        await lockAuthMutation(client);
        const repos = createPostgresRepositories(client);
        const order = await repos.billing.getOrderById(normalizeId(input.orderId), true);
        if (!order) throw new BillingInputError("订单不存在", 404);
        const provider = normalizeProvider(input.provider || order.provider);
        if (provider !== normalizeProvider(order.provider)) throw new BillingInputError("支付回调渠道与订单渠道不一致", 409);
        const paidAmountCents = input.amountCents === undefined ? order.amountCents : normalizePositiveInteger(input.amountCents, 0, 100_000_000, -1);
        if (paidAmountCents !== order.amountCents) throw new BillingInputError("支付金额与订单金额不一致", 409);
        const paidCurrency = input.currency === undefined ? order.currency : normalizeCurrency(input.currency);
        if (paidCurrency !== order.currency) throw new BillingInputError("支付币种与订单币种不一致", 409);
        if (order.status === "paid") {
            assertDuplicatePaymentIdentity(order, input);
            return buildPaidOrderResult(order, client);
        }
        if (order.status !== "pending" && !isAutomaticallyExpiredOrder(order)) throw new BillingInputError("当前订单状态不能确认支付", 409);
        if (!order.userId) throw new BillingInputError("订单没有绑定用户", 409);

        const user = await repos.users.getById(order.userId);
        if (!user || user.status !== "active") throw new BillingInputError("用户不可用", 403);

        const paidAt = normalizeIso(input.paidAt, new Date().toISOString());
        const providerTradeId = normalizeText(input.providerTradeId, `${provider}:${order.orderNo}`, 160);
        const providerPaymentId = normalizeText(input.providerPaymentId, providerTradeId, 160);
        await redeemBillingOrderCoupon(client, order, paidAt);
        const payment: PaymentTransactionRecord = {
            id: deterministicPaymentId(provider, providerTradeId),
            orderId: order.id,
            userId: user.id,
            provider,
            channel: normalizeText(input.channel, "", 60),
            status: "succeeded",
            amountCents: order.amountCents,
            currency: order.currency,
            providerTradeId,
            providerPaymentId,
            rawPayload: sanitizeJson(input.rawPayload),
            paidAt,
            createdAt: paidAt,
            updatedAt: paidAt,
        };
        const savedPayment = await repos.billing.upsertPayment(payment);

        if (order.pointsAmount > 0) {
            await adjustPermanentPointsInPostgresTransaction(client, {
                userId: user.id,
                amount: order.pointsAmount,
                description: `订单支付：${order.subject}`,
                idempotencyKey: `billing-order:${order.id}:credit`,
                type: "credit",
                now: new Date(paidAt),
            });
        }
        let updatedUser = user;
        let assignment: UserPlanAssignmentRecord | undefined;
        if (order.productKind === "plan") {
            if (!order.planId) throw new BillingInputError("套餐订单缺少套餐权益", 409);
            const planUser = await repos.users.update(user.id, { planId: order.planId });
            if (!planUser) throw new BillingInputError("用户不存在", 404);
            updatedUser = planUser;
            assignment = await createOrderPlanAssignment(order, paidAt, client);
        } else {
            const refreshedUser = await repos.users.getById(user.id);
            if (!refreshedUser) throw new BillingInputError("用户不存在", 404);
            updatedUser = refreshedUser;
        }
        const paidOrder = await repos.billing.updateOrder(order.id, {
            status: "paid",
            provider,
            providerOrderId: providerTradeId,
            providerPaymentId,
            paidAt,
            closedAt: undefined,
        });
        if (!paidOrder) throw new BillingInputError("订单不存在", 404);
        await prepareReferralRewardsForPaidOrder(client, { order: paidOrder, provider, rawPayload: savedPayment.rawPayload, paidAt });

        return {
            order: paidOrder,
            payment: savedPayment,
            assignment,
            user: updatedUser,
            pointsGranted: order.pointsAmount,
        };
    });
}

function assertDuplicatePaymentIdentity(order: BillingOrderRecord, input: Pick<CompleteBillingOrderPaymentInput, "providerTradeId" | "providerPaymentId">) {
    const incoming = [normalizeText(input.providerTradeId, "", 160), normalizeText(input.providerPaymentId, "", 160)].filter(Boolean);
    const stored = [order.providerOrderId, order.providerPaymentId].map((value) => normalizeText(value, "", 160)).filter(Boolean);
    if (incoming.length && stored.length && !incoming.some((value) => stored.includes(value))) throw new BillingInputError("订单已由另一笔支付交易完成，请人工核对并处理重复付款", 409);
}

export async function closeBillingOrder(orderId: string, input: BillingOperationInput = {}) {
    await assertBillingDatabaseReady();
    return withPostgresTransaction(async (client) => {
        const repos = createPostgresRepositories(client);
        const order = await repos.billing.getOrderById(normalizeId(orderId), true);
        if (!order) throw new BillingInputError("订单不存在", 404);
        if (order.status === "closed") return { order };
        if (order.status !== "pending") throw new BillingInputError("只有待支付订单可以关闭", 409);

        const now = new Date().toISOString();
        await releaseBillingOrderCoupon(client, order);
        const updatedOrder = await repos.billing.updateOrder(order.id, {
            status: "closed",
            closedAt: now,
            metadata: mergeJson(order.metadata, {
                close: {
                    reason: normalizeText(input.reason, "运营关闭", 200),
                    operatorUserId: normalizeOptionalText(input.operatorUserId, 120) || "",
                    closedAt: now,
                },
            }),
        });
        if (!updatedOrder) throw new BillingInputError("订单不存在", 404);
        return { order: updatedOrder };
    });
}

export async function refundBillingOrder(orderId: string, input: BillingOperationInput = {}) {
    await assertBillingDatabaseReady();
    const normalizedOrderId = normalizeId(orderId);
    const reason = normalizeText(input.reason, "运营退款", 200);
    const operatorUserId = normalizeOptionalText(input.operatorUserId, 120) || "";
    const claimId = randomUUID();

    const claim = await withPostgresTransaction(async (client) => {
        await lockAuthMutation(client);
        const repos = createPostgresRepositories(client);
        const order = await repos.billing.getOrderById(normalizedOrderId, true);
        if (!order) throw new BillingInputError("订单不存在", 404);
        if (order.status === "refunded") return { kind: "completed" as const, result: await buildRefundedOrderResult(order, client) };
        if (order.status === "refunding" && !isRefundClaimStale(order)) throw new BillingInputError("退款正在处理中，请稍后再试", 409);
        if (order.status !== "paid" && order.status !== "refunding") throw new BillingInputError("只有已支付订单可以退款", 409);
        if (!order.userId) throw new BillingInputError("订单没有绑定用户", 409);

        const payment = (await repos.billing.listPayments({ orderId: order.id, page: 1, pageSize: 1, status: "succeeded" })).items[0];
        const now = new Date().toISOString();
        const claimedOrder = await repos.billing.updateOrder(order.id, {
            status: "refunding",
            metadata: mergeJson(order.metadata, {
                refundAttempt: { claimId, reason, operatorUserId, startedAt: now },
            }),
        });
        if (!claimedOrder) throw new BillingInputError("订单不存在", 404);
        return { kind: "claimed" as const, order: claimedOrder, payment, claimId };
    });

    if (claim.kind === "completed") return claim.result;

    let providerRefund: PaymentRefundResult;
    try {
        providerRefund = await refundPaymentTransaction(claim.order, claim.payment, { reason, operatorUserId });
    } catch (error) {
        await withPostgresTransaction(async (client) => {
            await lockAuthMutation(client);
            const repos = createPostgresRepositories(client);
            const current = await repos.billing.getOrderById(claim.order.id, true);
            if (current?.status === "refunding" && readRefundAttempt(current.metadata)?.claimId === claimId) {
                await repos.billing.updateOrder(current.id, {
                    status: "paid",
                    metadata: mergeJson(current.metadata, {
                        refundAttempt: {
                            ...(readRefundAttempt(current.metadata) || {}),
                            failedAt: new Date().toISOString(),
                            error: error instanceof Error ? error.message.slice(0, 300) : "退款失败",
                        },
                    }),
                });
            }
        });
        throw error;
    }

    if (providerRefund.status === "pending") {
        const updated = await withPostgresTransaction(async (client) => {
            await lockAuthMutation(client);
            const repos = createPostgresRepositories(client);
            const current = await repos.billing.getOrderById(claim.order.id, true);
            if (!current) throw new BillingInputError("订单不存在", 404);
            if (current.status === "refunded") return current;
            if (current.status !== "refunding" || readRefundAttempt(current.metadata)?.claimId !== claimId) throw new BillingInputError("退款状态已变化，请刷新后重试", 409);
            const next = await repos.billing.updateOrder(current.id, {
                status: "refunding",
                metadata: mergeJson(current.metadata, { refund: paymentRefundMetadata(providerRefund, false) }),
            });
            if (!next) throw new BillingInputError("订单不存在", 404);
            return next;
        });
        return { order: updated, providerRefund, pending: true };
    }

    return withPostgresTransaction(async (client) => {
        await lockAuthMutation(client);
        const repos = createPostgresRepositories(client);
        const order = await repos.billing.getOrderById(claim.order.id, true);
        if (!order) throw new BillingInputError("订单不存在", 404);
        if (order.status === "refunded") return buildRefundedOrderResult(order, client);
        if (order.status !== "refunding" || readRefundAttempt(order.metadata)?.claimId !== claimId) throw new BillingInputError("退款状态已变化，请刷新后重试", 409);
        if (!order.userId) throw new BillingInputError("订单没有绑定用户", 409);

        const payment = claim.payment || (await repos.billing.listPayments({ orderId: order.id, page: 1, pageSize: 1, status: "succeeded" })).items[0];
        const user = await repos.users.getById(order.userId);
        if (!user) throw new BillingInputError("订单用户不存在", 404);
        const now = new Date().toISOString();
        await refundBillingOrderCoupon(client, order, now);

        const refundedPayment = payment
            ? await repos.billing.upsertPayment({
                  ...payment,
                  status: "refunded",
                  rawPayload: mergeJson(payment.rawPayload, {
                      refund: {
                          reason,
                          operatorUserId,
                          refundedAt: now,
                          rawPayload: sanitizeJson(input.rawPayload),
                          providerRefund: paymentRefundMetadata(providerRefund, true),
                      },
                  }),
                  refundedAt: now,
                  updatedAt: now,
              })
            : undefined;

        const assignments = order.productKind === "plan" ? await repos.billing.listPlanAssignments({ userId: order.userId, source: "order", page: 1, pageSize: 100 }) : undefined;
        const assignment = assignments?.items.find((item) => item.sourceId === order.id);
        const canceledAssignment = assignment
            ? await repos.billing.updatePlanAssignment(assignment.id, {
                  status: "canceled",
                  endsAt: now,
                  metadata: mergeJson(assignment.metadata, { refund: { reason, refundedAt: now } }),
              })
            : undefined;

        const requestedPointsReversal = order.pointsAmount > 0 ? order.pointsAmount : 0;
        const walletAdjustment = requestedPointsReversal
            ? await adjustPermanentPointsInPostgresTransaction(client, {
                  userId: user.id,
                  amount: -requestedPointsReversal,
                  description: `订单退款：${order.subject}`,
                  idempotencyKey: `billing-order:${order.id}:refund`,
                  type: "admin-adjust",
                  minimumBalance: 0,
                  requireActive: false,
                  now: new Date(now),
              })
            : null;
        const pointsReversed = Math.max(0, -(walletAdjustment?.record.amount || 0));
        await reverseReferralRewardsForRefundedOrder(client, { orderId: order.id, refundedAt: now, reason });
        let updatedUser = user;
        if (order.productKind === "plan") {
            const activeAssignment = await repos.billing.getActivePlanAssignment(user.id, new Date(now));
            const settings = await repos.settings.getSettings();
            const fallbackPlanId = settings.settings?.defaultPlanId || "free";
            const planUser = await repos.users.update(user.id, { planId: activeAssignment?.planId || fallbackPlanId });
            if (!planUser) throw new BillingInputError("订单用户不存在", 404);
            updatedUser = planUser;
        } else {
            const refreshedUser = await repos.users.getById(user.id);
            if (!refreshedUser) throw new BillingInputError("订单用户不存在", 404);
            updatedUser = refreshedUser;
        }

        const updatedOrder = await repos.billing.updateOrder(order.id, {
            status: "refunded",
            closedAt: now,
            metadata: mergeJson(order.metadata, {
                refund: {
                    reason,
                    operatorUserId,
                    refundedAt: now,
                    pointsReversed,
                    providerRefund: paymentRefundMetadata(providerRefund, false),
                },
            }),
        });
        if (!updatedOrder) throw new BillingInputError("订单不存在", 404);

        return {
            order: updatedOrder,
            payment: refundedPayment,
            assignment: canceledAssignment,
            user: updatedUser,
            pointsReversed,
            providerRefund,
        };
    });
}
