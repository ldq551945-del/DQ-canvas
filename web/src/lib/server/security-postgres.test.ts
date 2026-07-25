import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    postgresQuery: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: vi.fn(async () => undefined),
    getDatabaseProvider: vi.fn(() => "postgres"),
    postgresQuery: mocks.postgresQuery,
}));

import { checkRateLimit } from "./security";

describe("PostgreSQL rate limit", () => {
    beforeEach(() => vi.clearAllMocks());

    it("uses one atomic upsert and does not persist the raw key", async () => {
        mocks.postgresQuery.mockResolvedValue({ rows: [{ request_count: 3, reset_at: new Date(Date.now() + 60_000) }] });

        const result = await checkRateLimit("login:user@example.com", { maxRequests: 2, windowMs: 60_000 });

        expect(result.allowed).toBe(false);
        expect(mocks.postgresQuery).toHaveBeenCalledTimes(1);
        const [statement, values] = mocks.postgresQuery.mock.calls[0];
        expect(statement).toContain("ON CONFLICT (key_hash) DO UPDATE");
        expect(values[0]).toMatch(/^[a-f0-9]{64}$/);
        expect(values).not.toContain("login:user@example.com");
    });
});
