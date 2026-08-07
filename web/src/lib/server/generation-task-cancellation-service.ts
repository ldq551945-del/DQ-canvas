import { protocolAuthHeaders } from "@/lib/channel-protocol-registry";
import type { ApiCallFormat, SystemChannelAdvancedConfig } from "@/lib/auth/store";
import { fetchInternalApi, isInternalApiBaseUrl } from "@/lib/server/internal-origin";
import { workerHeaders } from "@/lib/server/maintenance-auth";
import { providerTaskPath } from "@/lib/server/provider-task-config";
import { fetchSafeOutboundUrl } from "@/lib/server/safe-outbound-fetch";
import { scheduleGenerationTask, type GenerationTaskExecutionPhase } from "@/lib/server/generation-task-scheduler";
import type { GenerationTaskType } from "@/lib/server/generation-task-store";
import { systemAiBillingHeaders } from "@/lib/server/system-ai-billing";

export type CancellableGenerationTaskType = Extract<GenerationTaskType, "text" | "image" | "video" | "audio">;

export type GenerationCancellationTarget = {
    type: CancellableGenerationTaskType;
    taskId: string;
    userId: string;
    executionPhase?: GenerationTaskExecutionPhase;
    upstreamTaskId?: string;
    queryPath?: string;
    config: {
        baseUrl: string;
        apiKey: string;
        apiFormat: ApiCallFormat;
        model: string;
        logicalModel?: string;
        channelId?: string;
        advancedConfig?: SystemChannelAdvancedConfig;
        capabilityProfile?: { timeoutMs?: number };
    };
};

export type UpstreamCancellationResult = "accepted" | "unsupported" | "deferred" | "not_submitted";

export function isCancellationExecutionPhase(value: GenerationTaskExecutionPhase | undefined): value is "cancel_requested" | "cancel_polling" {
    return value === "cancel_requested" || value === "cancel_polling";
}

export function cancellationExecutionPatch(target: GenerationCancellationTarget, now = Date.now()) {
    const upstreamTaskId = cancellableUpstreamTaskId(target.upstreamTaskId);
    return {
        executionPhase: "cancel_requested" as const,
        upstreamTaskId: upstreamTaskId || undefined,
        channelId: target.config.channelId,
        provider: target.config.advancedConfig?.protocol || target.config.apiFormat,
        queryPath: target.queryPath || target.config.advancedConfig?.queryPath,
        nextPollAt: now,
        lastUpstreamStatus: upstreamTaskId ? "cancel_requested" : "cancel_requested_without_upstream_id",
        resultPayload: { cancellationRequestedAt: now, submissionPhase: target.executionPhase || "created" },
    };
}

export function scheduleCancelledGenerationTask(target: GenerationCancellationTarget) {
    return scheduleGenerationTask(target.type, target.taskId, cancellationExecutionPatch(target), { cancellation: true });
}

export async function requestUpstreamGenerationCancellation(target: GenerationCancellationTarget, origin: string, cookie = "", workerUserId = ""): Promise<UpstreamCancellationResult> {
    const upstreamTaskId = cancellableUpstreamTaskId(target.upstreamTaskId);
    if (!upstreamTaskId) return "not_submitted";
    const attempts = cancellationAttempts(target, upstreamTaskId);
    if (!attempts.length) return "unsupported";
    let sawUnsupported = false;
    for (const attempt of attempts) {
        try {
            const response = await cancellationFetch(target, origin, cookie, workerUserId, attempt.path, attempt.method);
            await response.body?.cancel().catch(() => undefined);
            if (response.ok) return "accepted";
            if ([404, 405, 501].includes(response.status)) {
                sawUnsupported = true;
                continue;
            }
            return "deferred";
        } catch {
            return "deferred";
        }
    }
    return sawUnsupported ? "unsupported" : "deferred";
}

function cancellationAttempts(target: GenerationCancellationTarget, upstreamTaskId: string) {
    const configured = target.config.advancedConfig?.cancelPath?.trim();
    if (configured) {
        return [
            {
                path: providerTaskPath(configured, upstreamTaskId),
                method: target.config.advancedConfig?.cancelMethod === "DELETE" ? ("DELETE" as const) : ("POST" as const),
            },
        ];
    }
    if (target.config.advancedConfig?.protocol === "custom") return [];
    const configuredQuery = target.queryPath || target.config.advancedConfig?.queryPath;
    const queryBase = configuredQuery?.replace(/\/+:?task[_-]?id\b/gi, "").replace(/\/+$/, "");
    const id = encodeURIComponent(upstreamTaskId);
    const defaults =
        target.type === "video"
            ? [`${queryBase || "/videos"}/${id}/cancel`, `/videos/${id}/cancel`, `/video/generations/${id}/cancel`]
            : target.type === "audio"
              ? [`${queryBase || "/audio/speech"}/${id}/cancel`, `/audio/speech/${id}/cancel`]
              : target.type === "image"
                ? [`${queryBase || "/images/generations"}/${id}/cancel`, `/images/generations/${id}/cancel`]
                : [];
    return Array.from(new Set(defaults)).map((path) => ({ path, method: "POST" as const }));
}

async function cancellationFetch(target: GenerationCancellationTarget, origin: string, cookie: string, workerUserId: string, path: string, method: "POST" | "DELETE") {
    const internal = isInternalApiBaseUrl(target.config.baseUrl);
    const base = internal ? `${origin}${target.config.baseUrl}` : target.config.baseUrl;
    const url = `${base}`.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`);
    const headers = new Headers();
    if (internal) {
        if (workerUserId) Object.entries(workerHeaders(workerUserId)).forEach(([key, value]) => headers.set(key, value));
        else if (cookie) headers.set("cookie", cookie);
        Object.entries(systemAiBillingHeaders(target.config.logicalModel || target.config.model, undefined, target.config.model)).forEach(([key, value]) => headers.set(key, value));
        return fetchInternalApi(url, { method, headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    }
    Object.entries(protocolAuthHeaders(target.config.apiKey, target.config.advancedConfig, target.config.apiFormat)).forEach(([key, value]) => headers.set(key, value));
    return fetchSafeOutboundUrl(url, { method, headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000) });
}

function cancellableUpstreamTaskId(value: string | undefined) {
    const id = value?.trim() || "";
    return id && !id.startsWith("direct:") ? id : "";
}

export function hasCancellableUpstreamTaskId(value: string | undefined) {
    return Boolean(cancellableUpstreamTaskId(value));
}
