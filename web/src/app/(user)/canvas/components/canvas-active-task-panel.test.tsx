import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { ActiveTaskCard, CanvasActiveTaskPanel } from "./canvas-active-task-panel";

describe("CanvasActiveTaskPanel", () => {
    beforeEach(() => useThemeStore.setState({ theme: "light" }));

    it("keeps task details collapsed until the user opens the task summary", () => {
        const markup = renderToStaticMarkup(
            <CanvasActiveTaskPanel
                tasks={[
                    {
                        id: "task-one",
                        type: "video",
                        status: "running",
                        progress: 42,
                        stage: "submitting",
                        createdAt: Date.now() - 1_000,
                        updatedAt: Date.now(),
                    },
                ]}
            />,
        );

        expect(markup).toContain('aria-expanded="false"');
        expect(markup).not.toContain('id="canvas-active-task-list"');
    });

    it("stays out of the DOM when there are no active tasks", () => {
        expect(renderToStaticMarkup(<CanvasActiveTaskPanel tasks={[]} />)).toBe("");
    });

    it("only labels tasks with a persisted charge and keeps duration updates outside the live region", () => {
        const markup = renderToStaticMarkup(
            <CanvasActiveTaskPanel
                tasks={[
                    { id: "charged", type: "image", status: "running", createdAt: 1, updatedAt: 2, billing: { pointsCost: 8 } },
                    { id: "unbilled", type: "text", status: "running", createdAt: 1, updatedAt: 2 },
                ]}
            />,
        );

        expect(markup).toContain('aria-live="polite"');
        expect(markup).not.toContain('aria-label="当前画布生成任务" aria-live');
    });
    it("renders the persisted background-removal milestone instead of simulated progress", () => {
        const markup = renderToStaticMarkup(
            <ActiveTaskCard
                task={{ id: "cutout", type: "image_process", status: "running", progressStage: "inference", progress: 50, stage: "rembg \u63a8\u7406", createdAt: 1, updatedAt: 2 }}
                now={2}
                theme={canvasThemes.light}
                expanded={false}
                onToggle={() => undefined}
            />,
        );

        expect(markup).toContain("rembg \u63a8\u7406");
        expect(markup).toContain('aria-label="\u8fdb\u5ea6 50%"');
        expect(markup).not.toContain("canvas-task-progress-indeterminate");
        expect(markup).toContain('aria-current="step"');
    });
});
