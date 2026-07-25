import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { deleteUserLocalMediaAssets } from "@/lib/server/local-media-storage";

export async function DELETE(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { storageKeys?: unknown };
    const storageKeys = Array.isArray(body.storageKeys) ? body.storageKeys.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).slice(0, 200) : [];
    if (!storageKeys.length) return NextResponse.json({ code: 0, data: { deletedFiles: 0, deletedBytes: 0, blocked: [] }, msg: "没有需要删除的媒体文件" });
    const result = await deleteUserLocalMediaAssets(user.id, storageKeys);
    return NextResponse.json({ code: 0, data: result, msg: result.blocked.length ? "部分媒体仍被业务数据引用，已保留服务器文件" : "媒体文件已删除" });
}
