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

import { consumeUserPoints, createUser, listPublicUsers, refundUserPoints, updateUserByAdmin } from "./store";

describe("normalizePointAmount allows negative values", () => {
    beforeEach(() => {
        memory.value = undefined;
    });

    it("creates new users without permanent signup points", async () => {
        await createUser({ username: "admin", password: "password123" });
        const user = await createUser({ username: "new-user", password: "password123" });

        expect(user.permanentPointsBalance).toBe(0);
        expect(user.pointsBalance).toBe(0);
    });

    it("persists a negative balance set by admin", async () => {
        const admin = await createUser({ username: "admin", password: "password123" });
        const user = await createUser({ username: "tester", password: "password123" });

        await updateUserByAdmin(admin.id, user.id, { pointsBalance: -50 });

        const users = await listPublicUsers();
        expect(users.find((u) => u.id === user.id)?.pointsBalance).toBe(0);
        expect(users.find((u) => u.id === user.id)?.permanentPointsBalance).toBe(-50);
    });

    it("rejects refunds without an original consumption record", async () => {
        await createUser({ username: "admin", password: "password123" });
        const user = await createUser({ username: "tester", password: "password123" });

        await expect(refundUserPoints(user.id, "test-model", 10, "api", 1)).rejects.toThrow("退款缺少原消费流水");
    });

    it("keeps a manually adjusted balance at 0", async () => {
        const admin = await createUser({ username: "admin", password: "password123" });
        const user = await createUser({ username: "tester", password: "password123" });

        await updateUserByAdmin(admin.id, user.id, { pointsBalance: 0 });

        const users = await listPublicUsers();
        expect(users.find((u) => u.id === user.id)?.pointsBalance).toBe(0);
    });

    it("correctly adds refund to zero balance", async () => {
        const admin = await createUser({ username: "admin", password: "password123" });
        const user = await createUser({ username: "tester", password: "password123" });

        await updateUserByAdmin(admin.id, user.id, { pointsBalance: 50 });
        const consumption = await consumeUserPoints(user.id, "test-model", 50, "api", "zero-balance:consume");
        await refundUserPoints(user.id, "test-model", 50, "api", 50, "zero-balance:refund", consumption.recordId);

        const users = await listPublicUsers();
        expect(users.find((u) => u.id === user.id)?.pointsBalance).toBe(50);
    });
});
