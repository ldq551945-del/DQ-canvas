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

import { createEmailVerificationCode, createUser, resetPasswordByEmail } from "./store";

type StoredDb = {
    emailCodes: Array<{
        id: string;
        purpose: string;
        email: string;
        userId?: string;
        codeHash: string;
        createdAt: string;
        expiresAt: string;
        consumedAt?: string;
        attempts?: number;
    }>;
    [key: string]: unknown;
};

describe("consumeEmailCode attempt tracking", () => {
    beforeEach(() => {
        memory.value = undefined;
    });

    it("accepts a correct verification code on the first attempt", async () => {
        await createUser({ username: "admin", email: "test@example.com", password: "password123" });
        const { code } = await createEmailVerificationCode({ purpose: "password-reset", email: "test@example.com" });

        const user = await resetPasswordByEmail({ email: "test@example.com", code, newPassword: "newpass12345" });
        expect(user.username).toBe("admin");
    });

    it("rejects a wrong verification code with the correct error", async () => {
        await createUser({ username: "admin", email: "test@example.com", password: "password123" });
        await createEmailVerificationCode({ purpose: "password-reset", email: "test@example.com" });

        await expect(resetPasswordByEmail({ email: "test@example.com", code: "000000", newPassword: "newpass12345" })).rejects.toThrow("邮箱验证码不正确或已过期");
    });

    it("persists failed attempts and invalidates the code after five failures", async () => {
        await createUser({ username: "admin", email: "test@example.com", password: "password123" });
        const { code } = await createEmailVerificationCode({ purpose: "password-reset", email: "test@example.com" });

        for (let attempt = 0; attempt < 5; attempt += 1) {
            await expect(resetPasswordByEmail({ email: "test@example.com", code: "000000", newPassword: "newpass12345" })).rejects.toThrow("邮箱验证码不正确或已过期");
        }

        await expect(resetPasswordByEmail({ email: "test@example.com", code, newPassword: "newpass12345" })).rejects.toThrow("验证码错误次数过多");
        await expect(resetPasswordByEmail({ email: "test@example.com", code, newPassword: "newpass12345" })).rejects.toThrow("邮箱验证码不正确或已过期");
    });

    it("throws '验证码错误次数过多' after 5 failed attempts", async () => {
        await createUser({ username: "admin", email: "test@example.com", password: "password123" });
        const { code } = await createEmailVerificationCode({ purpose: "password-reset", email: "test@example.com" });

        // Seed the stored email code with attempts = 5 (simulating 5 prior failures)
        const db = memory.value as StoredDb;
        const storedCode = db.emailCodes.find((c) => c.email === "test@example.com" && c.purpose === "password-reset" && !c.consumedAt);
        expect(storedCode).toBeTruthy();
        storedCode!.attempts = 5;

        // The 6th attempt (even with the correct code) should throw the rate-limit error
        await expect(resetPasswordByEmail({ email: "test@example.com", code, newPassword: "newpass12345" })).rejects.toThrow("验证码错误次数过多");
    });

    it("accepts the correct code after 4 failed attempts (still under limit)", async () => {
        await createUser({ username: "admin", email: "test@example.com", password: "password123" });
        const { code } = await createEmailVerificationCode({ purpose: "password-reset", email: "test@example.com" });

        // Seed the stored email code with attempts = 4
        const db = memory.value as StoredDb;
        const storedCode = db.emailCodes.find((c) => c.email === "test@example.com" && c.purpose === "password-reset" && !c.consumedAt);
        expect(storedCode).toBeTruthy();
        storedCode!.attempts = 4;

        // The 5th attempt with the correct code should succeed
        const user = await resetPasswordByEmail({ email: "test@example.com", code, newPassword: "newpass12345" });
        expect(user.username).toBe("admin");
    });
});
