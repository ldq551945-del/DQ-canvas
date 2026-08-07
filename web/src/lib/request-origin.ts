import { getTrustedForwardedHeader } from "@/lib/trusted-proxy";

export function requestPublicOrigin(request: Request, configuredValue = process.env.NEXT_PUBLIC_SITE_URL || "") {
    const configured = normalizeHttpOrigin(configuredValue);
    if (configured) return configured;

    const requestUrl = new URL(request.url);
    const host = getTrustedForwardedHeader(request.headers, "x-forwarded-host") || requestUrl.host;
    const protocol = getTrustedForwardedHeader(request.headers, "x-forwarded-proto") || requestUrl.protocol.replace(/:$/, "");
    return normalizeHttpOrigin(`${protocol}://${host}`) || requestUrl.origin;
}

export function requestPublicOriginFromHeaders(headers: Headers, fallbackValue = "http://localhost:3000", configuredValue = process.env.NEXT_PUBLIC_SITE_URL || "") {
    const configured = normalizeHttpOrigin(configuredValue);
    if (configured) return configured;

    const fallback = normalizeHttpOrigin(fallbackValue) || "http://localhost:3000";
    const fallbackUrl = new URL(fallback);
    const host = getTrustedForwardedHeader(headers, "x-forwarded-host") || headers.get("host")?.trim() || fallbackUrl.host;
    const protocol = getTrustedForwardedHeader(headers, "x-forwarded-proto") || (isLoopbackHostname(hostnameFromHost(host)) ? "http" : "https");
    return normalizeHttpOrigin(`${protocol}://${host}`) || fallback;
}

export function normalizeHttpOrigin(value: string) {
    try {
        const url = new URL(value.trim().replace(/\/+$/, ""));
        return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
    } catch {
        return "";
    }
}

function hostnameFromHost(host: string) {
    try {
        return new URL(`http://${host}`).hostname;
    } catch {
        return "";
    }
}

function isLoopbackHostname(hostname: string) {
    const host = hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
