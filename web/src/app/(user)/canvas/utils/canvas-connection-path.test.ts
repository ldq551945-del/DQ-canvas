import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { buildNodeConnectionPath } from "./canvas-connection-path";

function node(id: string, x: number, y: number, width = 340, height = 240): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: id, position: { x, y }, width, height };
}

describe("Canvas connection routing", () => {
    it("uses a compact bezier when the target is clearly to the right", () => {
        const path = buildNodeConnectionPath(node("from", 0, 0), node("to", 520, 40));

        expect(path).toContain(" C ");
        expect(path).not.toContain(" Q ");
    });

    it("routes through the vertical gap when the target starts behind the source handle", () => {
        const path = buildNodeConnectionPath(node("from", 0, 0, 340, 210), node("to", 320, 280, 340, 240));

        expect(path).toContain(" Q ");
        expect(path).toContain("245");
        expect(path).not.toContain(" C ");
    });

    it("routes outside both nodes when their vertical ranges overlap", () => {
        const path = buildNodeConnectionPath(node("from", 0, 0), node("to", 280, 80));

        expect(path).toContain("-32");
        expect(path).toContain(" Q ");
    });
});
