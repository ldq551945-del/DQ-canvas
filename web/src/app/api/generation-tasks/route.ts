import { NextResponse } from "next/server";

import { normalizeBackgroundRemovalOptions } from "@/lib/background-removal-options";
import { backgroundRemovalProgressSnapshot, resolveBackgroundRemovalProgressStage } from "@/lib/background-removal-progress";
import { getCurrentUser } from "@/lib/auth/session";
import { listStoredGenerationTaskRecords, type StoredGenerationTaskRecord } from "@/lib/server/generation-task-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["pending", "running", "paused"] as const;

/**
 * Returns the current user's generation tasks in the public shape used by the
 * canvas task indicator. The storage record itself is never exposed: payloads
 * can contain provider details and internal prompts.
 */
export async function GET(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });

    const params = new URL(request.url).searchParams;
    const projectId = clean(params.get("projectId"), 160);
    const surface = clean(params.get("surface"), 40) || "canvas";
    if (surface !== "canvas") return NextResponse.json({ code: 0, data: { tasks: [], total: 0 }, msg: "OK" });

    const requestedLimit = Number(params.get("limit"));
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 50;
    const activeOnly = params.get("activeOnly") !== "false";
    const result = await listStoredGenerationTaskRecords({
        page: 1,
        pageSize: limit,
        surface: "canvas",
        projectId: projectId || undefined,
        userId: user.id,
        statuses: activeOnly ? [...ACTIVE_STATUSES] : undefined,
        includeAll: false,
    });
    const tasks = result.items.map(normalizeCanvasTask);
    return NextResponse.json({ code: 0, data: { tasks, total: result.total }, msg: "OK" });
}

export type CanvasGenerationTask = ReturnType<typeof normalizeCanvasTask>;

function normalizeCanvasTask(record: StoredGenerationTaskRecord) {
    const payload = record.payload || {};
    const config = object(payload.config);
    const upstream = object(payload.upstream);
    const billing = object(payload.billing);
    const sourceNodeId = firstText(payload.sourceNodeId, payload.nodeId);
    // A source node can fan out to several result nodes. Keep the result
    // target separate so task recovery never writes progress to the source.
    const targetNodeId = firstText(payload.targetNodeId, payload.nodeId, payload.sourceNodeId);
    const backgroundRemovalProgress = record.type === "image_process" ? backgroundRemovalProgressSnapshot(resolveBackgroundRemovalProgressStage(payload.progressStage, record.status), payload.progress) : undefined;
    const progress = backgroundRemovalProgress?.progress ?? normalizeProgress(payload.progress, object(payload.metadata).progress, upstream.progress, payload.taskProgress);
    const stage = backgroundRemovalProgress?.label || firstText(payload.stage, payload.taskStage, upstream.stage, record.lastUpstreamStatus, record.executionPhase);
    const prompt = firstText(payload.prompt, payload.title, payload.name);
    const model = firstText(payload.model, payload.logicalModelId, config.model, config.imageModel, config.videoModel, config.audioModel, upstream.model);
    const kind = payload.kind === "edit" || payload.kind === "generation" ? payload.kind : undefined;
    const provider = upstream.provider === "openai" || upstream.provider === "seedance" || upstream.provider === "generation" ? upstream.provider : record.type === "video" ? "generation" : undefined;
    const pointsCost = billingPointsCost(payload, billing, upstream);
    const backgroundRemovalOptions = record.type === "image_process" ? safeBackgroundRemovalOptions(payload.options) : undefined;
    return {
        id: record.id,
        type: record.type,
        status: normalizeStatus(record.status),
        progress,
        stage: stage || undefined,
        prompt: prompt.slice(0, 240) || undefined,
        model: model || undefined,
        kind,
        provider,
        pollPath: record.type === "video" ? (provider === "generation" ? "server" : firstText(upstream.pollPath) || undefined) : undefined,
        serverTaskId: record.type === "video" && provider === "generation" ? record.id : undefined,
        durationSeconds: positiveNumber(payload.durationSeconds, upstream.durationSeconds),
        sourceStorageKey: record.type === "image_process" ? firstText(payload.sourceStorageKey) || undefined : undefined,
        options: backgroundRemovalOptions,
        optionsHash: record.type === "image_process" ? firstText(payload.optionsHash) || undefined : undefined,
        progressStage: backgroundRemovalProgress?.stage,
        projectId: record.projectId,
        sourceNodeId: sourceNodeId || undefined,
        targetNodeId: targetNodeId || undefined,
        executionPhase: record.executionPhase,
        upstreamTaskId: record.upstreamTaskId || firstText(upstream.id) || undefined,
        lastUpstreamStatus: record.lastUpstreamStatus,
        error: firstText(payload.error, object(payload.result).error) || undefined,
        billing: pointsCost === undefined ? undefined : { pointsCost, refunded: Boolean(billing.refunded) },
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

function safeBackgroundRemovalOptions(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    try {
        return normalizeBackgroundRemovalOptions(value);
    } catch {
        return undefined;
    }
}

function billingPointsCost(payload: Record<string, unknown>, billing: Record<string, unknown>, upstream: Record<string, unknown>) {
    const hasBillingRecord = Boolean(firstText(billing.pointsRecordId, upstream.pointsRecordId, payload.pointsRecordId));
    if (!hasBillingRecord) return undefined;
    for (const value of [billing.pointsCost, upstream.pointsCost, payload.pointsCost]) {
        const points = Number(value);
        if (Number.isFinite(points) && points >= 0) return points;
    }
    return undefined;
}

function normalizeStatus(status: StoredGenerationTaskRecord["status"]): "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled" {
    if (status === "pending") return "queued";
    if (status === "running") return "running";
    if (status === "paused") return "paused";
    if (status === "success") return "succeeded";
    if (status === "cancelled") return "cancelled";
    return "failed";
}

function normalizeProgress(...values: unknown[]) {
    for (const value of values) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) continue;
        if (number <= 1) return Math.round(number * 100);
        if (number <= 100) return Math.round(number);
    }
    return undefined;
}

function object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstText(...values: unknown[]) {
    return values.map((value) => (typeof value === "string" ? value.trim() : "")).find(Boolean) || "";
}

function positiveNumber(...values: unknown[]) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
    }
    return undefined;
}

function clean(value: string | null, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}
