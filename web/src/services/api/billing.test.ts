import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ throwIfClientSessionExpired: vi.fn() }));

vi.mock("@/services/api/session-expiration", () => ({ throwIfClientSessionExpired: mocks.throwIfClientSessionExpired }));

import { getBillingOrder, listBillingCoupons } from "./billing";

describe("billing API session handling", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ order: { id: "order-one" } }), { status: 200 })));
    });

    it("checks authenticated billing responses for session expiry", async () => {
        await getBillingOrder("order-one");
        expect(mocks.throwIfClientSessionExpired).toHaveBeenCalledOnce();
        expect(mocks.throwIfClientSessionExpired.mock.calls[0]?.[0]).toBeInstanceOf(Response);
    });

    it("checks commerce responses for session expiry before parsing the envelope", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { coupons: [] } }), { status: 200 })));
        await expect(listBillingCoupons()).resolves.toEqual({ coupons: [] });
        expect(mocks.throwIfClientSessionExpired).toHaveBeenCalledOnce();
    });
});
