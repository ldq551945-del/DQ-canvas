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

describe("explicit node mentions", () => {
    it("resolves the source mention for a portrait-texture image child", () => {
        const source: CanvasNodeData = {
            id: "portrait-source",
            type: CanvasNodeType.Image,
            title: "Portrait",
            position: { x: 0, y: 0 },
            width: 640,
            height: 960,
            metadata: {
                content: "/api/reference-assets/permanent/portrait.png",
                storageKey: "permanent/portrait.png",
                mimeType: "image/png",
                naturalWidth: 1200,
                naturalHeight: 1800,
            },
        };
        const target: CanvasNodeData = {
            id: "portrait-texture",
            type: CanvasNodeType.Image,
            title: "人物质感调节",
            position: { x: 800, y: 0 },
            width: 640,
            height: 960,
            metadata: {
                prompt: `@[node:${source.id}]`,
                composerContent: `@[node:${source.id}]`,
                portraitTexture: {
                    personSceneFusion: "deep",
                    lightingFusion: "natural",
                    skin: "natural",
                    texture: "natural",
                    sharpness: "standard",
                },
            },
        };

        const context = buildNodeGenerationContext(target.id, [source, target], [connection(source.id, target.id)], target.metadata!.composerContent!);

        expect(context.prompt).toBe("图片1");
        expect(context.imageCount).toBe(1);
        expect(context.referenceImages).toHaveLength(1);
        expect(context.referenceImages[0]).toMatchObject({ id: source.id, storageKey: "permanent/portrait.png", width: 1200, height: 1800 });
    });

    it("keeps selected video frames when an explicit mention filters ordinary references", () => {
        const mentioned: CanvasNodeData = {
            id: "mentioned-frame",
            type: CanvasNodeType.Image,
            title: "Mentioned frame",
            position: { x: 0, y: 0 },
            width: 640,
            height: 360,
            metadata: { content: "/api/reference-assets/permanent/mentioned.png", mimeType: "image/png" },
        };
        const selectedFrame: CanvasNodeData = {
            ...mentioned,
            id: "selected-frame",
            title: "Selected frame",
            metadata: { content: "/api/reference-assets/permanent/selected.png", mimeType: "image/png" },
        };
        const target: CanvasNodeData = {
            ...targetNode(),
            id: "video-target",
            type: CanvasNodeType.Video,
            metadata: { videoStartFrameNodeId: selectedFrame.id, videoEndFrameNodeId: selectedFrame.id },
        };

        const context = buildNodeGenerationContext(target.id, [mentioned, selectedFrame, target], [connection(mentioned.id, target.id), connection(selectedFrame.id, target.id)], `Use @[node:${mentioned.id}] as the visual reference`);

        expect(context.referenceImages.map((image) => image.id)).toEqual([mentioned.id, selectedFrame.id]);
    });

    it("keeps structural start and end frames when a config prompt has no node token", () => {
        const startFrame: CanvasNodeData = {
            ...targetNode(),
            id: "start-frame",
            title: "Start frame",
            metadata: { content: "/api/reference-assets/permanent/start.png", mimeType: "image/png" },
        };
        const endFrame: CanvasNodeData = {
            ...targetNode(),
            id: "end-frame",
            title: "End frame",
            metadata: { content: "/api/reference-assets/permanent/end.png", mimeType: "image/png" },
        };
        const config: CanvasNodeData = {
            ...targetNode(),
            id: "config-target",
            type: CanvasNodeType.Config,
            metadata: { composerContent: "Generate a transition", videoStartFrameNodeId: startFrame.id, videoEndFrameNodeId: endFrame.id },
        };

        const context = buildNodeGenerationContext(config.id, [startFrame, endFrame, config], [connection(startFrame.id, config.id), connection(endFrame.id, config.id)], config.metadata!.composerContent!);

        expect(context.prompt).toBe("Generate a transition");
        expect(context.referenceImages.map((image) => image.id)).toEqual([startFrame.id, endFrame.id]);
        expect(context.imageCount).toBe(2);
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
