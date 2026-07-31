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
        const ops: unknown[] = [];
        const promise = watchCanvasAgentRun("run", {
            onPlan: (ops) => plans.push(ops),
            onAssistant: () => undefined,
            onStage: () => undefined,
            onPaused: (value) => paused.push(value),
            onOps: (value) => ops.push(...value),
        });
        const plan = { data: { ops: [{ type: "add_node", id: "brief-run" }] } };
        FakeEventSource.instance.emit("canvas.ops", plan);
        FakeEventSource.instance.emit("canvas.ops", plan);
        FakeEventSource.instance.emit("run.snapshot", { status: "paused" });
        FakeEventSource.instance.emit("run.snapshot", { status: "paused" });
        FakeEventSource.instance.emit("run.snapshot", { status: "running" });
        FakeEventSource.instance.emit("run.cancelled", { data: { ops: [{ type: "update_node", id: "output-run-0-0", metadata: { status: "cancelled" } }] } });
        await promise;

        expect(plans).toHaveLength(1);
        expect(paused).toEqual([true, false]);
        expect(ops).toEqual([{ type: "update_node", id: "output-run-0-0", metadata: { status: "cancelled" } }]);
    });

    it("keeps failed task identity and applies retry repair operations", async () => {
        vi.stubGlobal("EventSource", FakeEventSource);
        const messages: Array<{ text: string; detail: unknown }> = [];
        const ops: unknown[] = [];
        const promise = watchCanvasAgentRun("run", {
            onPlan: () => undefined,
            onAssistant: (text, detail) => messages.push({ text, detail }),
            onStage: () => undefined,
            onPaused: () => undefined,
            onOps: (value) => ops.push(...value),
        });
        FakeEventSource.instance.emit("task.retry.requested", { data: { ops: [{ type: "update_node", id: "output-run-0-0", metadata: { status: "loading" } }] } });
        FakeEventSource.instance.emit("task.running", { data: { title: "编辑图片", ops: [{ type: "update_node", id: "output-run-0-0", metadata: { status: "loading" } }] } });
        FakeEventSource.instance.emit("task.failed", { data: { taskId: "task", title: "编辑图片", error: "生成渠道暂时无法连接", ops: [{ type: "update_node", id: "output-run-0-0", metadata: { status: "error" } }] } });
        FakeEventSource.instance.emit("run.failed", { data: { message: "生成失败" } });
        await promise;

        expect(ops).toEqual([
            { type: "update_node", id: "output-run-0-0", metadata: { status: "loading" } },
            { type: "update_node", id: "output-run-0-0", metadata: { status: "loading" } },
            { type: "update_node", id: "output-run-0-0", metadata: { status: "error" } },
        ]);
        expect(messages).toEqual([{ text: "「编辑图片」执行失败：生成渠道暂时无法连接", detail: { taskType: undefined, nodeIds: [], taskId: "task", title: "编辑图片", runId: "run" } }]);
    });

    it("applies each child result immediately and keeps successful siblings visible", async () => {
        vi.stubGlobal("EventSource", FakeEventSource);
        const messages: Array<{ text: string; detail: unknown }> = [];
        const stages: CanvasAgentRunStage[] = [];
        const ops: unknown[] = [];
        const promise = watchCanvasAgentRun("run", {
            onPlan: () => undefined,
            onAssistant: (text, detail) => messages.push({ text, detail }),
            onStage: (stage) => stages.push(stage),
            onPaused: () => undefined,
            onOps: (value) => ops.push(...value),
        });

        FakeEventSource.instance.emit("task.child.completed", {
            data: {
                title: "角色图",
                type: "image",
                completedCount: 1,
                failedCount: 0,
                totalCount: 2,
                outputNodeIds: ["output-run-0-0"],
                ops: [{ type: "update_node", id: "output-run-0-0", metadata: { status: "success" } }],
            },
        });
        FakeEventSource.instance.emit("task.child.failed", {
            data: {
                title: "角色图",
                type: "image",
                completedCount: 1,
                failedCount: 1,
                totalCount: 2,
                outputNodeIds: ["output-run-0-1"],
                ops: [{ type: "update_node", id: "output-run-0-1", metadata: { status: "error" } }],
            },
        });
        FakeEventSource.instance.emit("run.completed", { data: { reply: "可用结果已经返回" } });
        await promise;

        expect(ops).toEqual([
            { type: "update_node", id: "output-run-0-0", metadata: { status: "success" } },
            { type: "update_node", id: "output-run-0-1", metadata: { status: "error" } },
        ]);
        expect(stages).toEqual([
            { key: "executing", text: "「角色图」已完成 1/2" },
            { key: "executing", text: "「角色图」已完成 1/2，失败 1" },
        ]);
        expect(messages).toEqual([
            { text: "「角色图」已完成 1/2", detail: { nodeIds: ["output-run-0-0"], taskType: "image" } },
            { text: "「角色图」已完成 1/2，失败 1", detail: { nodeIds: ["output-run-0-0"], taskType: "image" } },
            { text: "可用结果已经返回", detail: { nodeIds: ["output-run-0-0"], taskType: "image" } },
        ]);
    });

    it("exposes planning failures as retryable run failures", async () => {
        vi.stubGlobal("EventSource", FakeEventSource);
        const messages: Array<{ text: string; detail: unknown }> = [];
        const promise = watchCanvasAgentRun("run", {
            onPlan: () => undefined,
            onAssistant: (text, detail) => messages.push({ text, detail }),
            onStage: () => undefined,
            onPaused: () => undefined,
            onOps: () => undefined,
        });
        FakeEventSource.instance.emit("run.failed", { data: { message: "生成渠道暂时无法连接，请稍后重试或联系管理员。" } });
        await promise;

        expect(messages).toEqual([{ text: "生成渠道暂时无法连接，请稍后重试或联系管理员。", detail: { runId: "run", title: "Agent 执行失败" } }]);
    });
});
