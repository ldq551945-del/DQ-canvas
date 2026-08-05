import { NextResponse } from "next/server";

import { backgroundRemovalProgressSnapshot } from "@/lib/background-removal-progress";
import { getCurrentUser } from "@/lib/auth/session";
import { BackgroundRemovalProviderError, cancelBackgroundRemovalWithRembg } from "@/lib/server/background-removal-provider";
import { getBackgroundRemovalTask, publicBackgroundRemovalTask, transitionBackgroundRemovalTask } from "@/lib/server/background-removal-task-store";
import { finalizeCancelledBackgroundRemovalTask, repairUnscheduledImageProcessTask } from "@/lib/server/generation-task-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
    const user = await getCurrentUser(request);
    if (!user) return jsonError(401, "请先登录");
    const task = await getBackgroundRemovalTask((await context.params).id);
    if (!task || (task.userId !== user.id && user.role !== "admin")) return jsonError(task ? 404 : 404, "抠图任务不存在或已过期");
    if (["pending", "running"].includes(task.status)) {
        await repairUnscheduledImageProcessTask(task.id);
    }
    return NextResponse.json({ code: 0, data: { task: publicBackgroundRemovalTask(task) }, msg: "OK" });
}

export async function PATCH(request: Request, context: RouteContext) {
    const user = await getCurrentUser(request);
    if (!user) return jsonError(401, "请先登录");
    const task = await getBackgroundRemovalTask((await context.params).id);
    if (!task || (task.userId !== user.id && user.role !== "admin")) return jsonError(404, "抠图任务不存在或已过期");
    const body = (await request.json().catch(() => ({}))) as { status?: unknown };
    if (body.status !== "cancelled") return jsonError(409, "当前抠图任务无法取消");
    if (!["pending", "running", "success", "error", "cancelled"].includes(task.status)) return jsonError(409, "当前抠图任务无法取消");

    let cancelled = task;
    if (task.status === "pending" || task.status === "running") {
        const cancelledProgress = backgroundRemovalProgressSnapshot("cancelled", task.progress);
        const transitioned = await transitionBackgroundRemovalTask(task, ["pending", "running"], { status: "cancelled", error: "任务已取消", progressStage: cancelledProgress.stage, progress: cancelledProgress.progress });
        if (transitioned) cancelled = transitioned;
        else {
            const latest = await getBackgroundRemovalTask(task.id);
            if (!latest || (latest.userId !== user.id && user.role !== "admin")) return jsonError(404, "抠图任务不存在或已过期");
            if (!["success", "error", "cancelled"].includes(latest.status)) return jsonError(409, "当前抠图任务无法取消");
            cancelled = latest;
        }
    }

    try {
        await cancelBackgroundRemovalWithRembg(cancelled.id);
        if (cancelled.status === "cancelled") await finalizeCancelledBackgroundRemovalTask(cancelled.id);
    } catch (error) {
        const providerStatus = error instanceof BackgroundRemovalProviderError ? error.status : 503;
        const status = providerStatus >= 500 ? 503 : providerStatus;
        return NextResponse.json({ code: status, data: { task: publicBackgroundRemovalTask(cancelled), cancellationConfirmed: false }, msg: "任务已标记取消，但服务端尚未确认推理终止，请重试" }, { status });
    }
    return NextResponse.json({ code: 0, data: { task: publicBackgroundRemovalTask(cancelled), cancellationConfirmed: true }, msg: "抠图任务已终止" });
}

function jsonError(status: number, msg: string) {
    return NextResponse.json({ code: status, data: null, msg }, { status });
}
