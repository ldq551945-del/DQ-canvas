import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getAudioTask, transitionAudioTask } from "@/lib/server/audio-task-store";
import { refundAudioTask } from "@/lib/server/audio-task-refund";
import { pointsResponseHeaders } from "@/lib/server/points-response";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { generationModelId } from "@/lib/server/generation-channel";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { cancellationExecutionPatch, isCancellationExecutionPhase } from "@/lib/server/generation-task-cancellation-service";
import { getStoredGenerationTaskRecord } from "@/lib/server/generation-task-store";
import { publicGenerationTaskState } from "@/lib/server/generation-task-public-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const task = await getAudioTask((await params).id);
    if (!task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
    if (((task.status === "pending" || task.status === "running") && task.executionPhase !== "needs_review") || (task.status === "cancelled" && isCancellationExecutionPhase(task.executionPhase))) {
        const origin = resolveInternalOrigin(new URL(request.url).origin);
        after(() => runGenerationTaskRecoveryBatch({ origin, cookie: request.headers.get("cookie") || "", limit: 1, taskIds: [task.id] }));
    }
    const shouldRefund = Boolean(task.billing?.pointsRecordId && !task.billing.refunded && task.status === "error");
    const settledTask = shouldRefund ? await refundAudioTask(task) : task;
    const refreshedUser = shouldRefund ? await getCurrentUser(request) : user;
    const record = await readTaskRecord(task.id);
    return NextResponse.json({ task: { ...publicTask(settledTask, record || undefined), needsReview: task.executionPhase === "needs_review" } }, { headers: pointsResponseHeaders(refreshedUser) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request);
    const task = user ? await getAudioTask((await params).id) : null;
    if (!user || !task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "任务不存在或已过期" }, { status: user ? 404 : 401 });
    const body = (await request.json().catch(() => ({}))) as { status?: string };
    if (body.status !== "cancelled" || !["pending", "running"].includes(task.status)) return NextResponse.json({ error: "当前任务无法取消" }, { status: 409 });
    const target = { type: "audio" as const, taskId: task.id, userId: task.userId, executionPhase: task.executionPhase, upstreamTaskId: task.upstream?.id, queryPath: task.config.advancedConfig?.queryPath, config: task.config };
    const next = await transitionAudioTask(task, ["pending", "running"], { status: "cancelled", error: "已提交取消，正在确认上游状态", billing: task.billing }, cancellationExecutionPatch(target));
    if (!next) return NextResponse.json({ error: "当前任务无法取消" }, { status: 409 });
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    after(() => runGenerationTaskRecoveryBatch({ origin, cookie: request.headers.get("cookie") || "", limit: 1, taskIds: [next.id] }));
    const record = await readTaskRecord(next.id);
    return NextResponse.json({ task: publicTask(next, record || undefined) }, { headers: pointsResponseHeaders(user) });
}

function publicTask(task: NonNullable<Awaited<ReturnType<typeof getAudioTask>>>, record?: Awaited<ReturnType<typeof getStoredGenerationTaskRecord>>) {
    return {
        id: task.id,
        status: task.status,
        model: generationModelId(task.config),
        result: task.result,
        error: task.error,
        billing: task.billing ? { pointsCost: task.billing.pointsCost, refunded: task.billing.refunded } : undefined,
        ...publicGenerationTaskState(task, record || undefined),
    };
}

async function readTaskRecord(id: string) {
    try {
        return await getStoredGenerationTaskRecord("audio", id);
    } catch (error) {
        console.warn("Audio task execution metadata unavailable", { taskId: id, error: error instanceof Error ? error.message : String(error) });
        return null;
    }
}
