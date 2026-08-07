import { afterEach, describe, expect, it } from "vitest";

import { getTrustedForwardedHeader, getTrustedForwardedProtocol, getTrustedProxyHops } from "./trusted-proxy";

afterEach(() => {
    delete process.env.DQ_TRUSTED_PROXY_HOPS;
});

describe("trusted proxy headers", () => {
    it("ignores forwarded headers when no proxy is trusted", () => {
        const headers = new Headers({ "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" });

        expect(getTrustedProxyHops()).toBe(0);
        expect(getTrustedForwardedHeader(headers, "x-forwarded-host")).toBe("");
        expect(getTrustedForwardedHeader(headers, "x-forwarded-proto")).toBe("");
    });

    it("uses the value appended by the nearest trusted proxy", () => {
        process.env.DQ_TRUSTED_PROXY_HOPS = "1";
        const headers = new Headers({ "x-forwarded-host": "attacker.example, public.example", "x-forwarded-proto": "http, https" });

        expect(getTrustedForwardedHeader(headers, "x-forwarded-host")).toBe("public.example");
        expect(getTrustedForwardedHeader(headers, "x-forwarded-proto")).toBe("https");
    });

    it("uses the public-facing value at the configured trusted proxy boundary", () => {
        process.env.DQ_TRUSTED_PROXY_HOPS = "2";
        const headers = new Headers({ "x-forwarded-host": "attacker.example, public.example, internal.example", "x-forwarded-proto": "ftp, https, http" });

        expect(getTrustedForwardedHeader(headers, "x-forwarded-host")).toBe("public.example");
        expect(getTrustedForwardedHeader(headers, "x-forwarded-proto")).toBe("https");
    });

    it("rejects incomplete forwarded header chains", () => {
        process.env.DQ_TRUSTED_PROXY_HOPS = "2";
        const headers = new Headers({ "x-forwarded-host": "public.example", "x-forwarded-proto": "https" });

        expect(getTrustedForwardedHeader(headers, "x-forwarded-host")).toBe("");
        expect(getTrustedForwardedHeader(headers, "x-forwarded-proto")).toBe("");
    });

    it("rejects invalid hop counts and caps excessive values", () => {
        process.env.DQ_TRUSTED_PROXY_HOPS = "invalid";
        expect(getTrustedProxyHops()).toBe(0);
        process.env.DQ_TRUSTED_PROXY_HOPS = "99";
        expect(getTrustedProxyHops()).toBe(10);
    });

    it("uses only the nearest standard Forwarded entry", () => {
        process.env.DQ_TRUSTED_PROXY_HOPS = "1";
        const headers = new Headers({ forwarded: 'for=198.51.100.10;proto=https, for=192.0.2.10;proto="http"' });

        expect(getTrustedForwardedProtocol(headers)).toBe("http");
    });

    it("uses the standard Forwarded entry at the trusted proxy boundary", () => {
        process.env.DQ_TRUSTED_PROXY_HOPS = "2";
        const headers = new Headers({ forwarded: 'for=203.0.113.20;proto="https", for=192.0.2.10;proto=http' });

        expect(getTrustedForwardedProtocol(headers)).toBe("https");
    });
});
