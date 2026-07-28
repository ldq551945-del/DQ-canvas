import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    checkRateLimit: vi.fn(),
    recordReferralVisit: vi.fn(),
}));

vi.mock("@/lib/server/referral-service", () => ({
    normalizeReferralCode: vi.fn((value: unknown) =>
        String(value || "")
            .trim()
            .toUpperCase(),
    ),
    recordReferralVisit: mocks.recordReferralVisit,
    REFERRAL_COOKIE_NAME: "vozeb_referral",
}));
vi.mock("@/lib/server/security", () => ({
    checkRateLimit: mocks.checkRateLimit,
    getClientIp: vi.fn(() => "203.0.113.9"),
}));

import { GET } from "./route";

describe("GET /invite/[code]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.recordReferralVisit.mockResolvedValue({ code: "INVITE88" });
    });

    it("keeps valid attribution without counting a rate-limited click", async () => {
        mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false }).mockResolvedValueOnce({ allowed: true });
        const request = new NextRequest("http://localhost/invite/INVITE88?next=/gallery/work-one");

        const response = await GET(request, { params: Promise.resolve({ code: "INVITE88" }) });

        expect(mocks.recordReferralVisit).toHaveBeenCalledWith("INVITE88", { countClick: false });
        expect(response.headers.get("location")).toBe("http://localhost/register?next=%2Fgallery%2Fwork-one&ref=INVITE88");
        expect(response.headers.get("set-cookie")).toContain("vozeb_referral=INVITE88");
    });
});
