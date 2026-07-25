import { describe, expect, it } from "vitest";

import { CanvasNodeType } from "@/app/(user)/canvas/types";
import type { CanvasProject } from "@/lib/canvas-project-contract";
import type { StoredGenerationLogRecord } from "@/services/api/generation-logs";

import { canvasProjectPreviewMedia, createRecentAssets } from "./create-workbench-overview-data";

describe("create workbench overview data", () => {
    it("优先使用成功图片并保留同一节点的备用地址", () => {
        const project = canvasProject([
            { id: "video", type: CanvasNodeType.Video, metadata: { status: "success", serverUrl: "/video.mp4" } },
            { id: "broken", type: CanvasNodeType.Image, metadata: { status: "error", serverUrl: "/broken.png" } },
            { id: "panorama", type: CanvasNodeType.Panorama, metadata: { status: "success", serverUrl: "/panorama.jpg", remoteUrl: "https://example.com/panorama.jpg" } },
        ]);

        expect(canvasProjectPreviewMedia(project)).toEqual([
            { kind: "image", url: "/panorama.jpg" },
            { kind: "image", url: "https://example.com/panorama.jpg" },
            { kind: "video", url: "/video.mp4" },
        ]);
    });

    it("视频项目封面保持视频类型", () => {
        const project = canvasProject([{ id: "video", type: CanvasNodeType.Video, metadata: { serverUrl: "/generated/video.mp4" } }]);

        expect(canvasProjectPreviewMedia(project)).toEqual([{ kind: "video", url: "/generated/video.mp4" }]);
    });

    it("忽略浏览器临时地址和重复生成资产", () => {
        const logs = [
            generationLog("new", "2026-07-22T12:00:00.000Z", [
                { type: "image", url: "data:image/png;base64,abc" },
                { type: "image", url: "/generated/image.png" },
            ]),
            generationLog("old", "2026-07-21T12:00:00.000Z", [{ type: "image", url: "/generated/image.png" }]),
        ];

        expect(createRecentAssets(logs)).toEqual([
            {
                id: "new-1",
                kind: "image",
                title: "new",
                url: "/generated/image.png",
                createdAt: "2026-07-22T12:00:00.000Z",
            },
        ]);
    });
});

function canvasProject(nodes: Array<Pick<CanvasProject["nodes"][number], "id" | "type" | "metadata">>): CanvasProject {
    return {
        id: "project",
        title: "项目",
        createdAt: "",
        updatedAt: "",
        nodes: nodes.map((node) => ({ ...node, title: "", position: { x: 0, y: 0 }, width: 100, height: 100 })),
    } as CanvasProject;
}

function generationLog(id: string, createdAt: string, assets: StoredGenerationLogRecord["assets"]): StoredGenerationLogRecord {
    return {
        id,
        kind: "image",
        source: "image-workbench",
        status: "success",
        title: id,
        prompt: "",
        model: "",
        summary: "",
        durationMs: 0,
        count: assets.length,
        successCount: assets.length,
        failCount: 0,
        assets,
        createdAt,
        updatedAt: createdAt,
    };
}
