import type { MetadataRoute } from "next";

import { absoluteSiteUrl, siteMetadataBase } from "@/lib/server/site-metadata";

export default function robots(): MetadataRoute.Robots {
    const base = siteMetadataBase();
    return {
        rules: {
            userAgent: "*",
            allow: ["/", "/terms", "/privacy"],
            disallow: ["/api/", "/admin", "/assets", "/billing", "/canvas", "/create", "/drama", "/image", "/install", "/login", "/my-prompts", "/profile", "/prompts", "/register", "/video"],
        },
        sitemap: absoluteSiteUrl("/sitemap.xml", base),
    };
}
