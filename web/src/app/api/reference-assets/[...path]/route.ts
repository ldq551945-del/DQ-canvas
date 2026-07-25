import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { verifyReferenceAssetSignature } from "@/lib/server/reference-asset-access";
import { createLocalMediaResponse, mediaContentDisposition } from "@/lib/server/local-media-response";
import { getLocalMediaRegistration } from "@/lib/server/local-media-registry";
import { createExternalMediaReadUrl } from "@/lib/server/object-storage-service";
import { isReferenceAssetPath, readReferenceAsset } from "@/lib/server/reference-asset-store";
import { checkLocalMediaRateLimit, rateLimitHeaders } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ path: string[] }>;
};

export async function GET(request: Request, context: RouteContext) {
    const { path } = await context.params;
    const storagePath = path.join("/");
    if (!isReferenceAssetPath(storagePath)) return NextResponse.json({ error: "媒体文件不存在或已过期" }, { status: 404 });
    const url = new URL(request.url);
    const signature = url.searchParams.get("signature") || "";
    const signed = verifyReferenceAssetSignature(storagePath, url.searchParams.get("expires"), signature);
    let rateIdentity = `signature:${signature}`;
    let currentUser: Awaited<ReturnType<typeof getCurrentUser>> = null;
    if (!signed) {
        currentUser = await getCurrentUser();
        if (!currentUser) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
        rateIdentity = `user:${currentUser.id}`;
    }
    const rate = await checkLocalMediaRateLimit(rateIdentity, request);
    if (!rate.allowed) return NextResponse.json({ code: 429, data: null, msg: "媒体访问过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(rate) });
    const registration = await getLocalMediaRegistration(storagePath);
    if (!registration) return NextResponse.json({ error: "媒体文件不存在或已过期" }, { status: 404 });
    if (currentUser && currentUser.role !== "admin" && registration.ownerUserId !== currentUser.id) return NextResponse.json({ code: 404, data: null, msg: "媒体文件不存在" }, { status: 404 });
    if (registration.storageProvider === "object") {
        try {
            const externalUrl = await createExternalMediaReadUrl(request, registration);
            return externalUrl ? externalMediaRedirect(externalUrl) : NextResponse.json({ error: "媒体文件不存在或已过期" }, { status: 404 });
        } catch (error) {
            console.error("Reference object storage read failed", error);
            return NextResponse.json({ error: "外部存储文件读取失败" }, { status: 502 });
        }
    }
    const asset = await readReferenceAsset(storagePath);
    if (!asset) return NextResponse.json({ error: "媒体文件不存在或已过期" }, { status: 404 });

    return (
        (await createLocalMediaResponse(request, asset.filePath, asset.mimeType, {
            "Cache-Control": storagePath.startsWith("permanent/") ? "private, max-age=86400" : "private, max-age=300",
            "Content-Disposition": mediaContentDisposition("inline", registration.originalName || path.at(-1) || "media"),
        })) || NextResponse.json({ error: "媒体文件不存在或已过期" }, { status: 404 })
    );
}

function externalMediaRedirect(url: string) {
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return response;
}
