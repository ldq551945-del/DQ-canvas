import { after, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { canReconcileVideoTask, getVideoTask, transitionVideoTask } from "@/lib/server/video-task-store";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { pointsResponseHeaders } from "@/lib/server/points-response";
import { generationModelId } from "@/lib/server/generation-channel";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { getStoredGenerationTaskRecord } from "@/lib/server/generation-task-store";
import { publicGenerationTaskState } from "@/lib/server/generation-task-public-state";
import { cancellationExecutionPatch, isCancellationExecutionPhase } from "@/lib/server/generation-task-cancellation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request);
    const task = user ? await getVideoTask((await params).id) : null;
    if (!user || !task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "视频任务不存在" }, { status: user ? 404 : 401 });
    if (canReconcileVideoTask(task) || (task.status === "cancelled" && isCancellationExecutionPhase(task.executionPhase))) {
        const origin = resolveInternalOrigin(new URL(request.url).origin);
        const cookie = request.headers.get("cookie") || "";
        after(() => runGenerationTaskRecoveryBatch({ origin, cookie, limit: 1, taskIds: [task!.id] }));
    }
    const record = await readTaskRecord(task.id);
    return NextResponse.json({ task: { ...publicTask(task, record || undefined), needsReview: publicGenerationTaskState(task, record || undefined).publicStatus === "needs_review" } }, { headers: pointsResponseHeaders(user) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request);
    const id = (await params).id;
    const task = user ? await getVideoTask(id) : null;
    if (!user || !task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "视频任务不存在" }, { status: user ? 404 : 401 });
    const body = (await request.json().catch(() => ({}))) as { action?: string; status?: string; result?: unknown; error?: unknown };
    if (body.result !== undefined || body.error !== undefined || (body.status && body.status !== "cancelled")) {
        return NextResponse.json({ error: "视频任务终态和结果只能由服务端更新" }, { status: 403 });
    }
    if (body.action !== "cancel" && body.status !== "cancelled") return NextResponse.json({ error: "不支持的视频任务操作" }, { status: 400 });
    if (task.status !== "running") return NextResponse.json({ error: "当前任务无法取消" }, { status: 409 });
    const scheduleRecord = await readTaskRecord(task.id);
    const target = {
        type: "video" as const,
        taskId: task.id,
        userId: task.userId,
        executionPhase: scheduleRecord?.executionPhase || task.executionPhase,
        upstreamTaskId: task.upstream.id,
        queryPath: task.config.advancedConfig?.queryPath,
        config: task.config,
    };
    const next = await transitionVideoTask(task, { status: "cancelled", error: "已提交取消，正在确认上游状态", retryable: false }, cancellationExecutionPatch(target));
    if (!next) return NextResponse.json({ error: "当前任务状态无法修改" }, { status: 409 });
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    after(() => runGenerationTaskRecoveryBatch({ origin, cookie: request.headers.get("cookie") || "", limit: 1, taskIds: [next.id] }));
    const record = next ? await readTaskRecord(next.id) : null;
    return NextResponse.json({ task: next ? publicTask(next, record || undefined) : null }, { headers: pointsResponseHeaders(user) });
}

type VideoTask = NonNullable<Awaited<ReturnType<typeof getVideoTask>>>;

function publicTask(task: VideoTask, record?: Awaited<ReturnType<typeof getStoredGenerationTaskRecord>>) {
    return {
        id: task.id,
        status: task.status,
        model: generationModelId(task.config),
        upstreamId: task.upstream.id,
        durationSeconds: task.requestedDurationSeconds,
        result: task.result,
        error: task.error,
        billing: task.upstream.pointsCost === undefined ? undefined : { pointsCost: task.upstream.pointsCost, refunded: task.upstream.refunded === true },
        ...publicGenerationTaskState(task, record || undefined),
    };
}

async function readTaskRecord(id: string) {
    try {
        return await getStoredGenerationTaskRecord("video", id);
    } catch (error) {
        console.warn("Video task execution metadata unavailable", { taskId: id, error: error instanceof Error ? error.message : String(error) });
        return null;
    }
}
