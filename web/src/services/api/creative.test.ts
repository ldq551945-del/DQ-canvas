import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refreshUserPointsIfSystem: vi.fn(async () => undefined) }));

vi.mock("@/services/api/points", () => ({ refreshUserPointsIfSystem: mocks.refreshUserPointsIfSystem }));

import { controlCreativeAgentRun, listCreativeConversationPage, watchCreativeAgentRun } from "./creative";
import type { CreativeProjectHandoff } from "@/lib/creative-runtime-contract";

class FakeEventSource extends EventTarget {
    static instance: FakeEventSource;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public readonly url: string) {
        super();
        FakeEventSource.instance = this;
    }
    close() {}
    emit(type: string, data: unknown) {
        this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
}

describe("统一创作 Agent 事件流", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("returns planning, task and final replies to one conversation", () => {
        vi.stubGlobal("EventSource", FakeEventSource);
        const progress: string[] = [];
        const terminal: unknown[] = [];
        const completed: unknown[] = [];
        watchCreativeAgentRun("run-one", {
            onProgress: (text) => progress.push(text),
            onTerminal: (status, text) => terminal.push({ status, text }),
            onConnectionError: () => undefined,
            onTaskCompleted: (value) => completed.push(value),
        });

        FakeEventSource.instance.emit("run.planned", { data: { reply: "已选择图片模型和 1:1 画幅" } });
        FakeEventSource.instance.emit("task.running", { data: { title: "角色图" } });
        FakeEventSource.instance.emit("task.child.completed", { data: { taskId: "images", title: "角色图", completedCount: 1, failedCount: 0, totalCount: 4 } });
        FakeEventSource.instance.emit("task.child.failed", { data: { taskId: "images", title: "角色图", completedCount: 1, failedCount: 1, totalCount: 4 } });
        FakeEventSource.instance.emit("task.completed", { data: { message: "角色图已经生成" } });
        FakeEventSource.instance.emit("run.completed", { data: { reply: "四张角色图已经完成" } });

        expect(FakeEventSource.instance.url).toBe("/api/agent/runs/run-one/events");
        expect(progress).toEqual(["已选择图片模型和 1:1 画幅", "正在处理「角色图」", "「角色图」已完成 1/4", "「角色图」已完成 1/4，失败 1", "角色图已经生成"]);
        expect(completed).toEqual([{ taskId: "images", title: "角色图", completedCount: 1, failedCount: 0, totalCount: 4 }, undefined]);
        expect(terminal).toEqual([{ status: "completed", text: "四张角色图已经完成" }]);
        expect(mocks.refreshUserPointsIfSystem).toHaveBeenCalledWith("system");
    });

    it("reports terminal failure without asking the user to choose a target", () => {
        vi.stubGlobal("EventSource", FakeEventSource);
        const terminal: unknown[] = [];
        watchCreativeAgentRun("run-two", {
            onProgress: () => undefined,
            onTerminal: (status, text) => terminal.push({ status, text }),
            onConnectionError: () => undefined,
        });
        FakeEventSource.instance.emit("run.failed", { data: { message: "视频渠道暂时不可用" } });
        expect(terminal).toEqual([{ status: "failed", text: "视频渠道暂时不可用" }]);
    });

    it("forwards a persistent project handoff before the run completes", () => {
        vi.stubGlobal("EventSource", FakeEventSource);
        const handoffs: CreativeProjectHandoff[] = [];
        const handoff: CreativeProjectHandoff = {
            id: "handoff-run-three",
            sourceRunId: "run-three",
            conversationId: "conversation-three",
            surface: "drama",
            title: "雨夜来信",
            summary: "将当前内容整理为短剧项目",
            ratio: "9:16",
            assetIds: [],
            assets: [],
        };
        watchCreativeAgentRun("run-three", {
            onProgress: () => undefined,
            onTerminal: () => undefined,
            onConnectionError: () => undefined,
            onProjectHandoff: (value) => handoffs.push(value),
        });

        FakeEventSource.instance.emit("project.handoff", { data: { projectHandoff: handoff } });
        FakeEventSource.instance.emit("run.completed", { data: { projectHandoff: handoff, reply: "短剧项目资料已经整理完成" } });

        expect(handoffs).toEqual([handoff]);
    });
});

describe("创作会话来源", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("requests only the selected workbench source", async () => {
        const fetchMock = vi.fn(async (_input: string | URL | Request) => Response.json({ code: 0, data: { conversations: [], hasMore: false }, msg: "ok" }));
        vi.stubGlobal("fetch", fetchMock);

        await listCreativeConversationPage({ source: "video-workbench", offset: 10, limit: 20 });

        const url = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
        expect(Object.fromEntries(url.searchParams)).toMatchObject({ surface: "chat", source: "video-workbench", status: "active", offset: "10", limit: "20" });
    });

    it("explicitly retries a failed planning run in place", async () => {
        const run = { id: "run-one", conversationId: "conversation-one", inputMessageId: "input-one", assistantMessageId: "assistant-one", status: "planning", assetIds: [], tasks: [] };
        const fetchMock = vi.fn(async () => Response.json({ code: 0, data: { run }, msg: "OK" }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(controlCreativeAgentRun("run-one", "retry")).resolves.toEqual({ run });
        expect(fetchMock).toHaveBeenCalledWith("/api/agent/runs/run-one/retry", expect.objectContaining({ method: "POST", cache: "no-store" }));
    });
});
