import { AssetRecordType, createShapeId, createTLStore, DocumentRecordType, PageRecordType, type IndexKey, type TLImageShape } from "tldraw";

import { readImageMeta } from "@/lib/image-utils";
import { parseServerMediaUrl, serverMediaUrl, uploadServerMedia } from "@/services/server-media-storage";
import { CanvasNodeType, type CanvasDrawingPreview, type CanvasNodeData } from "../types";
import { createCanvasDrawingDocument } from "../utils/canvas-drawing-storage";

const INITIAL_DRAWING_SHAPE_MAX_DIMENSION = 1200;

export async function createCanvasDrawingFromImage(sourceNode: CanvasNodeData) {
    const content = sourceNode.metadata?.content?.trim() || "";
    if (sourceNode.type !== CanvasNodeType.Image || !content) throw new Error("只有已有图片内容的节点可以创建绘图");

    const source = await persistDrawingSource({
        url: content,
        serverUrl: sourceNode.metadata?.serverUrl,
        storageKey: sourceNode.metadata?.storageKey,
        mimeType: sourceNode.metadata?.mimeType,
        bytes: sourceNode.metadata?.bytes,
    });
    const imageMeta = sourceNode.metadata?.naturalWidth && sourceNode.metadata?.naturalHeight ? { width: sourceNode.metadata.naturalWidth, height: sourceNode.metadata.naturalHeight, mimeType: source.mimeType } : await readImageMeta(source.url);
    const width = Math.max(1, Math.round(imageMeta.width));
    const height = Math.max(1, Math.round(imageMeta.height));
    const store = createTLStore();
    const document = DocumentRecordType.create({ id: DocumentRecordType.createId("document") });
    const page = PageRecordType.create({
        id: PageRecordType.createId("page"),
        name: "Page 1",
        index: "a1" as IndexKey,
    });

    const assetId = AssetRecordType.createId();
    const shapeScale = Math.min(1, INITIAL_DRAWING_SHAPE_MAX_DIMENSION / Math.max(width, height));
    const shapeWidth = Math.max(1, Math.round(width * shapeScale));
    const shapeHeight = Math.max(1, Math.round(height * shapeScale));
    const name = sourceNode.title || "来源图片";
    const asset = AssetRecordType.create({
        id: assetId,
        type: "image",
        props: {
            w: width,
            h: height,
            name,
            isAnimated: false,
            mimeType: source.mimeType || imageMeta.mimeType || "image/png",
            src: source.url,
            ...(source.bytes ? { fileSize: source.bytes } : {}),
        },
        meta: { storageKey: source.storageKey },
    });
    const shape: TLImageShape = {
        id: createShapeId(),
        typeName: "shape",
        type: "image",
        parentId: page.id,
        index: "a1" as TLImageShape["index"],
        x: -shapeWidth / 2,
        y: -shapeHeight / 2,
        rotation: 0,
        isLocked: false,
        opacity: 1,
        props: {
            w: shapeWidth,
            h: shapeHeight,
            playing: false,
            url: "",
            assetId,
            crop: null,
            flipX: false,
            flipY: false,
            altText: name,
        },
        meta: {},
    };
    store.put([document, page, asset, shape]);

    const drawingDocument = createCanvasDrawingDocument({ document: store.getStoreSnapshot() });
    const preview: CanvasDrawingPreview = {
        storageKey: source.storageKey,
        serverUrl: source.url,
        mimeType: source.mimeType || imageMeta.mimeType || "image/png",
        width,
        height,
        ...(source.bytes ? { bytes: source.bytes } : {}),
    };
    return { document: drawingDocument, preview };
}

async function persistDrawingSource(image: { url: string; serverUrl?: string; storageKey?: string; mimeType?: string; bytes?: number }) {
    const candidate = serverMediaUrl(image.storageKey, image.serverUrl || image.url);
    const reference = parseServerMediaUrl(candidate);
    if (reference?.storageKey.startsWith("permanent/")) {
        return {
            url: reference.url,
            storageKey: reference.storageKey,
            mimeType: image.mimeType || "image/png",
            bytes: Math.max(0, image.bytes || 0),
        };
    }
    return uploadServerMedia(candidate || image.url, "image");
}
