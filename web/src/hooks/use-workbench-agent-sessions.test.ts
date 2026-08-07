import { describe, expect, it } from "vitest";

import { isCurrentWorkbenchSession, shouldResetWorkbenchDraft } from "./use-workbench-agent-sessions";

describe("工作台会话恢复边界", () => {
    it("拒绝旧会话的异步结果覆盖新会话", () => {
        const context = { key: "user:image", generation: 1 };

        expect(isCurrentWorkbenchSession(context, context, "new-session", "old-session")).toBe(false);
    });

    it("拒绝用户或工作台切换前的异步结果", () => {
        expect(isCurrentWorkbenchSession({ key: "user:image", generation: 2 }, { key: "user:image", generation: 1 }, "session", "session")).toBe(false);
    });

    it("保留初次匿名到登录用户水合期间的草稿", () => {
        expect(shouldResetWorkbenchDraft({ workspace: "image", userId: "" }, { workspace: "image", userId: "user-one" })).toBe(false);
    });

    it("用户或工作台真的切换时清空草稿", () => {
        expect(shouldResetWorkbenchDraft({ workspace: "image", userId: "user-one" }, { workspace: "image", userId: "user-two" })).toBe(true);
        expect(shouldResetWorkbenchDraft({ workspace: "image", userId: "user-one" }, { workspace: "video", userId: "user-one" })).toBe(true);
        expect(shouldResetWorkbenchDraft({ workspace: "image", userId: "user-one" }, { workspace: "image", userId: "" })).toBe(true);
    });
});
