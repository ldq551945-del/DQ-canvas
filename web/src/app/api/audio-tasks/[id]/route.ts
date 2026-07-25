import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getAudioTask, transitionAudioTask } from "@/lib/server/audio-task-store";
import { refundAudioTask } from "@/lib/server/audio-task-refund";
import { pointsResponseHeaders } from "@/lib/server/points-response";
import { fetchInternalApi, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { generationModelId } from "@/lib/server/generation-channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const task = await getAudioTask((await params).id);
    if (!task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
    const shouldRefund = Boolean(task.billing?.pointsCost && !task.billing.refunded && (task.status === "error" || task.status === "cancelled"));
    const settledTask = shouldRefund ? await refundAudioTask(task) : task;
    const refreshedUser = shouldRefund ? await getCurrentUser() : user;
    return NextResponse.json({ task: publicTask(settledTask) }, { headers: pointsResponseHeaders(refreshedUser) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    const task = user ? await getAudioTask((await params).id) : null;
    if (!user || !task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "任务不存在或已过期" }, { status: user ? 404 : 401 });
    const body = (await request.json().catch(() => ({}))) as { status?: string };
    if (body.status !== "cancelled" || !["pending", "running"].includes(task.status)) return NextResponse.json({ error: "当前任务无法取消" }, { status: 409 });
    const shouldRefund = Boolean(task.billing?.pointsCost && !task.billing.refunded);
    const next = await transitionAudioTask(task, ["pending", "running"], { status: "cancelled", error: "任务已取消", config: { ...task.config, apiKey: "" }, billing: task.billing });
    if (!next) return NextResponse.json({ error: "当前任务无法取消" }, { status: 409 });
    const settledTask = shouldRefund ? await refundAudioTask(next) : next;
    after(() => cancelUpstreamAudio(task, resolveInternalOrigin(new URL(request.url).origin), request.headers.get("cookie") || ""));
    const refreshedUser = await getCurrentUser();
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
    const attempts: Array<{ path: string; method: "POST" | "DELETE" }> = [
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
