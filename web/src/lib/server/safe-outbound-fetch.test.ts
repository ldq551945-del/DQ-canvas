import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    fetch: vi.fn(),
    resolve: vi.fn(),
    proxyUrl: vi.fn(() => ""),
}));

vi.mock("undici", async (importOriginal) => {
    const actual = await importOriginal<typeof import("undici")>();
    return { ...actual, fetch: mocks.fetch };
});
vi.mock("@/lib/server/outbound-url-security", () => ({
    resolveSafeOutboundTarget: mocks.resolve,
    isPublicIpAddress: (address: string) => !address.startsWith("10.") && !address.startsWith("172.") && !address.startsWith("192.168.") && address !== "127.0.0.1",
}));
vi.mock("@/lib/server/proxy-dispatcher", () => ({ getOutboundProxyUrl: mocks.proxyUrl }));

import { fetchSafeOutboundUrl, UnsafeOutboundUrlError } from "./safe-outbound-fetch";

describe("safe outbound fetch", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.proxyUrl.mockReturnValue("");
    });

    it("connects with an address-pinned dispatcher while preserving the original URL", async () => {
        mocks.resolve.mockResolvedValue(target("https://provider.example:8443/v1/models?cursor=one"));
        mocks.fetch.mockResolvedValue(Response.json({ ok: true }));

        await fetchSafeOutboundUrl("https://provider.example:8443/v1/models?cursor=one", { headers: { accept: "application/json" } });

        const [requestUrl, init] = mocks.fetch.mock.calls[0];
        expect(String(requestUrl)).toBe("https://provider.example:8443/v1/models?cursor=one");
        expect(new Headers(init.headers).get("host")).toBeNull();
        expect(init.dispatcher).toBeTruthy();
    });

    it("rejects an unsafe redirect before opening the next connection", async () => {
        mocks.resolve.mockResolvedValueOnce(target("https://provider.example/result")).mockResolvedValueOnce(null);
        mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));

        await expect(fetchSafeOutboundUrl("https://provider.example/result")).rejects.toBeInstanceOf(UnsafeOutboundUrlError);
        expect(mocks.fetch).toHaveBeenCalledOnce();
    });

    it("strips credentials when following a cross-origin redirect", async () => {
        mocks.resolve.mockImplementation(async (value: string | URL) => target(String(value)));
        mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.example/result.png" } })).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));

        await fetchSafeOutboundUrl("https://provider.example/result", {
            headers: { authorization: "Bearer secret", "x-api-key": "secret", accept: "image/*", range: "bytes=0-1023" },
        });

        const redirectedHeaders = new Headers(mocks.fetch.mock.calls[1][1].headers);
        expect(redirectedHeaders.get("authorization")).toBeNull();
        expect(redirectedHeaders.get("x-api-key")).toBeNull();
        expect(redirectedHeaders.get("accept")).toBe("image/*");
        expect(redirectedHeaders.get("range")).toBe("bytes=0-1023");
    });

    it("keeps manual redirects under caller control", async () => {
        const redirect = new Response(null, { status: 307, headers: { location: "https://cdn.example/result" } });
        mocks.resolve.mockResolvedValue(target("https://provider.example/result"));
        mocks.fetch.mockResolvedValue(redirect);

        await expect(fetchSafeOutboundUrl("https://provider.example/result", { redirect: "manual" })).resolves.toBe(redirect);
        expect(mocks.fetch).toHaveBeenCalledOnce();
    });

    it("bypasses the public proxy for an explicitly allowed private target", async () => {
        mocks.proxyUrl.mockReturnValue("http://proxy.example:8080");
        mocks.resolve.mockResolvedValue({ ...target("http://rembg:7000/v1/remove"), address: "172.20.0.5" });
        mocks.fetch.mockResolvedValue(Response.json({ ok: true }));

        await fetchSafeOutboundUrl("http://rembg:7000/v1/remove", {}, { privateHostnames: ["rembg"] });

        expect(String(mocks.fetch.mock.calls[0][0])).toBe("http://rembg:7000/v1/remove");
        expect(new Headers(mocks.fetch.mock.calls[0][1].headers).get("host")).toBeNull();
    });
});

function target(value: string) {
    const url = new URL(value);
    return { url, hostname: url.hostname, address: "8.8.8.8", family: 4 as const };
}
