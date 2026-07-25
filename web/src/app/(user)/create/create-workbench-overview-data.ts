import { CanvasNodeType } from "@/app/(user)/canvas/types";
import type { CanvasProject } from "@/lib/canvas-project-contract";
import { browserReadableMediaUrl } from "@/lib/browser-media-url";
import type { StoredGenerationLogRecord } from "@/services/api/generation-logs";

export type CreateOverviewMedia = {
    kind: "image" | "video";
    url: string;
};

export type CreateOverviewAsset = CreateOverviewMedia & {
    id: string;
    title: string;
    createdAt: string;
};

export function createRecentAssets(logs: StoredGenerationLogRecord[]) {
    const seen = new Set<string>();
    const assets: CreateOverviewAsset[] = [];
    const recentLogs = logs.filter((log) => log.status === "success").sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    for (const log of recentLogs) {
        for (const [index, asset] of log.assets.entries()) {
            const url = stableAssetUrl(asset.serverUrl || asset.url || asset.remoteUrl || "");
            if (!url || seen.has(url)) continue;
            seen.add(url);
            assets.push({
                id: `${log.id}-${index}`,
                kind: asset.type,
                title: log.title || (asset.type === "image" ? "生成图片" : "生成视频"),
                url,
                createdAt: log.createdAt,
            });
            if (assets.length >= 8) return assets;
        }
    }

    return assets;
}

export function canvasProjectPreviewMedia(project: CanvasProject) {
    const candidates: Array<CreateOverviewMedia & { preferred: boolean }> = [];
    const seen = new Set<string>();

    for (const node of project.nodes) {
        const type = String(node.type);
        const kind = type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Image || type === CanvasNodeType.Panorama ? "image" : undefined;
        if (!kind || node.metadata?.status === "error") continue;

        for (const value of [node.metadata?.serverUrl, node.metadata?.remoteUrl, node.metadata?.content]) {
            const url = stableAssetUrl(value || "");
            if (!url || seen.has(url)) continue;
            seen.add(url);
            candidates.push({ kind, url, preferred: node.metadata?.status === "success" });
        }
    }

    return candidates.sort((left, right) => Number(right.preferred) - Number(left.preferred) || Number(right.kind === "image") - Number(left.kind === "image")).map(({ kind, url }) => ({ kind, url }));
}

function stableAssetUrl(value: string) {
    if (!value || /^(data|blob):/i.test(value)) return "";
    return browserReadableMediaUrl(value);
}
