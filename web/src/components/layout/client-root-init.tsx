"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { App, Button } from "antd";
import { Settings2 } from "lucide-react";
import { usePathname } from "next/navigation";

import { SiteAnnouncementPopup } from "@/components/layout/site-announcement-popup";
import { expireClientSession } from "@/services/api/session-expiration";
import { applyPublicSystemSettings, useConfigStore, type ModelCapability } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { loadPublicSession, PUBLIC_SETTINGS_CHANGED_EVENT } from "@/stores/use-public-session-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message, notification } = App.useApp();
    const pathname = usePathname();
    const installRoute = pathname === "/install";
    const setConfig = useConfigStore((state) => state.setConfig);
    const setUser = useUserStore((state) => state.setUser);

    useEffect(() => {
        if (installRoute) return;
        let cancelled = false;
        const hydrate = (force = false) => {
            const previousUser = useUserStore.getState().user;
            void loadPublicSession({ force })
                .then((payload) => {
                    if (cancelled) return;
                    if (previousUser && !payload.user) {
                        expireClientSession();
                        return;
                    }
                    setUser(payload.user || null);
                    setConfig(applyPublicSystemSettings(useConfigStore.getState().config, payload.settings));
                })
                .catch(() => undefined);
        };
        const handleSettingsChanged = () => hydrate(true);
        const handleFocus = () => hydrate(true);
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") hydrate(true);
        };
        hydrate();
        window.addEventListener(PUBLIC_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
        window.addEventListener("focus", handleFocus);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            cancelled = true;
            window.removeEventListener(PUBLIC_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
            window.removeEventListener("focus", handleFocus);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [installRoute, setConfig, setUser]);

    useEffect(() => {
        const handleMissingConfig = (event: Event) => {
            const capability = (event as CustomEvent<{ capability?: ModelCapability }>).detail?.capability || capabilityFromPath(pathname);
            const label = capabilityLabel(capability);
            const user = useUserStore.getState().user;
            if (user?.role !== "admin") {
                message.warning(`当前没有可用的${label}模型，请联系管理员完成配置`);
                return;
            }
            notification.warning({
                key: `missing-model-${capability || "any"}`,
                message: `尚未配置可用的${label}模型`,
                description: "请添加模型渠道、拉取模型并设置对应默认模型，然后返回当前工作台重试。",
                duration: 8,
                btn: (
                    <Button type="primary" size="small" icon={<Settings2 className="size-3.5" />} onClick={() => window.location.assign("/admin?section=channels")}>
                        打开模型配置
                    </Button>
                ),
            });
        };
        window.addEventListener("dq-system-config-missing", handleMissingConfig);
        return () => window.removeEventListener("dq-system-config-missing", handleMissingConfig);
    }, [message, notification, pathname]);

    return (
        <>
            {children}
            {installRoute ? null : <SiteAnnouncementPopup />}
        </>
    );
}

function capabilityFromPath(pathname: string): ModelCapability | undefined {
    if (pathname.startsWith("/image")) return "image";
    if (pathname.startsWith("/video")) return "video";
    return undefined;
}

function capabilityLabel(capability?: ModelCapability) {
    if (capability === "image") return "图片";
    if (capability === "video") return "视频";
    if (capability === "text") return "文本";
    if (capability === "audio") return "音频";
    return "创作";
}
