import { describe, expect, it } from "vitest";

import { generationRuntimeEnvironment, resolveGenerationWorkerOrigin } from "./generation-runtime.mjs";

const token = "a".repeat(32);

describe("generation runtime environment", () => {
    it("uses distinct configured tokens while isolating the Worker environment", () => {
        const workerToken = "worker-token-at-least-thirty-two-characters";
        const result = generationRuntimeEnvironment({ environment: { DQ_MAINTENANCE_TOKEN: token, DQ_WORKER_TOKEN: workerToken, DQ_ENCRYPTION_KEY: "secret", DATABASE_URL: "postgres://secret", PORT: "3100" } });

        expect(result).toMatchObject({
            ephemeralToken: false,
            appEnvironment: { DQ_MAINTENANCE_TOKEN: token, DQ_ENCRYPTION_KEY: "secret", DATABASE_URL: "postgres://secret" },
            workerEnvironment: { DQ_WORKER_TOKEN: workerToken, DQ_WORKER_API_ORIGIN: "http://127.0.0.1:3100" },
        });
        expect(result.workerEnvironment).not.toHaveProperty("DQ_ENCRYPTION_KEY");
        expect(result.workerEnvironment).not.toHaveProperty("DATABASE_URL");
        expect(result.workerEnvironment).not.toHaveProperty("PORT");
    });

    it("generates a process-local token only for development", () => {
        const result = generationRuntimeEnvironment({ environment: {}, allowEphemeralToken: true });

        expect(result.ephemeralToken).toBe(true);
        expect(result.appEnvironment.DQ_MAINTENANCE_TOKEN).toHaveLength(64);
        expect(result.workerEnvironment.DQ_WORKER_TOKEN).toBe(result.appEnvironment.DQ_WORKER_TOKEN);
        expect(result.workerEnvironment).not.toHaveProperty("DQ_MAINTENANCE_TOKEN");
    });

    it("fails production startup before the app can run without a valid token", () => {
        expect(() => generationRuntimeEnvironment({ environment: { DQ_MAINTENANCE_TOKEN: token, DQ_WORKER_TOKEN: "short" } })).toThrow("DQ_WORKER_TOKEN must contain at least 32 characters");
    });

    it("rejects shared maintenance and Worker credentials", () => {
        expect(() => generationRuntimeEnvironment({ environment: { DQ_MAINTENANCE_TOKEN: token, DQ_WORKER_TOKEN: token } })).toThrow("different from DQ_MAINTENANCE_TOKEN");
    });

    it("normalizes a Render private hostport to an HTTP origin", () => {
        expect(resolveGenerationWorkerOrigin({ environment: { DQ_WORKER_API_ORIGIN: "dq:3000" } })).toBe("http://dq:3000");
    });
});
