import { afterEach, describe, expect, it } from "vitest";

import { requestPublicOrigin, requestPublicOriginFromHeaders } from "./request-origin";

afterEach(() => {
    delete process.env.DQ_TRUSTED_PROXY_HOPS;
});

describe("request public origin", () => {
    it("ignores spoofed forwarded origin headers by default", () => {
        const request = new Request("http://internal:3000/api/test", { headers: { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" } });

        expect(requestPublicOrigin(request, "")).toBe("http://internal:3000");
    });

    it("uses the nearest configured reverse proxy values", () => {
        process.env.DQ_TRUSTED_PROXY_HOPS = "1";
        const request = new Request("http://internal:3000/api/test", { headers: { "x-forwarded-host": "attacker.example, public.example", "x-forwarded-proto": "http, https" } });

        expect(requestPublicOrigin(request, "")).toBe("https://public.example");
    });

    it("prefers the configured canonical site origin", () => {
        const request = new Request("http://internal:3000/api/test", { headers: { "x-forwarded-host": "attacker.example" } });

        expect(requestPublicOrigin(request, "https://dq.example/app")).toBe("https://dq.example");
    });

    it("gates forwarded values when only request headers are available", () => {
        const headers = new Headers({ host: "admin.example", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http" });
        expect(requestPublicOriginFromHeaders(headers, "http://localhost:3000", "")).toBe("https://admin.example");

        process.env.DQ_TRUSTED_PROXY_HOPS = "1";
        expect(requestPublicOriginFromHeaders(headers, "http://localhost:3000", "")).toBe("http://attacker.example");
    });
});
