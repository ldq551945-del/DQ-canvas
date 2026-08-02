import { describe, expect, it } from "vitest";

import { DEFAULT_SITE_SETTINGS } from "./store-foundation";
import { normalizeSiteSettings } from "./store-normalizers";

describe("site settings", () => {
    it("uses the bundled browser icon when older settings have no icon URL", () => {
        expect(normalizeSiteSettings({ logoUrl: "/custom-logo.svg" }).iconUrl).toBe(DEFAULT_SITE_SETTINGS.iconUrl);
    });

    it("accepts a configured browser icon independently from the logo", () => {
        const settings = normalizeSiteSettings({ logoUrl: "/brand.svg", iconUrl: "https://cdn.example.com/favicon.ico" });

        expect(settings.logoUrl).toBe("/brand.svg");
        expect(settings.iconUrl).toBe("https://cdn.example.com/favicon.ico");
    });

    it("defaults public contacts to the DQ email and homepage link", () => {
        const settings = normalizeSiteSettings({});

        expect(settings.socials.email).toMatchObject({ enabled: true, url: "mailto:3275573660@qq.com" });
        expect(settings.socials.telegram).toMatchObject({ enabled: false, url: "" });
        expect(settings.socials.x).toMatchObject({ enabled: false, url: "" });
        expect(settings.socials.instagram).toMatchObject({ enabled: false, url: "" });
        expect(settings.friendLinks).toEqual([{ id: "dq-home", label: "DQ-绘图", url: "https://store.dqin-666zj.top/", enabled: true }]);
    });

    it("keeps an explicitly empty friend-link list empty", () => {
        expect(normalizeSiteSettings({ friendLinks: [] }).friendLinks).toEqual([]);
    });

    it("does not restore a removed default link beside custom links", () => {
        const friendLinks = [{ id: "custom", label: "自定义", url: "https://example.com/", enabled: true }];

        expect(normalizeSiteSettings({ friendLinks }).friendLinks).toEqual(friendLinks);
    });

    it("removes legacy built-in links while preserving the configured homepage and custom links", () => {
        expect(
            normalizeSiteSettings({
                friendLinks: [
                    { id: "dq-home", label: "DQ-绘图", url: "https://store.dqin-666zj.top/", enabled: true },
                    { id: "qq-dq-open-source", label: "DQ 开源交流 社区", url: "https://store.dqin-666zj.top/community", enabled: true },
                    { id: "linux-do", label: "Linux.do", url: "https://linux.do/", enabled: true },
                    { id: "custom-linux", label: "自定义 Linux.do", url: "https://linux.do/", enabled: true },
                    { id: "custom", label: "自定义", url: "https://example.com/", enabled: true },
                ],
            }).friendLinks,
        ).toEqual([
            { id: "dq-home", label: "DQ-绘图", url: "https://store.dqin-666zj.top/", enabled: true },
            { id: "custom-linux", label: "自定义 Linux.do", url: "https://linux.do/", enabled: true },
            { id: "custom", label: "自定义", url: "https://example.com/", enabled: true },
        ]);
    });
});
