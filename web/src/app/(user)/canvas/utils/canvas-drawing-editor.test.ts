import { describe, expect, it, vi } from "vitest";
import type { Editor } from "tldraw";

import { initializeCanvasDrawingEditor } from "./canvas-drawing-editor";

describe("initializeCanvasDrawingEditor", () => {
    it("prepares one drawing page before fitting its content to the viewport", () => {
        const calls: string[] = [];
        const editor = {
            getPages: vi.fn(() => [{ id: "page:primary" }, { id: "page:extra" }]),
            setCurrentPage: vi.fn((id: string) => calls.push(`page:${id}`)),
            deletePage: vi.fn((id: string) => calls.push(`delete:${id}`)),
            setCurrentTool: vi.fn((tool: string) => calls.push(`tool:${tool}`)),
            zoomToFit: vi.fn(() => calls.push("fit")),
        } as unknown as Editor;
        const cancelViewportFit = vi.fn();
        const scheduleViewportFit = vi.fn((fit: () => void) => {
            calls.push("schedule-fit");
            fit();
            return cancelViewportFit;
        });

        const cleanup = initializeCanvasDrawingEditor(editor, scheduleViewportFit);

        expect(calls).toEqual(["page:page:primary", "delete:page:extra", "tool:draw", "schedule-fit", "fit"]);
        expect(cleanup).toBe(cancelViewportFit);
    });
});
