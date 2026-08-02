import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasDrawingDocument, type CanvasNodeData } from "../types";
import { buildNodeGenerationContext, buildNodeGenerationInputs } from "./canvas-node-generation";

describe("drawing generation references", () => {
    it("maps a saved drawing preview to a ReferenceImage input", () => {
        const drawing = drawingNode({
            storageKey: "canvas/drawings/drawing-one/preview.png",
            serverUrl: "/api/reference-assets/canvas/drawings/drawing-one/preview.png",
            mimeType: "image/png",
            width: 1600,
            height: 900,
            bytes: 42_000,
        });
        const target = targetNode();

        const inputs = buildNodeGenerationInputs(target.id, [drawing, target], [connection(drawing.id, target.id)]);

        expect(inputs).toEqual([
            {
                nodeId: drawing.id,
                type: "image",
                sourceKind: "drawing",
                title: drawing.title,
                image: {
                    id: drawing.id,
                    name: "Storyboard.png",
                    type: "image/png",
                    dataUrl: "/api/reference-assets/canvas/drawings/drawing-one/preview.png",
                    url: "/api/reference-assets/canvas/drawings/drawing-one/preview.png",
                    serverUrl: "/api/reference-assets/canvas/drawings/drawing-one/preview.png",
                    storageKey: "canvas/drawings/drawing-one/preview.png",
                    width: 1600,
                    height: 900,
                },
            },
        ]);
    });

    it("includes the drawing preview in generation context with its persisted metadata", () => {
        const drawing = drawingNode({
            storageKey: "canvas/drawings/drawing-one/preview.webp",
            serverUrl: "/api/reference-assets/canvas/drawings/drawing-one/preview.webp",
            mimeType: "image/webp",
            width: 1200,
            height: 675,
        });
        const target = targetNode();

        const context = buildNodeGenerationContext(target.id, [drawing, target], [connection(drawing.id, target.id)], "Create a key visual");

        expect(context.prompt).toBe("Create a key visual");
        expect(context.imageCount).toBe(1);
        expect(context.referenceImages).toHaveLength(1);
        expect(context.referenceImages[0]).toMatchObject({
            id: drawing.id,
            type: "image/webp",
            dataUrl: "/api/reference-assets/canvas/drawings/drawing-one/preview.webp",
            url: "/api/reference-assets/canvas/drawings/drawing-one/preview.webp",
            serverUrl: "/api/reference-assets/canvas/drawings/drawing-one/preview.webp",
            storageKey: "canvas/drawings/drawing-one/preview.webp",
            width: 1200,
            height: 675,
        });
    });

    it("uses an independent drawing label in generation composer tokens", () => {
        const drawing = drawingNode({
            storageKey: "canvas/drawings/drawing-one/preview.png",
            serverUrl: "/api/reference-assets/canvas/drawings/drawing-one/preview.png",
            mimeType: "image/png",
            width: 1200,
            height: 675,
        });
        const target: CanvasNodeData = {
            ...targetNode(),
            type: CanvasNodeType.Config,
            metadata: { composerContent: "@[node:drawing-one]" },
        };

        const context = buildNodeGenerationContext(target.id, [drawing, target], [connection(drawing.id, target.id)], "@[node:drawing-one]");

        expect(context.prompt).toBe("绘图1");
        expect(context.imageCount).toBe(1);
    });

    it("does not expose a saved drawing without a preview as a generation resource", () => {
        const drawing = drawingNode();
        const target = targetNode();
        const nodes = [drawing, target];
        const connections = [connection(drawing.id, target.id)];

        expect(buildNodeGenerationInputs(target.id, nodes, connections)).toEqual([]);
        expect(buildNodeGenerationContext(target.id, nodes, connections, "Create a key visual")).toMatchObject({
            prompt: "Create a key visual",
            referenceImages: [],
            imageCount: 0,
        });
    });
});

function drawingNode(preview?: NonNullable<CanvasNodeData["metadata"]>["drawingPreview"]): CanvasNodeData {
    return {
        id: "drawing-one",
        type: CanvasNodeType.Drawing,
        title: "Storyboard",
        position: { x: 0, y: 0 },
        width: 640,
        height: 360,
        metadata: {
            drawingId: "drawing-one-document",
            drawingDocument: drawingDocument(),
            ...(preview ? { drawingPreview: preview } : {}),
        },
    };
}

function drawingDocument(): CanvasDrawingDocument {
    return {
        schemaVersion: 1,
        snapshot: {
            document: {
                store: {
                    "page:page": { id: "page:page", typeName: "page" },
                    "shape:one": { id: "shape:one", typeName: "shape" },
                },
                schema: { schemaVersion: 2, sequences: {} },
            },
        },
        revision: 1,
        updatedAt: "2026-08-02T10:00:00.000Z",
        shapeCount: 1,
        pageCount: 1,
    };
}

function targetNode(): CanvasNodeData {
    return {
        id: "target",
        type: CanvasNodeType.Image,
        title: "Output",
        position: { x: 800, y: 0 },
        width: 640,
        height: 640,
    };
}

function connection(fromNodeId: string, toNodeId: string): CanvasConnection {
    return {
        id: `${fromNodeId}-${toNodeId}`,
        fromNodeId,
        toNodeId,
    };
}
