import { createHash } from "node:crypto";

export const SYSTEM_AI_LOGICAL_MODEL_HEADER = "x-vozeb-pro-logical-model";
export const SYSTEM_AI_POINTS_IDEMPOTENCY_HEADER = "x-vozeb-pro-points-idempotency-key";

export type SystemAiBilling = {
    pointsCost?: number;
    pointsRecordId?: string;
};

export function systemAiBillingHeaders(logicalModel: string, idempotencyKey?: string) {
    return {
        ...(logicalModel.trim() ? { [SYSTEM_AI_LOGICAL_MODEL_HEADER]: logicalModel.trim() } : {}),
        ...(idempotencyKey?.trim() ? { [SYSTEM_AI_POINTS_IDEMPOTENCY_HEADER]: idempotencyKey.trim() } : {}),
    };
}

export function systemAiIdempotencyKey(scope: string, ...parts: string[]) {
    const prefix =
        scope
            .trim()
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .slice(0, 40) || "system-ai";
    const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
    return `${prefix}:${digest}`;
}

export function readSystemAiBilling(headers: Headers): SystemAiBilling {
    const rawCost = headers.get("x-vozeb-pro-points-cost");
    const cost = rawCost === null ? undefined : Number(rawCost);
    return {
        pointsCost: cost !== undefined && Number.isFinite(cost) && cost >= 0 ? cost : undefined,
        pointsRecordId: headers.get("x-vozeb-pro-points-record-id") || undefined,
    };
}

export function hasSystemAiCharge(billing: SystemAiBilling): billing is Required<SystemAiBilling> {
    return billing.pointsCost !== undefined && Boolean(billing.pointsRecordId);
}
