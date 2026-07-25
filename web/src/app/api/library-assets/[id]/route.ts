import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { deleteLibraryAssetForUser, LibraryAssetServiceError, updateLibraryAssetForUser } from "@/lib/server/library-asset-service";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const asset = await updateLibraryAssetForUser(user.id, (await context.params).id, await request.json().catch(() => ({})));
        return NextResponse.json({ code: 0, data: { asset }, msg: "素材已更新" });
    } catch (error) {
        return serviceError(error);
    }
}

export async function DELETE(_request: Request, context: Context) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        await deleteLibraryAssetForUser(user.id, (await context.params).id);
        return NextResponse.json({ code: 0, data: { deleted: true }, msg: "素材已删除" });
    } catch (error) {
        return serviceError(error);
    }
}

function serviceError(error: unknown) {
    if (error instanceof LibraryAssetServiceError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
    throw error;
}
