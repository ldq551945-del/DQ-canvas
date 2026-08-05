import { randomUUID } from "node:crypto";

import type { BackgroundRemovalModel, BackgroundRemovalOptionsV1 } from "@/lib/background-removal-options";
import { backgroundRemovalProgressSnapshot, resolveBackgroundRemovalProgressStage, type BackgroundRemovalProgressStage } from "@/lib/background-removal-progress";
import type { GenerationTaskContext } from "@/lib/server/generation-task-store";
import { createStoredGenerationTask, getStoredGenerationTask, mutateStoredGenerationTask, transitionStoredGenerationTask } from "@/lib/server/generation-task-store";
import { GENERATION_TASK_RETENTION_MS } from "@/lib/server/generation-task-retention";

export type BackgroundRemovalTaskStatus = "pending" | "running" | "success" | "error" | "cancelled";

export type BackgroundRemovalResult = {
    storageKey: string;
    serverUrl: string;
    mimeType: "image/png";
    bytes: number;
    width: number;
    height: number;
    options: BackgroundRemovalOptionsV1;
    optionsHash: string;
    model: BackgroundRemovalModel;
};

export type BackgroundRemovalTask = GenerationTaskContext & {
    id: string;
    userId: string;
    operation: "remove-background";
    sourceStorageKey: string;
    sourceNodeId?: string;
    sourceMimeType: string;
    sourceBytes: number;
    sourceWidth: number;
    sourceHeight: number;
    options: BackgroundRemovalOptionsV1;
    optionsHash: string;
    model: BackgroundRemovalModel;
    providerAttempt: number;
    status: BackgroundRemovalTaskStatus;
    progressStage?: BackgroundRemovalProgressStage;
    progress?: number;
    createdAt: number;
    updatedAt: number;
    result?: BackgroundRemovalResult;
    error?: string;
};

type BackgroundRemovalTaskInput = Omit<BackgroundRemovalTask, "id" | "status" | "createdAt" | "updatedAt" | "providerAttempt"> & { providerAttempt?: number };

/**
 * Keeps the legacy task-only API for callers that do not need to distinguish a
 * fresh insert from an idempotent duplicate. The route uses the detailed form
 * so a racing request cannot reschedule an already-running task.
 */
export async function createBackgroundRemovalTask(input: BackgroundRemovalTaskInput) {
    return (await createBackgroundRemovalTaskWithResult(input)).task;
}

export async function createBackgroundRemovalTaskWithResult(input: BackgroundRemovalTaskInput) {
    const now = Date.now();
    const candidateId = randomUUID();
    const queuedProgress = backgroundRemovalProgressSnapshot("queued");
    const task: BackgroundRemovalTask = {
        ...input,
        id: candidateId,
        status: "pending",
        progressStage: queuedProgress.stage,
        progress: queuedProgress.progress,
        providerAttempt: Math.max(0, Math.floor(Number(input.providerAttempt) || 0)),
        createdAt: now,
        updatedAt: now,
    };
    const stored = await createStoredGenerationTask("image_process", task, GENERATION_TASK_RETENTION_MS, {
        executionPhase: "submitting",
        provider: "rembg",
        nextPollAt: now,
        lastUpstreamStatus: "processing",
    });
    return { task: stored, created: stored.id === candidateId };
}

export function getBackgroundRemovalTask(id: string) {
    return getStoredGenerationTask<BackgroundRemovalTask>("image_process", id);
}

export function transitionBackgroundRemovalTask(
    task: BackgroundRemovalTask,
    allowedStatuses: BackgroundRemovalTaskStatus[],
    patch: Partial<Pick<BackgroundRemovalTask, "result" | "error" | "providerAttempt" | "model" | "progressStage" | "progress">> & { status: BackgroundRemovalTaskStatus },
) {
    return transitionStoredGenerationTask<BackgroundRemovalTask>("image_process", task.id, task.userId, allowedStatuses, patch, GENERATION_TASK_RETENTION_MS);
}

export function updateBackgroundRemovalTask(id: string, patch: Partial<Pick<BackgroundRemovalTask, "result" | "error" | "providerAttempt" | "model" | "progressStage" | "progress">>) {
    return mutateStoredGenerationTask<BackgroundRemovalTask>("image_process", id, GENERATION_TASK_RETENTION_MS, (current) => (current.status === "pending" || current.status === "running" ? { ...current, ...patch } : null));
}

export function publicBackgroundRemovalTask(task: BackgroundRemovalTask) {
    const progress = backgroundRemovalProgressSnapshot(resolveBackgroundRemovalProgressStage(task.progressStage, task.status), task.progress);
    return {
        id: task.id,
        operation: task.operation,
        status: task.status,
        progress: progress.progress,
        progressStage: progress.stage,
        stage: progress.label,
        sourceStorageKey: task.sourceStorageKey,
        sourceNodeId: task.sourceNodeId,
        sourceMimeType: task.sourceMimeType,
        sourceBytes: task.sourceBytes,
        sourceWidth: task.sourceWidth,
        sourceHeight: task.sourceHeight,
        options: task.options,
        optionsHash: task.optionsHash,
        model: task.model,
        projectId: task.projectId,
        result: task.result,
        error: task.error,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
    };
}
