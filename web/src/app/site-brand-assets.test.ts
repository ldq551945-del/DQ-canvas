import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_SITE_SETTINGS } from "@/lib/auth/store";

describe("default DQ drawing brand assets", () => {
    it("uses the built-in DQ drawing mark for every default brand entry", () => {
        expect(DEFAULT_SITE_SETTINGS.logoUrl).toBe("/logo.svg");
        expect(DEFAULT_SITE_SETTINGS.iconUrl).toBe("/icon.svg");
    });

    it("keeps the web logo, browser icon and docs logo identical", async () => {
        const [logo, icon, docsLogo] = await Promise.all([readFile(resolve(process.cwd(), "public/logo.svg"), "utf8"), readFile(resolve(process.cwd(), "public/icon.svg"), "utf8"), readFile(resolve(process.cwd(), "../docs/public/logo.svg"), "utf8")]);

        expect(markupShapes(icon)).toEqual(markupShapes(logo));
        expect(markupShapes(docsLogo)).toEqual(markupShapes(logo));
        expect(logo).toContain("<title>DQ round logo</title>");
    });
});

function markupShapes(svg: string) {
    return [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((match) => match[1]);
}
