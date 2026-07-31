import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";
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
