import { NextResponse } from "next/server";

import { initializeInstallDatabase, InstallInitializationError } from "@/lib/server/install-status";

export const runtime = "nodejs";

export async function POST() {
    try {
        const install = await initializeInstallDatabase();
        return NextResponse.json({ code: 0, data: { install }, msg: "数据库初始化完成" });
    } catch (error) {
        if (error instanceof InstallInitializationError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        console.error("Install initialization route failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "数据库初始化失败" }, { status: 500 });
    }
}
