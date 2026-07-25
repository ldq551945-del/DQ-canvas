import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getInstallStatus: vi.fn() }));

vi.mock("@/lib/server/install-status", () => ({ getInstallStatus: mocks.getInstallStatus }));

import { GET } from "./route";

describe("readiness route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 200 only when the runtime is fully initialized", async () => {
        mocks.getInstallStatus.mockResolvedValue({
            ready: true,
            provider: "postgres",
            firstAdminRequired: false,
            database: { healthy: true, schemaReady: true },
            security: { encryptionReady: true },
        });

        const response = await GET();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ code: 0, data: { ready: true, database: { healthy: true, schemaReady: true } } });
    });

    it("returns 503 while installation or a dependency is unavailable", async () => {
        mocks.getInstallStatus.mockResolvedValue({
            ready: false,
            provider: "postgres",
            firstAdminRequired: true,
            database: { healthy: true, schemaReady: true },
            security: { encryptionReady: true },
        });

        const response = await GET();

        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        await expect(response.json()).resolves.toMatchObject({ code: 503, data: { ready: false, firstAdminRequired: true } });
    });
});
