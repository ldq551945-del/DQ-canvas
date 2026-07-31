"use client";

import type { ReactNode } from "react";
import { Tag } from "antd";

const compactTagClass = "!m-0 !inline-flex !h-6 !min-w-max !shrink-0 !items-center !whitespace-nowrap !rounded-md !border !px-2 !text-xs !font-medium !leading-6";

const statusToneClass: Record<string, string> = {
    idle: "!border-border !bg-muted/60 !text-muted-foreground",
    queued: "!border-sky-200 !bg-sky-50 !text-sky-700 dark:!border-sky-900/70 dark:!bg-sky-950/35 dark:!text-sky-300",
    running: "!border-amber-200 !bg-amber-50 !text-amber-700 dark:!border-amber-900/70 dark:!bg-amber-950/35 dark:!text-amber-300",
    success: "!border-emerald-200 !bg-emerald-50 !text-emerald-700 dark:!border-emerald-900/70 dark:!bg-emerald-950/35 dark:!text-emerald-300",
    error: "!border-rose-200 !bg-rose-50 !text-rose-700 dark:!border-rose-900/70 dark:!bg-rose-950/35 dark:!text-rose-300",
    cancelled: "!border-border !bg-muted/60 !text-muted-foreground",
};

export function SectionTitle({ title, description, className = "" }: { title: string; description: string; className?: string }) {
    return (
        <div className={`mb-4 sm:mb-8 ${className}`}>
            <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground sm:mt-2 sm:leading-6">{description}</p>
        </div>
    );
}
export function GenerationTag({ status = "idle" }: { status?: string }) {
    const values: Record<string, string> = {
        idle: "未生成",
        queued: "排队中",
        running: "生成中",
        success: "已完成",
        error: "失败",
        cancelled: "已取消",
    };
    return <Tag className={`${compactTagClass} ${statusToneClass[status] || statusToneClass.idle}`}>{values[status] || values.idle}</Tag>;
}
export function StoryboardTag({ status = "idle" }: { status?: string }) {
    const values: Record<string, string> = {
        idle: "待分镜图",
        queued: "分镜排队",
        running: "分镜图生成中",
        success: "分镜图完成",
        error: "分镜图失败",
        cancelled: "分镜图取消",
    };
    return <Tag className={`${compactTagClass} ${statusToneClass[status] || statusToneClass.idle}`}>{values[status] || values.idle}</Tag>;
}
export function AudioTag({ status = "idle" }: { status?: string }) {
    const values: Record<string, string> = {
        idle: "未配音",
        queued: "配音排队",
        running: "配音中",
        success: "配音完成",
        error: "配音失败",
        cancelled: "配音取消",
    };
    return <Tag className={`${compactTagClass} ${statusToneClass[status] || statusToneClass.idle}`}>{values[status] || values.idle}</Tag>;
}
export function AssetPanel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
    return (
        <section className="rounded-xl border border-border bg-background p-3 sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex items-center gap-3 font-semibold sm:mb-6">
                {icon}
                {title}
            </div>
            {children}
        </section>
    );
}
export function AssetList({ items }: { items: Array<{ id: string; name: string; description: string }> }) {
    return items.length ? (
        <div className="mt-4 space-y-3 sm:mt-6 sm:space-y-4">
            {items.map((item) => (
                <div key={item.id} className="rounded-xl border border-border bg-card p-3 sm:p-4">
                    <div className="text-sm font-semibold">{item.name}</div>
                    <div className="mt-2 text-xs leading-5 text-muted-foreground">{item.description || "暂无描述"}</div>
                </div>
            ))}
        </div>
    ) : (
        <p className="mt-6 text-sm text-muted-foreground">暂未添加</p>
    );
}

export function stableTaskUrl(...values: Array<string | undefined>) {
    return values.find((value) => Boolean(value && !value.startsWith("data:") && !value.startsWith("blob:"))) || "";
}
