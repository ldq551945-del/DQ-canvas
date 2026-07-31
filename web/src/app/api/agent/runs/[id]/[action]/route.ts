import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { abortAgentRun } from "@/lib/server/agent-run-executor";
import { getAgentRun, setAgentRunStatus, updateAgentRunById, type AgentRun, type AgentRunStatus } from "@/lib/server/agent-run-store";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { withGenerationConcurrencyLimit } from "@/lib/server/generation-task-store";
import { fetchInternalApi, resolveInternalOrigin } from "@/lib/server/internal-origin";

const actions: Record<string, AgentRunStatus> = { pause: "paused", resume: "running", cancel: "cancelled" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    const { id, action } = await params;
    const status = actions[action];
    if (!status && action !== "retry") return NextResponse.json({ code: 400, data: null, msg: "不支持的 Agent 操作" }, { status: 400 });
    const run = await getAgentRun(id);
    if (!run || (run.userId !== user.id && user.role !== "admin")) return NextResponse.json({ code: 404, data: null, msg: "Agent 任务不存在" }, { status: 404 });
    if (action === "retry" && (run.status !== "failed" || run.tasks.length)) return NextResponse.json({ code: 409, data: null, msg: "只有规划阶段失败的任务可以整体重试" }, { status: 409 });
    if (action === "pause" && !["planning", "running"].includes(run.status)) return NextResponse.json({ code: 409, data: null, msg: "当前任务无法暂停" }, { status: 409 });
    if (action === "resume" && run.status !== "paused") return NextResponse.json({ code: 409, data: null, msg: "只有暂停中的任务可以恢复" }, { status: 409 });
    const limit = action === "resume" || action === "retry" ? (await getAuthSettings()).generationConcurrency.agent : 0;
    if (action === "cancel" && ["completed", "failed", "cancelled"].includes(run.status)) return NextResponse.json({ code: 409, data: null, msg: "当前任务无法取消" }, { status: 409 });
    if (action !== "resume") abortAgentRun(run.id);
    const mutate = async () => ({
        updated:
            action === "retry"
                ? await updateAgentRunById(
                      run.id,
                      { status: "planning", executionId: undefined, tasks: [], foundation: undefined, projectHandoff: undefined, projectHandoffEmitted: undefined, review: undefined, reviewed: false, assetIds: [] },
                      { type: "run.retry.requested" },
                      ["failed"],
                  )
                : await setAgentRunStatus(run, status!),
    });
    const result = action === "resume" || action === "retry" ? await withGenerationConcurrencyLimit(run.userId, "agent", 10 * 60 * 1000, limit, mutate) : await mutate();
    if (result === null) return NextResponse.json({ code: 429, data: null, msg: `当前最多同时运行 ${limit} 个 Agent 任务` }, { status: 429 });
    const { updated } = result;
    if (!updated) return NextResponse.json({ code: 409, data: null, msg: "Agent 状态已变化，请刷新后重试" }, { status: 409 });
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    const cookie = request.headers.get("cookie") || "";
    if (action === "cancel") await cancelChildTasks(run.tasks, origin, cookie);
    if (action === "resume" || action === "retry") {
        await scheduleGenerationTask("agent", updated.id, { executionPhase: "created", nextPollAt: Date.now(), lastUpstreamStatus: action });
        after(() => runGenerationTaskRecoveryBatch({ origin, cookie, limit: 1, taskIds: [updated.id] }));
    } else {
        await scheduleGenerationTask("agent", updated.id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: action });
    }
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
