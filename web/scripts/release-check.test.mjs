import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { prepareStandaloneAssets } from "./standalone-assets.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");

describe("low-memory release type-check contract", () => {
    it("runs strict type-check once before the standalone build", () => {
        const releaseCheck = readFileSync(path.join(webRoot, "scripts/release-check.mjs"), "utf8");
        const nextConfig = readFileSync(path.join(webRoot, "next.config.ts"), "utf8");
        const standaloneStart = readFileSync(path.join(webRoot, "scripts/start-standalone.mjs"), "utf8");
        const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");

        expect(releaseCheck.indexOf('["run", "typecheck"]')).toBeLessThan(releaseCheck.indexOf('["run", "build"]'));
        expect(releaseCheck).toContain('NEXT_SKIP_BUILD_TYPECHECK: "1"');
        expect(releaseCheck).toContain("prepareStandaloneAssets");
        expect(nextConfig).toContain("typescript: { ignoreBuildErrors: skipBuildTypeCheck }");
        expect(standaloneStart).toContain('process.env.NEXT_DIST_DIR?.trim() || ".next"');
        expect(standaloneStart).toContain("prepareStandaloneAssets");
        expect(dockerfile).toContain("pnpm run typecheck && NEXT_SKIP_BUILD_TYPECHECK=1 pnpm run build");
    });

    it("copies static and complete public assets into a custom standalone dist directory", async () => {
        const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "vozeb-standalone-"));
        try {
            const distDir = ".next-production";
            await Promise.all([
                mkdir(path.join(fixtureRoot, distDir, "standalone"), { recursive: true }),
                mkdir(path.join(fixtureRoot, distDir, "static", "chunks"), { recursive: true }),
                mkdir(path.join(fixtureRoot, "public", "icons"), { recursive: true }),
            ]);
            await Promise.all([
                writeFile(path.join(fixtureRoot, distDir, "standalone", "server.js"), "server"),
                writeFile(path.join(fixtureRoot, distDir, "static", "chunks", "app.js"), "chunk"),
                writeFile(path.join(fixtureRoot, "public", "logo.svg"), "logo"),
                writeFile(path.join(fixtureRoot, "public", "icon.svg"), "icon"),
                writeFile(path.join(fixtureRoot, "public", "icons", "icon-192.png"), "png"),
            ]);

            const result = await prepareStandaloneAssets({ webRoot: fixtureRoot, distDir });

            expect(result.staticFiles).toBe(1);
            expect(result.publicFiles).toBe(3);
            expect(existsSync(path.join(fixtureRoot, distDir, "standalone", distDir, "static", "chunks", "app.js"))).toBe(true);
            expect(existsSync(path.join(fixtureRoot, distDir, "standalone", "public", "logo.svg"))).toBe(true);
            expect(existsSync(path.join(fixtureRoot, distDir, "standalone", "public", "icons", "icon-192.png"))).toBe(true);
        } finally {
            await rm(fixtureRoot, { recursive: true, force: true });
        }
    });
});
