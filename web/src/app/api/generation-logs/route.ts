import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { CreativeRuntimeServiceError, registerGenerationLogAssetsForUser } from "@/lib/server/creative-runtime-service";
import { deleteGenerationLogs, listGenerationLogs, listUserGenerationLogsForDelete, recordGenerationLog, type GenerationLogAsset, type GenerationLogInput } from "@/lib/server/generation-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("pageSize") || 100);
    const kind = url.searchParams.get("kind") || undefined;
    const source = url.searchParams.get("source") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const keyword = url.searchParams.get("keyword") || undefined;
    return NextResponse.json(await listGenerationLogs({ page, pageSize, kind, source, status, keyword, userId: currentUser.id }));
}

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const body = await readJsonBody<Omit<GenerationLogInput, "userId" | "username" | "displayName"> & { conversationId?: string }>(request, 32 * 1024 * 1024);
    const conversationId = String(body.conversationId || "")
        .trim()
        .slice(0, 160);
    try {
        const log = await recordGenerationLog({
            ...body,
            userId: currentUser.id,
            username: currentUser.username,
            displayName: currentUser.displayName,
        });
        if (conversationId && log.status === "success" && log.assets.length && (log.source === "image-workbench" || log.source === "video-workbench")) {
            await registerGenerationLogAssetsForUser(currentUser.id, {
                conversationId,
                logId: log.id,
                taskId: log.taskId,
                source: log.source,
                title: log.title,
                assets: log.assets,
            });
        }
        return NextResponse.json({ log });
    } catch (error) {
        if (error instanceof CreativeRuntimeServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
        throw error;
    }
}

export async function DELETE(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const body = await readJsonBody<{ ids?: string[] }>(request);
    const requestedIds = Array.isArray(body.ids) ? Array.from(new Set(body.ids.map((id) => id.trim()).filter(Boolean))) : [];
    if (!requestedIds.length) return NextResponse.json({ deleted: 0 });

    const deletableIds = (await listUserGenerationLogsForDelete(currentUser.id, requestedIds)).map((log) => log.id);
    if (!deletableIds.length) return NextResponse.json({ deleted: 0 });

    return NextResponse.json(await deleteGenerationLogs(deletableIds));
}
