"use client";

import { create } from "zustand";

import type { LocalUser } from "@/stores/use-user-store";
import type { PublicSystemSettings } from "@/stores/use-config-store";

type PublicSiteSettings = {
    title: string;
    logoUrl: string;
    iconUrl?: string;
    seoDescription?: string;
    footerCopyright?: string;
    termsUrl?: string;
    privacyUrl?: string;
    homeShowcaseMode?: "random" | "custom";
    homeShowcaseItems?: Array<{ id: string; title: string; coverUrl: string; prompt: string; tags: string[]; category: string }>;
    friendLinks?: Array<{ id: string; label: string; url: string; enabled: boolean }>;
    socials?: Record<string, { enabled: boolean; label: string; url: string }>;
};

type PublicSessionPayload = {
    user?: LocalUser | null;
    install?: { firstAdminRequired?: boolean; database?: { healthy?: boolean } };
    settings?: PublicSystemSettings & { site?: PublicSiteSettings };
};

type PublicSessionStore = {
    payload: PublicSessionPayload | null;
    ready: boolean;
};

export const usePublicSessionStore = create<PublicSessionStore>(() => ({ payload: null, ready: false }));

let sessionRequest: Promise<PublicSessionPayload> | null = null;

export function loadPublicSession() {
    if (!sessionRequest) {
        sessionRequest = fetch("/api/auth/session", { cache: "no-store" })
            .then(async (response) => {
                if (!response.ok) throw new Error("会话加载失败");
                return (await response.json()) as PublicSessionPayload;
            })
            .then((payload) => {
                usePublicSessionStore.setState({ payload, ready: true });
                return payload;
            })
            .catch((error) => {
                usePublicSessionStore.setState({ payload: null, ready: true });
                sessionRequest = null;
                throw error;
            });
    }
    return sessionRequest;
}

export function resetPublicSession() {
    sessionRequest = null;
    usePublicSessionStore.setState({ payload: null, ready: false });
}
