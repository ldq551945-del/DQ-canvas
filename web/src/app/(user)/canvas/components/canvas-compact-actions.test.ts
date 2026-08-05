import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function componentSource(name: string) {
    return readFile(resolve(process.cwd(), `src/app/(user)/canvas/components/${name}`), "utf8");
}

describe("Canvas compact actions", () => {
    it("keeps result location actions icon-only and aligned beside the result text", async () => {
        const source = await componentSource("canvas-agent-chat-ui.tsx");
        const section = source.slice(source.indexOf("const resultNodeIds"), source.indexOf('objectField(item.detail, "runId")'));

        expect(section).toContain('objectField(item.detail, "taskType") === "text" ? []');
        expect(section).toContain('className="flex min-w-0 items-center gap-1"');
        expect(section.indexOf("{item.text}")).toBeLessThan(section.indexOf("{resultNodeIds.map"));
        expect(section).toContain("<Tooltip key={nodeId} title={locateLabel}");
        expect(section).toContain("aria-label={locateLabel}");
        expect(section).not.toMatch(/<Crosshair[^>]*\/>\s*\{locateLabel\}/);
    });

    it("keeps node hover actions icon-only by default and exposes an optional label switch", async () => {
        const [toolbarSource, settingsSource] = await Promise.all([componentSource("canvas-node-hover-toolbar.tsx"), componentSource("canvas-image-toolbar-settings-modal.tsx")]);

        expect(toolbarSource).toContain("<Tooltip title={title}");
        expect(toolbarSource).toContain("aria-label={title}");
        expect(toolbarSource).not.toContain("showImageToolLabels");
        expect(toolbarSource).toContain("const [showLabels, setShowLabels] = useState(false)");
        expect(toolbarSource).toContain('id="node-lock"');
        expect(toolbarSource).toContain('className="size-4" strokeWidth={2.25}');
        expect(toolbarSource).toMatch(/active=\{Boolean\(node\.metadata\?\.locked\)\}[\s\S]*onClick=\{\(\) => onToggleLocked\(node\)\}/);
        expect(toolbarSource).not.toContain("prominent");
        expect(toolbarSource).toContain('className="grid size-5 min-w-5 shrink-0 place-items-center [&>*]:size-4"');
        expect(toolbarSource).toContain('id="more" title="更多图片工具" label="更多"');
        expect(toolbarSource).toContain("data-canvas-node-toolbar-scroll");
        expect(toolbarSource).toContain("data-canvas-node-toolbar-fixed");
        expect(toolbarSource).toContain("temporaryImageToolbarTools.map");
        expect(settingsSource).toContain("显示功能名");
        expect(settingsSource).toContain("checked={showLabels} onChange={onShowLabelsChange}");
    });
});
