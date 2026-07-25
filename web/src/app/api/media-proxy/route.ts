import { lookup } from "node:dns/promises";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { limitMediaResponseBody, mediaResponseExceedsLimit } from "@/lib/server/media-response-limit";
import { checkMediaProxyRateLimit, isPublicIpAddress, rateLimitHeaders } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_PROXY_TIMEOUT_MS = 30 * 1000;
const MAX_REDIRECTS = 4;

export async function GET(request: Request) {
    return proxyMedia(request, "GET");
}

export async function HEAD(request: Request) {
    return proxyMedia(request, "HEAD");
}

async function proxyMedia(request: Request, method: "GET" | "HEAD") {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const rate = await checkMediaProxyRateLimit(currentUser.id, request);
    if (!rate.allowed) return NextResponse.json({ error: "媒体访问过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(rate) });

    const target = await readTargetUrl(request);
    if (!target) return NextResponse.json({ error: "Invalid media url" }, { status: 400 });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEDIA_PROXY_TIMEOUT_MS);
    try {
        const range = request.headers.get("range");
        const upstream = await fetchMedia(target, method, range, controller.signal);

        if (!upstream.ok && upstream.status !== 206) {
            return NextResponse.json({ error: "Media fetch failed" }, { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 });
        }

        if (mediaResponseExceedsLimit(upstream.headers)) return NextResponse.json({ error: "Media is too large" }, { status: 413 });

        const headers = mediaHeaders(upstream.headers);
        if (method === "HEAD") return new NextResponse(null, { status: upstream.status, headers });
        return new NextResponse(limitMediaResponseBody(upstream.body), { status: upstream.status, headers });
    } catch {
        return NextResponse.json({ error: "Media fetch failed" }, { status: 502 });
    } finally {
        clearTimeout(timer);
    }
}

async function readTargetUrl(request: Request) {
    const raw = new URL(request.url).searchParams.get("url") || "";
    let target: URL;
    try {
        target = new URL(raw);
    } catch {
        return null;
    }
    return (await isSafeTarget(target)) ? target : null;
}

async function fetchMedia(target: URL, method: "GET" | "HEAD", range: string | null, signal: AbortSignal) {
    let current = target;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        if (!(await isSafeTarget(current))) throw new Error("Unsafe media url");
        const response = await fetch(current, {
            method,
            headers: {
                "User-Agent": "VOZEB-PRO-Media-Proxy/0.0.2",
                ...(range ? { Range: range } : {}),
            },
            cache: "no-store",
            redirect: "manual",
            signal,
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) throw new Error("Too many media redirects");
        current = new URL(location, current);
    }
    throw new Error("Media redirect failed");
}

function mediaHeaders(source: Headers) {
    const headers = new Headers();
    const contentType = source.get("content-type") || "application/octet-stream";
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "private, max-age=600");
    headers.set("Cross-Origin-Resource-Policy", "same-site");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    for (const key of ["content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
        const value = source.get(key);
        if (value) headers.set(key, value);
    }
    return headers;
}

async function isSafeTarget(target: URL) {
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return false;
    const host = target.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
    try {
        const addresses = await lookup(host, { all: true, verbatim: true });
        return addresses.length > 0 && addresses.every((item) => isPublicIpAddress(item.address));
    } catch {
        return false;
    }
}
