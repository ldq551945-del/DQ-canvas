import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { createEmailVerificationCode, createFirstAdmin, createUser, resetPasswordByEmail } from "./store";

const INSTALL_TOKEN = "install-token-".padEnd(48, "x");

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
        vi.stubEnv("DQ_INSTALL_TOKEN", INSTALL_TOKEN);
    });

    afterEach(() => vi.unstubAllEnvs());

    it("accepts a correct verification code on the first attempt", async () => {
        await createFirstAdmin({ username: "admin", email: "test@example.com", password: "password123", installToken: INSTALL_TOKEN });
        const { code } = await createEmailVerificationCode({ purpose: "password-reset", email: "test@example.com" });

        const user = await resetPasswordByEmail({ email: "test@example.com", code, newPassword: "newpass12345" });
        expect(user.username).toBe("admin");
    });

    it("does not create a reset code when an anonymous reset request names no account", async () => {
        const result = await createEmailVerificationCode({ purpose: "password-reset", email: "missing@example.com", silentPasswordResetMissing: true });

        expect(result).toEqual({ email: "missing@example.com" });
        expect((memory.value as StoredDb).emailCodes).toEqual([]);
    });

    it("assigns the administrator role to only one concurrent installation request", async () => {
        const results = await Promise.allSettled([createFirstAdmin({ username: "first-admin", password: "password123", installToken: INSTALL_TOKEN }), createFirstAdmin({ username: "second-admin", password: "password123", installToken: INSTALL_TOKEN })]);

        const createdUsers = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
        expect(createdUsers.filter((user) => user.role === "admin")).toHaveLength(1);
    });

    it("rejects a wrong verification code with the correct error", async () => {
        await createFirstAdmin({ username: "admin", email: "test@example.com", password: "password123", installToken: INSTALL_TOKEN });
        await createEmailVerificationCode({ purpose: "password-reset", email: "test@example.com" });

        await expect(resetPasswordByEmail({ email: "test@example.com", code: "000000", newPassword: "newpass12345" })).rejects.toThrow("邮箱验证码不正确或已过期");
    });

    it("persists failed attempts and invalidates the code after five failures", async () => {
        await createFirstAdmin({ username: "admin", email: "test@example.com", password: "password123", installToken: INSTALL_TOKEN });
        const { code } = await createEmailVerificationCode({ purpose: "password-reset", email: "test@example.com" });

        for (let attempt = 0; attempt < 5; attempt += 1) {
            await expect(resetPasswordByEmail({ email: "test@example.com", code: "000000", newPassword: "newpass12345" })).rejects.toThrow("邮箱验证码不正确或已过期");
        }

        await expect(resetPasswordByEmail({ email: "test@example.com", code, newPassword: "newpass12345" })).rejects.toThrow("验证码错误次数过多");
        await expect(resetPasswordByEmail({ email: "test@example.com", code, newPassword: "newpass12345" })).rejects.toThrow("邮箱验证码不正确或已过期");
    });

    it("throws '验证码错误次数过多' after 5 failed attempts", async () => {
        await createFirstAdmin({ username: "admin", email: "test@example.com", password: "password123", installToken: INSTALL_TOKEN });
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
        await createFirstAdmin({ username: "admin", email: "test@example.com", password: "password123", installToken: INSTALL_TOKEN });
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
