import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { beginCanvasDerivedImageRequest, currentCanvasDerivedImageSource, finishCanvasDerivedImageRequest } from "./canvas-derived-image-request-guard";

describe("canvas derived image request guard", () => {
    it("deduplicates only the same operation and source while a request is in flight", () => {
        const requests = new Map<string, symbol>();
        const source = imageNode();

        expect(beginCanvasDerivedImageRequest(requests, "project", "annotation", source)).not.toBeNull();
        expect(beginCanvasDerivedImageRequest(requests, "project", "annotation", source)).toBeNull();
        expect(beginCanvasDerivedImageRequest(requests, "project", "angle", source)).not.toBeNull();
        expect(beginCanvasDerivedImageRequest(requests, "other-project", "annotation", source)).not.toBeNull();
    });

    it("resolves the current source when its id and media identity are unchanged", () => {
        const requests = new Map<string, symbol>();
        const source = imageNode();
        const ticket = beginCanvasDerivedImageRequest(requests, "project", "angle", source)!;

        expect(currentCanvasDerivedImageSource(requests, ticket, "project", [source])).toBe(source);
    });

    it("rejects deleted, replaced, or cross-project sources", () => {
        const requests = new Map<string, symbol>();
        const source = imageNode();
        const ticket = beginCanvasDerivedImageRequest(requests, "project", "annotation", source)!;

        expect(currentCanvasDerivedImageSource(requests, ticket, "project", [])).toBeNull();
        expect(currentCanvasDerivedImageSource(requests, ticket, "project", [imageNode({ content: "/replacement.png" })])).toBeNull();
        expect(currentCanvasDerivedImageSource(requests, ticket, "project", [imageNode({ storageKey: "permanent/replacement.png" })])).toBeNull();
        expect(currentCanvasDerivedImageSource(requests, ticket, "other-project", [source])).toBeNull();
    });

    it("releases the matching request without clearing a replacement token", () => {
        const requests = new Map<string, symbol>();
        const ticket = beginCanvasDerivedImageRequest(requests, "project", "angle", imageNode())!;
        finishCanvasDerivedImageRequest(requests, ticket);
        expect(beginCanvasDerivedImageRequest(requests, "project", "angle", imageNode())).not.toBeNull();

        const replacement = Symbol("replacement");
        requests.set(ticket.key, replacement);
        finishCanvasDerivedImageRequest(requests, ticket);
        expect(requests.get(ticket.key)).toBe(replacement);
    });
});

function imageNode(metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return {
        id: "source",
        type: CanvasNodeType.Image,
        title: "Source",
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: { content: "/source.png", storageKey: "permanent/source.png", ...metadata },
    };
}
