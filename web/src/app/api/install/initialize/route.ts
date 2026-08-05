import { NextResponse } from "next/server";

import { initializeInstallDatabase, InstallInitializationError } from "@/lib/server/install-status";
import { isAuthorizedMaintenanceRequest, isMaintenanceTokenConfigured } from "@/lib/server/maintenance-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
    try {
        if (!isMaintenanceTokenConfigured()) return NextResponse.json({ code: 503, data: null, msg: "请先配置至少 32 位的 DQ_MAINTENANCE_TOKEN" }, { status: 503 });
        if (!isAuthorizedMaintenanceRequest(request)) return NextResponse.json({ code: 401, data: null, msg: "初始化请求认证失败" }, { status: 401 });
        const install = await initializeInstallDatabase();
        return NextResponse.json({ code: 0, data: { install }, msg: "数据库初始化完成" });
    } catch (error) {
        if (error instanceof InstallInitializationError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Install initialization route failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "数据库初始化失败" }, { status: 500 });
    }
}
