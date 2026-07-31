import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { parseChangelog } from "@/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const buildCpus = Math.max(1, Number.parseInt(process.env.NEXT_BUILD_CPUS || "1", 10) || 1);
const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
const skipBuildTypeCheck = process.env.NEXT_SKIP_BUILD_TYPECHECK === "1";
const nodeProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
const privatePageSource = "/:section(api|admin|assets|billing|canvas|community|create|drama|forgot-password|help|image|install|login|my-prompts|profile|prompts|register|video|works)/:path*";
if (nodeProxy) setGlobalDispatcher(new ProxyAgent(nodeProxy));

export default function nextConfig(phase: string): NextConfig {
    const isDev = phase === PHASE_DEVELOPMENT_SERVER;
    const isProduction = process.env.NODE_ENV === "production";
    const releases = parseChangelog(localChangelog);
    const contentSecurityPolicy = [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        "font-src 'self' data: https:",
        "connect-src 'self' http: https:",
        "worker-src 'self' blob:",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join("; ");

    return {
        distDir,
        output: "standalone",
        typescript: { ignoreBuildErrors: skipBuildTypeCheck },
        allowedDevOrigins: isDev ? ["*.*.*.*"] : [],
        env: {
            NEXT_PUBLIC_APP_VERSION: localVersion,
            NEXT_PUBLIC_APP_RELEASES: JSON.stringify(releases),
        },
        experimental: {
            cpus: buildCpus,
            proxyClientMaxBodySize: "32mb",
            workerThreads: false,
        },
        async rewrites() {
            return {
                beforeFiles: [{ source: "/favicon.ico", destination: "/api/site-icon" }],
                afterFiles: [],
                fallback: [],
            };
        },
        async headers() {
            return [
                {
                    source: "/(.*)",
                    headers: [
                        { key: "Content-Security-Policy", value: contentSecurityPolicy },
                        { key: "X-Content-Type-Options", value: "nosniff" },
                        { key: "X-Frame-Options", value: "DENY" },
                        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
                        ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
                    ],
                },
                {
                    source: privatePageSource,
                    headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" }],
                },
            ];
        },
    };
}
