import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    resetClientSessionState: vi.fn(),
    resetPublicSession: vi.fn(),
    clearSession: vi.fn(),
    user: { id: "user-one" },
}));

vi.mock("@/lib/client-session-reset", () => ({ resetClientSessionState: mocks.resetClientSessionState }));
vi.mock("@/stores/use-public-session-store", () => ({ resetPublicSession: mocks.resetPublicSession }));
vi.mock("@/stores/use-user-store", () => ({ useUserStore: { getState: () => ({ clearSession: mocks.clearSession, user: mocks.user }) } }));

import { ClientSessionExpiredError, throwIfClientSessionExpired } from "./session-expiration";

describe("client session expiration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("window", {
            location: { pathname: "/image", search: "?draft=one", hash: "#results", assign: vi.fn() },
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    it("clears client state and keeps the current path when an authenticated API returns 401", () => {
        expect(() => throwIfClientSessionExpired(new Response(null, { status: 401 }))).toThrow(ClientSessionExpiredError);
        expect(mocks.clearSession).toHaveBeenCalledTimes(1);
        expect(mocks.resetPublicSession).toHaveBeenCalledTimes(1);
        expect(mocks.resetClientSessionState).toHaveBeenCalledTimes(1);
        expect(window.location.assign).toHaveBeenCalledWith("/login?next=%2Fimage%3Fdraft%3Done%23results&error=%E7%99%BB%E5%BD%95%E7%8A%B6%E6%80%81%E5%B7%B2%E5%A4%B1%E6%95%88%EF%BC%8C%E8%AF%B7%E9%87%8D%E6%96%B0%E7%99%BB%E5%BD%95");
    });

    it("leaves non-401 responses untouched", () => {
        expect(() => throwIfClientSessionExpired(new Response(null, { status: 403 }))).not.toThrow();
        expect(mocks.clearSession).not.toHaveBeenCalled();
        expect(mocks.resetPublicSession).not.toHaveBeenCalled();
    });
});
