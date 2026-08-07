import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";
import type { GenerationTaskExecutionState } from "@/services/api/generation-task-state";
import styles from "./workbench-generation-placeholder.module.css";

export const GENERATION_PLACEHOLDER_TILE_COUNT = 96;
const GPT_IMAGE_TILE_PALETTE = [
    ["#d9f4ee", "#4dc8ae"],
    ["#dbeafe", "#5b9cf5"],
    ["#e9e3ff", "#9b82ee"],
    ["#fde8f1", "#ee7caf"],
    ["#ffe5da", "#f58a6d"],
    ["#fff1c9", "#eeb84b"],
    ["#dff3fb", "#56b8df"],
    ["#e2f4df", "#69be70"],
] as const;

export function WorkbenchGenerationPlaceholder({ kind, className }: { kind: "image" | "video"; className?: string }) {
    const label = kind === "image" ? "图片正在生成" : "视频正在生成";
    return (
        <div role="status" aria-label={label} aria-busy="true" className={cn(styles.placeholder, "relative isolate overflow-hidden rounded-lg border border-border bg-muted", className)}>
            <span className={styles.cube} aria-hidden="true">
                {Array.from({ length: GENERATION_PLACEHOLDER_TILE_COUNT }, (_, index) => {
                    const colors = GPT_IMAGE_TILE_PALETTE[(index * 5 + Math.floor(index / 12) * 3) % GPT_IMAGE_TILE_PALETTE.length];
                    return <span key={index} style={{ "--cube-index": index, "--cube-base": colors[0], "--cube-peak": colors[1] } as CSSProperties} />;
                })}
            </span>
            <span className={styles.sheen} aria-hidden="true" />
        </div>
    );
}

export function WorkbenchGenerationStatus({ state }: { state?: GenerationTaskExecutionState }) {
    const status = state?.message || "排队中";
    const elapsed = formatElapsed(state?.elapsedMs);
    const progress = typeof state?.progress === "number" ? Math.max(0, Math.min(100, Math.round(state.progress))) : undefined;
    return (
        <span className="pointer-events-none absolute inset-x-3 bottom-3 z-10 rounded-md border border-white/50 bg-white/90 px-2.5 py-2 text-xs text-stone-700 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-stone-950/85 dark:text-stone-200">
            <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{status}</span>
                <span className="text-stone-500 dark:text-stone-400">{elapsed}</span>
            </span>
            {progress !== undefined ? (
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-stone-200 dark:bg-white/10" aria-label={`真实进度 ${progress}%`}>
                    <span className="block h-full rounded-full bg-sky-500 transition-[width]" style={{ width: `${progress}%` }} />
                </span>
            ) : null}
        </span>
    );
}

function formatElapsed(value?: number) {
    const seconds = Math.max(0, Math.floor(Number(value) / 1000) || 0);
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}分${String(seconds % 60).padStart(2, "0")}秒` : `${seconds}秒`;
}

export function WorkbenchGenerationActivity({ kind, count }: { kind: "image" | "video"; count: number }) {
    const label = `${count} 个${kind === "image" ? "图片" : "视频"}任务正在生成`;
    return (
        <span role="status" aria-label={label} aria-busy="true" className="relative inline-flex h-7 w-11 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground">
            <span className="relative flex items-end gap-1" aria-hidden="true">
                <span className="h-1.5 w-1 animate-pulse rounded-full bg-current [animation-duration:1.2s]" />
                <span className="h-3 w-1 animate-pulse rounded-full bg-current [animation-delay:-.4s] [animation-duration:1.2s]" />
                <span className="h-2 w-1 animate-pulse rounded-full bg-current [animation-delay:-.8s] [animation-duration:1.2s]" />
            </span>
            <span className="sr-only">{label}</span>
        </span>
    );
}
