import { NextResponse } from "next/server";

import { recordGenerationWorkerHeartbeat } from "@/lib/server/generation-worker-heartbeat";
import { getInstallStatus } from "@/lib/server/install-status";
import { isAuthorizedMaintenanceRequest, isMaintenanceTokenConfigured } from "@/lib/server/maintenance-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    if (!isMaintenanceTokenConfigured()) return NextResponse.json({ code: 503, data: null, msg: "维护任务令牌未配置" }, { status: 503 });
    if (!isAuthorizedMaintenanceRequest(request)) return NextResponse.json({ code: 401, data: null, msg: "维护任务认证失败" }, { status: 401 });
    const workerId = request.headers.get("x-vozeb-pro-worker-id")?.trim();
    if (!workerId) return NextResponse.json({ code: 400, data: null, msg: "缺少 Worker ID" }, { status: 400 });
    if (!(await getInstallStatus()).database.schemaReady) return NextResponse.json({ code: 0, data: { accepted: false }, msg: "等待初始化数据库" });
    await recordGenerationWorkerHeartbeat(workerId);
    return NextResponse.json({ code: 0, data: { accepted: true }, msg: "OK" }, { headers: { "cache-control": "no-store" } });
}
