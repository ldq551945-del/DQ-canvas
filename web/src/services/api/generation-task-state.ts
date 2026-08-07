export type GenerationTaskExecutionState = {
    needsReview?: boolean;
    executionPhase?: string;
    publicStatus?: "queued" | "submitting" | "generating" | "retryable" | "failed" | "cancelled" | "needs_review" | "succeeded";
    progress?: number;
    elapsedMs?: number;
    startedAt?: number;
    updatedAt?: number;
    submittedAt?: number;
    lastPollAt?: number;
    lastUpstreamStatus?: string;
    canRetry?: boolean;
    message?: string;
};

export const GENERATION_TASK_STATE_PERSIST_INTERVAL_MS = 5_000;

export class GenerationTaskStatePersistenceGate {
    private readonly markers = new Map<string, { phase: string; persistedAt: number }>();

    constructor(private readonly intervalMs = GENERATION_TASK_STATE_PERSIST_INTERVAL_MS) {}

    shouldPersist(key: string, state: GenerationTaskExecutionState, now = Date.now()) {
        const phase = `${state.publicStatus || ""}:${state.executionPhase || ""}`;
        const previous = this.markers.get(key);
        if (previous && previous.phase === phase && now - previous.persistedAt < this.intervalMs) return false;
        this.markers.set(key, { phase, persistedAt: now });
        return true;
    }

    forget(key: string) {
        this.markers.delete(key);
    }

    clear() {
        this.markers.clear();
    }
}

export const GENERATION_TASK_NEEDS_REVIEW_MESSAGE = "上游创建状态待确认，系统已停止重复创建，请联系管理员处理";

export class GenerationTaskNeedsReviewError extends Error {
    constructor() {
        super(GENERATION_TASK_NEEDS_REVIEW_MESSAGE);
        this.name = "GenerationTaskNeedsReviewError";
    }
}

export function isGenerationTaskNeedsReviewError(error: unknown) {
    return error instanceof GenerationTaskNeedsReviewError || (error instanceof Error && error.message === GENERATION_TASK_NEEDS_REVIEW_MESSAGE);
}
