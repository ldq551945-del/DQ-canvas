import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), readJsonBody: vi.fn(), listCouponTemplates: vi.fn(), saveCouponTemplate: vi.fn(), safeRecordAuditLog: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/auth/request", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({})), safeRecordAuditLog: mocks.safeRecordAuditLog }));
vi.mock("@/lib/server/billing-service", () => ({ isBillingInputError: vi.fn(() => false) }));
vi.mock("@/lib/server/coupon-service", () => ({ listCouponTemplates: mocks.listCouponTemplates, saveCouponTemplate: mocks.saveCouponTemplate }));

import { GET, POST } from "./route";

describe("/api/admin/billing/coupon-templates", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "admin-one", role: "admin" });
        mocks.listCouponTemplates.mockResolvedValue({ items: [{ id: "template-one" }], total: 1, page: 1, pageSize: 20 });
        mocks.readJsonBody.mockResolvedValue({ name: "新客券" });
        mocks.saveCouponTemplate.mockResolvedValue({ id: "template-one", name: "新客券", enabled: true, claimable: true });
    });

    it("requires administrator permission", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        const response = await GET(new NextRequest("http://localhost/api/admin/billing/coupon-templates"));
        expect(response.status).toBe(401);
        expect(mocks.listCouponTemplates).not.toHaveBeenCalled();
    });

    it("lists and creates templates", async () => {
        expect((await GET(new NextRequest("http://localhost/api/admin/billing/coupon-templates"))).status).toBe(200);
        const response = await POST(new Request("http://localhost/api/admin/billing/coupon-templates", { method: "POST" }));
        expect(response.status).toBe(201);
        expect(mocks.saveCouponTemplate).toHaveBeenCalledWith({ name: "新客券", createdByUserId: "admin-one" });
        expect(mocks.safeRecordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.billing.coupon-template.save" }));
    });
});
