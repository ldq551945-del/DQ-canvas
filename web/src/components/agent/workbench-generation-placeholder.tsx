import { cn } from "@/lib/utils";
import styles from "./workbench-generation-placeholder.module.css";

export function WorkbenchGenerationPlaceholder({ kind, className }: { kind: "image" | "video"; className?: string }) {
    const label = kind === "image" ? "图片正在生成" : "视频正在生成";
    return (
        <div role="status" aria-label={label} aria-busy="true" className={cn(styles.placeholder, "relative isolate overflow-hidden rounded-lg border border-white/70 bg-[#f7f8fb] dark:border-white/10 dark:bg-[#111318]", className)}>
            <div className={styles.smokeBase} aria-hidden="true" />
            <div className={styles.smokeA} aria-hidden="true" />
            <div className={styles.smokeB} aria-hidden="true" />
            <div className={styles.smokeC} aria-hidden="true" />
            <div className={styles.sheen} aria-hidden="true" />
            {kind === "video" ? (
                <div className={styles.timeline} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </div>
            ) : null}
            <span className="sr-only">{label}</span>
        </div>
    );
}

export function WorkbenchGenerationActivity({ kind, count }: { kind: "image" | "video"; count: number }) {
    const label = `${count} 个${kind === "image" ? "图片" : "视频"}任务正在生成`;
    return (
        <span role="status" aria-label={label} aria-busy="true" className="relative inline-flex h-7 w-11 items-center justify-center overflow-hidden rounded-full border border-sky-200/80 bg-sky-50/80 dark:border-sky-500/20 dark:bg-sky-500/10">
            <span className="absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_center,rgba(56,189,248,.2),transparent_68%)] [animation-duration:1.8s]" aria-hidden="true" />
            <span className="relative flex items-end gap-1" aria-hidden="true">
                <span className="h-1.5 w-1 animate-pulse rounded-full bg-sky-600 [animation-duration:1.2s] dark:bg-sky-300" />
                <span className="h-3 w-1 animate-pulse rounded-full bg-sky-600 [animation-delay:-.4s] [animation-duration:1.2s] dark:bg-sky-300" />
                <span className="h-2 w-1 animate-pulse rounded-full bg-sky-600 [animation-delay:-.8s] [animation-duration:1.2s] dark:bg-sky-300" />
            </span>
            <span className="sr-only">{label}</span>
        </span>
    );
}
