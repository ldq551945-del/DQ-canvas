import { beforeEach, describe, expect, it, vi } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { createCanvasDrawingFromImage } from "./canvas-drawing-from-image";

const mocks = vi.hoisted(() => ({
    readImageMeta: vi.fn(),
    uploadServerMedia: vi.fn(),
}));

vi.mock("@/lib/image-utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/image-utils")>()),
    readImageMeta: mocks.readImageMeta,
}));

vi.mock("@/services/server-media-storage", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/server-media-storage")>()),
    uploadServerMedia: mocks.uploadServerMedia,
}));

describe("createCanvasDrawingFromImage", () => {
    beforeEach(() => {
        mocks.readImageMeta.mockReset();
        mocks.uploadServerMedia.mockReset();
    });

    it("reuses a permanent server image and centers a scaled tldraw image shape", async () => {
        const source = imageNode({
            content: "/api/generation-log-assets/permanent/user/source.png",
            serverUrl: "/api/generation-log-assets/permanent/user/source.png",
            storageKey: "permanent/user/source.png",
            mimeType: "image/png",
            bytes: 3200,
            naturalWidth: 2400,
            naturalHeight: 1200,
        });

        const result = await createCanvasDrawingFromImage(source);
        const store = snapshotStore(result.document.snapshot);
        const asset = recordByType(store, "asset") as { props: Record<string, unknown>; meta: Record<string, unknown> };
        const shape = recordByType(store, "shape") as { x: number; y: number; props: Record<string, unknown> };

        expect(mocks.uploadServerMedia).not.toHaveBeenCalled();
        expect(asset.props).toMatchObject({
            src: "/api/generation-log-assets/permanent/user/source.png",
            w: 2400,
            h: 1200,
            fileSize: 3200,
        });
        expect(asset.meta).toEqual({ storageKey: "permanent/user/source.png" });
        expect(shape).toMatchObject({ x: -600, y: -300, props: { w: 1200, h: 600 } });
        expect(result.document).toMatchObject({ revision: 1, shapeCount: 1, pageCount: 1 });
        expect(result.preview).toMatchObject({
            serverUrl: "/api/generation-log-assets/permanent/user/source.png",
            storageKey: "permanent/user/source.png",
            width: 2400,
            height: 1200,
        });
    });

    it("persists an unstable source before writing it into the drawing snapshot", async () => {
        mocks.uploadServerMedia.mockResolvedValue({
            url: "/api/reference-assets/permanent/user/copied.webp",
            storageKey: "permanent/user/copied.webp",
            mimeType: "image/webp",
            bytes: 6400,
        });
        mocks.readImageMeta.mockResolvedValue({ width: 800, height: 600, mimeType: "image/webp" });

        const result = await createCanvasDrawingFromImage(imageNode({ content: "https://example.com/source.webp" }));
        const asset = recordByType(snapshotStore(result.document.snapshot), "asset") as { props: Record<string, unknown>; meta: Record<string, unknown> };

        expect(mocks.uploadServerMedia).toHaveBeenCalledWith("https://example.com/source.webp", "image");
        expect(asset.props.src).toBe("/api/reference-assets/permanent/user/copied.webp");
        expect(asset.meta.storageKey).toBe("permanent/user/copied.webp");
        expect(result.preview.mimeType).toBe("image/webp");
    });

    it("rejects non-image or empty source nodes", async () => {
        await expect(createCanvasDrawingFromImage({ ...imageNode({ content: "/image.png" }), type: CanvasNodeType.Panorama })).rejects.toThrow("只有已有图片内容的节点可以创建绘图");
        await expect(createCanvasDrawingFromImage(imageNode({ content: "" }))).rejects.toThrow("只有已有图片内容的节点可以创建绘图");
    });
});

function imageNode(metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return {
        id: "source-image",
        type: CanvasNodeType.Image,
        title: "来源图片",
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata,
    };
}

function snapshotStore(snapshot: unknown): Record<string, unknown> {
    return (snapshot as { document: { store: Record<string, unknown> } }).document.store;
}

function recordByType(store: Record<string, unknown>, typeName: string) {
    return Object.values(store).find((record) => (record as { typeName?: string }).typeName === typeName);
}
