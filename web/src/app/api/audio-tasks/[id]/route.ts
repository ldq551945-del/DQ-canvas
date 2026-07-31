import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getAudioTask, transitionAudioTask } from "@/lib/server/audio-task-store";
import { refundAudioTask } from "@/lib/server/audio-task-refund";
import { pointsResponseHeaders } from "@/lib/server/points-response";
import { fetchInternalApi, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { generationModelId } from "@/lib/server/generation-channel";
import { providerTaskPath } from "@/lib/server/provider-task-config";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const task = await getAudioTask((await params).id);
    if (!task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
    if ((task.status === "pending" || task.status === "running") && task.executionPhase !== "needs_review") {
        const origin = resolveInternalOrigin(new URL(request.url).origin);
        after(() => runGenerationTaskRecoveryBatch({ origin, cookie: request.headers.get("cookie") || "", limit: 1, taskIds: [task.id] }));
    }
    const shouldRefund = Boolean(task.billing?.pointsRecordId && !task.billing.refunded && (task.status === "error" || task.status === "cancelled"));
    const settledTask = shouldRefund ? await refundAudioTask(task) : task;
    const refreshedUser = shouldRefund ? await getCurrentUser(request) : user;
    return NextResponse.json({ task: { ...publicTask(settledTask), needsReview: task.executionPhase === "needs_review", executionPhase: task.executionPhase } }, { headers: pointsResponseHeaders(refreshedUser) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser(request);
    const task = user ? await getAudioTask((await params).id) : null;
    if (!user || !task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "任务不存在或已过期" }, { status: user ? 404 : 401 });
    const body = (await request.json().catch(() => ({}))) as { status?: string };
    if (body.status !== "cancelled" || !["pending", "running"].includes(task.status)) return NextResponse.json({ error: "当前任务无法取消" }, { status: 409 });
    const shouldRefund = Boolean(task.billing?.pointsRecordId && !task.billing.refunded);
    const next = await transitionAudioTask(task, ["pending", "running"], { status: "cancelled", error: "任务已取消", config: { ...task.config, apiKey: "" }, billing: task.billing });
    if (!next) return NextResponse.json({ error: "当前任务无法取消" }, { status: 409 });
    const settledTask = shouldRefund ? await refundAudioTask(next) : next;
    after(() => cancelUpstreamAudio(task, resolveInternalOrigin(new URL(request.url).origin), request.headers.get("cookie") || ""));
    const refreshedUser = await getCurrentUser(request);
    return NextResponse.json({ task: publicTask(settledTask) }, { headers: pointsResponseHeaders(refreshedUser) });
}

function publicTask(task: NonNullable<Awaited<ReturnType<typeof getAudioTask>>>) {
    return {
        id: task.id,
        status: task.status,
        model: generationModelId(task.config),
        result: task.result,
        error: task.error,
        billing: task.billing ? { pointsCost: task.billing.pointsCost, refunded: task.billing.refunded } : undefined,
    };
}

async function cancelUpstreamAudio(task: NonNullable<Awaited<ReturnType<typeof getAudioTask>>>, origin: string, cookie: string) {
    if (!task.upstream?.id) return;
    const id = encodeURIComponent(task.upstream.id);
    const createPath = task.upstream.createPath.replace(/\/+$/, "");
    const configuredCancelPath = task.config.advancedConfig?.cancelPath;
    const attempts: Array<{ path: string; method: "POST" | "DELETE" }> = [
        ...(configuredCancelPath ? [{ path: providerTaskPath(configuredCancelPath, task.upstream.id), method: task.config.advancedConfig?.cancelMethod || ("POST" as const) }] : []),
        { path: `${createPath}/${id}/cancel`, method: "POST" },
        { path: `/audio/speech/${id}/cancel`, method: "POST" },
        { path: `${createPath}/${id}`, method: "DELETE" },
    ];
    for (const attempt of attempts) {
        const response = await fetchInternalApi(`${origin}${task.config.baseUrl.replace(/\/+$/, "")}${attempt.path}`, {
            method: attempt.method,
            headers: { cookie },
            signal: AbortSignal.timeout(10_000),
        }).catch(() => null);
        if (response?.ok) return;
    }
}
