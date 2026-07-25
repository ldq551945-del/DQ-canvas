import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: vi.fn(),
    isPostgresDatabaseEnabled: vi.fn(() => false),
    postgresQuery: vi.fn(),
    withPostgresTransaction: vi.fn(),
}));

vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: vi.fn(async (_fileName: string, fallback: unknown) => memory.value ?? fallback),
    writeJsonDataFile: vi.fn(async (_fileName: string, value: unknown) => {
        memory.value = structuredClone(value);
    }),
}));

import { consumeUserPoints, createUserByAdmin, listPointRecordsPage, listPublicUsers, refundUserPoints } from "./store";

describe("refundUserPoints idempotency", () => {
    beforeEach(() => {
        memory.value = undefined;
    });

    it("applies a task refund only once for the same idempotency key", async () => {
        const user = await createUserByAdmin({ username: "tester", password: "password123", pointsBalance: 5 });
        const consumption = await consumeUserPoints(user.id, "audio-model", 5, "audio", "audio-task:one:consume");

        await refundUserPoints(user.id, "audio-model", 5, "audio", 5, "audio-task:one:refund", consumption.recordId);
        await refundUserPoints(user.id, "audio-model", 5, "audio", 5, "audio-task:one:refund", consumption.recordId);

        expect((await listPublicUsers()).find((item) => item.id === user.id)?.pointsBalance).toBe(user.pointsBalance);
        expect((await listPointRecordsPage(user.id)).records.filter((record) => record.type === "refund")).toHaveLength(1);

        const debitPage = await listPointRecordsPage(user.id, { direction: "debit", page: 1, pageSize: 1 });
        expect(debitPage).toMatchObject({ total: 1, page: 1, pageSize: 1 });
        expect(debitPage.records).toEqual([expect.objectContaining({ type: "consume", amount: -5 })]);

        const creditPage = await listPointRecordsPage(user.id, { direction: "credit", page: 1, pageSize: 10 });
        expect(creditPage.records.length).toBe(creditPage.total);
        expect(creditPage.records.every((record) => record.amount > 0)).toBe(true);
        expect(creditPage.records.some((record) => record.type === "refund")).toBe(true);
    });
});
