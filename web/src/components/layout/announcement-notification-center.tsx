"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, ChevronDown, Megaphone, RotateCcw, X } from "lucide-react";
import { Modal } from "antd";

import { useAnnouncementReadState } from "@/hooks/use-announcement-read-state";
import { useAnnouncements } from "@/hooks/use-announcements";
import { formatAnnouncementTime } from "@/lib/announcement-notifications";
import { cn } from "@/lib/utils";
import type { PublicAnnouncement } from "@/services/api/announcements";

export function AnnouncementNotificationCenter({ compact, buttonClassName, buttonStyle, onOpen }: { compact: boolean; buttonClassName: string; buttonStyle?: CSSProperties; onOpen?: () => void }) {
    const { data: announcements = [], error, isFetching, refetch } = useAnnouncements();
    const { readIds, hydrated, markRead } = useAnnouncementReadState();
    const [open, setOpen] = useState(false);
    const [expandedId, setExpandedId] = useState("");
    const [sessionUnreadIds, setSessionUnreadIds] = useState<Set<string>>(() => new Set());
    const unreadAnnouncements = useMemo(() => (hydrated ? announcements.filter((item) => !readIds.has(item.id)) : []), [announcements, hydrated, readIds]);

    useEffect(() => {
        if (!open || !unreadAnnouncements.length) return;
        setSessionUnreadIds((current) => new Set([...current, ...unreadAnnouncements.map((item) => item.id)]));
        markRead(...unreadAnnouncements.map((item) => item.id));
    }, [markRead, open, unreadAnnouncements]);

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (nextOpen) onOpen?.();
        else {
            setExpandedId("");
            setSessionUnreadIds(new Set());
        }
    };
    const button = (
        <button
            type="button"
            className={cn(buttonClassName, "relative")}
            style={buttonStyle}
            onClick={() => handleOpenChange(true)}
            aria-label={unreadAnnouncements.length ? `公告通知，${unreadAnnouncements.length} 条未读` : "公告通知"}
            title="公告通知"
            aria-expanded={open}
        >
            <Bell className="size-4" />
            {hydrated && unreadAnnouncements.length ? (
                <span className="absolute -right-0.5 -top-0.5 grid min-w-3.5 place-items-center rounded-full bg-[#66758e] px-1 text-[9px] font-semibold leading-[14px] text-white ring-2 ring-white dark:bg-[#d8dee8] dark:text-[#252b33] dark:ring-[#181b20]">
                    {unreadAnnouncements.length > 9 ? "9+" : unreadAnnouncements.length}
                </span>
            ) : null}
        </button>
    );
    const panel = (
        <AnnouncementPanel
            announcements={announcements}
            error={error}
            expandedId={expandedId}
            loading={isFetching && !announcements.length}
            sessionUnreadIds={sessionUnreadIds}
            onClose={() => handleOpenChange(false)}
            onExpand={(id) => setExpandedId((current) => (current === id ? "" : id))}
            onRetry={() => void refetch()}
        />
    );

    return (
        <>
            {button}
            <Modal
                centered
                width={compact ? "calc(100vw - 24px)" : 460}
                open={open}
                onCancel={() => handleOpenChange(false)}
                footer={null}
                closeIcon={null}
                destroyOnHidden
                styles={{ container: { overflow: "hidden", borderRadius: 18, padding: 0 }, body: { padding: 0 } }}
            >
                {panel}
            </Modal>
        </>
    );
}

function AnnouncementPanel({
    announcements,
    error,
    expandedId,
    loading,
    sessionUnreadIds,
    onClose,
    onExpand,
    onRetry,
}: {
    announcements: PublicAnnouncement[];
    error: Error | null;
    expandedId: string;
    loading: boolean;
    sessionUnreadIds: ReadonlySet<string>;
    onClose: () => void;
    onExpand: (id: string) => void;
    onRetry: () => void;
}) {
    return (
        <section className="flex max-h-[72dvh] min-h-0 w-full flex-col bg-white text-[#20242a] dark:bg-[#15181d] dark:text-[#f3f5f7] sm:max-h-[560px]" aria-label="公告通知中心">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e8ebef] px-4 py-3.5 dark:border-[#2a2f36]">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eef1f5] text-[#536178] dark:bg-[#232831] dark:text-[#d8dee8]">
                        <Megaphone className="size-[17px]" />
                    </span>
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold tracking-tight">通知中心</h2>
                        <p className="mt-0.5 text-[11px] text-[#8a939f] dark:text-[#8f98a5]">站点更新与服务公告</p>
                    </div>
                </div>
                <button
                    type="button"
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-[#7c8591] transition hover:bg-[#f1f3f5] hover:text-[#20242a] dark:text-[#9aa3af] dark:hover:bg-[#22262c] dark:hover:text-white"
                    onClick={onClose}
                    aria-label="关闭通知中心"
                    title="关闭"
                >
                    <X className="size-4" />
                </button>
            </header>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {loading ? <AnnouncementLoading /> : null}
                {!loading && error ? <AnnouncementError onRetry={onRetry} /> : null}
                {!loading && !error && announcements.length ? (
                    <div className="divide-y divide-[#edf0f3] dark:divide-[#272c33]">
                        {announcements.map((announcement) => (
                            <AnnouncementRow key={announcement.id} announcement={announcement} expanded={expandedId === announcement.id} unread={sessionUnreadIds.has(announcement.id)} onExpand={() => onExpand(announcement.id)} />
                        ))}
                    </div>
                ) : null}
                {!loading && !error && !announcements.length ? (
                    <div className="grid min-h-40 place-items-center px-5 py-10 text-center">
                        <div>
                            <Bell className="mx-auto size-5 text-[#a4acb6]" />
                            <p className="mt-3 text-sm font-medium">暂时没有新公告</p>
                            <p className="mt-1 text-xs text-[#8a939f] dark:text-[#8f98a5]">后续通知会在这里集中展示</p>
                        </div>
                    </div>
                ) : null}
            </div>
            <Link
                href="/announcements"
                onClick={onClose}
                className="flex h-11 shrink-0 items-center justify-center border-t border-[#e8ebef] text-xs font-semibold text-[#59677d] transition hover:bg-[#f7f8fa] hover:text-[#20242a] dark:border-[#2a2f36] dark:text-[#c2c8d1] dark:hover:bg-[#1d2127] dark:hover:text-white"
            >
                查看全部公告
            </Link>
        </section>
    );
}

function AnnouncementRow({ announcement, expanded, unread, onExpand }: { announcement: PublicAnnouncement; expanded: boolean; unread: boolean; onExpand: () => void }) {
    return (
        <button type="button" className="group relative block w-full px-4 py-3.5 text-left transition hover:bg-[#f7f8fa] dark:hover:bg-[#1d2127]" onClick={onExpand} aria-expanded={expanded}>
            <span className={cn("absolute left-4 top-[19px] size-2 rounded-full ring-4 ring-white dark:ring-[#15181d]", unread ? "bg-[#66758e] dark:bg-[#d8dee8]" : "bg-[#cbd0d6] dark:bg-[#4b535e]")} aria-hidden="true" />
            <div className="min-w-0 pl-5">
                <div className="flex items-start justify-between gap-3">
                    <h3 className={cn("min-w-0 flex-1 text-sm leading-5", unread ? "font-semibold text-[#20242a] dark:text-white" : "font-medium text-[#444c56] dark:text-[#d2d7de]")}>{announcement.title}</h3>
                    <ChevronDown className={cn("mt-0.5 size-3.5 shrink-0 text-[#9aa2ad] transition", expanded && "rotate-180")} />
                </div>
                <p className={cn("mt-1 whitespace-pre-wrap text-xs leading-5 text-[#6f7884] dark:text-[#a7afb9]", expanded ? "" : "line-clamp-2")}>{announcement.content}</p>
                <time className="mt-1.5 block text-[11px] text-[#9aa2ad] dark:text-[#737d89]">{formatAnnouncementTime(announcement.createdAt)}</time>
            </div>
        </button>
    );
}

function AnnouncementLoading() {
    return (
        <div className="divide-y divide-[#edf0f3] dark:divide-[#272c33]" aria-label="公告加载中">
            {[0, 1, 2].map((item) => (
                <div key={item} className="animate-pulse px-4 py-4">
                    <div className="ml-5 h-3 w-2/3 rounded bg-[#e8ebef] dark:bg-[#2a3038]" />
                    <div className="ml-5 mt-2 h-2.5 w-full rounded bg-[#f0f2f4] dark:bg-[#22272e]" />
                    <div className="ml-5 mt-2 h-2.5 w-16 rounded bg-[#f0f2f4] dark:bg-[#22272e]" />
                </div>
            ))}
        </div>
    );
}

function AnnouncementError({ onRetry }: { onRetry: () => void }) {
    return (
        <div className="grid min-h-40 place-items-center px-5 py-10 text-center">
            <div>
                <p className="text-sm font-medium">公告暂时无法加载</p>
                <button
                    type="button"
                    className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dfe3e8] px-3 text-xs font-semibold text-[#59616c] transition hover:bg-[#f3f5f7] hover:text-[#20242a] dark:border-[#343a43] dark:text-[#c4cad2] dark:hover:bg-[#22262c] dark:hover:text-white"
                    onClick={onRetry}
                >
                    <RotateCcw className="size-3.5" /> 重新加载
                </button>
            </div>
        </div>
    );
}
