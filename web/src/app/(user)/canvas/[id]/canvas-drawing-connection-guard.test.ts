import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { beginCanvasDrawingCreate, currentCanvasDrawingCreateSource, finishCanvasDrawingCreate } from "./canvas-drawing-connection-guard";

describe("canvas drawing connection guard", () => {
    it("deduplicates an in-flight request for the same project and source", () => {
        const requests = new Map<string, symbol>();
        const source = imageNode();

        expect(beginCanvasDrawingCreate(requests, "project-one", source)).not.toBeNull();
        expect(beginCanvasDrawingCreate(requests, "project-one", source)).toBeNull();
        expect(beginCanvasDrawingCreate(requests, "project-two", source)).not.toBeNull();
    });

    it("returns the current source while the project and media are unchanged", () => {
        const requests = new Map<string, symbol>();
        const source = imageNode();
        const ticket = beginCanvasDrawingCreate(requests, "project-one", source)!;

        expect(currentCanvasDrawingCreateSource(requests, ticket, "project-one", [source])).toBe(source);
    });

    it("rejects a result after the project changes or the source is removed", () => {
        const requests = new Map<string, symbol>();
        const source = imageNode();
        const ticket = beginCanvasDrawingCreate(requests, "project-one", source)!;

        expect(currentCanvasDrawingCreateSource(requests, ticket, "project-two", [source])).toBeNull();
        expect(currentCanvasDrawingCreateSource(requests, ticket, "project-one", [])).toBeNull();
    });

    it("rejects a result after the source media changes", () => {
        const requests = new Map<string, symbol>();
        const source = imageNode();
        const ticket = beginCanvasDrawingCreate(requests, "project-one", source)!;
        const changed = imageNode({ content: "/api/reference-assets/permanent/user/new.png" });

        expect(currentCanvasDrawingCreateSource(requests, ticket, "project-one", [changed])).toBeNull();
    });

    it("does not let an old ticket clear a replacement lock", () => {
        const requests = new Map<string, symbol>();
        const ticket = beginCanvasDrawingCreate(requests, "project-one", imageNode())!;
        const replacement = Symbol("replacement");
        requests.set(ticket.key, replacement);

        finishCanvasDrawingCreate(requests, ticket);

        expect(requests.get(ticket.key)).toBe(replacement);
    });
});

function imageNode(metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return {
        id: "source-image",
        type: CanvasNodeType.Image,
        title: "Source image",
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: {
            content: "/api/reference-assets/permanent/user/source.png",
            serverUrl: "/api/reference-assets/permanent/user/source.png",
            storageKey: "permanent/user/source.png",
            mimeType: "image/png",
            naturalWidth: 1200,
            naturalHeight: 800,
            ...metadata,
        },
    };
}
