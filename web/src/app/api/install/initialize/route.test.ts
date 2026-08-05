import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    authorized: vi.fn(),
    configured: vi.fn(),
    initialize: vi.fn(),
}));

vi.mock("@/lib/server/maintenance-auth", () => ({
    isAuthorizedMaintenanceRequest: mocks.authorized,
    isMaintenanceTokenConfigured: mocks.configured,
}));
vi.mock("@/lib/server/install-status", () => ({
    InstallInitializationError: class InstallInitializationError extends Error {
        constructor(
            message: string,
            readonly status: number,
        ) {
            super(message);
        }
    },
    initializeInstallDatabase: mocks.initialize,
}));

import { POST } from "./route";

describe("POST /api/install/initialize", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.configured.mockReturnValue(true);
        mocks.authorized.mockReturnValue(true);
        mocks.initialize.mockResolvedValue({ firstAdminRequired: true });
    });

    it("rejects initialization when the maintenance token is not configured", async () => {
        mocks.configured.mockReturnValue(false);

        const response = await POST(new Request("http://localhost/api/install/initialize", { method: "POST" }));

        expect(response.status).toBe(503);
        expect(mocks.initialize).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated public initialization requests", async () => {
        mocks.authorized.mockReturnValue(false);

        const response = await POST(new Request("http://localhost/api/install/initialize", { method: "POST" }));

        expect(response.status).toBe(401);
        expect(mocks.initialize).not.toHaveBeenCalled();
    });

    it("initializes only after maintenance authentication", async () => {
        const request = new Request("http://localhost/api/install/initialize", { method: "POST", headers: { Authorization: "Bearer maintenance-token" } });

        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mocks.authorized).toHaveBeenCalledWith(request);
        expect(mocks.initialize).toHaveBeenCalledOnce();
    });
});
