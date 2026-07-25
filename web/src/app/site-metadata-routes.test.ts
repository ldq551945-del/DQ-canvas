import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getPublicSiteSettings: vi.fn(),
    siteMetadataBase: vi.fn(() => new URL("https://example.com")),
    absoluteSiteUrl: vi.fn((value: string, base = new URL("https://example.com")) => new URL(value, base).toString()),
    browserIconHref: vi.fn((site: { iconUrl?: string; logoUrl?: string }) => site.iconUrl || site.logoUrl || "/icon.svg"),
}));

vi.mock("@/lib/server/site-metadata", () => mocks);

import manifest from "./manifest";
import robots from "./robots";
import sitemap from "./sitemap";
import { GET as favicon } from "./favicon.ico/route";

describe("site metadata routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPublicSiteSettings.mockResolvedValue({ title: "自定义站点", iconUrl: "https://cdn.example.com/favicon.ico", seoDescription: "站点摘要" });
    });

    it("keeps private workspaces out of robots and points to the sitemap", () => {
        const result = robots();
        const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;

        expect(rules.disallow).toEqual(expect.arrayContaining(["/api/", "/admin", "/create", "/canvas", "/drama"]));
        expect(result.sitemap).toBe("https://example.com/sitemap.xml");
    });

    it("publishes only crawlable marketing and legal pages", () => {
        expect(sitemap().map((entry) => entry.url)).toEqual(["https://example.com/", "https://example.com/announcements", "https://example.com/terms", "https://example.com/privacy"]);
    });

    it("uses the backend browser icon in the web manifest", async () => {
        const result = await manifest();

        expect(result.name).toBe("自定义站点");
        expect(result.icons).toEqual([{ src: "https://cdn.example.com/favicon.ico", sizes: "any", purpose: "any" }]);
    });

    it("redirects the standard favicon route to the configured browser icon", async () => {
        const response = await favicon(new Request("http://localhost:3000/favicon.ico"));

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("https://cdn.example.com/favicon.ico");
        expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    });

    it("keeps a site-local icon relative to the current host", async () => {
        mocks.getPublicSiteSettings.mockResolvedValue({ title: "默认站点", iconUrl: "/icon.svg", logoUrl: "/logo.svg" });

        const response = await favicon(new Request("http://localhost:3000/favicon.ico"));

        expect(response.headers.get("location")).toBe("/icon.svg");
    });
});
