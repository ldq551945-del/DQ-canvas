import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Canvas entry behavior", () => {
    it("keeps the removed Agent creation badge out of the public home", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/home-client.tsx"), "utf8");

        expect(source).not.toContain("Agent 创作入口");
        expect(source).not.toContain("landing-hero-badge");
    });

    it("keeps the canvas index open until the user chooses a project", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/canvas/page.tsx"), "utf8");

        expect(source).not.toContain("useSearchParams");
        expect(source).not.toContain("autoOpenRef");
        expect(source).not.toContain('searchParams.get("mode")');
        expect(source).toContain("router.push(`/canvas/${id}`)");
    });

    it("uses the Q brand mark for both canvas Agent entry points", async () => {
        const [topBar, panel] = await Promise.all([readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-top-bar.tsx"), "utf8"), readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-assistant-panel.tsx"), "utf8")]);

        expect(topBar).toContain('<span className="canvas-agent-button-icon inline-flex size-7 shrink-0 items-center justify-center">');
        expect(topBar).toContain('<SiteLogo logoUrl="/logo.svg" className={agentOpen ? "size-7 dark:bg-stone-950" : "size-7"} />');
        expect(panel).toContain('<SiteLogo logoUrl="/logo.svg" className="size-7" />');
        expect(topBar).not.toContain("<Bot");
        expect(panel).not.toContain("<Bot");
    });

    it("uses the Q brand mark across image and video workbench Agent states", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/agent/workbench-agent-panel.tsx"), "utf8");

        expect(source).toContain('import { SiteLogo } from "@/components/layout/site-logo";');
        expect(source.match(/<SiteLogo logoUrl="\/logo\.svg" className="size-7" \/>/g)).toHaveLength(2);
        expect(source).not.toContain("<Bot");
    });

    it("does not expand the Agent panel while a canvas project loads", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/canvas/[id]/use-canvas-generation-actions.tsx"), "utf8");

        expect(source).not.toContain("autoOpenedAgentRef");
        expect(source).not.toContain('matchMedia("(min-width: 1024px)")');
    });

    it("opens drawings only from the two node pencil buttons", async () => {
        const [content, node, hoverToolbar, clientPage] = await Promise.all([
            readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-node-content.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-node.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/canvas/components/canvas-node-hover-toolbar.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/canvas/[id]/canvas-client-page.tsx"), "utf8"),
        ]);

        expect(content.match(/aria-label="编辑绘图"/g)).toHaveLength(2);
        expect(content.match(/onMouseDown=\{stopEditEventPropagation\}/g)).toHaveLength(2);
        expect(content.match(/onPointerDown=\{stopEditEventPropagation\}/g)).toHaveLength(2);
        expect(content).toContain("onEditDrawing?.(node)");
        expect(node).toContain("onEditDrawing={onEditDrawing}");
        expect(node).not.toContain("onEditDrawing?.(data)");
        expect(hoverToolbar).not.toContain("editDrawing");
        expect(clientPage.match(/onEditDrawing=/g)).toHaveLength(1);
    });

    it("creates and selects drawings without opening the editor", async () => {
        const [pointerInteractions, nodeActions, interactionCore] = await Promise.all([
            readFile(resolve(process.cwd(), "src/app/(user)/canvas/[id]/use-canvas-pointer-interactions.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/canvas/[id]/use-canvas-node-actions.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/canvas/[id]/use-canvas-interaction-core.tsx"), "utf8"),
        ]);

        expect(pointerInteractions).not.toContain("setDrawingNodeId");
        expect(pointerInteractions).toContain("clickedNode?.type === CanvasNodeType.Drawing");
        expect(pointerInteractions).toContain("setDialogNodeId(null)");
        expect(nodeActions).not.toContain("if (type === CanvasNodeType.Drawing) setDrawingNodeId");
        expect(nodeActions).toContain("type !== CanvasNodeType.Drawing");
        expect(interactionCore).not.toContain("setDrawingNodeId");
        expect(interactionCore).toContain("type !== CanvasNodeType.Drawing");
    });
});
