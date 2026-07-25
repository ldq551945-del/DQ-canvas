import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkbenchGenerationActivity, WorkbenchGenerationPlaceholder } from "./workbench-generation-placeholder";

describe("workbench generation placeholders", () => {
    it("keeps generation status accessible without visible status copy", () => {
        const placeholder = renderToStaticMarkup(<WorkbenchGenerationPlaceholder kind="image" />);
        const activity = renderToStaticMarkup(<WorkbenchGenerationActivity kind="video" count={2} />);

        expect(placeholder).toContain('aria-label="图片正在生成"');
        expect(placeholder).toContain('class="sr-only">图片正在生成</span>');
        expect(activity).toContain('aria-label="2 个视频任务正在生成"');
        expect(activity).toContain('class="sr-only">2 个视频任务正在生成</span>');
        expect(activity).not.toContain(">生成中<");
    });
});
