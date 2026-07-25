import { resolve, sep } from "node:path";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getServerDataDir } from "@/lib/server/data-dir";
import { canAccessGenerationAsset } from "@/lib/server/generation-log-store";
import { createLocalMediaResponse, mediaContentDisposition } from "@/lib/server/local-media-response";
import { getLocalMediaRegistration } from "@/lib/server/local-media-registry";
import { createExternalMediaReadUrl } from "@/lib/server/object-storage-service";
import { checkLocalMediaRateLimit, rateLimitHeaders } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ path: string[] }>;
};

export async function GET(request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const { path } = await context.params;
    const rate = await checkLocalMediaRateLimit(`user:${currentUser.id}`, request);
    if (!rate.allowed) return NextResponse.json({ error: "媒体访问过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(rate) });
    const root = resolve(getServerDataDir(), "generation-assets");
    const filePath = resolve(root, ...(path || []));
    if (!isInsideRoot(filePath, root)) return NextResponse.json({ error: "资源不存在" }, { status: 404 });
    const assetUrl = `/api/generation-log-assets/${(path || []).join("/")}`;
    if (!(await canAccessGenerationAsset(currentUser.id, currentUser.role, assetUrl))) return NextResponse.json({ error: "资源不存在" }, { status: 404 });

    const registration = await getLocalMediaRegistration((path || []).join("/"));
    if (registration?.storageProvider === "object") {
        try {
            const externalUrl = await createExternalMediaReadUrl(request, registration);
            return externalUrl ? externalMediaRedirect(externalUrl) : NextResponse.json({ error: "资源不存在" }, { status: 404 });
        } catch (error) {
            console.error("Generation object storage read failed", error);
            return NextResponse.json({ error: "外部存储文件读取失败" }, { status: 502 });
        }
    }
    return (
        (await createLocalMediaResponse(request, filePath, contentType(filePath), {
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": mediaContentDisposition("inline", registration?.originalName || path.at(-1) || "media"),
        })) || NextResponse.json({ error: "资源不存在" }, { status: 404 })
    );
}

function externalMediaRedirect(url: string) {
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return response;
}

function isInsideRoot(filePath: string, root: string) {
    return filePath === root || filePath.startsWith(`${root}${sep}`);
}

function contentType(filePath: string) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".mov")) return "video/quicktime";
    return lower.includes("\\videos\\") || lower.includes("/videos/") ? "video/mp4" : "image/png";
}
