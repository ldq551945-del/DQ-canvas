import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminBackupData } from "./admin-backup-store";

const mocks = vi.hoisted(() => ({
    client: { query: vi.fn() },
    readPostgresAuthDb: vi.fn(),
    readPostgresPromptDb: vi.fn(),
    readPostgresGenerationLogDb: vi.fn(),
    writePostgresAuthDbWithExecutor: vi.fn(),
    writePostgresPromptDbWithExecutor: vi.fn(),
    writePostgresGenerationLogDbWithExecutor: vi.fn(),
    readAccountDeletionRequestBackup: vi.fn(),
    writeAccountDeletionRequestBackup: vi.fn(),
}));

vi.mock("@/lib/auth/store-normalizers", () => ({ normalizeDb: vi.fn((value) => value) }));
vi.mock("@/lib/auth/store-repository", () => ({
    readAuthDb: vi.fn(),
    readPostgresAuthDb: mocks.readPostgresAuthDb,
    writeAuthDb: vi.fn(),
    writePostgresAuthDbWithExecutor: mocks.writePostgresAuthDbWithExecutor,
}));
vi.mock("@/lib/prompts/store", () => ({
    readPromptBackup: vi.fn(),
    readPostgresPromptDb: mocks.readPostgresPromptDb,
    writePromptBackup: vi.fn(),
    writePostgresPromptDbWithExecutor: mocks.writePostgresPromptDbWithExecutor,
}));
vi.mock("@/lib/server/generation-log-repository", () => ({
    readGenerationLogDb: vi.fn(),
    readPostgresGenerationLogDb: mocks.readPostgresGenerationLogDb,
    writeGenerationLogDb: vi.fn(),
    writePostgresGenerationLogDbWithExecutor: mocks.writePostgresGenerationLogDbWithExecutor,
}));
vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: vi.fn(async () => undefined),
    getDatabaseProvider: vi.fn(() => "postgres"),
    withPostgresTransaction: vi.fn(async (callback: (client: typeof mocks.client) => unknown) => callback(mocks.client)),
}));
vi.mock("@/lib/server/database/account-deletion-request-repository", () => ({
    readAccountDeletionRequestBackup: mocks.readAccountDeletionRequestBackup,
    writeAccountDeletionRequestBackup: mocks.writeAccountDeletionRequestBackup,
}));

import { readAdminBackupData, restoreAdminBackupData } from "./admin-backup-store";

describe("admin PostgreSQL backup store", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readPostgresAuthDb.mockResolvedValue({ users: [] });
        mocks.readPostgresPromptDb.mockResolvedValue({ version: 1, prompts: [], seedSources: [] });
        mocks.readPostgresGenerationLogDb.mockResolvedValue({ version: 1, logs: [] });
        mocks.readAccountDeletionRequestBackup.mockResolvedValue({ version: 1, requests: [] });
    });

    it("reads every backup section through the same transaction client", async () => {
        await readAdminBackupData();

        expect(mocks.readPostgresAuthDb).toHaveBeenCalledWith(mocks.client);
        expect(mocks.readPostgresPromptDb).toHaveBeenCalledWith(mocks.client);
        expect(mocks.readPostgresGenerationLogDb).toHaveBeenCalledWith(mocks.client);
        expect(mocks.readAccountDeletionRequestBackup).toHaveBeenCalledWith(mocks.client);
    });

    it("stops the transactional restore when one section fails", async () => {
        const data = { auth: {}, prompts: { version: 1, prompts: [], seedSources: [] }, generationLogs: { version: 1, logs: [] }, accountDeletionRequests: { version: 1, requests: [] } } as unknown as AdminBackupData;
        mocks.writePostgresPromptDbWithExecutor.mockRejectedValue(new Error("prompt restore failed"));

        await expect(restoreAdminBackupData(data)).rejects.toThrow("prompt restore failed");

        expect(mocks.writePostgresAuthDbWithExecutor).toHaveBeenCalledWith(data.auth, mocks.client);
        expect(mocks.writePostgresPromptDbWithExecutor).toHaveBeenCalledWith(data.prompts, mocks.client);
        expect(mocks.writePostgresGenerationLogDbWithExecutor).not.toHaveBeenCalled();
    });
});
