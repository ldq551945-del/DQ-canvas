import { describe, expect, it } from "vitest";

import { generationRuntimeEnvironment, resolveGenerationWorkerOrigin } from "./generation-runtime.mjs";

describe("generation runtime environment", () => {
    it("uses one configured maintenance token for the app and worker", () => {
        const token = "a".repeat(32);
        const result = generationRuntimeEnvironment({ environment: { VOZEB_PRO_MAINTENANCE_TOKEN: token, PORT: "3100" } });

        expect(result).toMatchObject({ ephemeralToken: false, environment: { VOZEB_PRO_MAINTENANCE_TOKEN: token, VOZEB_PRO_WORKER_API_ORIGIN: "http://127.0.0.1:3100" } });
    });

    it("generates a process-local token only for development", () => {
        const result = generationRuntimeEnvironment({ environment: {}, allowEphemeralToken: true });

        expect(result.ephemeralToken).toBe(true);
        expect(result.environment.VOZEB_PRO_MAINTENANCE_TOKEN).toHaveLength(64);
    });

    it("fails production startup before the app can run without a valid token", () => {
        expect(() => generationRuntimeEnvironment({ environment: { VOZEB_PRO_MAINTENANCE_TOKEN: "short" } })).toThrow("at least 32 characters");
    });

    it("normalizes a Render private hostport to an HTTP origin", () => {
        expect(resolveGenerationWorkerOrigin({ environment: { VOZEB_PRO_WORKER_API_ORIGIN: "vozeb-pro:3000" } })).toBe("http://vozeb-pro:3000");
    });
});
