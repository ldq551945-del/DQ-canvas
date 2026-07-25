import type { CanvasAgentOp } from "../utils/canvas-agent-ops";
import type { CanvasAgentRunStage, CanvasAgentStableStageKey } from "./canvas-agent-progress";

type RunHandlers = {
    onPlan: (ops: CanvasAgentOp[], reply: string) => void;
    onAssistant: (text: string, detail?: { nodeIds?: string[]; taskType?: "text" | "image" | "video" | "audio"; runId?: string; taskId?: string; title?: string }) => void;
    onStage: (stage: CanvasAgentRunStage) => void;
    onPaused: (paused: boolean) => void;
    onOps: (ops: CanvasAgentOp[]) => void;
};

export function watchCanvasAgentRun(runId: string, handlers: RunHandlers) {
    return new Promise<void>((resolve, reject) => {
        const stream = new EventSource(`/api/agent/runs/${encodeURIComponent(runId)}/events`);
        let appliedPlan = false;
        let connectionErrors = 0;
        let settled = false;
        let paused: boolean | undefined;
        let latestStageKey: CanvasAgentStableStageKey = "planning";
        let latestOutput: { nodeIds?: string[]; taskType?: "text" | "image" | "video" | "audio" } | undefined;
        let latestFailedTask: { taskId: string; title?: string } | undefined;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            stream.close();
            if (error) reject(error);
            else resolve();
        };
        const read = <T>(event: Event) => JSON.parse((event as MessageEvent<string>).data) as T;
        const setPaused = (value: boolean) => {
            if (paused === value) return;
            paused = value;
            handlers.onPaused(value);
        };
        const reportStage = (stage: CanvasAgentRunStage) => {
            if (stage.key !== "reconnecting") latestStageKey = stage.key;
            handlers.onStage(stage);
        };

        stream.addEventListener("run.planning", () => reportStage({ key: "planning", text: "正在理解需求并分析当前画布" }));
        stream.addEventListener("skills.selected", () => reportStage({ key: "skills", text: "正在匹配合适的创作技能" }));
        stream.addEventListener("canvas.ops", (event) => {
            const payload = read<{ data?: { ops?: CanvasAgentOp[]; reply?: string } }>(event);
            if (!appliedPlan && payload.data?.ops?.length) {
                appliedPlan = true;
                handlers.onPlan(payload.data.ops, payload.data.reply || "创作计划已添加到画布，后台正在执行任务。");
            }
            reportStage({ key: "plan", text: "文本执行计划已生成，正在准备任务" });
        });
        stream.addEventListener("task.running", (event) => {
            const payload = read<{ data?: { title?: string; attempts?: number } }>(event);
            reportStage({ key: "executing", text: `正在执行「${payload.data?.title || "创作任务"}」${payload.data?.attempts ? `（第 ${payload.data.attempts} 次）` : ""}` });
        });
        stream.addEventListener("task.completed", (event) => {
            const payload = read<{ data?: { message?: string; title?: string; outputNodeIds?: string[]; type?: "text" | "image" | "video" | "audio"; ops?: CanvasAgentOp[] } }>(event);
            if (payload.data?.ops?.length) handlers.onOps(payload.data.ops);
            latestOutput = { nodeIds: payload.data?.outputNodeIds, taskType: payload.data?.type };
            handlers.onAssistant(payload.data?.message || `「${payload.data?.title || "创作任务"}」已完成，正在继续处理。`, latestOutput);
        });
        stream.addEventListener("task.failed", (event) => {
            const payload = read<{ data?: { taskId?: string; title?: string; error?: string } }>(event);
            if (!payload.data?.taskId) return;
            latestFailedTask = { taskId: payload.data.taskId, title: payload.data.title };
            handlers.onAssistant(`「${payload.data.title || "创作任务"}」执行失败：${payload.data.error || "生成服务暂时不可用"}`, { taskType: undefined, nodeIds: [], ...latestFailedTask, runId });
        });
        stream.addEventListener("run.review.retry", () => reportStage({ key: "reviewing", text: "发现可优化内容，正在重新生成" }));
        stream.addEventListener("run.review.passed", () => reportStage({ key: "finalizing", text: "检查完成，正在整理结果" }));
        stream.addEventListener("run.review.unavailable", () => reportStage({ key: "finalizing", text: "正在整理已完成结果" }));
        stream.addEventListener("run.completed", (event) => {
            const payload = read<{ data?: { reply?: string } }>(event);
            handlers.onAssistant(payload.data?.reply || "创作计划与后台生成任务已全部完成。", latestOutput);
            finish();
        });
        stream.addEventListener("run.failed", (event) => {
            const payload = read<{ data?: { message?: string } }>(event);
            if (latestFailedTask) finish();
            else finish(new Error(payload.data?.message || "Agent 执行失败"));
        });
        stream.addEventListener("run.cancelled", () => {
            handlers.onAssistant("Agent 任务已取消。");
            finish();
        });
        stream.addEventListener("run.paused", () => {
            setPaused(true);
            reportStage({ key: "paused", text: "任务已暂停" });
        });
        stream.addEventListener("run.resumed", () => {
            setPaused(false);
            reportStage({ key: "executing", text: "任务已恢复，正在继续执行" });
        });
        stream.addEventListener("run.snapshot", (event) => {
            const payload = read<{ status?: string }>(event);
            if (payload.status === "cancelled") {
                handlers.onAssistant("Agent 任务已取消。");
                finish();
            }
            if (payload.status === "completed") {
                handlers.onAssistant("Agent 任务已完成，结果已经返回。");
                finish();
            }
            if (payload.status === "failed") finish(new Error("Agent 执行失败"));
            if (payload.status === "paused") setPaused(true);
            if (payload.status === "planning" || payload.status === "running") setPaused(false);
        });
        stream.onopen = () => {
            connectionErrors = 0;
        };
        stream.onerror = () => {
            if (settled) return;
            connectionErrors += 1;
            if (connectionErrors >= 5) finish(new Error("Agent 事件连接多次重试后仍无法恢复"));
            else reportStage({ key: "reconnecting", resumeKey: latestStageKey, text: `连接暂时中断，正在进行第 ${connectionErrors} 次自动恢复` });
        };
    });
}
