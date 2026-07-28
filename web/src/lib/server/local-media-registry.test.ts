import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    ensurePostgresSchema: vi.fn(),
    getDatabaseProvider: vi.fn(),
    postgresQuery: vi.fn(),
    readJsonDataFile: vi.fn(),
    writeJsonDataFile: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: mocks.ensurePostgresSchema,
    getDatabaseProvider: mocks.getDatabaseProvider,
    postgresQuery: mocks.postgresQuery,
}));
vi.mock("@/lib/server/data-adapter", () => ({ readJsonDataFile: mocks.readJsonDataFile, writeJsonDataFile: mocks.writeJsonDataFile }));

import { getLocalMediaRegistrationSummary, listLocalMediaRegistrationPage, listLocalMediaRegistrationsForUser } from "./local-media-registry";

describe("listLocalMediaRegistrationsForUser", () => {
    beforeEach(() => vi.clearAllMocks());

    it("uses an owner-scoped PostgreSQL query", async () => {
        mocks.getDatabaseProvider.mockReturnValue("postgres");
        mocks.postgresQuery.mockResolvedValue({ rows: [] });

        await listLocalMediaRegistrationsForUser("user-one");

        expect(mocks.ensurePostgresSchema).toHaveBeenCalledTimes(1);
        expect(mocks.postgresQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE owner_user_id = $1"), ["user-one"]);
    });

    it("filters the file provider before returning registrations", async () => {
        mocks.getDatabaseProvider.mockReturnValue("file");
        mocks.readJsonDataFile.mockResolvedValue({
            version: 1,
            assets: [
                { storageKey: "one.png", ownerUserId: "user-one", createdAt: "2026-01-02T00:00:00.000Z" },
                { storageKey: "two.png", ownerUserId: "user-two", createdAt: "2026-01-03T00:00:00.000Z" },
            ],
        });

        const registrations = await listLocalMediaRegistrationsForUser("user-one");

        expect(registrations).toEqual([expect.objectContaining({ storageKey: "one.png", ownerUserId: "user-one" })]);
    });

    it("paginates local PostgreSQL media and calculates totals without loading all registrations", async () => {
        mocks.getDatabaseProvider.mockReturnValue("postgres");
        mocks.postgresQuery
            .mockResolvedValueOnce({
                rows: [{ storage_key: "permanent/image.png", scope: "reference", storage_class: "permanent", type: "image", owner_user_id: "user-one", source: "agent", mime_type: "image/png", bytes: 12, created_at: new Date("2026-01-02") }],
            })
            .mockResolvedValueOnce({ rows: [{ total: "42" }] })
            .mockResolvedValueOnce({ rows: [{ total_files: "42", total_bytes: "512", temporary_files: "2", temporary_bytes: "12", permanent_files: "40", permanent_bytes: "500", expired_temporary_files: "1" }] });

        const page = await listLocalMediaRegistrationPage({ page: 2, pageSize: 10, type: "image", source: "agent", search: "0001", ownerUserIds: ["user-one"] });

        expect(mocks.postgresQuery).toHaveBeenCalledWith(expect.stringContaining("LIMIT $6 OFFSET $7"), [null, "image", "agent", "0001", ["user-one"], 10, 10]);
        expect(mocks.postgresQuery).toHaveBeenCalledWith(expect.stringContaining("owner_user_id = ANY($5::text[])"), [null, "image", "agent", "0001", ["user-one"]]);
        expect(page).toMatchObject({ total: 42, items: [{ storageKey: "permanent/image.png" }], summary: { totalFiles: 42, expiredTemporaryFiles: 1 } });
    });

    it("loads only the PostgreSQL media summary for the dashboard", async () => {
        mocks.getDatabaseProvider.mockReturnValue("postgres");
        mocks.postgresQuery.mockResolvedValue({ rows: [{ total_files: "42", total_bytes: "512", temporary_files: "2", temporary_bytes: "12", permanent_files: "40", permanent_bytes: "500", expired_temporary_files: "1" }] });

        const summary = await getLocalMediaRegistrationSummary();

        expect(summary).toMatchObject({ totalFiles: 42, totalBytes: 512, permanentFiles: 40, expiredTemporaryFiles: 1 });
        expect(mocks.postgresQuery).toHaveBeenCalledTimes(1);
        expect(String(mocks.postgresQuery.mock.calls[0][0])).toContain("FROM local_media_assets");
        expect(String(mocks.postgresQuery.mock.calls[0][0])).not.toContain("ORDER BY");
    });
});
