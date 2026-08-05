import { describe, expect, it, vi } from "vitest";

const dnsMocks = vi.hoisted(() => ({ lookup: vi.fn() }));

vi.mock("node:dns/promises", () => ({ lookup: dnsMocks.lookup }));

import {
    checkGenerationRateLimit,
    checkLocalMediaRateLimit,
    checkMediaProxyRateLimit,
    checkPublicMediaRateLimit,
    checkRateLimit,
    fetchSafeOutboundUrl,
    getClientIp,
    isClashFakeIpAddress,
    isSafeOutboundUrl,
    rateLimitHeaders,
    resolveSafeOutboundUrl,
} from "./security";

describe("checkRateLimit", () => {
    it("blocks requests beyond the configured window limit", async () => {
        const key = `test:${crypto.randomUUID()}`;
        expect((await checkRateLimit(key, { maxRequests: 2, windowMs: 60_000 })).allowed).toBe(true);
        expect((await checkRateLimit(key, { maxRequests: 2, windowMs: 60_000 })).allowed).toBe(true);
        expect((await checkRateLimit(key, { maxRequests: 2, windowMs: 60_000 })).allowed).toBe(false);
    });

    it("only trusts the configured number of proxy hops", () => {
        const previous = process.env.DQ_TRUSTED_PROXY_HOPS;
        delete process.env.DQ_TRUSTED_PROXY_HOPS;
        expect(getClientIp(new Request("http://localhost", { headers: { "x-forwarded-for": "198.51.100.10" } }))).toBe("unknown");

        process.env.DQ_TRUSTED_PROXY_HOPS = "2";
        expect(getClientIp(new Request("http://localhost", { headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.10, 192.0.2.10" } }))).toBe("203.0.113.10");

        if (previous === undefined) delete process.env.DQ_TRUSTED_PROXY_HOPS;
        else process.env.DQ_TRUSTED_PROXY_HOPS = previous;
    });

    it("limits generation requests by user", async () => {
        const userId = `user:${crypto.randomUUID()}`;
        for (let index = 0; index < 6; index += 1) expect((await checkGenerationRateLimit(userId, new Request("http://localhost"), "video")).allowed).toBe(true);
        expect((await checkGenerationRateLimit(userId, new Request("http://localhost"), "video")).allowed).toBe(false);
    });

    it("allows 30 background-removal requests per user in the initial minute window", async () => {
        const userId = `image-process:${crypto.randomUUID()}`;
        for (let index = 0; index < 30; index += 1) expect((await checkGenerationRateLimit(userId, new Request("http://localhost"), "image_process")).allowed).toBe(true);
        expect((await checkGenerationRateLimit(userId, new Request("http://localhost"), "image_process")).allowed).toBe(false);
    });

    it("limits generation requests across users sharing an IP", async () => {
        const previous = process.env.DQ_TRUSTED_PROXY_HOPS;
        process.env.DQ_TRUSTED_PROXY_HOPS = "1";
        const clientIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
        try {
            for (let index = 0; index < 24; index += 1) {
                const request = new Request("http://localhost", { headers: { "x-forwarded-for": clientIp } });
                expect((await checkGenerationRateLimit(`user:${crypto.randomUUID()}`, request, "video")).allowed).toBe(true);
            }
            const blocked = await checkGenerationRateLimit(`user:${crypto.randomUUID()}`, new Request("http://localhost", { headers: { "x-forwarded-for": clientIp } }), "video");
            expect(blocked.allowed).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.DQ_TRUSTED_PROXY_HOPS;
            else process.env.DQ_TRUSTED_PROXY_HOPS = previous;
        }
    });

    it("limits repeated media proxy access", async () => {
        const userId = `media:${crypto.randomUUID()}`;
        for (let index = 0; index < 120; index += 1) expect((await checkMediaProxyRateLimit(userId, new Request("http://localhost"))).allowed).toBe(true);
        expect((await checkMediaProxyRateLimit(userId, new Request("http://localhost"))).allowed).toBe(false);
    });

    it("limits repeated local media access", async () => {
        const identity = `local-media:${crypto.randomUUID()}`;
        for (let index = 0; index < 240; index += 1) expect((await checkLocalMediaRateLimit(identity, new Request("http://localhost"))).allowed).toBe(true);
        expect((await checkLocalMediaRateLimit(identity, new Request("http://localhost"))).allowed).toBe(false);
    });

    it("uses a stricter limit for leaked signed media urls", async () => {
        const identity = `signature:${crypto.randomUUID()}`;
        for (let index = 0; index < 60; index += 1) expect((await checkLocalMediaRateLimit(identity, new Request("http://localhost"))).allowed).toBe(true);
        expect((await checkLocalMediaRateLimit(identity, new Request("http://localhost"))).allowed).toBe(false);
    });

    it("does not make normal hotspot reads share the per-IP public limit when proxy headers are untrusted", async () => {
        const previous = process.env.DQ_TRUSTED_PROXY_HOPS;
        delete process.env.DQ_TRUSTED_PROXY_HOPS;
        try {
            const resource = `public:${crypto.randomUUID()}`;
            for (let index = 0; index < 241; index += 1) expect((await checkPublicMediaRateLimit(resource, new Request("http://localhost"))).allowed).toBe(true);
        } finally {
            if (previous === undefined) delete process.env.DQ_TRUSTED_PROXY_HOPS;
            else process.env.DQ_TRUSTED_PROXY_HOPS = previous;
        }
    });

    it("limits a trusted client IP across different public resources", async () => {
        const previous = process.env.DQ_TRUSTED_PROXY_HOPS;
        process.env.DQ_TRUSTED_PROXY_HOPS = "1";
        const clientIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
        try {
            for (let index = 0; index < 240; index += 1) {
                const request = new Request("http://localhost", { headers: { "x-forwarded-for": clientIp } });
                expect((await checkPublicMediaRateLimit(`public:${crypto.randomUUID()}`, request)).allowed).toBe(true);
            }
            const blocked = await checkPublicMediaRateLimit(`public:${crypto.randomUUID()}`, new Request("http://localhost", { headers: { "x-forwarded-for": clientIp } }));
            expect(blocked.allowed).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.DQ_TRUSTED_PROXY_HOPS;
            else process.env.DQ_TRUSTED_PROXY_HOPS = previous;
        }
    });

    it("returns a Retry-After header in seconds", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-22T00:00:00.000Z"));
        expect(rateLimitHeaders({ allowed: false, remaining: 0, resetAt: Date.now() + 1500 })).toEqual({ "Retry-After": "2" });
        vi.useRealTimers();
    });

    it("allows private upstreams only through an explicit exact host allowlist", async () => {
        vi.stubEnv("DQ_ALLOW_PRIVATE_UPSTREAMS", "");
        vi.stubEnv("DQ_PRIVATE_UPSTREAM_HOSTS", "");
        await expect(isSafeOutboundUrl("http://127.0.0.1:4010/v1/models")).resolves.toBe(false);

        vi.stubEnv("DQ_ALLOW_PRIVATE_UPSTREAMS", "1");
        await expect(isSafeOutboundUrl("http://127.0.0.1:4010/v1/models")).resolves.toBe(false);

        vi.stubEnv("DQ_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1, provider.internal");
        await expect(isSafeOutboundUrl("http://127.0.0.1:4010/v1/models")).resolves.toBe(true);
        await expect(isSafeOutboundUrl("http://127.0.0.1:4010/private.png", { allowPrivateUpstreams: false })).resolves.toBe(false);
        await expect(isSafeOutboundUrl("http://127.0.0.2:4010/v1/models")).resolves.toBe(false);
        await expect(isSafeOutboundUrl("ftp://127.0.0.1/file")).resolves.toBe(false);
        await expect(isSafeOutboundUrl("http://user:secret@127.0.0.1/file")).resolves.toBe(false);

        vi.stubEnv("NODE_ENV", "production");
        await expect(isSafeOutboundUrl("http://127.0.0.1:4010/v1/models")).resolves.toBe(true);
        vi.unstubAllEnvs();
    });

    it("allows Clash Fake-IP DNS only through the explicit deployment switch", async () => {
        dnsMocks.lookup.mockResolvedValue([{ address: "198.18.3.115", family: 4 }]);
        vi.stubEnv("DQ_ALLOW_FAKE_IP_DNS", "");
        await expect(isSafeOutboundUrl("https://api.openai.com/v1/models")).resolves.toBe(false);

        vi.stubEnv("DQ_ALLOW_FAKE_IP_DNS", "1");
        await expect(isSafeOutboundUrl("https://api.openai.com/v1/models")).resolves.toBe(true);
        await expect(isSafeOutboundUrl("https://198.18.3.115/v1/models")).resolves.toBe(false);
        expect(isClashFakeIpAddress("198.18.0.1")).toBe(true);
        expect(isClashFakeIpAddress("198.19.255.254")).toBe(true);
        expect(isClashFakeIpAddress("198.20.0.1")).toBe(false);
        vi.unstubAllEnvs();
    });

    it("pins a validated DNS result on the outbound dispatcher instead of handing the hostname back to fetch", async () => {
        dnsMocks.lookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
        const resolved = await resolveSafeOutboundUrl("https://provider.example/v1/models");
        expect(resolved).toMatchObject({ hostname: "provider.example", address: "203.0.113.10" });

        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
        await fetchSafeOutboundUrl("https://provider.example/v1/models");

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe("https://provider.example/v1/models");
        expect((init as (RequestInit & { dispatcher?: unknown }) | undefined)?.dispatcher).toBeDefined();
    });

    it("pins the CONNECT destination when an outbound proxy is configured", async () => {
        dnsMocks.lookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
        const previousProxy = process.env.HTTPS_PROXY;
        process.env.HTTPS_PROXY = "http://127.0.0.1:8080";
        try {
            vi.resetModules();
            const { fetchSafeOutboundUrl: fetchWithConfiguredProxy } = await import("./security");
            const { getOutboundProxyUrl } = await import("./proxy-dispatcher");
            expect(getOutboundProxyUrl()).toBe("http://127.0.0.1:8080");
            vi.restoreAllMocks();
            const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));

            await fetchWithConfiguredProxy("https://provider.example/v1/models");

            const [url, init] = fetchMock.mock.calls[0];
            expect(new Headers(init?.headers).get("host")).toBe("provider.example");
            expect(String(url)).toBe("https://203.0.113.10/v1/models");
            expect((init as (RequestInit & { dispatcher?: unknown }) | undefined)?.dispatcher).toBeDefined();
        } finally {
            if (previousProxy === undefined) delete process.env.HTTPS_PROXY;
            else process.env.HTTPS_PROXY = previousProxy;
            vi.resetModules();
        }
    });
});
