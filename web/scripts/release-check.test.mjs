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
        const productionBuild = readFileSync(path.join(webRoot, "scripts/production-build.mjs"), "utf8");
        const packageJson = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8"));
        const nextConfig = readFileSync(path.join(webRoot, "next.config.ts"), "utf8");
        const standaloneStart = readFileSync(path.join(webRoot, "scripts/start-standalone.mjs"), "utf8");
        const dockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");

        expect(releaseCheck.indexOf('["run", "typecheck"]')).toBeLessThan(releaseCheck.indexOf('["run", "build"]'));
        expect(releaseCheck).toContain('NEXT_SKIP_BUILD_TYPECHECK: "1"');
        expect(packageJson.scripts.build).toBe("node scripts/production-build.mjs");
        expect(productionBuild.indexOf("node_modules/typescript/bin/tsc")).toBeLessThan(productionBuild.indexOf("node_modules/next/dist/bin/next"));
        expect(productionBuild).toContain('NEXT_SKIP_BUILD_TYPECHECK: "1"');
        expect(releaseCheck).toContain("prepareStandaloneAssets");
        expect(releaseCheck).toContain("validateStandaloneSharpRuntime");
        expect(releaseCheck).toContain("validateContainerReleaseContracts");
        expect(nextConfig).toContain("typescript: { ignoreBuildErrors: skipBuildTypeCheck }");
        expect(standaloneStart).toContain('process.env.NEXT_DIST_DIR?.trim() || ".next"');
        expect(standaloneStart).toContain("prepareStandaloneAssets");
        expect(dockerfile).toContain("pnpm run typecheck && NEXT_SKIP_BUILD_TYPECHECK=1 pnpm run build");
        expect(dockerfile).toContain("COPY web/scripts/http-observability.mjs /app/web/scripts/http-observability.mjs");
        expect(dockerfile).toContain('CMD ["node", "--import", "file:///app/web/scripts/http-observability.mjs", "server.js"]');
    });

    it("copies static and complete public assets into a custom standalone dist directory", async () => {
        const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "dq-standalone-"));
        try {
            const distDir = ".next-production";
            await Promise.all([
                mkdir(path.join(fixtureRoot, distDir, "standalone"), { recursive: true }),
                mkdir(path.join(fixtureRoot, distDir, "static", "chunks"), { recursive: true }),
                mkdir(path.join(fixtureRoot, "public", "icons"), { recursive: true }),
                mkdir(path.join(fixtureRoot, "node_modules", ".pnpm", "@img+sharp-test@0.0.0", "node_modules", "@img", "sharp-test"), { recursive: true }),
            ]);
            await Promise.all([
                writeFile(path.join(fixtureRoot, distDir, "standalone", "server.js"), "server"),
                writeFile(path.join(fixtureRoot, distDir, "static", "chunks", "app.js"), "chunk"),
                writeFile(path.join(fixtureRoot, "public", "logo.svg"), "logo"),
                writeFile(path.join(fixtureRoot, "public", "icon.svg"), "icon"),
                writeFile(path.join(fixtureRoot, "public", "icons", "icon-192.png"), "png"),
                writeFile(path.join(fixtureRoot, "node_modules", ".pnpm", "@img+sharp-test@0.0.0", "node_modules", "@img", "sharp-test", "fixture.node"), "native"),
            ]);

            const result = await prepareStandaloneAssets({ webRoot: fixtureRoot, distDir });

            expect(result.staticFiles).toBe(1);
            expect(result.publicFiles).toBe(3);
            expect(result.sharpPackages).toEqual(["@img+sharp-test@0.0.0"]);
            expect(existsSync(path.join(fixtureRoot, distDir, "standalone", distDir, "static", "chunks", "app.js"))).toBe(true);
            expect(existsSync(path.join(fixtureRoot, distDir, "standalone", "public", "logo.svg"))).toBe(true);
            expect(existsSync(path.join(fixtureRoot, distDir, "standalone", "public", "icons", "icon-192.png"))).toBe(true);
            expect(existsSync(path.join(fixtureRoot, distDir, "standalone", "node_modules", ".pnpm", "@img+sharp-test@0.0.0", "node_modules", "@img", "sharp-test", "fixture.node"))).toBe(true);
        } finally {
            await rm(fixtureRoot, { recursive: true, force: true });
        }
    });
});
