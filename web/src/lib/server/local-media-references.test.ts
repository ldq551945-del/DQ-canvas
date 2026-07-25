import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    ensurePostgresSchema: vi.fn(),
    getDatabaseProvider: vi.fn(),
    postgresQuery: vi.fn(),
    readJsonDataFile: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: mocks.ensurePostgresSchema,
    getDatabaseProvider: mocks.getDatabaseProvider,
    postgresQuery: mocks.postgresQuery,
}));
vi.mock("@/lib/server/data-adapter", () => ({ readJsonDataFile: mocks.readJsonDataFile }));

import { countLocalMediaReferences } from "./local-media-references";

describe("countLocalMediaReferences", () => {
    beforeEach(() => vi.clearAllMocks());

    it("counts all requested keys with one PostgreSQL query", async () => {
        mocks.getDatabaseProvider.mockReturnValue("postgres");
        mocks.postgresQuery.mockResolvedValue({
            rows: [
                { storage_key: "permanent/one.png", total: "2" },
                { storage_key: "permanent/two.png", total: 0 },
            ],
        });

        const result = await countLocalMediaReferences(["permanent/one.png", "permanent/two.png", "permanent/one.png"]);

        expect(result).toEqual(
            new Map([
                ["permanent/one.png", 2],
                ["permanent/two.png", 0],
            ]),
        );
        expect(mocks.postgresQuery).toHaveBeenCalledTimes(1);
        expect(mocks.postgresQuery).toHaveBeenCalledWith(expect.stringContaining("unnest($1::text[])"), [["permanent/one.png", "permanent/two.png"]]);
    });
});
