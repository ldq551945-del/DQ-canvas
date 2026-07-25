import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    checkMediaProxyRateLimit: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user-one" })) }));
vi.mock("@/lib/server/security", () => ({
    checkMediaProxyRateLimit: mocks.checkMediaProxyRateLimit,
    isPublicIpAddress: vi.fn(() => true),
    rateLimitHeaders: vi.fn(() => ({ "Retry-After": "60" })),
}));

import { GET } from "./route";

describe("media proxy", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.checkMediaProxyRateLimit.mockResolvedValue({ allowed: true, remaining: 119, resetAt: Date.now() + 60_000 });
    });

    it("blocks requests before fetching when the rate limit is exhausted", async () => {
        mocks.checkMediaProxyRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });
        const fetchMock = vi.spyOn(globalThis, "fetch");

        const response = await GET(request());

        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("60");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects an upstream response with an oversized content length", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { headers: { "content-length": String(300 * 1024 * 1024 + 1) } }));

        const response = await GET(request());

        expect(response.status).toBe(413);
    });

    it("uses private caching for authenticated media", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("media", { headers: { "content-type": "image/png" } }));

        const response = await GET(request());

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, max-age=600");
    });
});

function request() {
    return new Request(`http://localhost/api/media-proxy?url=${encodeURIComponent("https://cdn.example.com/media.png")}`);
}
