import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    checkRateLimit: vi.fn(),
    createSession: vi.fn(),
    createUser: vi.fn(),
    getInstallStatus: vi.fn(),
    readJsonBody: vi.fn(),
}));

vi.mock("@/lib/auth/store", () => ({
    createSession: mocks.createSession,
    createUser: mocks.createUser,
    isAuthInputError: vi.fn(() => false),
}));
vi.mock("@/lib/auth/request", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/auth/session", () => ({
    serializeCurrentUser: vi.fn((user) => user),
    setSessionCookie: vi.fn(),
}));
vi.mock("@/lib/server/install-status", () => ({ getInstallStatus: mocks.getInstallStatus }));
vi.mock("@/lib/server/security", () => ({
    checkRateLimit: mocks.checkRateLimit,
    getClientIp: vi.fn(() => "203.0.113.8"),
}));
vi.mock("@/lib/server/referral-service", () => ({ REFERRAL_COOKIE_NAME: "vozeb_referral" }));

import { POST } from "./route";

function registerRequest(cookie = "COOKIE88") {
    return new NextRequest("http://localhost/api/auth/register", {
        method: "POST",
        headers: { cookie: `vozeb_referral=${cookie}` },
    });
}

describe("POST /api/auth/register referral attribution", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getInstallStatus.mockResolvedValue({ ready: true, firstAdminRequired: false });
        mocks.checkRateLimit.mockResolvedValue({ allowed: true });
        mocks.createUser.mockResolvedValue({ id: "user-one", role: "user" });
        mocks.createSession.mockResolvedValue("session-token");
    });

    it("treats an explicitly cleared referral code as an attribution opt-out", async () => {
        mocks.readJsonBody.mockResolvedValue({ username: "new-user", password: "password123", referralCode: "" });

        const response = await POST(registerRequest());

        expect(response.status).toBe(200);
        expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ referralCode: undefined, referralSource: undefined }));
    });

    it("ignores all referral attribution for the first administrator", async () => {
        mocks.getInstallStatus.mockResolvedValue({ ready: false, firstAdminRequired: true });
        mocks.readJsonBody.mockResolvedValue({ username: "admin", password: "password123", referralCode: "BODYCODE", referralSource: "registration-form" });
        mocks.createUser.mockResolvedValue({ id: "admin-one", role: "admin" });

        const response = await POST(registerRequest());

        expect(response.status).toBe(200);
        expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ referralCode: undefined, referralSource: undefined }));
    });

    it("uses the referral cookie when the form does not provide the field", async () => {
        mocks.readJsonBody.mockResolvedValue({ username: "new-user", password: "password123" });

        await POST(registerRequest("COOKIE88"));

        expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ referralCode: "COOKIE88", referralSource: "invite-link" }));
    });
});
