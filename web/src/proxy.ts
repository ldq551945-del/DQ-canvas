import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
    if (request.nextUrl.pathname.startsWith("/api/billing/webhooks/")) return NextResponse.next();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return NextResponse.next();

    const requestOrigin = publicRequestOrigin(request);
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

function publicRequestOrigin(request: NextRequest) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const protocol = forwardedProto || request.nextUrl.protocol.replace(/:$/, "");
    const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
    return `${protocol}://${host}`;
}
