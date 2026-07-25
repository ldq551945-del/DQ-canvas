import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import type { PaymentProviderId } from "@/lib/payment-config-types";
import { PAYMENT_PROVIDER_DEFINITIONS } from "@/lib/payment-config-types";
import { savePaymentProviderConfig } from "@/lib/server/payment-config-store";
import { getPaymentConfigSummary } from "@/lib/server/payment-config-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    return NextResponse.json({ paymentConfig: await getPaymentConfigSummary(origin) });
}

export async function PATCH(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    try {
        const body = await readJsonBody<{ providerId?: unknown; enabled?: unknown; values?: unknown }>(request);
        const providerId = normalizeProviderId(body.providerId);
        if (!providerId) return NextResponse.json({ error: "支付渠道无效" }, { status: 400 });
        await savePaymentProviderConfig({
            providerId,
            enabled: body.enabled === true,
            values: body.values && typeof body.values === "object" && !Array.isArray(body.values) ? (body.values as Record<string, unknown>) : {},
        });
        const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
        return NextResponse.json({ paymentConfig: await getPaymentConfigSummary(origin) });
    } catch (error) {
        console.error("Payment config save failed", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "保存支付配置失败" }, { status: 500 });
    }
}

function normalizeProviderId(value: unknown): PaymentProviderId | undefined {
    const text = typeof value === "string" ? value : "";
    return PAYMENT_PROVIDER_DEFINITIONS.some((provider) => provider.id === text) ? (text as PaymentProviderId) : undefined;
}
