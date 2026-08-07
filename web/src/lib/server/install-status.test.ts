import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const INSTALL_TOKEN = "install-token-".padEnd(48, "x");

const mocks = vi.hoisted(() => ({
    provider: "postgres" as "file" | "postgres",
    connectionString: "postgres://dq:test@localhost:5432/dq",
    ensurePostgresSchema: vi.fn(),
    initializePostgresSchema: vi.fn(),
    postgresQuery: vi.fn(),
    getPublicUserSummary: vi.fn(),
    encryption: { ready: true, message: "加密密钥已就绪。" },
}));

vi.mock("@/lib/auth/store", () => ({
    DEFAULT_SITE_SETTINGS: { title: "DQ-绘图", logoUrl: "/logo.svg" },
    getPublicUserSummary: mocks.getPublicUserSummary,
}));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: mocks.ensurePostgresSchema,
    initializePostgresSchema: mocks.initializePostgresSchema,
    getDatabaseProvider: () => mocks.provider,
    getPostgresConnectionString: () => mocks.connectionString,
    postgresQuery: mocks.postgresQuery,
}));

vi.mock("@/lib/server/secret-crypto", () => ({
    getEncryptionKeyStatus: () => mocks.encryption,
}));

import { getInstallStatus, initializeInstallDatabase, invalidateInstallStatusCache } from "./install-status";

describe("install status cache", () => {
    beforeEach(() => {
        invalidateInstallStatusCache();
        mocks.provider = "postgres";
        mocks.connectionString = "postgres://dq:test@localhost:5432/dq";
        mocks.ensurePostgresSchema.mockReset().mockResolvedValue(undefined);
        mocks.initializePostgresSchema.mockReset().mockResolvedValue(undefined);
        mocks.postgresQuery.mockReset();
        mocks.getPublicUserSummary.mockReset();
        mocks.encryption = { ready: true, message: "加密密钥已就绪。" };
        vi.stubEnv("DQ_INSTALL_TOKEN", INSTALL_TOKEN);
    });

    afterEach(() => vi.unstubAllEnvs());

    it("reuses a completed healthy installation check", async () => {
        mockHealthySchema(["3"]);

        const first = await getInstallStatus();
        const second = await getInstallStatus();

        expect(first.ready).toBe(true);
        expect(second).toBe(first);
        expect(mocks.postgresQuery).toHaveBeenCalledTimes(3);
        expect(mocks.ensurePostgresSchema).not.toHaveBeenCalled();
        expect(mocks.postgresQuery.mock.calls.map(([statement]) => String(statement))).toEqual(["SELECT 1", expect.stringContaining("to_regclass"), expect.stringContaining("count(*)")]);
    });

    it("does not retain the first-admin-required result", async () => {
        mockHealthySchema(["0", "1"]);

        expect((await getInstallStatus()).firstAdminRequired).toBe(true);
        expect((await getInstallStatus()).ready).toBe(true);
        expect(mocks.postgresQuery).toHaveBeenCalledTimes(6);
    });

    it("coalesces concurrent installation checks", async () => {
        let resolveConnection: ((value: { rows: Array<Record<string, unknown>> }) => void) | undefined;
        const connection = new Promise<{ rows: Array<Record<string, unknown>> }>((resolve) => {
            resolveConnection = resolve;
        });
        mocks.postgresQuery.mockImplementation(async (statement: string) => {
            if (statement === "SELECT 1") return connection;
            if (statement.includes("to_regclass")) return { rows: [{ table_name: "users" }] };
            return { rows: [{ total: "2" }] };
        });

        const first = getInstallStatus();
        const second = getInstallStatus();
        resolveConnection?.({ rows: [{ connected: 1 }] });

        await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ ready: true }), expect.objectContaining({ ready: true })]);
        expect(mocks.postgresQuery).toHaveBeenCalledTimes(3);
    });

    it("runs schema DDL only through the explicit initializer", async () => {
        mockHealthySchema(["0"]);

        await expect(initializeInstallDatabase(INSTALL_TOKEN)).resolves.toMatchObject({ firstAdminRequired: true, database: { schemaReady: true } });

        expect(mocks.initializePostgresSchema).toHaveBeenCalledTimes(1);
        expect(mocks.ensurePostgresSchema).not.toHaveBeenCalled();
    });

    it("keeps an installed site ready after the one-time token is removed", async () => {
        delete process.env.DQ_INSTALL_TOKEN;
        mockHealthySchema(["1"]);

        await expect(getInstallStatus()).resolves.toMatchObject({ ready: true, firstAdminRequired: false, security: { installTokenReady: false } });
    });
});

function mockHealthySchema(userCounts: string[]) {
    mocks.postgresQuery.mockImplementation(async (statement: string) => {
        if (statement === "SELECT 1") return { rows: [{ connected: 1 }] };
        if (statement.includes("to_regclass")) return { rows: [{ table_name: "users" }] };
        return { rows: [{ total: userCounts.shift() || "0" }] };
    });
}
