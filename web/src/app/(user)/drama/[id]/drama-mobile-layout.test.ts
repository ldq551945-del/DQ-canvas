import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("drama mobile list layout", () => {
    it("does not enable cached content sizing before the responsive breakpoint", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/drama/[id]/page.tsx"), "utf8");

        expect(source).not.toMatch(/(?:^|[\s"])(?<!sm:)\[content-visibility:auto\]/m);
        expect(source).toContain("[content-visibility:visible]");
        expect(source).toContain("sm:[content-visibility:auto]");
    });
});
