import { isCanvasImageNodeType, type CanvasNodeData } from "../types";

export type CanvasDerivedImageRequestTicket = {
    key: string;
    token: symbol;
    projectId: string;
    sourceNodeId: string;
    sourceFingerprint: string;
};

export function beginCanvasDerivedImageRequest(requests: Map<string, symbol>, projectId: string, operation: string, sourceNode: CanvasNodeData): CanvasDerivedImageRequestTicket | null {
    const key = `${projectId}:${operation}:${sourceNode.id}`;
    if (requests.has(key)) return null;
    const token = Symbol(key);
    requests.set(key, token);
    return { key, token, projectId, sourceNodeId: sourceNode.id, sourceFingerprint: canvasDerivedImageSourceFingerprint(sourceNode) };
}

export function currentCanvasDerivedImageSource(requests: Map<string, symbol>, ticket: CanvasDerivedImageRequestTicket, currentProjectId: string, nodes: readonly CanvasNodeData[]) {
    if (currentProjectId !== ticket.projectId || requests.get(ticket.key) !== ticket.token) return null;
    const sourceNode = nodes.find((node) => node.id === ticket.sourceNodeId);
    if (!sourceNode || !isCanvasImageNodeType(sourceNode.type) || !sourceNode.metadata?.content?.trim()) return null;
    return canvasDerivedImageSourceFingerprint(sourceNode) === ticket.sourceFingerprint ? sourceNode : null;
}

export function finishCanvasDerivedImageRequest(requests: Map<string, symbol>, ticket: CanvasDerivedImageRequestTicket) {
    if (requests.get(ticket.key) === ticket.token) requests.delete(ticket.key);
}

function canvasDerivedImageSourceFingerprint(node: CanvasNodeData) {
    return JSON.stringify([node.metadata?.content?.trim() || "", node.metadata?.storageKey?.trim() || ""]);
}
