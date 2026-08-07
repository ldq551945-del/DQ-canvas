import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), pool: vi.fn() }));

vi.mock("pg", () => ({ Pool: mocks.pool }));

import { getPostgresOperationalSnapshot, postgresQuery } from "./postgres";

describe("PostgreSQL operational metrics", () => {
    beforeEach(() => {
        delete (globalThis as Record<string, unknown>).__dqPostgresPool;
        delete (globalThis as Record<string, unknown>).__dqPostgresObservability;
        process.env.DATABASE_URL = "postgres://dq:test@localhost:5432/dq";
        process.env.DQ_DATABASE_SLOW_QUERY_MS = "10";
        mocks.query.mockReset();
        mocks.pool.mockReset().mockImplementation(function PoolMock() {
            return { query: mocks.query, connect: mocks.connect, totalCount: 3, idleCount: 2, waitingCount: 1, on: vi.fn() };
        });
    });

    it("records query duration and redacts literals from slow query samples", async () => {
        mocks.query.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 12));
            return { rows: [{ ok: true }] };
        });
        await postgresQuery("SELECT * FROM users WHERE email = 'person@example.com' AND id = 123", ["person@example.com", 123]);

        const snapshot = getPostgresOperationalSnapshot();
        expect(snapshot.pool).toMatchObject({ total: 3, idle: 2, waiting: 1 });
        expect(snapshot.queries).toMatchObject({ total: 1, slow: 1 });
        expect(snapshot.queries.recentSlow[0]).toMatchObject({ sql: "SELECT * FROM dq_users WHERE email = ? AND id = ?", failed: false });
        expect(snapshot.queries.recentSlow[0]?.sql).not.toContain("person@example.com");
    });
});
