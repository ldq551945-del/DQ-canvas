import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    connect: vi.fn(),
    pool: vi.fn(),
}));

vi.mock("pg", () => ({
    Pool: mocks.pool,
}));

import { ensurePostgresSchema, initializePostgresSchema, withPostgresTransaction } from "./postgres";

describe("PostgreSQL schema lifecycle", () => {
    beforeEach(() => {
        delete (globalThis as Record<string, unknown>).__vozebProPostgresPool;
        delete (globalThis as Record<string, unknown>).__vozebProPostgresSchemaReady;
        process.env.DATABASE_URL = "postgres://vozeb:test@localhost:5432/vozeb";
        mocks.query.mockReset();
        mocks.connect.mockReset();
        mocks.pool.mockReset().mockImplementation(function PoolMock() {
            return { query: mocks.query, connect: mocks.connect };
        });
    });

    it("serializes concurrent repository queries on one transaction client", async () => {
        let active = false;
        const statements: string[] = [];
        const release = vi.fn();
        const clientQuery = vi.fn(async (statement: string) => {
            statements.push(statement);
            if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") return { rows: [], rowCount: 0 };
            if (active) throw new Error("transaction client received concurrent queries");
            active = true;
            await new Promise((resolve) => setTimeout(resolve, 0));
            active = false;
            return { rows: [], rowCount: 0 };
        });
        mocks.connect.mockResolvedValue({ query: clientQuery, release });

        await withPostgresTransaction(async (client) => {
            await Promise.all([client.query("SELECT 1"), client.query("SELECT 2"), client.query("SELECT 3")]);
        });

        expect(statements).toEqual(["BEGIN", "SELECT 1", "SELECT 2", "SELECT 3", "COMMIT"]);
        expect(release).toHaveBeenCalledOnce();
    });

    it("does not execute schema DDL when an ordinary caller reaches an empty database", async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ table_name: null }] });

        await expect(ensurePostgresSchema()).rejects.toThrow("PostgreSQL schema has not been initialized");

        expect(mocks.query).toHaveBeenCalledTimes(1);
        expect(mocks.query.mock.calls[0]?.[0]).toContain("to_regclass");
        expect(mocks.query.mock.calls[0]?.[0]).not.toContain("CREATE TABLE");
    });

    it("executes schema DDL only through explicit initialization", async () => {
        mocks.query.mockResolvedValueOnce({ rows: [] });

        await initializePostgresSchema();

        expect(mocks.query).toHaveBeenCalledTimes(1);
        const ddl = String(mocks.query.mock.calls[0]?.[0]);
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS vozeb_pro_schema_migrations");
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS vozeb_pro_generation_worker_heartbeats");
        expect(ddl).toContain("CREATE SEQUENCE IF NOT EXISTS vozeb_pro_user_account_id_seq");
        expect(ddl).toContain("account_id bigint NOT NULL DEFAULT nextval('vozeb_pro_user_account_id_seq')");
        expect(ddl).toContain("CREATE UNIQUE INDEX IF NOT EXISTS vozeb_pro_users_account_id_idx ON vozeb_pro_users (account_id)");
        expect(ddl).toContain("user_id text NOT NULL REFERENCES vozeb_pro_users(id) ON DELETE CASCADE");
        expect(ddl).toContain("CREATE TABLE IF NOT EXISTS vozeb_pro_account_deletion_requests");
        expect(ddl).toContain("'review_pending', 'reviewing', 'review_unavailable'");
        expect(ddl).toContain("task_type = 'agent' AND status = 'success' AND execution_phase IN ('review_pending', 'reviewing')");

        const tableNames = [...ddl.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z][a-z0-9_]*)/gi)].map((match) => match[1]).sort();
        expect(tableNames).toHaveLength(58);
        expect(tableNames.every((name) => name.startsWith("vozeb_pro_"))).toBe(true);
        expect(tableNames).not.toContain("vozeb_pro_check_ins");
        expect(ddl).toContain("DROP TABLE IF EXISTS vozeb_pro_check_ins");
        expect(ddl).not.toContain("20260731_generation_task_recovery");

        const indexNames = [...ddl.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z][a-z0-9_]*)/gi)].map((match) => match[1]);
        expect(indexNames.length).toBeGreaterThan(0);
        expect(indexNames.every((name) => name.startsWith("vozeb_pro_"))).toBe(true);

        const uniqueConstraintNames = [...ddl.matchAll(/CONSTRAINT\s+([a-z][a-z0-9_]*)\s+UNIQUE\b/gi)].map((match) => match[1]);
        expect(uniqueConstraintNames.length).toBeGreaterThan(0);
        expect(uniqueConstraintNames.every((name) => name.startsWith("vozeb_pro_"))).toBe(true);
    });

    it("continues applying additive schema updates after the sentinel table exists", async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ table_name: "vozeb_pro_users" }] }).mockResolvedValueOnce({ rows: [] });

        await ensurePostgresSchema();

        expect(mocks.query).toHaveBeenCalledTimes(2);
        expect(mocks.query.mock.calls[0]?.[0]).toContain("to_regclass");
        expect(mocks.query.mock.calls[1]?.[0]).toContain("CREATE TABLE IF NOT EXISTS vozeb_pro_schema_migrations");
    });
});
