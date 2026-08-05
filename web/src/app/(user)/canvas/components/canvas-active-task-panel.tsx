"use client";

import { ChevronDown, ChevronUp, Clock3, Coins, ListTodo, LoaderCircle, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasGenerationTask } from "@/services/api/generation-tasks";
import { useThemeStore } from "@/stores/use-theme-store";

const copy = {
    panelLabel: "\u5f53\u524d\u753b\u5e03\u751f\u6210\u4efb\u52a1",
    taskTitle: "\u751f\u6210\u4efb\u52a1",
    activeCount: "\u4e2a\u8fdb\u884c\u4e2d",
    unknownProgress: "\u8fdb\u5ea6\u672a\u77e5",
    elapsed: "\u5df2\u8fd0\u884c",
    queued: "\u5df2\u7b49\u5f85",
    duration: "\u8017\u65f6",
    unbilled: "\u672a\u8ba1\u8d39",
    refunded: "\u5df2\u9000\u8fd8",
    taskStage: "\u4efb\u52a1\u9636\u6bb5",
    model: "\u6a21\u578b",
    taskId: "\u4efb\u52a1 ID\uff1a",
    generation: "\u751f\u6210\u4efb\u52a1",
};

const statusLabel: Record<CanvasGenerationTask["status"], string> = {
    queued: "\u6392\u961f\u4e2d",
    running: "\u751f\u6210\u4e2d",
    paused: "\u5df2\u6682\u505c",
    succeeded: "\u5df2\u5b8c\u6210",
    failed: "\u5931\u8d25",
    cancelled: "\u5df2\u53d6\u6d88",
};

const typeLabel: Record<string, string> = {
    image: "\u56fe\u7247\u751f\u6210",
    video: "\u89c6\u9891\u751f\u6210",
    audio: "\u97f3\u9891\u751f\u6210",
    text: "\u6587\u672c\u751f\u6210",
    agent: "Agent \u4efb\u52a1",
    render: "\u6e32\u67d3\u4efb\u52a1",
    image_process: "\u56fe\u7247\u5904\u7406",
};

export function CanvasActiveTaskPanel({ tasks }: { tasks: CanvasGenerationTask[] }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [now, setNow] = useState(() => Date.now());
    const [open, setOpen] = useState(false);
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

    useEffect(() => {
        if (!tasks.length) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [tasks.length]);

    useEffect(() => {
        if (expandedTaskId && !tasks.some((task) => task.id === expandedTaskId)) setExpandedTaskId(null);
    }, [expandedTaskId, tasks]);

    if (!tasks.length) return null;

    return (
        <section
            data-canvas-no-zoom
            aria-label={copy.panelLabel}
            className="pointer-events-auto absolute right-3 top-[72px] z-[120] w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-2xl border backdrop-blur-xl"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: "0 20px 60px rgba(15,23,42,.18)" }}
        >
            <span className="sr-only" aria-live="polite" aria-atomic="true">
                {tasks.map((task) => `${task.id} ${statusLabel[task.status]}${task.stage ? ` ${task.stage}` : ""}${typeof task.progress === "number" ? ` ${task.progress}%` : ""}`).join("，")}
            </span>
            <button
                type="button"
                className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-controls="canvas-active-task-list"
            >
                <span className="flex min-w-0 items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[10px]" style={{ background: theme.toolbar.activeBg, color: theme.node.activeStroke }}>
                        <ListTodo className="size-4" />
                    </span>
                    <span className="min-w-0">
                        <span className="block text-sm font-semibold leading-5">{copy.taskTitle}</span>
                        <span className="block truncate text-[11px]" style={{ color: theme.node.muted }}>
                            {copy.panelLabel} · {tasks.length} {copy.activeCount}
                        </span>
                    </span>
                </span>
                <span className="flex shrink-0 items-center gap-2" style={{ color: theme.node.activeStroke }}>
                    <LoaderCircle className="size-4 animate-spin opacity-75 motion-reduce:animate-none" />
                    {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </span>
            </button>

            {open ? (
                <div id="canvas-active-task-list" className="thin-scrollbar max-h-[min(70vh,520px)] space-y-2 overflow-y-auto px-2.5 pb-2.5">
                    {tasks.map((task) => (
                        <ActiveTaskCard key={task.id} task={task} now={now} theme={theme} expanded={expandedTaskId === task.id} onToggle={() => setExpandedTaskId((current) => (current === task.id ? null : task.id))} />
                    ))}
                </div>
            ) : null}
        </section>
    );
}

export function ActiveTaskCard({ task, now, theme, expanded, onToggle }: { task: CanvasGenerationTask; now: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; expanded: boolean; onToggle: () => void }) {
    const progress = typeof task.progress === "number" ? Math.max(0, Math.min(100, task.progress)) : undefined;
    const elapsedMs = Math.max(0, now - task.createdAt);
    const isTerminal = task.status === "succeeded" || task.status === "failed" || task.status === "cancelled";
    const statusTone = task.status === "failed" ? "#ef6a6a" : task.status === "succeeded" ? "#62c59b" : theme.node.activeStroke;
    const durationLabel = `${task.status === "queued" ? copy.queued : isTerminal ? copy.duration : copy.elapsed} ${formatDuration(elapsedMs)}`;
    const billingLabel = task.billing ? (task.billing.refunded ? copy.refunded : `${task.billing.pointsCost} \u79ef\u5206`) : copy.unbilled;
    const backgroundRemovalStages = task.type === "image_process" ? ["queued", "reading_source", "inference", "saving", "completed"] : [];
    const activeBackgroundRemovalStage = task.progressStage === "failed" || task.progressStage === "cancelled" ? -1 : backgroundRemovalStages.indexOf(task.progressStage || "queued");

    return (
        <article className="overflow-hidden rounded-xl border" style={{ background: theme.node.fill, borderColor: theme.toolbar.border }}>
            <button type="button" className="block w-full p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]" onClick={onToggle} aria-expanded={expanded}>
                <div className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md" style={{ background: `${statusTone}20`, color: statusTone }}>
                        {task.status === "failed" ? <XCircle className="size-3.5" /> : <ListTodo className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold" title={task.prompt || typeLabel[task.type]}>
                                {typeLabel[task.type] || copy.generation}
                            </span>
                            <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium" style={{ borderColor: `${statusTone}55`, color: statusTone }}>
                                {statusLabel[task.status]}
                            </span>
                        </span>
                        <span className="mt-1 block truncate text-[11px]" style={{ color: theme.node.muted }} title={task.stage || statusLabel[task.status]}>
                            {task.stage || statusLabel[task.status]}
                        </span>
                    </span>
                    {expanded ? <ChevronUp className="mt-0.5 size-3.5 shrink-0" style={{ color: theme.node.muted }} /> : <ChevronDown className="mt-0.5 size-3.5 shrink-0" style={{ color: theme.node.muted }} />}
                </div>

                <div className="mt-3 h-1 overflow-hidden rounded-full" style={{ background: theme.toolbar.itemHover }} aria-label={progress === undefined ? copy.unknownProgress : `\u8fdb\u5ea6 ${progress}%`}>
                    {progress === undefined ? (
                        <div className="canvas-task-progress-indeterminate h-full w-2/5 rounded-full motion-reduce:animate-none" style={{ background: statusTone }} />
                    ) : (
                        <div className="relative h-full overflow-hidden rounded-full transition-[width] duration-300" style={{ width: `${progress}%`, background: statusTone }}>
                            {task.status === "running" ? <span className="canvas-task-progress-shimmer absolute inset-0 motion-reduce:hidden" /> : null}
                        </div>
                    )}
                </div>

                <div className="mt-1.5 flex justify-end text-[10px]" style={{ color: theme.node.muted }}>
                    {progress === undefined ? copy.unknownProgress : `\u8fdb\u5ea6 ${progress}%`}
                </div>

                {backgroundRemovalStages.length ? (
                    <ol className="mt-2 grid grid-cols-5 gap-1 text-center text-[9px]" aria-label="\u62a0\u56fe\u5904\u7406\u9636\u6bb5">
                        {["\u6392\u961f", "\u8bfb\u53d6", "\u63a8\u7406", "\u4fdd\u5b58", "\u5b8c\u6210"].map((label, index) => (
                            <li key={label} aria-current={index === activeBackgroundRemovalStage ? "step" : undefined} style={{ color: index <= activeBackgroundRemovalStage ? statusTone : theme.node.muted }}>
                                {label}
                            </li>
                        ))}
                    </ol>
                ) : null}

                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]" style={{ color: theme.node.muted }}>
                    <span className="inline-flex min-w-0 items-center gap-1 truncate" title={durationLabel}>
                        <Clock3 className="size-3 shrink-0" />
                        {durationLabel}
                    </span>
                    <span className="inline-flex min-w-0 items-center justify-end gap-1 truncate" title={billingLabel}>
                        <Coins className="size-3 shrink-0" />
                        {billingLabel}
                    </span>
                </div>
            </button>

            {expanded ? (
                <div className="border-t px-3 pb-3 pt-2 text-[11px]" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}>
                    {task.prompt ? (
                        <p className="mb-2 line-clamp-3 break-words" style={{ color: theme.node.text }}>
                            {task.prompt}
                        </p>
                    ) : null}
                    <div className="flex items-center justify-between gap-2">
                        <span>{copy.taskStage}</span>
                        <span className="max-w-[210px] truncate text-right" style={{ color: theme.node.text }}>
                            {task.stage || statusLabel[task.status]}
                        </span>
                    </div>
                    {task.model ? (
                        <div className="mt-1 flex items-center justify-between gap-2">
                            <span>{copy.model}</span>
                            <span className="max-w-[210px] truncate text-right" style={{ color: theme.node.text }}>
                                {task.model}
                            </span>
                        </div>
                    ) : null}
                    {task.error ? <p className="mt-2 break-words text-red-400">{task.error}</p> : null}
                    <p className="mt-2 truncate text-[10px]">
                        {copy.taskId}
                        {task.id}
                    </p>
                </div>
            ) : null}
        </article>
    );
}

function formatDuration(value: number) {
    const totalSeconds = Math.floor(value / 1_000);
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
