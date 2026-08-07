import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { parseDeploymentSmokeArgs, runDeploymentSmoke, validatePublicSessionPayload, validateReadinessPayload } from "./deployment-smoke.mjs";

const requestId = "019fd360-bb4b-7640-8dbc-e6e23fcb5416";
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
let server;

afterEach(async () => {
    if (!server?.listening) return;
    server.close();
    await once(server, "close");
});

describe("deployment smoke", () => {
    it("checks deployment health, worker heartbeat, session allowlist, assets and public pages", async () => {
        server = createFixtureServer();
        const baseUrl = await listen(server);

        const report = await runDeploymentSmoke({ baseUrl, timeoutMs: 2_000 });

        expect(report.results).toHaveLength(10);
        expect(report.results.map((item) => item.path)).toEqual(["/api/health/live", "/api/health/ready", "/api/auth/session", "/logo.svg", "/icon.svg", "/favicon.ico", "/", "/login", "/register", "/gallery"]);
    });

    it("rejects an unhealthy generation worker", () => {
        expect(() => validateReadinessPayload(readyPayload({ required: true, healthy: false }))).toThrow("Generation worker heartbeat is unhealthy");
    });

    it("rejects internal channel configuration in the public session", () => {
        const payload = sessionPayload();
        payload.settings.systemChannels[0].advancedConfig = { authHeader: "X-Secret" };

        expect(() => validatePublicSessionPayload(payload)).toThrow("exposes internal configuration");
    });

    it("rejects upstream addresses and non-sentinel API keys in the public session", () => {
        const upstream = sessionPayload();
        upstream.settings.systemChannels[0].baseUrl = "https://provider.example/v1";
        expect(() => validatePublicSessionPayload(upstream)).toThrow("exposes an upstream address");

        const key = sessionPayload();
        key.settings.systemChannels[0].apiKey = "provider-secret";
        expect(() => validatePublicSessionPayload(key)).toThrow("is not the public sentinel");
    });

    it("parses repeatable page checks and rejects credentials in the deployment URL", () => {
        expect(parseDeploymentSmokeArgs(["--", "--base-url", "https://example.com/", "--timeout-ms", "2500", "--path", "/pricing", "--path", "/pricing"], {})).toMatchObject({
            baseUrl: "https://example.com",
            timeoutMs: 2500,
            pagePaths: ["/", "/login", "/register", "/gallery", "/pricing"],
        });
        expect(() => parseDeploymentSmokeArgs(["--base-url", "https://user:password@example.com"], {})).toThrow("must not contain credentials");
    });

    it("keeps the package command and production documentation wired to the smoke script", () => {
        const packageJson = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8"));
        const productionReadiness = readFileSync(path.join(repoRoot, "docs/content/docs/overview/production-readiness.mdx"), "utf8");

        expect(packageJson.scripts["smoke:deployment"]).toBe("node scripts/deployment-smoke.mjs");
        expect(productionReadiness).toContain("pnpm smoke:deployment -- --base-url");
        expect(productionReadiness).toContain("公开 Session 字段白名单");
    });
});

function createFixtureServer() {
    return createServer((request, response) => {
        const path = new URL(request.url || "/", "http://fixture.local").pathname;
        if (path.startsWith("/api/")) response.setHeader("x-request-id", requestId);
        if (path === "/api/health/live") return json(response, { code: 0, data: { status: "live" }, msg: "OK" });
        if (path === "/api/health/ready") return json(response, readyPayload());
        if (path === "/api/auth/session") return json(response, sessionPayload());
        if (path === "/favicon.ico") {
            response.statusCode = 307;
            response.setHeader("location", "/icon.svg");
            return response.end();
        }
        if (path === "/logo.svg" || path === "/icon.svg") {
            response.setHeader("content-type", "image/svg+xml");
            return response.end('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        }
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end("<!doctype html><title>DQ</title>");
    });
}

function readyPayload(worker = { required: true, healthy: true, lastHeartbeatAt: "2026-08-07T12:00:00.000Z" }) {
    return {
        code: 0,
        data: {
            ready: true,
            provider: "postgres",
            database: { healthy: true, schemaReady: true },
            encryptionReady: true,
            firstAdminRequired: false,
            generationWorker: worker,
        },
        msg: "OK",
    };
}

function sessionPayload() {
    return {
        user: null,
        settings: {
            site: { title: "DQ" },
            systemChannels: [{ id: "channel-one", name: "Channel", baseUrl: "/api/ai/system/channel-one", apiKey: "system", apiFormat: "openai", models: ["model-one"], enabled: true, hasApiKey: true }],
        },
        install: { ready: true, database: { healthy: true, schemaReady: true } },
    };
}

function json(response, payload) {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(payload));
}

async function listen(target) {
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const address = target.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not expose a TCP port");
    return `http://127.0.0.1:${address.port}`;
}
