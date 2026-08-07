import type { GenerationTaskExecutionPhase } from "@/lib/server/generation-task-scheduler";
import type { StoredGenerationTaskRecord } from "@/lib/server/generation-task-store";

export type GenerationTaskPublicStatus = "queued" | "submitting" | "generating" | "retryable" | "failed" | "cancelled" | "needs_review" | "succeeded";

export type GenerationTaskPublicState = {
    publicStatus: GenerationTaskPublicStatus;
    executionPhase?: GenerationTaskExecutionPhase;
    progress?: number;
    elapsedMs: number;
    startedAt: number;
    updatedAt: number;
    submittedAt?: number;
    lastPollAt?: number;
    lastUpstreamStatus?: string;
    canRetry: boolean;
    message: string;
};

type PublicTaskInput = {
    status?: string;
    error?: string;
    retryable?: boolean;
    createdAt?: number;
    updatedAt?: number;
    executionPhase?: GenerationTaskExecutionPhase;
    submittedAt?: number;
    lastPollAt?: number;
    lastUpstreamStatus?: string;
    resultPayload?: Record<string, unknown>;
};

export function publicGenerationTaskState(
    task: PublicTaskInput,
    record?: Partial<Pick<StoredGenerationTaskRecord, "executionPhase" | "submittedAt" | "lastPollAt" | "lastUpstreamStatus" | "resultPayload" | "createdAt" | "updatedAt">>,
    now = Date.now(),
): GenerationTaskPublicState {
    const executionPhase = record?.executionPhase || task.executionPhase;
    const createdAt = finiteTime(record?.createdAt ?? task.createdAt) || now;
    const updatedAt = finiteTime(record?.updatedAt ?? task.updatedAt) || createdAt;
    const submittedAt = finiteTime(record?.submittedAt ?? task.submittedAt);
    const lastPollAt = finiteTime(record?.lastPollAt ?? task.lastPollAt);
    const lastUpstreamStatus = cleanText(record?.lastUpstreamStatus ?? task.lastUpstreamStatus);
    const resultPayload = record?.resultPayload || task.resultPayload;
    const status = task.status || "pending";
    let publicStatus: GenerationTaskPublicStatus;
    if (executionPhase === "needs_review" || executionPhase === "review_unavailable") publicStatus = "needs_review";
    else if (status === "cancelled") publicStatus = "cancelled";
    else if (["success", "succeeded", "completed"].includes(status)) publicStatus = "succeeded";
    else if (["error", "failed", "failure"].includes(status)) publicStatus = task.retryable ? "retryable" : "failed";
    else if (executionPhase === "submitting") publicStatus = "submitting";
    else if (executionPhase === "created" || (executionPhase === undefined && status !== "running")) publicStatus = "queued";
    else publicStatus = "generating";

    // 待确认仍是未解决状态，耗时应继续增长，避免把提交异常误显示成瞬时终态。
    const terminal = ["succeeded", "failed", "retryable", "cancelled"].includes(publicStatus);
    const elapsedMs = Math.max(0, (terminal ? updatedAt : now) - createdAt);
    return {
        publicStatus,
        executionPhase,
        progress: readProgress(resultPayload),
        elapsedMs,
        startedAt: submittedAt || createdAt,
        updatedAt,
        submittedAt: submittedAt || undefined,
        lastPollAt: lastPollAt || undefined,
        lastUpstreamStatus,
        canRetry: publicStatus === "retryable",
        message: stateMessage(publicStatus, lastUpstreamStatus, executionPhase),
    };
}

function readProgress(payload?: Record<string, unknown>) {
    if (!payload) return undefined;
    const candidates = [payload.progress, payload.percentage, payload.progressPercent, payload.percent];
    for (const value of candidates) {
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0 && number <= 100) return Math.round(number);
    }
    return undefined;
}

function stateMessage(status: GenerationTaskPublicStatus, lastUpstreamStatus?: string, executionPhase?: GenerationTaskExecutionPhase) {
    if (status === "cancelled" && (executionPhase === "cancel_requested" || executionPhase === "cancel_polling")) return "已提交取消，正在确认上游状态";
    if (status === "cancelled" && lastUpstreamStatus === "cancel_unconfirmed") return "上游终态未确认，积分暂未退回";
    if (status === "cancelled" && (lastUpstreamStatus?.startsWith("cancelled_") || lastUpstreamStatus === "cancelled_before_submission")) return "任务已取消，余额正在更新";
    switch (status) {
        case "queued":
            return "排队中";
        case "submitting":
            return "提交中";
        case "generating":
            return "生成中";
        case "retryable":
            return "可重试";
        case "failed":
            return "失败";
        case "cancelled":
            return "已取消";
        case "needs_review":
            return "待确认";
        case "succeeded":
            return "已完成";
    }
}

function finiteTime(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function cleanText(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : undefined;
}
