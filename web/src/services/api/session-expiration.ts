"use client";

import { resetClientSessionState } from "@/lib/client-session-reset";
import { resetPublicSession } from "@/stores/use-public-session-store";
import { useUserStore } from "@/stores/use-user-store";

let redirecting = false;

export class ClientSessionExpiredError extends Error {
    constructor() {
        super("登录状态已失效，请重新登录");
        this.name = "ClientSessionExpiredError";
    }
}

export function throwIfClientSessionExpired(response: Response) {
    if (response.status !== 401) return;
    expireClientSession();
    throw new ClientSessionExpiredError();
}

export function expireClientSession() {
    useUserStore.getState().clearSession();
    resetPublicSession();
    void resetClientSessionState();
    if (typeof window === "undefined" || redirecting) return;
    const pathname = window.location.pathname;
    if (pathname === "/login" || pathname === "/register" || pathname === "/forgot-password" || pathname === "/install") return;
    redirecting = true;
    const nextPath = `${pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent("登录状态已失效，请重新登录")}`);
}

export async function stopIfClientSessionExpired() {
    try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) return false;
        const payload = (await response.json().catch(() => null)) as { user?: unknown } | null;
        if (payload?.user) return false;
        if (!useUserStore.getState().user) return false;
        expireClientSession();
        return true;
    } catch {
        return false;
    }
}
