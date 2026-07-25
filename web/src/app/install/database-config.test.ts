import { describe, expect, it } from "vitest";

import { buildDeploymentSnippets, generateEncryptionKey } from "./database-config";

const baseConfig = {
    mode: "baota" as const,
    host: "127.0.0.1",
    port: "5432",
    database: "vozeb_pro",
    username: "vozeb_pro",
    password: "safe password",
    ssl: false,
    encryptionKey: "ab".repeat(32),
};

describe("database deployment config", () => {
    it("generates an exact 32-byte hexadecimal encryption key", () => {
        expect(generateEncryptionKey()).toMatch(/^[a-f0-9]{64}$/);
    });

    it("uses host networking without a bundled PostgreSQL service in Baota mode", () => {
        const snippets = buildDeploymentSnippets(baseConfig);

        expect(snippets.envText).toContain("@127.0.0.1:5432/vozeb_pro");
        expect(snippets.composeText).toContain("network_mode: host");
        expect(snippets.composeText).not.toContain("postgres:\n");
        expect(snippets.composeText).not.toContain("ports:");
        expect(snippets.composeText).toContain(`VOZEB_PRO_ENCRYPTION_KEY: "${baseConfig.encryptionKey}"`);
        expect(snippets.envText).toContain("VOZEB_PRO_TRUSTED_PROXY_HOPS=1");
        expect(snippets.composeText).toContain('VOZEB_PRO_TRUSTED_PROXY_HOPS: "1"');
    });

    it.each([
        { mode: "local" as const, host: "localhost", ssl: false },
        { mode: "docker" as const, host: "postgres", ssl: false },
        { mode: "cloud" as const, host: "db.example.com", ssl: true },
    ])("does not inject Baota proxy defaults into $mode mode", ({ mode, host, ssl }) => {
        const snippets = buildDeploymentSnippets({ ...baseConfig, mode, host, ssl });

        expect(snippets.envText).not.toContain("VOZEB_PRO_TRUSTED_PROXY_HOPS");
        expect(snippets.composeText).not.toContain("VOZEB_PRO_TRUSTED_PROXY_HOPS");
    });
});
