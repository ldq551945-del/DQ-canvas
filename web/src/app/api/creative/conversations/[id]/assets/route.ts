import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { CreativeRuntimeServiceError, listAssetPageForUser } from "@/lib/server/creative-runtime-service";

type AssetPageInput = { ids?: unknown; messageIds?: unknown; runIds?: unknown; limit?: unknown; offset?: unknown };
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
    const search = new URL(request.url).searchParams;
    return assetPageResponse(
        {
            ids: search.getAll("ids"),
            messageIds: search.getAll("messageIds"),
            runIds: search.getAll("runIds"),
            limit: search.get("limit"),
            offset: search.get("offset"),
        },
        context,
    );
}

export async function POST(request: Request, context: RouteContext) {
    return assetPageResponse(await readJsonBody<AssetPageInput>(request), context);
}

async function assetPageResponse(input: AssetPageInput, { params }: RouteContext) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const page = await listAssetPageForUser(user.id, (await params).id, input);
        const offset = Math.max(0, Number(input.offset) || 0);
        return NextResponse.json({ code: 0, data: { ...page, nextOffset: page.hasMore ? offset + page.assets.length : undefined }, msg: "OK" });
    } catch (error) {
        if (error instanceof CreativeRuntimeServiceError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        throw error;
    }
}
