import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getImageTask, transitionImageTask } from "@/lib/server/image-task-store";
import { pointsResponseHeaders } from "@/lib/server/points-response";
import { generationModelId } from "@/lib/server/generation-channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const { id } = await context.params;
    const task = await getImageTask(id);
    if (!task || (task.userId !== currentUser.id && currentUser.role !== "admin")) return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });

    return NextResponse.json(
        {
            task: {
                id: task.id,
                kind: task.kind,
                status: task.status,
                model: generationModelId(task.config),
                result: task.result,
                error: task.error,
            },
        },
        { headers: pointsResponseHeaders(currentUser) },
    );
}

export async function PATCH(request: Request, context: RouteContext) {
    const user = await getCurrentUser();
    const task = user ? await getImageTask((await context.params).id) : null;
    if (!user || !task || (task.userId !== user.id && user.role !== "admin")) return NextResponse.json({ error: "任务不存在或已过期" }, { status: user ? 404 : 401 });
    const body = (await request.json().catch(() => ({}))) as { status?: string };
    if (body.status !== "cancelled" || !["pending", "running"].includes(task.status)) return NextResponse.json({ error: "当前任务无法取消" }, { status: 409 });
    const cancelled = await transitionImageTask(task, ["pending", "running"], { status: "cancelled", error: "任务已取消" });
    if (!cancelled) return NextResponse.json({ error: "当前任务无法取消" }, { status: 409 });
    return NextResponse.json({ task: { id: cancelled.id, kind: cancelled.kind, status: cancelled.status, model: generationModelId(cancelled.config), result: cancelled.result, error: cancelled.error } }, { headers: pointsResponseHeaders(user) });
}
