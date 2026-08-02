import { afterEach, describe, expect, it, vi } from "vitest";

import { CANVAS_DRAWING_SCHEMA_VERSION, cloneCanvasDrawingDocument, createCanvasDrawingDocument, normalizeCanvasDrawingDocument, summarizeCanvasDrawing } from "./canvas-drawing-storage";

const SAVED_AT = "2026-08-02T10:00:00.000Z";

describe("canvas drawing storage", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("creates a versioned document that survives JSON persistence and normalization", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(SAVED_AT));
        const snapshot = tldrawSnapshot({
            "page:page": { id: "page:page", typeName: "page", name: "Page 1" },
            "shape:one": { id: "shape:one", typeName: "shape", props: { text: "before save" } },
        });

        const saved = createCanvasDrawingDocument(snapshot);
        const restored = normalizeCanvasDrawingDocument(JSON.parse(JSON.stringify(saved)));

        expect(saved).toEqual({
            schemaVersion: CANVAS_DRAWING_SCHEMA_VERSION,
            snapshot,
            revision: 1,
            updatedAt: SAVED_AT,
            shapeCount: 1,
            pageCount: 1,
        });
        expect(restored).toEqual(saved);
        expect(restored).not.toBe(saved);
        expect(restored?.snapshot).not.toBe(saved.snapshot);
    });

    it("rejects unsupported documents and normalizes missing or invalid summary fields", () => {
        const snapshot = tldrawSnapshot({
            "page:page": { id: "page:page", typeName: "page" },
            "shape:one": { id: "shape:one", typeName: "shape" },
            "shape:two": { id: "shape:two", typeName: "shape" },
        });

        expect(normalizeCanvasDrawingDocument(null)).toBeNull();
        expect(normalizeCanvasDrawingDocument([])).toBeNull();
        expect(normalizeCanvasDrawingDocument({ schemaVersion: 2, snapshot })).toBeNull();
        expect(normalizeCanvasDrawingDocument({ schemaVersion: CANVAS_DRAWING_SCHEMA_VERSION })).toBeNull();

        expect(
            normalizeCanvasDrawingDocument({
                schemaVersion: CANVAS_DRAWING_SCHEMA_VERSION,
                snapshot,
                revision: Number.NaN,
                updatedAt: "",
                shapeCount: Number.NaN,
                pageCount: Number.NaN,
            }),
        ).toEqual({
            schemaVersion: CANVAS_DRAWING_SCHEMA_VERSION,
            snapshot,
            revision: 0,
            updatedAt: "1970-01-01T00:00:00.000Z",
            shapeCount: 2,
            pageCount: 1,
        });
    });

    it("increments revision on every save while preserving the previous document", () => {
        const firstSnapshot = tldrawSnapshot({
            "page:page": { id: "page:page", typeName: "page" },
            "shape:first": { id: "shape:first", typeName: "shape" },
        });
        const firstSave = createCanvasDrawingDocument(firstSnapshot);
        const secondSnapshot = tldrawSnapshot({
            "page:page": { id: "page:page", typeName: "page" },
            "shape:first": { id: "shape:first", typeName: "shape" },
            "shape:second": { id: "shape:second", typeName: "shape" },
        });

        const secondSave = createCanvasDrawingDocument(secondSnapshot, firstSave);

        expect(firstSave.revision).toBe(1);
        expect(firstSave.shapeCount).toBe(1);
        expect(secondSave.revision).toBe(2);
        expect(secondSave.shapeCount).toBe(2);
        expect(firstSave.snapshot).toEqual(firstSnapshot);
    });

    it("counts shape and page records from tldraw snapshots without counting other records", () => {
        const store = {
            "document:document": { id: "document:document", typeName: "document" },
            "page:one": { id: "page:one", typeName: "page" },
            "page:two": { id: "page:two", typeName: "page" },
            "shape:one": { id: "shape:one", typeName: "shape" },
            "shape:two": { id: "shape:two", typeName: "shape" },
            "asset:image": { id: "asset:image", typeName: "asset" },
        };

        expect(summarizeCanvasDrawing({ document: { store } })).toEqual({ shapeCount: 2, pageCount: 2 });
        expect(summarizeCanvasDrawing({ document: { store: {} } })).toEqual({ shapeCount: 0, pageCount: 1 });
    });

    it("deep clones documents so duplicated drawings remain isolated", () => {
        const original = createCanvasDrawingDocument(
            tldrawSnapshot({
                "page:page": { id: "page:page", typeName: "page" },
                "shape:one": { id: "shape:one", typeName: "shape", props: { text: "original" } },
            }),
        );

        const duplicate = cloneCanvasDrawingDocument(original);
        const originalStore = snapshotStore(original.snapshot);
        const duplicateStore = snapshotStore(duplicate?.snapshot);

        expect(duplicate).toEqual(original);
        expect(duplicate).not.toBe(original);
        expect(duplicate?.snapshot).not.toBe(original.snapshot);

        (duplicateStore["shape:one"] as { props: { text: string } }).props.text = "duplicate";
        duplicateStore["shape:two"] = { id: "shape:two", typeName: "shape" };
        expect((originalStore["shape:one"] as { props: { text: string } }).props.text).toBe("original");
        expect(originalStore["shape:two"]).toBeUndefined();

        (originalStore["shape:one"] as { props: { text: string } }).props.text = "changed original";
        expect((duplicateStore["shape:one"] as { props: { text: string } }).props.text).toBe("duplicate");
        expect(cloneCanvasDrawingDocument(null)).toBeUndefined();
    });
});

function tldrawSnapshot(store: Record<string, unknown>) {
    return {
        document: {
            store,
            schema: { schemaVersion: 2, sequences: {} },
        },
    };
}

function snapshotStore(snapshot: unknown): Record<string, unknown> {
    return (snapshot as { document: { store: Record<string, unknown> } }).document.store;
}
