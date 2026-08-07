import { NextResponse } from "next/server";

import { isAuthorizedMaintenanceRequest, isMaintenanceTokenConfigured } from "@/lib/server/maintenance-auth";
import { logStructured } from "@/lib/server/observability";
import { getOperationalObservabilitySnapshot } from "@/lib/server/observability-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    if (!isMaintenanceTokenConfigured()) return NextResponse.json({ code: 503, data: null, msg: "维护任务令牌未配置" }, { status: 503 });
    if (!isAuthorizedMaintenanceRequest(request)) return NextResponse.json({ code: 401, data: null, msg: "维护任务认证失败" }, { status: 401 });
    try {
        return NextResponse.json({ code: 0, data: await getOperationalObservabilitySnapshot(), msg: "OK" }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
        logStructured("error", "observability.snapshot.failed", { error });
        return NextResponse.json({ code: 500, data: null, msg: "读取运行指标失败" }, { status: 500, headers: { "cache-control": "no-store" } });
    }
}
