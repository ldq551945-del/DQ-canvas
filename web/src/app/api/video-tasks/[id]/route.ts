import { after, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getVideoTask, transitionVideoTask, type VideoTaskStatus } from "@/lib/server/video-task-store";
import { refundUserPoints } from "@/lib/auth/store";
import { fetchInternalApi, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { pointsResponseHeaders } from "@/lib/server/points-response";
import { canTransitionVideoTask } from "@/lib/server/video-task-registration";
import { generationModelId } from "@/lib/server/generation-channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    const task = user ? await getVideoTask((await params).id) : null;
    if (!user || !task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "视频任务不存在" }, { status: user ? 404 : 401 });
    return NextResponse.json({ task: publicTask(task) }, { headers: pointsResponseHeaders(user) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const user = await getCurrentUser();
    const id = (await params).id;
    const task = user ? await getVideoTask(id) : null;
    if (!user || !task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "视频任务不存在" }, { status: user ? 404 : 401 });
    const body = (await request.json().catch(() => ({}))) as { status?: VideoTaskStatus; result?: VideoTask["result"]; error?: string };
    if (!body.status || !canTransitionVideoTask(task.status, body.status)) return NextResponse.json({ error: "当前任务状态无法修改" }, { status: 409 });
    const status = body.status as Exclude<VideoTaskStatus, "running">;
    const next = await transitionVideoTask(task, {
        status,
        result: status === "success" ? sanitizeResult(body.result) : undefined,
        error: status === "error" ? String(body.error || "视频生成失败").slice(0, 500) : undefined,
    });
    if (!next) return NextResponse.json({ error: "当前任务状态无法修改" }, { status: 409 });
    if (status === "cancelled") {
        if (task.upstream.pointsCost && task.upstream.pointsRecordId)
            await refundUserPoints(task.userId, generationModelId(task.config), task.upstream.pointsCost, "video", task.upstream.pointsUnits || 1, `video-task:${task.id}:refund`, task.upstream.pointsRecordId);
        after(() => cancelUpstreamVideo(task, resolveInternalOrigin(new URL(request.url).origin), request.headers.get("cookie") || ""));
    }
    const refreshedUser = await getCurrentUser();
    return NextResponse.json({ task: next ? publicTask(next) : null }, { headers: pointsResponseHeaders(refreshedUser) });
}

async function cancelUpstreamVideo(task: VideoTask, origin: string, cookie: string) {
    if (!task.upstream.id || task.upstream.id.startsWith("direct:")) return;
    const id = encodeURIComponent(task.upstream.id);
    const createPath = (task.upstream.pollPath || "/video/generations").replace(/\/+$/, "");
    const attempts: Array<{ path: string; method: "POST" | "DELETE" }> = [
        { path: `${createPath}/${id}/cancel`, method: "POST" },
        { path: `/videos/${id}/cancel`, method: "POST" },
        { path: `/video/generations/${id}/cancel`, method: "POST" },
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

type VideoTask = NonNullable<Awaited<ReturnType<typeof getVideoTask>>>;

function sanitizeResult(result?: VideoTask["result"]) {
    if (!result) return undefined;
    return {
        url: typeof result.url === "string" ? result.url : undefined,
        remoteUrl: typeof result.remoteUrl === "string" ? result.remoteUrl : undefined,
        mimeType: typeof result.mimeType === "string" ? result.mimeType : undefined,
    };
}

function publicTask(task: VideoTask) {
    return { id: task.id, status: task.status, model: generationModelId(task.config), upstreamId: task.upstream.id, result: task.result, error: task.error };
}
