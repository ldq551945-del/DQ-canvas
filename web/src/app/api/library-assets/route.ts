import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { createLibraryAssetForUser, LibraryAssetServiceError, listLibraryAssetsForUser } from "@/lib/server/library-asset-service";

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    return NextResponse.json({ code: 0, data: { assets: await listLibraryAssetsForUser(user.id) }, msg: "OK" });
}

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const asset = await createLibraryAssetForUser(user.id, await request.json().catch(() => ({})));
        return NextResponse.json({ code: 0, data: { asset }, msg: "素材已保存" });
    } catch (error) {
        return serviceError(error);
    }
}

function serviceError(error: unknown) {
    if (error instanceof LibraryAssetServiceError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
    throw error;
}
