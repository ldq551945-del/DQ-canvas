import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createCode: vi.fn(),
    currentUser: vi.fn(),
    getSettings: vi.fn(),
    isAuthInputError: vi.fn(),
    rateLimit: vi.fn(),
    readJsonBody: vi.fn(),
    sendMail: vi.fn(),
}));

vi.mock("@/lib/auth/request", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/auth/store", () => ({
    createEmailVerificationCode: mocks.createCode,
    getAuthSettings: mocks.getSettings,
    isAuthInputError: mocks.isAuthInputError,
}));
vi.mock("@/lib/mail/smtp", () => ({ sendSmtpMail: mocks.sendMail }));
vi.mock("@/lib/server/security", () => ({
    checkRateLimit: mocks.rateLimit,
    getClientIp: vi.fn(() => "203.0.113.8"),
}));

import { POST } from "./route";

function request() {
    return new Request("http://localhost/api/auth/email-code", { method: "POST", headers: { "Content-Type": "application/json" } });
}

describe("POST /api/auth/email-code", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readJsonBody.mockResolvedValue({ purpose: "password-reset", email: "person@example.com" });
        mocks.currentUser.mockResolvedValue(null);
        mocks.rateLimit.mockResolvedValue({ allowed: true, remaining: 1, resetAt: Date.now() + 60_000 });
        mocks.getSettings.mockResolvedValue({ mail: {} });
        mocks.isAuthInputError.mockReturnValue(false);
    });

    it("returns the same success result when a password reset address has no account", async () => {
        mocks.createCode.mockResolvedValue({ email: "person@example.com" });

        const response = await POST(request());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
        expect(mocks.sendMail).not.toHaveBeenCalled();
        expect(mocks.rateLimit).toHaveBeenNthCalledWith(1, "email-code:203.0.113.8:password-reset", { maxRequests: 20, windowMs: 60 * 60 * 1000 });
        expect(mocks.rateLimit).toHaveBeenNthCalledWith(2, "email-code:203.0.113.8:password-reset:person@example.com", { maxRequests: 5, windowMs: 60 * 60 * 1000 });
        expect(mocks.createCode).toHaveBeenCalledWith(expect.objectContaining({ purpose: "password-reset", silentPasswordResetMissing: true }));
    });

    it("returns the same success result after sending a code to an existing password-reset address", async () => {
        mocks.createCode.mockResolvedValue({ email: "person@example.com", code: "123456" });

        const response = await POST(request());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
        expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "person@example.com" }));
    });

    it("keeps password-reset responses anonymous when code creation or mail delivery fails", async () => {
        mocks.createCode.mockRejectedValue(new Error("code resend cooldown"));
        mocks.isAuthInputError.mockReturnValue(true);

        const response = await POST(request());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true });
    });

    it("limits password reset requests by client IP before the address-specific limit", async () => {
        mocks.rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

        const response = await POST(request());

        expect(response.status).toBe(429);
        expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
        expect(mocks.createCode).not.toHaveBeenCalled();
    });
});
