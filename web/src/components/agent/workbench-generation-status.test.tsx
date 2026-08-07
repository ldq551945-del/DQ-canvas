import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkbenchGenerationStatus } from "./workbench-generation-placeholder";

describe("workbench generation status", () => {
    it("shows the server phase and elapsed time without inventing progress", () => {
        const html = renderToStaticMarkup(<WorkbenchGenerationStatus state={{ publicStatus: "generating", elapsedMs: 65_000, message: "生成中" }} />);
        expect(html).toContain("生成中");
        expect(html).toContain("1分05秒");
        expect(html).not.toContain("真实进度");
    });

    it("renders a real progress value when the server provides one", () => {
        const html = renderToStaticMarkup(<WorkbenchGenerationStatus state={{ publicStatus: "generating", elapsedMs: 2_000, progress: 42, message: "生成中" }} />);
        expect(html).toContain("真实进度 42%");
        expect(html).toContain("width:42%");
    });
});
