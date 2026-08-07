import type { CanvasProject, CanvasProjectMediaPreview } from "@/lib/canvas-project-contract";
import { canvasProjectMediaPreviews } from "@/lib/canvas-project-summary";

export type CreateOverviewMedia = CanvasProjectMediaPreview;

export type CreateOverviewProject = {
    id: string;
    title: string;
    updatedAt: string;
    nodeCount: number;
    connectionCount: number;
    previews: CreateOverviewMedia[];
};

export type CreateOverviewTask = {
    id: string;
    kind: "image" | "video";
    source: string;
    title: string;
    createdAt: string;
};

export type CreateOverviewAsset = {
    id: string;
    kind: "image" | "video" | "audio";
    title: string;
    url: string;
    mimeType?: string;
    createdAt: string;
};

export type CreateWorkbenchOverviewPayload = {
    latestProject?: CreateOverviewProject;
    runningTasks: CreateOverviewTask[];
    recentAssets: CreateOverviewAsset[];
};

export function summarizeCanvasProject(project: CanvasProject): CreateOverviewProject {
    return {
        id: project.id,
        title: project.title,
        updatedAt: project.updatedAt,
        nodeCount: project.nodes.length,
        connectionCount: project.connections.length,
        previews: canvasProjectMediaPreviews(project),
    };
}
