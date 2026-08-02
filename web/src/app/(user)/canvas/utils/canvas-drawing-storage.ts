import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasDrawingDocument, type CanvasDrawingPreview, type CanvasNodeData } from "../types";

export const CANVAS_DRAWING_SCHEMA_VERSION = 1 as const;

export type CanvasDrawingSaveSummary = Pick<CanvasDrawingDocument, "revision" | "updatedAt" | "shapeCount" | "pageCount"> & {
    document: CanvasDrawingDocument;
    preview?: CanvasDrawingPreview;
};

export function createCanvasDrawingDocument(snapshot: unknown, previous?: CanvasDrawingDocument | null): CanvasDrawingDocument {
    const summary = summarizeCanvasDrawing(snapshot);
    return {
        schemaVersion: CANVAS_DRAWING_SCHEMA_VERSION,
        snapshot: cloneValue(snapshot),
        revision: (previous?.revision || 0) + 1,
        updatedAt: new Date().toISOString(),
        shapeCount: summary.shapeCount,
        pageCount: Math.max(1, Math.min(summary.pageCount, 1)),
    };
}

export function normalizeCanvasDrawingDocument(value: unknown): CanvasDrawingDocument | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Partial<CanvasDrawingDocument>;
    if (source.schemaVersion !== CANVAS_DRAWING_SCHEMA_VERSION || source.snapshot === undefined) return null;
    const summary = summarizeCanvasDrawing(source.snapshot);
    return {
        schemaVersion: CANVAS_DRAWING_SCHEMA_VERSION,
        snapshot: cloneValue(source.snapshot),
        revision: Number.isFinite(source.revision) && Number(source.revision) >= 0 ? Number(source.revision) : 0,
        updatedAt: typeof source.updatedAt === "string" && source.updatedAt ? source.updatedAt : new Date(0).toISOString(),
        shapeCount: Number.isFinite(source.shapeCount) ? Math.max(0, Number(source.shapeCount)) : summary.shapeCount,
        pageCount: Math.max(1, Math.min(Number.isFinite(source.pageCount) ? Number(source.pageCount) : summary.pageCount, 1)),
    };
}

export function summarizeCanvasDrawing(snapshot: unknown) {
    const root = asRecord(snapshot);
    const document = asRecord(root.document) || root;
    const store = asRecord(document.store) || document;
    const shapeCount = countRecords(store, "shape:");
    const pageCount = countRecords(store, "page:");
    return { shapeCount, pageCount: Math.max(pageCount, 1) };
}

export function drawingPreviewUrl(preview?: CanvasDrawingPreview | null) {
    return preview?.serverUrl || (preview?.storageKey ? `/api/reference-assets/${preview.storageKey.split("/").map(encodeURIComponent).join("/")}` : "");
}

export function canvasDrawingReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Drawing) return null;
    const preview = node.metadata?.drawingPreview;
    const url = drawingPreviewUrl(preview);
    if (!preview || !url) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: preview.mimeType || "image/png",
        dataUrl: url,
        url,
        serverUrl: preview.serverUrl || url,
        storageKey: preview.storageKey,
        width: preview.width || node.width,
        height: preview.height || node.height,
    };
}

export function drawingNodeHasContent(node: CanvasNodeData | null | undefined) {
    return Boolean(node?.metadata?.drawingDocument?.shapeCount || node?.metadata?.drawingPreview?.serverUrl || node?.metadata?.drawingPreview?.storageKey);
}

export function cloneCanvasDrawingDocument(document?: CanvasDrawingDocument | null) {
    return document ? (cloneValue(document) as CanvasDrawingDocument) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function countRecords(value: Record<string, unknown>, prefix: string) {
    return Object.keys(value).filter((key) => key.startsWith(prefix)).length;
}

function cloneValue<T>(value: T): T {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as T;
}
