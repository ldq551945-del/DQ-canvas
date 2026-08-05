import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { annotationExportError } from "./canvas-node-annotation-dialog";
import { stopCanvasPortalEvent } from "./canvas-portrait-texture-popover";

describe("canvas advanced image tool boundaries", () => {
    it("shows a useful message when browser security blocks annotation export", () => {
        expect(annotationExportError(new DOMException("The canvas has been tainted", "SecurityError"))).toContain("跨域保护");
        expect(annotationExportError(new Error("导出失败"))).toBe("导出失败");
    });

    it("keeps annotation loading, decode, export, and submit states explicit", () => {
        const source = componentSource("canvas-node-annotation-dialog.tsx");

        expect(source).toContain("element.onerror");
        expect(source).toContain('setLoadState("error")');
        expect(source).toContain("annotationExportError(error)");
        expect(source).toContain('if (submitLockRef.current || loadState !== "ready") return');
        expect(source).toContain("loading={saving}");
        expect(source).toContain('maxHeight: "calc(100dvh - 96px)"');
        expect(source).toContain('overflowY: "auto"');
    });

    it("locks multi-angle submission and keeps its modal reachable on short viewports", () => {
        const source = componentSource("canvas-node-angle-dialog.tsx");

        expect(source).toContain("if (submitLockRef.current) return");
        expect(source).toContain("Promise.resolve(result)");
        expect(source).toContain(".finally(releaseSubmission)");
        expect(source).toContain("loading={submitting}");
        expect(source).toContain("closable={!submitting}");
        expect(source).toContain("mask={{ closable: !submitting }}");
        expect(source).toContain('maxHeight: "calc(100dvh - 120px)"');
        expect(source).toContain('overflowY: "auto"');
    });

    it("keeps annotation and multi-angle submissions promise-aware through page wiring", () => {
        const pageSource = readFileSync(new URL("../[id]/canvas-client-page.tsx", import.meta.url), "utf8");
        const actionSource = readFileSync(new URL("../[id]/use-canvas-node-media-actions.tsx", import.meta.url), "utf8");
        const annotationFlow = actionSource.slice(actionSource.indexOf("const saveAnnotatedImageNode"), actionSource.indexOf("const generatePortraitTextureNode"));

        expect(pageSource).toContain("onConfirm={(dataUrl) => saveAnnotatedImageNode(annotationNode, dataUrl)}");
        expect(pageSource).toContain("onConfirm={(params) => generateAngleNode(angleNode!, params)}");
        expect(annotationFlow).toContain('const failure = error instanceof Error && error.message ? error : new Error("标注图片保存失败")');
        expect(annotationFlow).toContain("message.error(failure.message)");
        expect(annotationFlow).toContain("throw failure");
    });

    it("stops every portal event that can leak into the canvas", () => {
        const stopPropagation = vi.fn();
        stopCanvasPortalEvent({ stopPropagation });

        expect(stopPropagation).toHaveBeenCalledOnce();

        const source = componentSource("canvas-portrait-texture-popover.tsx");
        for (const handler of ["onPointerDown", "onMouseDown", "onClick", "onDoubleClick", "onWheel", "onContextMenu"]) {
            expect(source).toContain(`${handler}={stopCanvasPortalEvent}`);
        }
    });

    it("loads the theme-colored FaceCap geometry without the unused Basis texture runtime", () => {
        const source = componentSource("canvas-node-emotion-panel.tsx");

        expect(source).toContain('useLoader(GLTFLoader, "/canvas/models/facecap.glb"');
        expect(source).toContain("loader.setMeshoptDecoder(MeshoptDecoder)");
        expect(source).not.toContain("KTX2Loader");
        expect(source).not.toContain("/three/basis/");
    });

    it("keeps the full image-tool registry available when a panorama manages the Dock", () => {
        const source = componentSource("canvas-node-hover-toolbar.tsx");

        expect(source).toContain("const imageActionToolbarTools:");
        expect(source).toContain("[...baseToolbarTools, ...nodeToolbarTools, ...imageActionToolbarTools].filter(");
        expect(source).toContain("const temporaryImageToolbarTools = [...baseToolbarTools, ...nodeToolbarTools].filter(");
        expect(source).toContain("...(hasImage && !isPanorama ? imageActionToolbarTools : [])");
    });
});

function componentSource(fileName: string) {
    return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}
