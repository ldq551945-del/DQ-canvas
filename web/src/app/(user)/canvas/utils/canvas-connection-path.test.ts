import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { buildNodeConnectionPath, buildPreviewConnectionPath, clampAnchorRatio, connectionInsertionPoint, nodeAnchorRatioAtY, nodeAnchorY, splitCanvasConnectionAtNode } from "./canvas-connection-path";

function node(id: string, x: number, y: number, width = 340, height = 240): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: id, position: { x, y }, width, height };
}

describe("Canvas connection routing", () => {
    it("uses a compact bezier when the target is clearly to the right", () => {
        const path = buildNodeConnectionPath(node("from", 0, 0), node("to", 520, 40));

        expect(path).toContain(" C ");
        expect(path).not.toContain(" Q ");
    });

    it("keeps overlapping nodes on one continuous bezier", () => {
        const path = buildNodeConnectionPath(node("from", 0, 0, 340, 210), node("to", 320, 280, 340, 240));

        expect(path).toBe("M 340 105 C 350 105, 310 400, 320 400");
        expect(path).not.toContain(" Q ");
    });

    it("keeps reverse connections on the same cubic curve", () => {
        const path = buildNodeConnectionPath(node("from", 0, 0), node("to", 280, 80));

        expect(path).toBe("M 340 120 C 370 120, 250 200, 280 200");
        expect(path).not.toContain(" Q ");
    });

    it("keeps legacy connections at the vertical midpoint when ratios are absent", () => {
        const from = node("from", 0, 0, 340, 240);
        const to = node("to", 520, 40, 340, 240);

        expect(nodeAnchorY(from)).toBe(120);
        expect(nodeAnchorY(to)).toBe(160);
        expect(buildNodeConnectionPath(from, to)).toContain("M 340 120 C");
    });

    it("routes from the persisted vertical attachment ratios", () => {
        const path = buildNodeConnectionPath(node("from", 0, 0, 340, 240), node("to", 520, 40, 340, 240), 0.2, 0.8);

        expect(path).toContain("M 340 48 C");
        expect(path).toContain("520 232");
    });

    it("keeps a live connection as one continuous bezier in every drag direction", () => {
        const path = buildPreviewConnectionPath({ x: 340, y: 120 }, { x: 180, y: 300 });

        expect(path).toBe("M 340 120 C 420 120, 100 300, 180 300");
        expect(path).not.toContain(" Q ");
    });

    it("clamps endpoint ratios away from the rounded node corners", () => {
        expect(clampAnchorRatio(-1)).toBe(0.08);
        expect(clampAnchorRatio(2)).toBe(0.92);
        expect(clampAnchorRatio()).toBe(0.5);
        expect(nodeAnchorRatioAtY(node("n", 0, 100, 340, 200), 150)).toBe(0.25);
        expect(nodeAnchorRatioAtY(node("n", 0, 100, 340, 200), -20)).toBe(0.08);
    });

    it("keeps the edge midpoint stable for callers that need it", () => {
        const point = connectionInsertionPoint(node("from", 0, 0, 340, 240), node("to", 620, 80, 340, 240), 0.25, 0.75);

        expect(point).toEqual({ x: 480, y: 160 });
    });

    it("splits a connection while preserving the existing outer anchor ratios", () => {
        expect(splitCanvasConnectionAtNode({ id: "edge", fromNodeId: "from", toNodeId: "to", fromAnchorRatio: 0.2, toAnchorRatio: 0.8 }, "middle")).toEqual({
            first: { fromNodeId: "from", toNodeId: "middle", fromAnchorRatio: 0.2, toAnchorRatio: 0.5 },
            second: { fromNodeId: "middle", toNodeId: "to", fromAnchorRatio: 0.5, toAnchorRatio: 0.8 },
        });
    });

    it("keeps the outer port ids when a connection is split", () => {
        expect(splitCanvasConnectionAtNode({ id: "edge", fromNodeId: "from", toNodeId: "to", fromHandleId: "source:main", toHandleId: "target:main" }, "middle")).toEqual({
            first: { fromNodeId: "from", toNodeId: "middle", fromHandleId: "source:main", fromAnchorRatio: 0.5, toAnchorRatio: 0.5 },
            second: { fromNodeId: "middle", toNodeId: "to", toHandleId: "target:main", fromAnchorRatio: 0.5, toAnchorRatio: 0.5 },
        });
    });
});
