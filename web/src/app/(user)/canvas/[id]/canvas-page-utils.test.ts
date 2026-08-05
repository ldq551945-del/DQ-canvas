import { beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasNodeType, type CanvasAssistantSession, type CanvasNodeData } from "../types";
import { CANVAS_IMAGE_UPLOAD_MAX_BYTES } from "@/lib/creative-upload";

const mocks = vi.hoisted(() => ({
    readImageMeta: vi.fn(),
    resolveStoredImageDataUrl: vi.fn(),
    uploadImage: vi.fn(),
}));

vi.mock("@/lib/image-utils", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/image-utils")>()), readImageMeta: mocks.readImageMeta }));
vi.mock("@/services/image-storage", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/image-storage")>()),
    resolveStoredImageDataUrl: mocks.resolveStoredImageDataUrl,
    uploadImage: mocks.uploadImage,
}));

import { applyNodeConfigPatch, buildPendingMediaNodeMetadata, canvasNodesEqualIgnoringTaskMetadata, hydrateAssistantImages, hydrateCanvasImages, normalizeConnection, uploadCanvasImage } from "./canvas-page-utils";

describe("Canvas project hydration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readImageMeta.mockResolvedValue({ width: 1024, height: 1024, mimeType: "image/png" });
        mocks.resolveStoredImageDataUrl.mockImplementation(async (storageKey: string) => {
            if (storageKey === "broken-image") throw new Error("media unavailable");
            return `/api/reference-assets/${storageKey}`;
        });
        mocks.uploadImage.mockRejectedValue(new Error("upload unavailable"));
    });

    it("keeps the rest of the Canvas usable when one persisted node media fails to hydrate", async () => {
        const valid = imageNode("valid", "valid-image");
        const broken = imageNode("broken", "broken-image");

        const result = await hydrateCanvasImages([valid, broken, textNode()]);

        expect(result).toHaveLength(3);
        expect(result[0]?.metadata?.content).toBe("/api/reference-assets/valid-image");
        expect(result[1]).toBe(broken);
        expect(result[2]?.type).toBe(CanvasNodeType.Text);
    });

    it("preserves individual assistant references that cannot be restored", async () => {
        const sessions: CanvasAssistantSession[] = [
            {
                id: "session",
                title: "会话",
                createdAt: "2026-07-31T00:00:00.000Z",
                updatedAt: "2026-07-31T00:00:00.000Z",
                messages: [
                    {
                        id: "message",
                        role: "user",
                        text: "参考这些素材",
                        references: [
                            { id: "valid", type: CanvasNodeType.Image, title: "正常", storageKey: "valid-image" },
                            { id: "broken", type: CanvasNodeType.Image, title: "失效", storageKey: "broken-image", dataUrl: "legacy-fallback" },
                        ],
                    },
                ],
            },
        ];

        const result = await hydrateAssistantImages(sessions);
        const references = result[0]?.messages[0]?.references;

        expect(references?.[0]?.dataUrl).toBe("/api/reference-assets/valid-image");
        expect(references?.[1]).toEqual(sessions[0]?.messages[0]?.references?.[1]);
    });

    it("uses the 30MiB canvas-image upload purpose for image nodes", async () => {
        mocks.uploadImage.mockResolvedValue({ url: "/api/reference-assets/permanent/source.png", storageKey: "permanent/source.png", width: 4, height: 2, bytes: 10, mimeType: "image/png" });
        mocks.resolveStoredImageDataUrl.mockResolvedValue("/api/reference-assets/permanent/source.png");

        await expect(uploadCanvasImage(new Blob(["x"], { type: "image/png" }))).resolves.toMatchObject({ storageKey: "permanent/source.png" });
        expect(mocks.uploadImage).toHaveBeenCalledWith(expect.any(Blob), { maxBytes: CANVAS_IMAGE_UPLOAD_MAX_BYTES, purpose: "canvas-image" });
    });

    it("updates locked node metadata without changing its geometry", () => {
        const node: CanvasNodeData = {
            ...imageNode("locked", "locked-image"),
            position: { x: 120, y: 80 },
            width: 420,
            height: 260,
            metadata: { locked: true },
        };

        const updated = applyNodeConfigPatch(node, { model: "image-model", size: "1024x1024" });

        expect(updated).toMatchObject({
            position: { x: 120, y: 80 },
            width: 420,
            height: 260,
            metadata: { locked: true, model: "image-model", size: "1024x1024" },
        });
    });

    it("still applies size-driven geometry updates after a node is unlocked", () => {
        const node: CanvasNodeData = {
            ...imageNode("unlocked", "unlocked-image"),
            position: { x: 100, y: 60 },
            width: 420,
            height: 260,
            metadata: { locked: false },
        };

        const updated = applyNodeConfigPatch(node, { size: "1024x1024" });

        expect(updated).toMatchObject({
            position: { x: 190, y: 70 },
            width: 240,
            height: 240,
            metadata: { locked: false, size: "1024x1024" },
        });
    });

    it("keeps lock metadata when an empty media node is reused for generation", () => {
        const source: CanvasNodeData = {
            id: "locked-video",
            type: CanvasNodeType.Video,
            title: "空白视频",
            position: { x: 40, y: 60 },
            width: 480,
            height: 270,
            metadata: { locked: true, prompt: "旧提示词" },
        };

        expect(buildPendingMediaNodeMetadata(source, true, { prompt: "新提示词", status: "loading" })).toMatchObject({ locked: true, prompt: "新提示词", status: "loading" });
        expect(buildPendingMediaNodeMetadata(source, false, { prompt: "新提示词", status: "loading" })).not.toHaveProperty("locked");
    });

    it("does not add canvas history entries for task runtime updates", () => {
        const previous = imageNode("source", "source-image");
        const next: CanvasNodeData = {
            ...previous,
            metadata: {
                ...previous.metadata,
                status: "loading",
                taskId: "remove-background",
                taskStatus: "running",
                taskProgress: 50,
                taskStage: "rembg inference",
                taskUpdatedAt: 123,
                backgroundRemovalTask: {
                    id: "remove-background",
                    sourceNodeId: previous.id,
                    sourceStorageKey: "source-image",
                    sourceContent: previous.metadata?.content || "",
                    options: { version: 3, model: "u2net", preset: "standard", alphaMatting: false, foregroundThreshold: 240, backgroundThreshold: 10, refineRange: 10, cleanMask: false, outputMode: "transparent", backgroundColor: [255, 255, 255, 255] },
                },
            },
        };

        expect(canvasNodesEqualIgnoringTaskMetadata([previous], [next])).toBe(true);
    });

    it("keeps content, geometry and regular metadata changes undoable", () => {
        const previous = imageNode("source", "source-image");

        expect(canvasNodesEqualIgnoringTaskMetadata([previous], [{ ...previous, position: { x: 12, y: 4 } }])).toBe(false);
        expect(canvasNodesEqualIgnoringTaskMetadata([previous], [{ ...previous, metadata: { ...previous.metadata, content: "/changed.png" } }])).toBe(false);
        expect(canvasNodesEqualIgnoringTaskMetadata([previous], [{ ...previous, metadata: { ...previous.metadata, locked: true } }])).toBe(false);
    });

    it("reverses a connection started from a node input rail", () => {
        const input = imageNode("input", "input-image");
        const source = imageNode("source", "source-image");

        expect(normalizeConnection(input.id, source.id, [input, source], "target")).toEqual({ fromNodeId: source.id, toNodeId: input.id });
        expect(normalizeConnection(input.id, source.id, [input, source], "source")).toEqual({ fromNodeId: input.id, toNodeId: source.id });
    });
});

function imageNode(id: string, storageKey: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 320,
        metadata: { content: `/legacy/${id}.png`, storageKey, naturalWidth: 1024, naturalHeight: 1024 },
    };
}

function textNode(): CanvasNodeData {
    return { id: "text", type: CanvasNodeType.Text, title: "文本", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "内容" } };
}
