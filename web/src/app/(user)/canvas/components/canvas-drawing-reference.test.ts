import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { buildCanvasResourceReferences } from "../utils/canvas-resource-references";
import { canvasRunSelectedNodeIds, nodeToReference } from "./canvas-assistant-elements";

const drawing: CanvasNodeData = {
    id: "drawing-one",
    type: CanvasNodeType.Drawing,
    title: "分镜草图",
    position: { x: 0, y: 0 },
    width: 640,
    height: 360,
    metadata: {
        drawingPreview: {
            storageKey: "permanent/2026/08/02/images/drawing.png",
            serverUrl: "/api/reference-assets/permanent/2026/08/02/images/drawing.png",
            mimeType: "image/png",
            width: 1600,
            height: 900,
        },
    },
};

describe("drawing references", () => {
    it("shows saved drawings as image resources with their preview", () => {
        expect(buildCanvasResourceReferences([drawing], [], drawing.id)).toEqual([
            expect.objectContaining({
                nodeId: drawing.id,
                kind: "image",
                label: "绘图1",
                previewUrl: drawing.metadata?.drawingPreview?.serverUrl,
                active: true,
            }),
        ]);
    });

    it("attaches a selected drawing preview to Canvas Agent requests", () => {
        expect(nodeToReference(drawing)).toEqual({
            id: drawing.id,
            type: CanvasNodeType.Drawing,
            title: drawing.title,
            dataUrl: drawing.metadata?.drawingPreview?.serverUrl,
            storageKey: drawing.metadata?.drawingPreview?.storageKey,
        });

        const snapshot = {
            projectId: "canvas-one",
            title: "画布",
            nodes: [drawing],
            connections: [],
            selectedNodeIds: [drawing.id],
            viewport: { x: 0, y: 0, k: 1 },
        };
        expect(canvasRunSelectedNodeIds(snapshot, new Set())).toEqual([]);
        expect(canvasRunSelectedNodeIds(snapshot, new Set([drawing.id]))).toEqual([drawing.id]);
    });
});
