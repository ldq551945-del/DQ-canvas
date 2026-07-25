import { afterEach, describe, expect, it, vi } from "vitest";
import { watchCanvasAgentRun } from "./canvas-agent-run-client";
import type { CanvasAgentRunStage } from "./canvas-agent-progress";

class FakeEventSource extends EventTarget {
    static instance: FakeEventSource;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
        super();
        FakeEventSource.instance = this;
    }
    close() {}
    emit(type: string, data: unknown) {
        this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
}

describe("Canvas Agent 事件流", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("reports thinking stages and the final returned message", async () => {
        vi.stubGlobal("EventSource", FakeEventSource);
        const stages: CanvasAgentRunStage[] = [];
        const messages: string[] = [];
        const details: unknown[] = [];
        const ops: unknown[] = [];
        const promise = watchCanvasAgentRun("run", {
            onPlan: () => undefined,
            onAssistant: (text, detail) => {
                messages.push(text);
                details.push(detail);
            },
            onStage: (stage) => stages.push(stage),
            onPaused: () => undefined,
            onOps: (value) => ops.push(...value),
        });
        FakeEventSource.instance.emit("run.planning", {});
        FakeEventSource.instance.emit("canvas.ops", { data: { ops: [{ type: "add_node", id: "brief-run" }] } });
        FakeEventSource.instance.emit("task.running", { data: { title: "生成文案", attempts: 1 } });
        FakeEventSource.instance.emit("task.completed", { data: { message: "文案已经返回", outputNodeIds: ["output-run-0"], type: "text", ops: [{ type: "select_nodes", ids: ["output-run-0"] }] } });
        FakeEventSource.instance.emit("run.completed", { data: { reply: "全部任务已经完成" } });
        await promise;
        expect(stages).toEqual([
            { key: "planning", text: "正在理解需求并分析当前画布" },
            { key: "plan", text: "文本执行计划已生成，正在准备任务" },
            { key: "executing", text: "正在执行「生成文案」（第 1 次）" },
        ]);
        expect(messages).toEqual(["文案已经返回", "全部任务已经完成"]);
        expect(details).toEqual([
            { nodeIds: ["output-run-0"], taskType: "text" },
            { nodeIds: ["output-run-0"], taskType: "text" },
        ]);
        expect(ops).toEqual([{ type: "select_nodes", ids: ["output-run-0"] }]);
    });

    it("applies a replayed plan once and restores paused state from snapshots", async () => {
        vi.stubGlobal("EventSource", FakeEventSource);
        const plans: unknown[] = [];
        const paused: boolean[] = [];
        const promise = watchCanvasAgentRun("run", {
            onPlan: (ops) => plans.push(ops),
            onAssistant: () => undefined,
            onStage: () => undefined,
            onPaused: (value) => paused.push(value),
            onOps: () => undefined,
        });
        const plan = { data: { ops: [{ type: "add_node", id: "brief-run" }] } };
        FakeEventSource.instance.emit("canvas.ops", plan);
        FakeEventSource.instance.emit("canvas.ops", plan);
        FakeEventSource.instance.emit("run.snapshot", { status: "paused" });
        FakeEventSource.instance.emit("run.snapshot", { status: "paused" });
        FakeEventSource.instance.emit("run.snapshot", { status: "running" });
        FakeEventSource.instance.emit("run.cancelled", {});
        await promise;

        expect(plans).toHaveLength(1);
        expect(paused).toEqual([true, false]);
    });
});
