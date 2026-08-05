import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType } from "../types";
import { DQCanvas } from "./dq-canvas";

const containerRef = { current: null };
const viewport = { x: 0, y: 0, k: 1 };
const node = { id: "image", type: CanvasNodeType.Image, title: "", position: { x: 0, y: 0 }, width: 100, height: 100 };

function renderCanvas(performanceMode: "quality" | "performance", canvasTool: "move" | "box-select" = "move") {
    return renderToStaticMarkup(
        <DQCanvas containerRef={containerRef} viewport={viewport} backgroundMode="dots" performanceMode={performanceMode} canvasTool={canvasTool} nodes={[node]} onViewportChange={() => undefined}>
            <div />
        </DQCanvas>,
    );
}

describe("DQCanvas performance mode", () => {
    beforeEach(() => useThemeStore.setState({ theme: "light" }));

    it("removes the canvas grid when performance reduction is active", () => {
        expect(renderCanvas("performance")).not.toContain("background-size:48px 48px");
        expect(renderCanvas("performance")).toContain('class="canvas-surface relative h-full w-full select-none overflow-hidden cursor-grab canvas-performance-mode"');
    });

    it("keeps the selected canvas grid in quality mode", () => {
        expect(renderCanvas("quality")).toContain("radial-gradient");
    });

    it("shows a crosshair while the explicit box-select tool is active", () => {
        expect(renderCanvas("quality", "box-select")).toContain("cursor-crosshair");
    });
});
