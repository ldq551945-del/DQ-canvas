const MAX_TRUSTED_PROXY_HOPS = 10;

export type TrustedForwardedHeader = "x-forwarded-host" | "x-forwarded-proto";

export function getTrustedProxyHops() {
    const value = Number(process.env.DQ_TRUSTED_PROXY_HOPS || 0);
    return Number.isInteger(value) && value > 0 ? Math.min(value, MAX_TRUSTED_PROXY_HOPS) : 0;
}

export function getTrustedForwardedHeader(headers: Headers, name: TrustedForwardedHeader) {
    const trustedProxyHops = getTrustedProxyHops();
    if (trustedProxyHops <= 0) return "";
    const values = headers
        .get(name)
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    if (!values || values.length < trustedProxyHops) return "";
    return values[values.length - trustedProxyHops] || "";
}

export function getTrustedForwardedProtocol(headers: Headers) {
    const forwardedProtocol = getTrustedForwardedHeader(headers, "x-forwarded-proto");
    if (forwardedProtocol) return forwardedProtocol.toLowerCase();
    const trustedProxyHops = getTrustedProxyHops();
    if (trustedProxyHops <= 0) return "";

    const values = headers
        .get("forwarded")
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    if (!values || values.length < trustedProxyHops) return "";
    const trustedEntry = values[values.length - trustedProxyHops];
    const match = trustedEntry?.match(/(?:^|;)\s*proto=([^;]+)/i);
    return match?.[1]?.trim().replace(/^"|"$/g, "").toLowerCase() || "";
}
