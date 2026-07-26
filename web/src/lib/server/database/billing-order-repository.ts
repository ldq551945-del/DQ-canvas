import type { QueryExecutor } from "@/lib/server/database/postgres";
import type { BillingOrderRecord, BillingOrderStatus, BillingSummaryRecord, PageInput, PageResult } from "./repository-shared";
import { jsonParam, jsonValue, mapBillingOrder, normalizePage, normalizePageSize, numberValue, pageResult, stringValue } from "./repository-shared";

export class BillingOrderRepository {
    constructor(private readonly db: QueryExecutor) {}

    async createOrder(order: BillingOrderRecord) {
        const result = await this.db.query(
            `
            INSERT INTO billing_orders (
                id, order_no, product_id, user_id, product_kind, plan_id, status, subject, amount_cents, currency, points_amount,
                daily_points, period_days, quantity, provider, provider_order_id, provider_payment_id, expires_at,
                paid_at, closed_at, metadata, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
            RETURNING *
            `,
            [
                order.id,
                order.orderNo,
                order.productId || null,
                order.userId || null,
                order.productKind,
                order.planId || null,
                order.status,
                order.subject,
                order.amountCents,
                order.currency,
                order.pointsAmount,
                order.dailyPoints,
                order.periodDays,
                order.quantity,
                order.provider,
                order.providerOrderId || null,
                order.providerPaymentId || null,
                order.expiresAt || null,
                order.paidAt || null,
                order.closedAt || null,
                jsonParam(order.metadata ?? {}),
                order.createdAt,
                order.updatedAt,
            ],
        );
        return mapBillingOrder(result.rows[0]);
    }

    async getOrderById(id: string, forUpdate?: boolean) {
        const result = await this.db.query(`SELECT * FROM billing_orders WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`, [id]);
        return result.rows[0] ? mapBillingOrder(result.rows[0]) : null;
    }

    async getOrderByOrderNo(orderNo: string) {
        const result = await this.db.query("SELECT * FROM billing_orders WHERE order_no = $1", [orderNo]);
        return result.rows[0] ? mapBillingOrder(result.rows[0]) : null;
    }

    async listOrders(input: PageInput & { userId?: string; status?: BillingOrderStatus; planId?: string; productId?: string; keyword?: string } = {}): Promise<PageResult<BillingOrderRecord>> {
        const page = normalizePage(input.page);
        const pageSize = normalizePageSize(input.pageSize);
        const keyword = input.keyword?.trim().toLowerCase() || "";
        const result = await this.db.query(
            `
            SELECT *, count(*) OVER() AS total_count
            FROM billing_orders
            WHERE ($1::text IS NULL OR user_id = $1)
              AND ($2::text IS NULL OR status = $2)
              AND ($3::text IS NULL OR plan_id = $3)
              AND ($4::text IS NULL OR product_id = $4)
              AND ($5 = '' OR lower(order_no) LIKE $6 OR lower(subject) LIKE $6 OR lower(coalesce(provider_order_id, '')) LIKE $6 OR lower(coalesce(provider_payment_id, '')) LIKE $6)
            ORDER BY created_at DESC
            LIMIT $7 OFFSET $8
            `,
            [input.userId || null, input.status || null, input.planId || null, input.productId || null, keyword, `%${keyword}%`, pageSize, (page - 1) * pageSize],
        );
        return pageResult(result.rows.map(mapBillingOrder), Number(result.rows[0]?.total_count || 0), page, pageSize);
    }

    async getSummary(input: { startDate?: string; endDate?: string } = {}): Promise<BillingSummaryRecord> {
        const result = await this.db.query<Record<string, unknown>>(
            `
            WITH scoped_orders AS MATERIALIZED (
                SELECT id, provider, status, amount_cents
                FROM billing_orders
                WHERE ($1::timestamptz IS NULL OR created_at >= $1)
                  AND ($2::timestamptz IS NULL OR created_at <= $2)
            ),
            scoped_payments AS MATERIALIZED (
                SELECT order_id, status, amount_cents
                FROM payment_transactions
                WHERE ($1::timestamptz IS NULL OR created_at >= $1)
                  AND ($2::timestamptz IS NULL OR created_at <= $2)
            ),
            order_summary AS (
                SELECT
                    count(*) AS total,
                    count(*) FILTER (WHERE status = 'pending') AS pending,
                    count(*) FILTER (WHERE status = 'paid') AS paid,
                    count(*) FILTER (WHERE status = 'closed') AS closed,
                    count(*) FILTER (WHERE status = 'canceled') AS canceled,
                    count(*) FILTER (WHERE status = 'refunded') AS refunded,
                    coalesce(sum(amount_cents) FILTER (WHERE status IN ('paid', 'refunded')), 0) AS gross_amount_cents,
                    coalesce(sum(amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid_amount_cents,
                    coalesce(sum(amount_cents) FILTER (WHERE status = 'pending'), 0) AS pending_amount_cents,
                    coalesce(sum(amount_cents) FILTER (WHERE status = 'refunded'), 0) AS refunded_amount_cents
                FROM scoped_orders
            ),
            payment_summary AS (
                SELECT
                    count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
                    count(*) FILTER (WHERE status = 'refunded') AS refunded,
                    coalesce(sum(amount_cents) FILTER (WHERE status = 'succeeded'), 0) AS succeeded_amount_cents,
                    coalesce(sum(amount_cents) FILTER (WHERE status = 'refunded'), 0) AS refunded_amount_cents
                FROM scoped_payments
            ),
            provider_summary AS (
                SELECT
                    provider,
                    count(*) AS total_orders,
                    count(*) FILTER (WHERE status = 'pending') AS pending_orders,
                    count(*) FILTER (WHERE status = 'paid') AS paid_orders,
                    count(*) FILTER (WHERE status = 'refunded') AS refunded_orders,
                    coalesce(sum(amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid_amount_cents,
                    coalesce(sum(amount_cents) FILTER (WHERE status = 'refunded'), 0) AS refunded_amount_cents
                FROM scoped_orders
                GROUP BY provider
            ),
            reconciliation_summary AS (
                SELECT
                    (
                        SELECT count(*)
                        FROM scoped_orders order_row
                        WHERE order_row.status = 'paid'
                          AND NOT EXISTS (
                              SELECT 1
                              FROM payment_transactions payment_row
                              WHERE payment_row.order_id = order_row.id AND payment_row.status = 'succeeded'
                          )
                    ) AS paid_orders_without_succeeded_payment,
                    (
                        SELECT count(*)
                        FROM payment_transactions payment_row
                        JOIN scoped_orders order_row ON order_row.id = payment_row.order_id
                        WHERE payment_row.status = 'succeeded' AND order_row.status NOT IN ('paid', 'refunded')
                    ) AS succeeded_payments_without_paid_order,
                    (
                        SELECT count(*)
                        FROM payment_transactions payment_row
                        JOIN scoped_orders order_row ON order_row.id = payment_row.order_id
                        WHERE payment_row.status IN ('succeeded', 'refunded') AND payment_row.amount_cents <> order_row.amount_cents
                    ) AS amount_mismatch_payments
            )
            SELECT
                order_summary.total AS order_total,
                order_summary.pending AS order_pending,
                order_summary.paid AS order_paid,
                order_summary.closed AS order_closed,
                order_summary.canceled AS order_canceled,
                order_summary.refunded AS order_refunded,
                order_summary.gross_amount_cents AS order_gross_amount_cents,
                order_summary.paid_amount_cents AS order_paid_amount_cents,
                order_summary.pending_amount_cents AS order_pending_amount_cents,
                order_summary.refunded_amount_cents AS order_refunded_amount_cents,
                payment_summary.succeeded AS payment_succeeded,
                payment_summary.refunded AS payment_refunded,
                payment_summary.succeeded_amount_cents AS payment_succeeded_amount_cents,
                payment_summary.refunded_amount_cents AS payment_refunded_amount_cents,
                coalesce((
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'provider', provider,
                            'totalOrders', total_orders,
                            'pendingOrders', pending_orders,
                            'paidOrders', paid_orders,
                            'refundedOrders', refunded_orders,
                            'paidAmountCents', paid_amount_cents,
                            'refundedAmountCents', refunded_amount_cents
                        )
                        ORDER BY paid_amount_cents DESC, total_orders DESC, provider ASC
                    )
                    FROM provider_summary
                ), '[]'::jsonb) AS providers,
                reconciliation_summary.paid_orders_without_succeeded_payment,
                reconciliation_summary.succeeded_payments_without_paid_order,
                reconciliation_summary.amount_mismatch_payments
            FROM order_summary
            CROSS JOIN payment_summary
            CROSS JOIN reconciliation_summary
            `,
            [input.startDate || null, input.endDate || null],
        );

        const row = result.rows[0] || {};
        const providers = jsonValue(row.providers);
        return {
            orders: {
                total: numberValue(row.order_total),
                pending: numberValue(row.order_pending),
                paid: numberValue(row.order_paid),
                closed: numberValue(row.order_closed),
                canceled: numberValue(row.order_canceled),
                refunded: numberValue(row.order_refunded),
                grossAmountCents: numberValue(row.order_gross_amount_cents),
                paidAmountCents: numberValue(row.order_paid_amount_cents),
                pendingAmountCents: numberValue(row.order_pending_amount_cents),
                refundedAmountCents: numberValue(row.order_refunded_amount_cents),
            },
            payments: {
                succeeded: numberValue(row.payment_succeeded),
                refunded: numberValue(row.payment_refunded),
                succeededAmountCents: numberValue(row.payment_succeeded_amount_cents),
                refundedAmountCents: numberValue(row.payment_refunded_amount_cents),
            },
            providers: Array.isArray(providers)
                ? providers.flatMap((item): BillingSummaryRecord["providers"] => {
                      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
                      return [
                          {
                              provider: stringValue(item.provider) || "unknown",
                              totalOrders: numberValue(item.totalOrders),
                              pendingOrders: numberValue(item.pendingOrders),
                              paidOrders: numberValue(item.paidOrders),
                              refundedOrders: numberValue(item.refundedOrders),
                              paidAmountCents: numberValue(item.paidAmountCents),
                              refundedAmountCents: numberValue(item.refundedAmountCents),
                          },
                      ];
                  })
                : [],
            reconciliation: {
                paidOrdersWithoutSucceededPayment: numberValue(row.paid_orders_without_succeeded_payment),
                succeededPaymentsWithoutPaidOrder: numberValue(row.succeeded_payments_without_paid_order),
                amountMismatchPayments: numberValue(row.amount_mismatch_payments),
            },
        };
    }

    async expirePendingOrders(input: { expiredAt: string; limit: number; orderId?: string }) {
        const result = await this.db.query(
            `
            WITH expired AS (
                SELECT id
                FROM billing_orders
                WHERE status = 'pending'
                  AND expires_at IS NOT NULL
                  AND expires_at <= $1
                  AND ($3::text IS NULL OR id = $3)
                ORDER BY expires_at ASC, id ASC
                LIMIT $2
                FOR UPDATE SKIP LOCKED
            )
            UPDATE billing_orders AS orders SET
                status = 'closed',
                closed_at = $1,
                metadata = coalesce(orders.metadata, '{}'::jsonb) || jsonb_build_object(
                    'close',
                    jsonb_build_object(
                        'reason', $4::text,
                        'source', $5::text,
                        'closedAt', $1::text
                    )
                )
            FROM expired
            WHERE orders.id = expired.id
              AND orders.status = 'pending'
            RETURNING orders.*
            `,
            [input.expiredAt, input.limit, input.orderId || null, "订单超时自动关闭", "expiration-job"],
        );
        return result.rows.map(mapBillingOrder);
    }

    async updateOrder(id: string, patch: Partial<Omit<BillingOrderRecord, "id" | "orderNo" | "createdAt" | "updatedAt">>) {
        const result = await this.db.query(
            `
            UPDATE billing_orders SET
                product_id = COALESCE($2, product_id),
                user_id = COALESCE($3, user_id),
                product_kind = COALESCE($4, product_kind),
                plan_id = CASE WHEN $5 THEN $6 ELSE plan_id END,
                status = COALESCE($7, status),
                subject = COALESCE($8, subject),
                amount_cents = COALESCE($9, amount_cents),
                currency = COALESCE($10, currency),
                points_amount = COALESCE($11, points_amount),
                daily_points = COALESCE($12, daily_points),
                period_days = COALESCE($13, period_days),
                quantity = COALESCE($14, quantity),
                provider = COALESCE($15, provider),
                provider_order_id = COALESCE($16, provider_order_id),
                provider_payment_id = COALESCE($17, provider_payment_id),
                expires_at = COALESCE($18, expires_at),
                paid_at = COALESCE($19, paid_at),
                closed_at = CASE WHEN $20 THEN $21 ELSE closed_at END,
                metadata = COALESCE($22::jsonb, metadata)
            WHERE id = $1
            RETURNING *
            `,
            [
                id,
                patch.productId,
                patch.userId,
                patch.productKind,
                Object.prototype.hasOwnProperty.call(patch, "planId"),
                patch.planId || null,
                patch.status,
                patch.subject,
                patch.amountCents,
                patch.currency,
                patch.pointsAmount,
                patch.dailyPoints,
                patch.periodDays,
                patch.quantity,
                patch.provider,
                patch.providerOrderId,
                patch.providerPaymentId,
                patch.expiresAt,
                patch.paidAt,
                Object.prototype.hasOwnProperty.call(patch, "closedAt"),
                patch.closedAt || null,
                jsonParam(patch.metadata),
            ],
        );
        return result.rows[0] ? mapBillingOrder(result.rows[0]) : null;
    }
}
