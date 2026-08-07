import { after, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { requestPublicOrigin } from "@/app/api/image-tasks/image-task-reference-urls";
import { getImageTask, transitionImageTask } from "@/lib/server/image-task-store";
import { getStoredGenerationTaskRecord } from "@/lib/server/generation-task-store";
import { publicGenerationTaskState } from "@/lib/server/generation-task-public-state";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { resolveInternalOrigin } from "@/lib/server/internal-origin";
import { pointsResponseHeaders } from "@/lib/server/points-response";
import { generationModelId } from "@/lib/server/generation-channel";
import { cancellationExecutionPatch, isCancellationExecutionPhase } from "@/lib/server/generation-task-cancellation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const { id } = await context.params;
    const task = await getImageTask(id);
    if (!task || (task.userId !== currentUser.id && currentUser.role !== "admin")) return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
    if (isRecoverableImageTask(task)) {
        const origin = resolveInternalOrigin(new URL(request.url).origin);
        after(() => runGenerationTaskRecoveryBatch({ origin, publicOrigin: requestPublicOrigin(request), cookie: request.headers.get("cookie") || "", limit: 1, taskIds: [task.id] }));
    }

    const record = await readTaskRecord(task.id);
    const state = publicGenerationTaskState(task, record || undefined);
    return NextResponse.json(
        {
            task: {
                id: task.id,
                kind: task.kind,
                status: task.status,
                model: generationModelId(task.config),
                result: task.result,
                error: task.error,
                ...state,
                needsReview: state.publicStatus === "needs_review",
                canRetry: state.canRetry,
            },
        },
        { headers: pointsResponseHeaders(currentUser) },
    );
}

function isRecoverableImageTask(task: NonNullable<Awaited<ReturnType<typeof getImageTask>>>) {
    return ((task.status === "pending" || task.status === "running") && task.executionPhase !== "needs_review") || (task.status === "cancelled" && isCancellationExecutionPhase(task.executionPhase));
}

async function readTaskRecord(id: string) {
    try {
        return await getStoredGenerationTaskRecord("image", id);
    } catch (error) {
        console.warn("Image task execution metadata unavailable", { taskId: id, error: error instanceof Error ? error.message : String(error) });
        return null;
    }
}

export async function PATCH(request: Request, context: RouteContext) {
    const user = await getCurrentUser(request);
    const task = user ? await getImageTask((await context.params).id) : null;
    if (!user || !task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "任务不存在或已过期" }, { status: user ? 404 : 401 });
    const body = (await request.json().catch(() => ({}))) as { status?: string };
    if (body.status !== "cancelled" || !["pending", "running"].includes(task.status)) return NextResponse.json({ error: "当前任务无法取消" }, { status: 409 });
    const scheduleRecord = await readTaskRecord(task.id);
    const target = {
        type: "image" as const,
        taskId: task.id,
        userId: task.userId,
        executionPhase: scheduleRecord?.executionPhase || task.executionPhase,
        upstreamTaskId: task.upstream?.id,
        queryPath: task.config.advancedConfig?.queryPath,
        config: task.config,
    };
    const cancelled = await transitionImageTask(task, ["pending", "running"], { status: "cancelled", error: "已提交取消，正在确认上游状态", retryable: false }, cancellationExecutionPatch(target));
    if (!cancelled) return NextResponse.json({ error: "当前任务无法取消" }, { status: 409 });
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    after(() => runGenerationTaskRecoveryBatch({ origin, publicOrigin: requestPublicOrigin(request), cookie: request.headers.get("cookie") || "", limit: 1, taskIds: [cancelled.id] }));
    const record = await readTaskRecord(cancelled.id);
    return NextResponse.json(
        { task: { id: cancelled.id, kind: cancelled.kind, status: cancelled.status, model: generationModelId(cancelled.config), result: cancelled.result, error: cancelled.error, ...publicGenerationTaskState(cancelled, record || undefined) } },
        { headers: pointsResponseHeaders(user) },
    );
}
