import { describe, expect, it } from "vitest";

import { resolveWorkbenchHydrationDraft } from "./workbench-composer-controls";

describe("工作台提示词水合", () => {
    it("恢复 React 水合前已经输入的文本", () => {
        expect(resolveWorkbenchHydrationDraft("", "生成小狗")).toBe("生成小狗");
    });

    it("已有受控草稿时不被旧 DOM 文本覆盖", () => {
        expect(resolveWorkbenchHydrationDraft("生成唐老鸭", "过期的 DOM 输入")).toBe("生成唐老鸭");
    });
});
