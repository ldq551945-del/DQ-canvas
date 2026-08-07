import { NextResponse, type NextRequest } from "next/server";
import { requestPublicOrigin } from "@/lib/request-origin";

export function proxy(request: NextRequest) {
    if (request.nextUrl.pathname.startsWith("/api/billing/webhooks/")) return NextResponse.next();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return NextResponse.next();

    const requestOrigin = requestPublicOrigin(request);
    const origin = request.headers.get("origin");
    if (origin && origin !== requestOrigin) return NextResponse.json({ error: "跨站请求已被拦截" }, { status: 403 });

    const referer = request.headers.get("referer");
    if (referer) {
        try {
            if (new URL(referer).origin !== requestOrigin) return NextResponse.json({ error: "跨站请求已被拦截" }, { status: 403 });
        } catch {
            return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: "/api/:path*",
};
