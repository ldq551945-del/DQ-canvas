import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { isBillingInputError, refundBillingOrder } from "@/lib/server/billing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const { id } = await context.params;
    try {
        const body = await readJsonBody<{ reason?: unknown; rawPayload?: unknown }>(request);
        const result = await refundBillingOrder(id, { ...body, operatorUserId: currentUser.id });
        const providerRefund = "providerRefund" in result ? result.providerRefund : undefined;
        await safeRecordAuditLog({
            action: "admin.billing.order.refund",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "billing_order", id: result.order.id, label: result.order.orderNo },
            metadata: {
                status: result.order.status,
                reason: body.reason,
                userId: result.order.userId,
                pointsReversed: "pointsReversed" in result ? result.pointsReversed : 0,
                amountCents: result.order.amountCents,
                currency: result.order.currency,
                providerRefund: providerRefund
                    ? {
                          provider: providerRefund.provider,
                          status: providerRefund.status,
                          providerRefundId: providerRefund.providerRefundId || "",
                      }
                    : undefined,
            },
        });
        return NextResponse.json(result);
    } catch (error) {
        await safeRecordAuditLog({
            action: "admin.billing.order.refund",
            status: "failure",
            actor: auditActorFromRequest(request, currentUser),
            target: { type: "billing_order", id },
            metadata: { error: error instanceof Error ? error.message : "unknown" },
        });
        if (isBillingInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Admin refund billing order failed", error);
        return NextResponse.json({ error: "退款标记失败" }, { status: 500 });
    }
}
