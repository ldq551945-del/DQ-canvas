import { CanvasNodeType, type CanvasNodeData } from "../types";

export type CanvasDrawingCreateTicket = {
    key: string;
    token: symbol;
    projectId: string;
    sourceNodeId: string;
    sourceFingerprint: string;
};

export function beginCanvasDrawingCreate(requests: Map<string, symbol>, projectId: string, sourceNode: CanvasNodeData): CanvasDrawingCreateTicket | null {
    const key = `${projectId}:${sourceNode.id}`;
    if (requests.has(key)) return null;
    const token = Symbol(key);
    requests.set(key, token);
    return {
        key,
        token,
        projectId,
        sourceNodeId: sourceNode.id,
        sourceFingerprint: canvasDrawingSourceFingerprint(sourceNode),
    };
}

export function currentCanvasDrawingCreateSource(requests: Map<string, symbol>, ticket: CanvasDrawingCreateTicket, currentProjectId: string, nodes: CanvasNodeData[]) {
    if (currentProjectId !== ticket.projectId || requests.get(ticket.key) !== ticket.token) return null;
    const sourceNode = nodes.find((node) => node.id === ticket.sourceNodeId);
    if (sourceNode?.type !== CanvasNodeType.Image || !sourceNode.metadata?.content?.trim()) return null;
    return canvasDrawingSourceFingerprint(sourceNode) === ticket.sourceFingerprint ? sourceNode : null;
}

export function finishCanvasDrawingCreate(requests: Map<string, symbol>, ticket: CanvasDrawingCreateTicket) {
    if (requests.get(ticket.key) === ticket.token) requests.delete(ticket.key);
}

function canvasDrawingSourceFingerprint(node: CanvasNodeData) {
    const metadata = node.metadata;
    return JSON.stringify([node.title, metadata?.content?.trim() || "", metadata?.serverUrl || "", metadata?.storageKey || "", metadata?.mimeType || "", metadata?.bytes || 0, metadata?.naturalWidth || 0, metadata?.naturalHeight || 0]);
}
