import type { AuditLogRecord, BillingOrderRecord, BillingProductRecord, BillingReconciliationRowRecord, BillingReconciliationRunRecord, PaymentProviderEventRecord, PaymentTransactionRecord, UserPlanAssignmentRecord } from "./repository-types";
import {
    billingOrderStatusValue,
    billingProductKindValue,
    billingReconciliationRunStatusValue,
    billingReconciliationSourceValue,
    billingReconciliationStatementStatusValue,
    isoValue,
    jsonValue,
    numberValue,
    optionalIso,
    optionalJson,
    optionalNumber,
    optionalString,
    paymentTransactionStatusValue,
    planAssignmentSourceValue,
    planAssignmentStatusValue,
    stringValue,
} from "./repository-utils";

export function mapBillingOrder(row: Record<string, unknown>): BillingOrderRecord {
    return {
        id: stringValue(row.id),
        orderNo: stringValue(row.order_no),
        productId: optionalString(row.product_id),
        userId: optionalString(row.user_id),
        productKind: billingProductKindValue(row.product_kind),
        planId: optionalString(row.plan_id),
        status: billingOrderStatusValue(row.status),
        subject: stringValue(row.subject),
        amountCents: numberValue(row.amount_cents),
        currency: stringValue(row.currency),
        pointsAmount: numberValue(row.points_amount),
        dailyPoints: numberValue(row.daily_points),
        periodDays: numberValue(row.period_days),
        quantity: numberValue(row.quantity),
        provider: stringValue(row.provider),
        providerOrderId: optionalString(row.provider_order_id),
        providerPaymentId: optionalString(row.provider_payment_id),
        expiresAt: optionalIso(row.expires_at),
        paidAt: optionalIso(row.paid_at),
        closedAt: optionalIso(row.closed_at),
        metadata: optionalJson(row.metadata),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}

export function mapBillingProduct(row: Record<string, unknown>): BillingProductRecord {
    return {
        id: stringValue(row.id),
        productKind: billingProductKindValue(row.product_kind),
        planId: optionalString(row.plan_id),
        name: stringValue(row.name),
        description: stringValue(row.description),
        amountCents: numberValue(row.amount_cents),
        currency: stringValue(row.currency),
        pointsAmount: numberValue(row.points_amount),
        dailyPoints: numberValue(row.daily_points),
        periodDays: numberValue(row.period_days),
        enabled: row.enabled !== false,
        sortOrder: numberValue(row.sort_order),
        metadata: optionalJson(row.metadata),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}

export function mapPaymentTransaction(row: Record<string, unknown>): PaymentTransactionRecord {
    return {
        id: stringValue(row.id),
        orderId: stringValue(row.order_id),
        userId: optionalString(row.user_id),
        provider: stringValue(row.provider),
        channel: stringValue(row.channel),
        status: paymentTransactionStatusValue(row.status),
        amountCents: numberValue(row.amount_cents),
        currency: stringValue(row.currency),
        providerTradeId: optionalString(row.provider_trade_id),
        providerPaymentId: optionalString(row.provider_payment_id),
        rawPayload: optionalJson(row.raw_payload),
        paidAt: optionalIso(row.paid_at),
        refundedAt: optionalIso(row.refunded_at),
        failedAt: optionalIso(row.failed_at),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}

export function mapBillingReconciliationRun(row: Record<string, unknown>): BillingReconciliationRunRecord {
    return {
        id: stringValue(row.id),
        provider: stringValue(row.provider),
        source: billingReconciliationSourceValue(row.source),
        status: billingReconciliationRunStatusValue(row.status),
        totalRows: numberValue(row.total_rows),
        matchedRows: numberValue(row.matched_rows),
        okRows: numberValue(row.ok_rows),
        issueRows: numberValue(row.issue_rows),
        statementPaidAmountCents: numberValue(row.statement_paid_amount_cents),
        statementRefundedAmountCents: numberValue(row.statement_refunded_amount_cents),
        localMatchedAmountCents: numberValue(row.local_matched_amount_cents),
        differenceAmountCents: numberValue(row.difference_amount_cents),
        importedByUserId: optionalString(row.imported_by_user_id),
        importedByUsername: optionalString(row.imported_by_username),
        fileName: optionalString(row.file_name),
        note: optionalString(row.note),
        metadata: optionalJson(row.metadata),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}

export function mapBillingReconciliationRow(row: Record<string, unknown>): BillingReconciliationRowRecord {
    return {
        id: stringValue(row.id),
        runId: stringValue(row.run_id),
        rowNumber: numberValue(row.row_number),
        rowKey: stringValue(row.row_key),
        provider: stringValue(row.provider),
        orderNo: optionalString(row.order_no),
        providerOrderId: optionalString(row.provider_order_id),
        providerPaymentId: optionalString(row.provider_payment_id),
        statementStatus: billingReconciliationStatementStatusValue(row.statement_status),
        amountCents: optionalNumber(row.amount_cents),
        currency: optionalString(row.currency),
        localOrderId: optionalString(row.local_order_id),
        localOrderNo: optionalString(row.local_order_no),
        localOrderStatus: optionalString(row.local_order_status),
        localAmountCents: optionalNumber(row.local_amount_cents),
        localCurrency: optionalString(row.local_currency),
        issueCodes: jsonValue(row.issue_codes),
        issues: jsonValue(row.issues),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}

export function mapUserPlanAssignment(row: Record<string, unknown>): UserPlanAssignmentRecord {
    return {
        id: stringValue(row.id),
        userId: stringValue(row.user_id),
        planId: stringValue(row.plan_id),
        status: planAssignmentStatusValue(row.status),
        source: planAssignmentSourceValue(row.source),
        sourceId: optionalString(row.source_id),
        startsAt: isoValue(row.starts_at),
        endsAt: optionalIso(row.ends_at),
        metadata: optionalJson(row.metadata),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}

export function mapPaymentProviderEvent(row: Record<string, unknown>): PaymentProviderEventRecord {
    return {
        id: stringValue(row.id),
        provider: stringValue(row.provider),
        eventId: optionalString(row.event_id),
        eventType: stringValue(row.event_type),
        orderId: optionalString(row.order_id),
        signatureValid: row.signature_valid === true,
        payload: optionalJson(row.payload),
        processingAt: optionalIso(row.processing_at),
        processedAt: optionalIso(row.processed_at),
        error: optionalString(row.error),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}

export function mapAuditLog(row: Record<string, unknown>): AuditLogRecord {
    return {
        id: stringValue(row.id),
        action: stringValue(row.action),
        status: row.status === "failure" ? "failure" : "success",
        actorUserId: optionalString(row.actor_user_id),
        actorUsername: optionalString(row.actor_username),
        actorRole: row.actor_role === "admin" || row.actor_role === "user" ? row.actor_role : undefined,
        actorIp: optionalString(row.actor_ip),
        actorUserAgent: optionalString(row.actor_user_agent),
        targetType: optionalString(row.target_type),
        targetId: optionalString(row.target_id),
        targetLabel: optionalString(row.target_label),
        metadata: optionalJson(row.metadata),
        createdAt: isoValue(row.created_at),
    };
}
