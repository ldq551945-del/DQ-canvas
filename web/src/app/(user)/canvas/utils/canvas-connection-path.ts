import type { CanvasConnection, CanvasNodeData, Position } from "../types";

export function buildNodeConnectionPath(from: CanvasNodeData, to: CanvasNodeData, fromAnchorRatio?: number, toAnchorRatio?: number) {
    const start = { x: from.position.x + from.width, y: nodeAnchorY(from, fromAnchorRatio) };
    const end = { x: to.position.x, y: nodeAnchorY(to, toAnchorRatio) };
    return buildBezierConnectionPath(start, end);
}

/** The midpoint used by callers that need to place a control on an edge. */
export function connectionInsertionPoint(from: CanvasNodeData, to: CanvasNodeData, fromAnchorRatio?: number, toAnchorRatio?: number): Position {
    const start = { x: from.position.x + from.width, y: nodeAnchorY(from, fromAnchorRatio) };
    const end = { x: to.position.x, y: nodeAnchorY(to, toAnchorRatio) };
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

/** Produces two ratio-preserving edges around an inserted intermediate node. */
export function splitCanvasConnectionAtNode(connection: CanvasConnection, nodeId: string) {
    const fromAnchorRatio = clampAnchorRatio(connection.fromAnchorRatio);
    const toAnchorRatio = clampAnchorRatio(connection.toAnchorRatio);
    return {
        first: { fromNodeId: connection.fromNodeId, toNodeId: nodeId, ...(connection.fromHandleId ? { fromHandleId: connection.fromHandleId } : {}), fromAnchorRatio, toAnchorRatio: 0.5 },
        second: { fromNodeId: nodeId, toNodeId: connection.toNodeId, ...(connection.toHandleId ? { toHandleId: connection.toHandleId } : {}), fromAnchorRatio: 0.5, toAnchorRatio },
    };
}

export function nodeAnchorY(node: CanvasNodeData, ratio?: number) {
    return node.position.y + node.height * clampAnchorRatio(ratio);
}

/** Converts a canvas-space pointer Y coordinate into a safe side-anchor ratio. */
export function nodeAnchorRatioAtY(node: CanvasNodeData, worldY: number) {
    return clampAnchorRatio((worldY - node.position.y) / Math.max(node.height, 1));
}

export function clampAnchorRatio(ratio?: number) {
    if (!Number.isFinite(ratio)) return 0.5;
    // Keep the endpoint inside the rounded side capsule rather than allowing
    // it to land on the node's border-radius corner.
    return Math.min(0.92, Math.max(0.08, Number(ratio)));
}

export function buildPreviewConnectionPath(start: Position, end: Position) {
    return buildBezierConnectionPath(start, end);
}

function buildBezierConnectionPath(start: Position, end: Position) {
    const distance = Math.abs(end.x - start.x);
    return `M ${format(start.x)} ${format(start.y)} C ${format(start.x + distance * 0.5)} ${format(start.y)}, ${format(end.x - distance * 0.5)} ${format(end.y)}, ${format(end.x)} ${format(end.y)}`;
}

function format(value: number) {
    return Number(value.toFixed(2));
}
