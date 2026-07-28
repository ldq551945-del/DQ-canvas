"use client";

import { CircleHelp } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { SiteLogo } from "@/components/layout/site-logo";
import { navigationGroups, navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { usePublicSessionStore } from "@/stores/use-public-session-store";

export function AppSidebar({ activeToolSlug, expanded }: { activeToolSlug?: NavigationToolSlug; expanded: boolean }) {
    const pathname = usePathname();
    const router = useRouter();
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: "VOZEB PRO", logoUrl: "/logo.svg" };
    const helpActive = pathname.startsWith("/help");

    return (
        <aside className={cn("hidden h-full shrink-0 flex-col border-r border-[#e8ebef] bg-white text-[#20242a] transition-[width] duration-200 lg:flex dark:border-[#292d33] dark:bg-[#111316] dark:text-[#f3f5f7]", expanded ? "w-56" : "w-[72px]")}>
            <Link href="/create" className={cn("flex h-[60px] shrink-0 items-center border-b border-[#e8ebef] px-3 dark:border-[#292d33]", expanded ? "justify-start px-5" : "justify-center")} aria-label={site.title || "VOZEB PRO"}>
                <SiteLogo logoUrl={site.logoUrl} className="size-8" />
                {expanded ? <span className="ml-3 min-w-0 truncate text-sm font-semibold">{site.title || "VOZEB PRO"}</span> : null}
            </Link>

            <nav className={cn("hide-scrollbar min-h-0 flex-1 overflow-y-auto py-4", expanded ? "px-3" : "px-2")} aria-label="工作空间导航">
                {navigationGroups.map((group, groupIndex) => {
                    const tools = navigationTools.filter((tool) => tool.group === group.id);
                    return (
                        <div key={group.id} className={cn(groupIndex > 0 && "mt-5")}>
                            {expanded ? <div className="mb-1 px-2 text-[11px] font-medium text-[#9aa2ad] dark:text-[#737d89]">{group.label}</div> : null}
                            <div className="space-y-1">
                                {tools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    const primary = "primary" in tool && tool.primary;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            href={`/${tool.slug}`}
                                            prefetch
                                            title={tool.label}
                                            onMouseEnter={() => router.prefetch(`/${tool.slug}`)}
                                            onFocus={() => router.prefetch(`/${tool.slug}`)}
                                            className={cn(
                                                "group relative flex h-10 items-center rounded-lg px-2 text-sm font-medium transition",
                                                expanded ? "justify-start gap-3 px-3" : "justify-center",
                                                active
                                                    ? "bg-[#f0f2f4] text-[#1d2127] dark:bg-[#22262c] dark:text-[#f3f5f7]"
                                                    : primary
                                                      ? "text-[#343b44] hover:bg-[#f3f5f7] dark:text-[#d4d9df] dark:hover:bg-[#20242a]"
                                                      : "text-[#697381] hover:bg-[#f3f5f7] hover:text-[#20242a] dark:text-[#8f99a6] dark:hover:bg-[#20242a] dark:hover:text-[#f3f5f7]",
                                            )}
                                            aria-current={active ? "page" : undefined}
                                        >
                                            <Icon className="size-[18px] shrink-0" />
                                            {expanded ? <span className="min-w-0 truncate">{tool.label}</span> : null}
                                            {active ? <span className="absolute right-0 h-4 w-0.5 rounded-full bg-[#5d7fdb]" /> : null}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </nav>

            <div className={cn("shrink-0 border-t border-[#e8ebef] dark:border-[#292d33]", expanded ? "p-3" : "p-2")}>
                <Link
                    href="/help"
                    prefetch
                    title="帮助中心"
                    onMouseEnter={() => router.prefetch("/help")}
                    onFocus={() => router.prefetch("/help")}
                    className={cn(
                        "relative flex h-10 items-center rounded-lg px-2 text-sm font-medium text-[#697381] transition hover:bg-[#f3f5f7] hover:text-[#20242a] dark:text-[#8f99a6] dark:hover:bg-[#20242a] dark:hover:text-[#f3f5f7]",
                        expanded ? "justify-start gap-3 px-3" : "justify-center",
                        helpActive && "bg-[#f0f2f4] text-[#1d2127] dark:bg-[#22262c] dark:text-[#f3f5f7]",
                    )}
                    aria-current={helpActive ? "page" : undefined}
                >
                    <CircleHelp className="size-[18px] shrink-0" />
                    {expanded ? <span>帮助中心</span> : null}
                    {helpActive ? <span className="absolute right-0 h-4 w-0.5 rounded-full bg-[#5d7fdb]" /> : null}
                </Link>
            </div>
        </aside>
    );
}
