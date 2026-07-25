import type { MetadataRoute } from "next";

import { absoluteSiteUrl, siteMetadataBase } from "@/lib/server/site-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
    const base = siteMetadataBase();
    return ["/", "/announcements", "/terms", "/privacy"].map((path) => ({
        url: absoluteSiteUrl(path, base),
        changeFrequency: path === "/" ? "daily" : path === "/announcements" ? "weekly" : "yearly",
        priority: path === "/" ? 1 : path === "/announcements" ? 0.6 : 0.3,
    }));
}
