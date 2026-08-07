import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    initialize: vi.fn(),
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
        mocks.initialize.mockResolvedValue({ firstAdminRequired: true });
    });

    it("passes the one-time install token to the explicit initializer", async () => {
        const request = new Request("http://localhost/api/install/initialize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ installToken: "install-token" }),
        });

        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mocks.initialize).toHaveBeenCalledWith("install-token");
    });

    it("does not accept a maintenance bearer token as an install token", async () => {
        const request = new Request("http://localhost/api/install/initialize", { method: "POST", headers: { Authorization: "Bearer maintenance-token" } });

        await POST(request);

        expect(mocks.initialize).toHaveBeenCalledWith(undefined);
    });
});
