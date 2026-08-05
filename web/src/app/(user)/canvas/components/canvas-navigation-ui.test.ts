import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function source(name: string) {
    return readFile(resolve(process.cwd(), `src/app/(user)/canvas/components/${name}`), "utf8");
}

describe("Canvas navigation UI", () => {
    it("keeps both performance controls on the same mode handler and replaces the top-right shortcut button", async () => {
        const topBar = await source("canvas-top-bar.tsx");

        const newProject = topBar.indexOf('key: "new"');
        const performance = topBar.indexOf('key: "performance-menu"');
        const deleteProject = topBar.indexOf('key: "delete"');
        expect(newProject).toBeGreaterThan(-1);
        expect(performance).toBeGreaterThan(newProject);
        expect(deleteProject).toBeGreaterThan(performance);
        expect(topBar).toContain("children: performanceMenuItems(performanceMode, performanceReduced, onPerformanceModeChange)");
        expect(topBar).toContain("items: performanceMenuItems(performanceMode, performanceReduced, onPerformanceModeChange)");
        expect(topBar).toContain('<UserStatusActions variant="canvas" />');
        expect(topBar).not.toContain("onOpenShortcuts=");
        expect(topBar).toContain("data-canvas-performance-trigger");
        expect(topBar).toContain("自动性能");
        expect(topBar).toContain("画质优先");
        expect(topBar).toContain("性能优先");
    });

    it("keeps the keyboard icon as the sole shortcut entry in the zoom controls", async () => {
        const zoomControls = await source("canvas-zoom-controls.tsx");

        expect(zoomControls).toContain("import { Compass, Focus, Keyboard }");
        expect(zoomControls).toContain('icon={<Keyboard className="size-4" />}');
        expect(zoomControls).toContain('aria-label="打开画布快捷键"');
        expect(zoomControls).toContain('title="画布快捷键"');
        expect(zoomControls).not.toContain("HelpCircle");
    });

    it("collects exactly the seven component creators in a responsive keyboard-accessible menu", async () => {
        const toolbar = await source("canvas-toolbar.tsx");

        expect(toolbar).toContain('id="tool-add"');
        for (const label of ["文本", "图片", "全景图", "绘图", "视频", "音频", "生成配置"]) {
            expect(toolbar).toContain(`label="${label}"`);
        }
        expect(toolbar).toContain('id="canvas-add-component-menu"');
        expect(toolbar).toContain('role="menu"');
        expect(toolbar).toContain('role="menuitem"');
        expect(toolbar).toContain("handleAddMenuKeyDown");
        expect(toolbar).toContain('window.addEventListener("keydown", closeOnEscape)');
        expect(toolbar).toContain("max-w-[calc(100%-24px)]");
        expect(toolbar).toContain("max-sm:bottom-[132px]");
        expect(toolbar).toContain("getPanelX(wrapRef.current, event.currentTarget, 272)");
    });
});
