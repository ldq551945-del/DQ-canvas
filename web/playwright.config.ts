import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.DQ_E2E_PORT || 3100);
const baseURL = `http://127.0.0.1:${port}`;
const protocolFixturePort = Number(process.env.DQ_PROTOCOL_FIXTURE_PORT || 4010);
const paymentFixturePort = Number(process.env.DQ_PAYMENT_FIXTURE_PORT || 4020);
const databaseUrl = process.env.DQ_E2E_DATABASE_URL?.trim() || "";
const storageState = path.join(process.cwd(), ".e2e-data", "admin-state.json");
const e2eEncryptionKey = Buffer.alloc(32, 0x42).toString("hex");

export default defineConfig({
    testDir: "./e2e",
    outputDir: ".e2e-artifacts",
    fullyParallel: false,
    timeout: 120_000,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    // The suite intentionally shares one file-backed database and protocol fixture.
    // Running files in parallel makes logout and fixture resets leak across tests.
    workers: 1,
    reporter: process.env.CI ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
    use: {
        baseURL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
    projects: [
        { name: "setup", testMatch: /installation\.spec\.ts/ },
        { name: "chromium", testMatch: [/(?:auth|billing|core|gallery|responsive|rembg)\.spec\.ts/], dependencies: ["setup"], use: { ...devices["Desktop Chrome"], storageState } },
        { name: "mobile-390", testMatch: /responsive\.spec\.ts/, dependencies: ["setup"], use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 }, storageState } },
        { name: "mobile-430", testMatch: /responsive\.spec\.ts/, dependencies: ["setup"], use: { ...devices["iPhone 14 Pro Max"], browserName: "chromium", viewport: { width: 430, height: 932 }, storageState } },
    ],
    webServer: [
        {
            command: "node scripts/protocol-fixture-server.mjs",
            url: `http://127.0.0.1:${protocolFixturePort}/health`,
            timeout: 30_000,
            reuseExistingServer: !process.env.CI,
            env: { ...process.env, DQ_PROTOCOL_FIXTURE_PORT: String(protocolFixturePort) },
        },
        {
            command: "node scripts/payment-fixture-server.mjs",
            url: `http://127.0.0.1:${paymentFixturePort}/health`,
            timeout: 30_000,
            reuseExistingServer: !process.env.CI,
            env: { ...process.env, DQ_PAYMENT_FIXTURE_PORT: String(paymentFixturePort) },
        },
        {
            command: "pnpm run start",
            url: `${baseURL}/api/auth/session`,
            timeout: 120_000,
            // The app process owns an isolated data directory and database contract.
            // Reusing an older process can silently run tests against stale state or code.
            reuseExistingServer: false,
            env: {
                ...process.env,
                PORT: String(port),
                NEXT_PUBLIC_SITE_URL: baseURL,
                DQ_DATABASE_PROVIDER: databaseUrl ? "postgres" : "file",
                DQ_DATA_DIR: path.join(process.cwd(), ".e2e-data"),
                DQ_ENCRYPTION_KEY: e2eEncryptionKey,
                DQ_INSTALL_TOKEN: "dq-e2e-install-token-more-than-32-characters",
                DQ_MAINTENANCE_TOKEN: "dq-e2e-maintenance-token-more-than-32-characters",
                DQ_WORKER_TOKEN: "dq-e2e-worker-token-more-than-32-characters",
                DQ_ALLOW_PRIVATE_UPSTREAMS: "1",
                DQ_PRIVATE_UPSTREAM_HOSTS: "127.0.0.1",
                ...(process.env.DQ_E2E_REMBG_URL ? { DQ_REMBG_URL: process.env.DQ_E2E_REMBG_URL } : {}),
                ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
                DQ_PAYPLY_API_KEY: "dq-e2e-payply-production-key",
                DQ_PAYPLY_CHECKOUT_URL: `http://127.0.0.1:${paymentFixturePort}/payply/checkout`,
                DQ_PAYPLY_QUERY_URL: `http://127.0.0.1:${paymentFixturePort}/payply/query?orderId={{orderId}}&orderNo={{orderNo}}&tradeId={{providerTradeId}}&paymentId={{providerPaymentId}}`,
                DQ_PAYPLY_REFUND_URL: `http://127.0.0.1:${paymentFixturePort}/payply/refund`,
                DQ_PAYPLY_REFUND_QUERY_URL: `http://127.0.0.1:${paymentFixturePort}/payply/refund-query?refundId={{providerRefundId}}`,
                DQ_PAYPLY_WEBHOOK_SECRET: "dq-e2e-payply-webhook-secret-more-than-32-characters",
            },
        },
    ],
});
