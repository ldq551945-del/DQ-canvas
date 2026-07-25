"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { SiteLogo } from "@/components/layout/site-logo";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { usePublicSessionStore } from "@/stores/use-public-session-store";

export function AppTopNav() {
    const pathname = usePathname();
    const router = useRouter();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const navItemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
    const [navIndicator, setNavIndicator] = useState({ left: 7, width: 0, visible: false });
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: "VOZEB PRO", logoUrl: "/logo.svg" };
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    const activeToolIndex = navigationTools.findIndex((tool) => tool.slug === activeToolSlug);

    const moveNavIndicator = useCallback((index: number) => {
        const item = navItemRefs.current[index];
        if (!item) return;
        setNavIndicator({ left: item.offsetLeft, width: item.offsetWidth, visible: true });
    }, []);

    const restoreActiveIndicator = useCallback(() => {
        if (activeToolIndex >= 0) moveNavIndicator(activeToolIndex);
        else setNavIndicator((current) => ({ ...current, visible: false }));
    }, [activeToolIndex, moveNavIndicator]);

    useLayoutEffect(() => {
        restoreActiveIndicator();
        window.addEventListener("resize", restoreActiveIndicator);
        return () => window.removeEventListener("resize", restoreActiveIndicator);
    }, [restoreActiveIndicator]);

    return (
        <>
            {!hideHeader ? (
                <header className="app-shell-header sticky top-0 z-20 h-[68px] shrink-0 sm:h-[74px]">
                    <div className="mx-auto grid h-full max-w-[1500px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:grid-cols-[minmax(180px,0.8fr)_minmax(0,auto)_minmax(300px,1.2fr)] lg:gap-4">
                        <div className="flex min-w-0 items-center justify-start overflow-hidden">
                            <Link href="/" className="flex h-full min-w-0 items-center gap-2.5 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <SiteLogo logoUrl={site.logoUrl} className="size-9" />
                                <span className="max-w-[24vw] truncate text-xl font-semibold sm:max-w-[30vw] lg:max-w-none">{site.title || "VOZEB PRO"}</span>
                            </Link>

                            <button
                                type="button"
                                className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 lg:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label="打开导航菜单"
                                title="导航菜单"
                            >
                                <Menu className="size-5" />
                            </button>
                        </div>

                        <nav
                            className="app-shell-nav-pill hide-scrollbar hidden min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-visible lg:flex lg:justify-self-center"
                            onPointerLeave={restoreActiveIndicator}
                            onBlur={(event) => {
                                if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) restoreActiveIndicator();
                            }}
                        >
                            <span className="app-shell-nav-indicator" aria-hidden="true" style={{ left: navIndicator.left, opacity: navIndicator.visible ? 1 : 0, width: navIndicator.width }} />
                            {navigationTools.map((tool, index) => {
                                const Icon = tool.icon;
                                const active = tool.slug === activeToolSlug;
                                return (
                                    <Link
                                        key={tool.slug}
                                        ref={(node) => {
                                            navItemRefs.current[index] = node;
                                        }}
                                        href={`/${tool.slug}`}
                                        prefetch
                                        onPointerEnter={() => {
                                            moveNavIndicator(index);
                                            router.prefetch(`/${tool.slug}`);
                                        }}
                                        onFocus={() => {
                                            moveNavIndicator(index);
                                            router.prefetch(`/${tool.slug}`);
                                        }}
                                        className={cn("app-shell-nav-link flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium leading-none xl:px-3.5", active && "is-active")}
                                    >
                                        <Icon className="size-[17px]" />
                                        <span className="truncate">{tool.label}</span>
                                    </Link>
                                );
                            })}
                        </nav>

                        <div className="app-shell-actions my-auto flex h-9 max-w-[calc(100vw-9rem)] min-w-0 items-center justify-end overflow-visible whitespace-nowrap sm:max-w-[calc(100vw-12rem)] lg:max-w-none">
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
        </>
    );
}
