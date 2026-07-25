import { NextResponse } from "next/server";

import { getInstallStatus } from "@/lib/server/install-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const install = await getInstallStatus();
        const data = {
            ready: install.ready,
            provider: install.provider,
            database: { healthy: install.database.healthy, schemaReady: install.database.schemaReady },
            encryptionReady: install.security.encryptionReady,
            firstAdminRequired: install.firstAdminRequired,
        };
        return NextResponse.json({ code: install.ready ? 0 : 503, data, msg: install.ready ? "服务已就绪" : "服务尚未就绪" }, { status: install.ready ? 200 : 503, headers: { "cache-control": "no-store" } });
    } catch (error) {
        console.error("Readiness check failed", error);
        return NextResponse.json({ code: 503, data: { ready: false }, msg: "服务尚未就绪" }, { status: 503, headers: { "cache-control": "no-store" } });
    }
}
