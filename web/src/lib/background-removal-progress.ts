export type BackgroundRemovalProgressStage = "queued" | "reading_source" | "inference" | "saving" | "completed" | "failed" | "cancelled";

const MILESTONES: Record<Exclude<BackgroundRemovalProgressStage, "failed" | "cancelled">, { progress: number; label: string }> = {
    queued: { progress: 0, label: "\u6392\u961f\u4e2d" },
    reading_source: { progress: 25, label: "\u8bfb\u53d6\u7d20\u6750" },
    inference: { progress: 50, label: "rembg \u63a8\u7406" },
    saving: { progress: 75, label: "\u4fdd\u5b58\u7ed3\u679c" },
    completed: { progress: 100, label: "\u5df2\u5b8c\u6210" },
};

const TERMINAL_LABELS: Record<"failed" | "cancelled", string> = {
    failed: "\u5931\u8d25",
    cancelled: "\u5df2\u53d6\u6d88",
};

export function backgroundRemovalProgressSnapshot(stage: BackgroundRemovalProgressStage, currentProgress?: unknown) {
    if (stage === "failed" || stage === "cancelled") return { stage, progress: normalizeProgress(currentProgress), label: TERMINAL_LABELS[stage] };
    return { stage, ...MILESTONES[stage] };
}

export function resolveBackgroundRemovalProgressStage(value: unknown, status?: string): BackgroundRemovalProgressStage {
    if (status === "success") return "completed";
    if (status === "error") return "failed";
    if (status === "cancelled") return "cancelled";
    if (isBackgroundRemovalProgressStage(value)) return value;
    return "queued";
}

export function isBackgroundRemovalProgressStage(value: unknown): value is BackgroundRemovalProgressStage {
    return value === "queued" || value === "reading_source" || value === "inference" || value === "saving" || value === "completed" || value === "failed" || value === "cancelled";
}

function normalizeProgress(value: unknown) {
    const progress = Number(value);
    return Number.isFinite(progress) ? Math.max(0, Math.min(99, Math.round(progress))) : 0;
}
