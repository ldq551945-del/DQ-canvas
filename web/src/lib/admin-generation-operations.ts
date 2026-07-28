import type { GenerationTaskType } from "@/lib/server/generation-task-store";
import type { GenerationAttempt } from "@/lib/server/generation-attempt";

export type AdminGenerationTask = {
    id: string;
    userId: string;
    accountId?: string;
    username: string;
    displayName: string;
    type: GenerationTaskType;
    status: "pending" | "running" | "success" | "error" | "paused" | "cancelled";
    surface?: "chat" | "canvas" | "drama";
    conversationId?: string;
    runId?: string;
    projectId?: string;
    parentTaskId?: string;
    attemptNo?: number;
    model: string;
    channelId?: string;
    attempts?: GenerationAttempt[];
    prompt: string;
    error?: string;
    durationMs: number;
    pointsCost: number;
    createdAt: number;
    updatedAt: number;
    canCancel: boolean;
    retryTaskId?: string;
};

export type AdminGenerationChannel = {
    id: string;
    name: string;
    capability: "text" | "image" | "video" | "audio";
    logicalModelId: string;
    logicalModelName: string;
    upstreamModel: string;
    enabled: boolean;
    runtimeHealth: {
        status: "healthy" | "cooling";
        consecutiveFailures: number;
        cooldownUntil?: number;
        lastError?: string;
    };
};

export type AdminGenerationOperationsPayload = {
    items: AdminGenerationTask[];
    total: number;
    page: number;
    pageSize: number;
    summary: {
        total: number;
        active: number;
        success: number;
        failed: number;
        averageDurationMs: number;
        totalPointsCost: number;
        byType: Record<string, number>;
        byStatus: Record<string, number>;
    };
    channels: AdminGenerationChannel[];
};
