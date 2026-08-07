import type { CanvasProject, CanvasProjectMediaPreview, CanvasProjectSummary } from "@/lib/canvas-project-contract";

export function summarizeCanvasProjectRecord(project: CanvasProject): CanvasProjectSummary {
    const preview = canvasProjectMediaPreviews(project, 1)[0];
    return {
        id: project.id,
        sourceHandoffId: project.sourceHandoffId,
        creativeConversationId: project.creativeConversationId,
        title: project.title,
        nodeCount: project.nodes.length,
        connectionCount: project.connections.length,
        ...(preview ? { preview } : {}),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
    };
}

export function canvasProjectMediaPreviews(project: CanvasProject, limit = 6): CanvasProjectMediaPreview[] {
    const candidates: Array<CanvasProjectMediaPreview & { preferred: boolean }> = [];
    const seen = new Set<string>();

    for (const node of project.nodes) {
        const kind = node.type === "video" ? "video" : node.type === "image" || node.type === "panorama" || node.type === "drawing" ? "image" : undefined;
        if (!kind || node.metadata?.status === "error") continue;

        for (const value of [node.metadata?.serverUrl, node.metadata?.remoteUrl, node.metadata?.drawingPreview?.serverUrl, node.metadata?.content]) {
            const url = stableMediaUrl(value);
            if (!url || seen.has(url)) continue;
            seen.add(url);
            candidates.push({ kind, url, preferred: node.metadata?.status === "success" });
        }
    }

    return candidates
        .sort((left, right) => Number(right.preferred) - Number(left.preferred) || Number(right.kind === "image") - Number(left.kind === "image"))
        .slice(0, Math.max(0, limit))
        .map(({ kind, url }) => ({ kind, url }));
}

function stableMediaUrl(value: unknown) {
    const url = typeof value === "string" ? value.trim() : "";
    return url && !/^(data|blob):/i.test(url) ? url : "";
}
