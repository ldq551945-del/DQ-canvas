"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { App } from "antd";
import { usePathname } from "next/navigation";

import { SiteAnnouncementPopup } from "@/components/layout/site-announcement-popup";
import { applyPublicSystemSettings, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { loadPublicSession } from "@/stores/use-public-session-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const pathname = usePathname();
    const installRoute = pathname === "/install";
    const setConfig = useConfigStore((state) => state.setConfig);
    const setUser = useUserStore((state) => state.setUser);

    useEffect(() => {
        if (installRoute) return;
        let cancelled = false;
        void loadPublicSession()
            .then((payload) => {
                if (cancelled) return;
                setUser(payload.user || null);
                setConfig(applyPublicSystemSettings(useConfigStore.getState().config, payload.settings));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [installRoute, setConfig, setUser]);

    useEffect(() => {
        const handleMissingConfig = () => {
            message.warning("请联系管理员在后台配置可用模型渠道");
        };
        window.addEventListener("vozeb-pro-system-config-missing", handleMissingConfig);
        return () => window.removeEventListener("vozeb-pro-system-config-missing", handleMissingConfig);
    }, [message]);

    return (
        <>
            {children}
            {installRoute ? null : <SiteAnnouncementPopup />}
        </>
    );
}
