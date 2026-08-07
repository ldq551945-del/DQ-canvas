import { afterEach, describe, expect, it, vi } from "vitest";

import { assertInstallToken, getInstallTokenStatus, InstallTokenError, verifyInstallToken } from "./install-token";

const TOKEN = "install-token-".padEnd(48, "x");

describe("one-time install token", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it.each([undefined, "short"])('reports server token "%s" as not ready', (value) => {
        if (value === undefined) delete process.env.DQ_INSTALL_TOKEN;
        else vi.stubEnv("DQ_INSTALL_TOKEN", value);

        expect(getInstallTokenStatus()).toMatchObject({ ready: false });
        expect(() => assertInstallToken(TOKEN)).toThrowError(expect.objectContaining<Partial<InstallTokenError>>({ status: 503 }));
    });

    it("accepts only the exact configured token", () => {
        vi.stubEnv("DQ_INSTALL_TOKEN", TOKEN);

        expect(getInstallTokenStatus()).toMatchObject({ ready: true });
        expect(verifyInstallToken("wrong-token".padEnd(48, "x"))).toBe(false);
        expect(verifyInstallToken(TOKEN)).toBe(true);
        expect(() => assertInstallToken(TOKEN)).not.toThrow();
    });

    it("does not expose the configured token in status text", () => {
        vi.stubEnv("DQ_INSTALL_TOKEN", TOKEN);

        expect(JSON.stringify(getInstallTokenStatus())).not.toContain(TOKEN);
    });
});
