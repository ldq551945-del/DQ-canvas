import { describe, expect, it } from "vitest";

import createNextConfig from "../next.config";

describe("Next response headers", () => {
    it("prevents private pages and APIs from being indexed", async () => {
        const config = createNextConfig("phase-production-build");
        const rules = (await config.headers?.()) || [];
        const privateRule = rules.find((rule) => rule.source.includes(":section"));

        expect(privateRule?.source).toContain("api|admin|assets|billing|canvas|create");
        expect(privateRule?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" });
    });
});
