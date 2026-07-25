import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

export function createSignedReferenceAssetUrl(token: string, origin: string, now = Date.now()) {
    const secret = signingSecret();
    const normalizedOrigin = normalizeOrigin(origin);
    if (!secret || !normalizedOrigin || !token) return "";
    const expires = Math.floor((now + SIGNED_URL_TTL_MS) / 1000);
    const signature = sign(token, expires, secret);
    const path = token.split("/").map(encodeURIComponent).join("/");
    return `${normalizedOrigin}/api/reference-assets/${path}?expires=${expires}&signature=${signature}`;
}

export function signReferenceAssetInputUrl(value: string, origin: string, now = Date.now()) {
    const raw = value.trim();
    if (!raw) return "";
    let url: URL;
    try {
        url = new URL(raw, normalizeOrigin(origin));
    } catch {
        return raw;
    }
    const prefix = "/api/reference-assets/";
    if (!url.pathname.startsWith(prefix)) return raw;
    const token = url.pathname
        .slice(prefix.length)
        .split("/")
        .map((part) => decodeURIComponent(part))
        .join("/");
    return createSignedReferenceAssetUrl(token, origin, now) || raw;
}

export function verifyReferenceAssetSignature(token: string, expiresValue: string | null, signature: string | null, now = Date.now()) {
    const secret = signingSecret();
    const expires = Number(expiresValue);
    if (!secret || !token || !signature || !Number.isInteger(expires) || expires <= Math.floor(now / 1000)) return false;
    const expected = Buffer.from(sign(token, expires, secret));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(token: string, expires: number, secret: string) {
    return createHmac("sha256", secret).update(`${token}.${expires}`).digest("base64url");
}

function signingSecret() {
    return process.env.VOZEB_PRO_REFERENCE_ASSET_SIGNING_KEY?.trim() || process.env.VOZEB_PRO_ENCRYPTION_KEY?.trim() || "";
}

function normalizeOrigin(value: string) {
    try {
        const url = new URL(value.trim());
        return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
    } catch {
        return "";
    }
}
