import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { abortAgentRun, executeAgentRun } from "@/lib/server/agent-run-executor";
import { getAgentRun, setAgentRunStatus, type AgentRun, type AgentRunStatus } from "@/lib/server/agent-run-store";
import { withGenerationConcurrencyLimit } from "@/lib/server/generation-task-store";
import { fetchInternalApi, resolveInternalOrigin } from "@/lib/server/internal-origin";

const actions: Record<string, AgentRunStatus> = { pause: "paused", resume: "running", cancel: "cancelled" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const { id, action } = await params;
    const status = actions[action];
    if (!status) return NextResponse.json({ code: 400, data: null, msg: "不支持的 Agent 操作" }, { status: 400 });
    const run = await getAgentRun(id);
    if (!run || (run.userId !== user.id && user.role !== "admin")) return NextResponse.json({ code: 404, data: null, msg: "Agent 任务不存在" }, { status: 404 });
    if (action === "pause" && !["planning", "running"].includes(run.status)) return NextResponse.json({ code: 409, data: null, msg: "当前任务无法暂停" }, { status: 409 });
    if (action === "resume" && run.status !== "paused") return NextResponse.json({ code: 409, data: null, msg: "只有暂停中的任务可以恢复" }, { status: 409 });
    const limit = action === "resume" ? (await getAuthSettings()).generationConcurrency.agent : 0;
    if (action === "cancel" && ["completed", "failed", "cancelled"].includes(run.status)) return NextResponse.json({ code: 409, data: null, msg: "当前任务无法取消" }, { status: 409 });
    if (action !== "resume") abortAgentRun(run.id);
    const result = action === "resume" ? await withGenerationConcurrencyLimit(run.userId, "agent", 10 * 60 * 1000, limit, async () => ({ updated: await setAgentRunStatus(run, status) })) : { updated: await setAgentRunStatus(run, status) };
    if (result === null) return NextResponse.json({ code: 429, data: null, msg: `当前最多同时运行 ${limit} 个 Agent 任务` }, { status: 429 });
    const { updated } = result;
    if (!updated) return NextResponse.json({ code: 409, data: null, msg: "Agent 状态已变化，请刷新后重试" }, { status: 409 });
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    const cookie = request.headers.get("cookie") || "";
    if (action === "cancel") await cancelChildTasks(run.tasks, origin, cookie);
    if (action === "resume") after(() => executeAgentRun(updated, origin, cookie));
    return NextResponse.json({ code: 0, data: { run: updated }, msg: "OK" });
}

async function cancelChildTasks(tasks: AgentRun["tasks"], origin: string, cookie: string) {
    await Promise.all(
        tasks
            .filter((task) => task.status === "running" && task.taskId && ["text", "image", "video", "audio"].includes(task.type))
            .map((task) =>
                fetchInternalApi(`${origin}/api/${task.type}-tasks/${encodeURIComponent(task.taskId!)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json", cookie },
                    body: JSON.stringify({ status: "cancelled" }),
                }).catch(() => null),
            ),
    );
}
