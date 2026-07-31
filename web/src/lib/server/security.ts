import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { ensurePostgresSchema, getDatabaseProvider, postgresQuery } from "@/lib/server/database";

type RateLimitConfig = {
    maxRequests: number;
    windowMs: number;
};

export type RateLimitResult = {
    allowed: boolean;
    remaining: number;
    resetAt: number;
};

export type GenerationRateLimitType = "text" | "image" | "video" | "audio" | "agent" | "render";

const generationRateLimits: Record<GenerationRateLimitType, RateLimitConfig> = {
    agent: { maxRequests: 10, windowMs: 60 * 1000 },
    image: { maxRequests: 20, windowMs: 60 * 1000 },
    video: { maxRequests: 6, windowMs: 60 * 1000 },
    audio: { maxRequests: 20, windowMs: 60 * 1000 },
    text: { maxRequests: 30, windowMs: 60 * 1000 },
    render: { maxRequests: 6, windowMs: 60 * 1000 },
};

const mediaProxyRateLimit: RateLimitConfig = { maxRequests: 120, windowMs: 60 * 1000 };
const localMediaRateLimit: RateLimitConfig = { maxRequests: 240, windowMs: 60 * 1000 };
const signedMediaRateLimit: RateLimitConfig = { maxRequests: 60, windowMs: 60 * 1000 };
const publicMediaResourceRateLimit: RateLimitConfig = { maxRequests: 2400, windowMs: 60 * 1000 };
const publicMediaIpRateLimit: RateLimitConfig = { maxRequests: 240, windowMs: 60 * 1000 };

const blockedHostnames = ["metadata.google.internal", "metadata.goog", "metadata.azure.com", "instance-data"];

const globalSecurityStore = globalThis as typeof globalThis & {
    __vozebProRateLimits?: Map<string, { count: number; resetAt: number }>;
};

const rateLimits = (globalSecurityStore.__vozebProRateLimits ??= new Map<string, { count: number; resetAt: number }>());

export function getClientIp(request: Request) {
    const trustedProxyHops = readTrustedProxyHops();
    if (trustedProxyHops <= 0) return "unknown";

    const forwarded = request.headers
        .get("x-forwarded-for")
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const forwardedIp = forwarded?.[Math.max(0, forwarded.length - trustedProxyHops)];
    return forwardedIp || request.headers.get("x-real-ip")?.trim() || request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

export async function checkRateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const normalized = { maxRequests: Math.max(1, Math.floor(config.maxRequests)), windowMs: Math.max(1000, Math.floor(config.windowMs)) };
    if (getDatabaseProvider() === "postgres") {
        try {
            return await checkPostgresRateLimit(key, normalized);
        } catch {
            return checkMemoryRateLimit(key, normalized);
        }
    }
    return checkMemoryRateLimit(key, normalized);
}

export async function checkGenerationRateLimit(userId: string, request: Request, type: GenerationRateLimitType) {
    const config = generationRateLimits[type];
    const userLimit = await checkRateLimit(`generation:${type}:user:${userId}`, config);
    if (!userLimit.allowed) return userLimit;

    const clientIp = getClientIp(request);
    if (clientIp === "unknown") return userLimit;
    const ipLimit = await checkRateLimit(`generation:${type}:ip:${clientIp}`, { ...config, maxRequests: config.maxRequests * 4 });
    return ipLimit.allowed ? userLimit : ipLimit;
}

export async function checkMediaProxyRateLimit(userId: string, request: Request) {
    const userLimit = await checkRateLimit(`media-proxy:user:${userId}`, mediaProxyRateLimit);
    if (!userLimit.allowed) return userLimit;

    const clientIp = getClientIp(request);
    if (clientIp === "unknown") return userLimit;
    const ipLimit = await checkRateLimit(`media-proxy:ip:${clientIp}`, { ...mediaProxyRateLimit, maxRequests: mediaProxyRateLimit.maxRequests * 4 });
    return ipLimit.allowed ? userLimit : ipLimit;
}

export async function checkLocalMediaRateLimit(identity: string, request: Request) {
    const config = identity.startsWith("signature:") ? signedMediaRateLimit : localMediaRateLimit;
    const identityLimit = await checkRateLimit(`local-media:${identity}`, config);
    if (!identityLimit.allowed) return identityLimit;

    const clientIp = getClientIp(request);
    if (clientIp === "unknown") return identityLimit;
    const ipLimit = await checkRateLimit(`local-media:ip:${clientIp}`, { ...config, maxRequests: config.maxRequests * 4 });
    return ipLimit.allowed ? identityLimit : ipLimit;
}

export async function checkPublicMediaRateLimit(resource: string, request: Request) {
    const resourceLimit = await checkRateLimit(`public-media:resource:${resource}`, publicMediaResourceRateLimit);
    if (!resourceLimit.allowed) return resourceLimit;

    const clientIp = getClientIp(request);
    if (clientIp === "unknown") return resourceLimit;
    const ipLimit = await checkRateLimit(`public-media:ip:${clientIp}`, publicMediaIpRateLimit);
    return ipLimit.allowed ? resourceLimit : ipLimit;
}

export function rateLimitHeaders(result: RateLimitResult) {
    return { "Retry-After": String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))) };
}

async function checkPostgresRateLimit(key: string, config: RateLimitConfig) {
    await ensurePostgresSchema();
    const now = Date.now();
    const resetAt = now + config.windowMs;
    const result = await postgresQuery<{ request_count: number | string; reset_at: Date | string }>(
        `INSERT INTO rate_limits (key_hash, request_count, reset_at, updated_at)
         VALUES ($1, 1, $3, $2)
         ON CONFLICT (key_hash) DO UPDATE SET
            request_count = CASE WHEN rate_limits.reset_at <= $2 THEN 1 ELSE LEAST(rate_limits.request_count + 1, $4) END,
            reset_at = CASE WHEN rate_limits.reset_at <= $2 THEN $3 ELSE rate_limits.reset_at END,
            updated_at = $2
         RETURNING request_count, reset_at`,
        [createHash("sha256").update(key).digest("hex"), new Date(now), new Date(resetAt), config.maxRequests + 1],
    );
    const count = Number(result.rows[0]?.request_count) || 1;
    const databaseResetAt = new Date(result.rows[0]?.reset_at || resetAt).getTime();
    return { allowed: count <= config.maxRequests, remaining: Math.max(0, config.maxRequests - count), resetAt: Number.isFinite(databaseResetAt) ? databaseResetAt : resetAt };
}

function checkMemoryRateLimit(key: string, config: RateLimitConfig) {
    const now = Date.now();
    const current = rateLimits.get(key);
    if (!current || current.resetAt <= now) {
        const next = { count: 1, resetAt: now + config.windowMs };
        rateLimits.set(key, next);
        cleanupRateLimits(now);
        return { allowed: true, remaining: config.maxRequests - 1, resetAt: next.resetAt };
    }

    if (current.count >= config.maxRequests) {
        return { allowed: false, remaining: 0, resetAt: current.resetAt };
    }

    current.count += 1;
    return { allowed: true, remaining: config.maxRequests - current.count, resetAt: current.resetAt };
}

export async function isSafeOutboundUrl(value: string, options?: { allowCredentials?: boolean }) {
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        if (!options?.allowCredentials && (url.username || url.password)) return false;
        if (privateUpstreamHostAllowed(url.hostname)) return true;
        return isSafeOutboundHost(url.hostname);
    } catch {
        return false;
    }
}

function privateUpstreamHostAllowed(hostname: string) {
    if (process.env.VOZEB_PRO_ALLOW_PRIVATE_UPSTREAMS !== "1") return false;
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (process.env.VOZEB_PRO_PRIVATE_UPSTREAM_HOSTS || "")
        .split(",")
        .map((value) =>
            value
                .trim()
                .replace(/^\[|\]$/g, "")
                .toLowerCase(),
        )
        .filter(Boolean)
        .includes(host);
}

async function isSafeOutboundHost(hostname: string) {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
    if (blockedHostnames.some((blocked) => host === blocked || host.endsWith(`.${blocked}`) || host.includes(blocked))) return false;

    const directIpVersion = isIP(host);
    if (directIpVersion) return isPublicIpAddress(host);

    try {
        const addresses = await lookup(host, { all: true, verbatim: true });
        return addresses.length > 0 && addresses.every((address) => isPublicIpAddress(address.address));
    } catch {
        return false;
    }
}

export function isPublicIpAddress(address: string) {
    const version = isIP(address);
    if (version === 4) {
        const parts = address.split(".").map((part) => Number(part));
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
        const [a, b] = parts;
        if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
        if (a === 100 && b >= 64 && b <= 127) return false;
        if (a === 169 && b === 254) return false;
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && (b === 0 || b === 168)) return false;
        if (a === 198 && (b === 18 || b === 19)) return false;
        return true;
    }

    if (version === 6) {
        const normalized = address.toLowerCase();
        if (normalized === "::" || normalized === "::1") return false;
        if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return false;
        if (normalized.startsWith("ff") || normalized.startsWith("2001:db8:")) return false;
        if (normalized.startsWith("::ffff:")) return isPublicIpAddress(normalized.slice("::ffff:".length));
        return true;
    }

    return false;
}

function cleanupRateLimits(now: number) {
    if (rateLimits.size < 5000) return;
    for (const [key, value] of rateLimits.entries()) {
        if (value.resetAt <= now) rateLimits.delete(key);
    }
}

function readTrustedProxyHops() {
    const value = Number(process.env.VOZEB_PRO_TRUSTED_PROXY_HOPS || 0);
    return Number.isInteger(value) && value > 0 ? Math.min(value, 10) : 0;
}
