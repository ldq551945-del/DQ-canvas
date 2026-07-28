import type { CreateOverviewAsset, CreateOverviewTask, CreateWorkbenchOverviewPayload } from "@/lib/create-workbench-overview";
import { getLatestCanvasProjectOverview } from "@/lib/server/canvas-project-store";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled } from "@/lib/server/database";
import { readGenerationLogDb, stableAssetUrl } from "@/lib/server/generation-log-repository";
import type { StoredGenerationLog } from "@/lib/server/generation-log-types";

export async function getCreateWorkbenchOverview(userId: string): Promise<CreateWorkbenchOverviewPayload> {
    const [latestProject, generation] = await Promise.all([getLatestCanvasProjectOverview(userId), getCreateGenerationOverview(userId)]);
    return { latestProject, ...generation };
}

export function buildCreateGenerationOverview(logs: StoredGenerationLog[]): Pick<CreateWorkbenchOverviewPayload, "runningTasks" | "recentAssets"> {
    const sorted = [...logs].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    const runningTasks = sorted
        .filter((log) => log.status === "pending")
        .slice(0, 4)
        .map((log): CreateOverviewTask => ({
            id: log.id,
            kind: log.kind,
            source: log.source,
            title: log.title || (log.kind === "video" ? "视频生成" : "图片生成"),
            createdAt: log.createdAt,
        }));
    const recentAssets: CreateOverviewAsset[] = [];
    const seen = new Set<string>();

    for (const log of sorted) {
        if (log.status !== "success") continue;
        for (const [index, asset] of log.assets.entries()) {
            const url = stableAssetUrl(asset).trim();
            if (!url || /^(data|blob):/i.test(url) || seen.has(url)) continue;
            seen.add(url);
            recentAssets.push({ id: `${log.id}-${index}`, kind: asset.type, title: log.title || (asset.type === "video" ? "生成视频" : "生成图片"), url, createdAt: log.createdAt });
            if (recentAssets.length >= 6) return { runningTasks, recentAssets };
        }
    }

    return { runningTasks, recentAssets };
}

async function getCreateGenerationOverview(userId: string) {
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        return createPostgresRepositories().generationLogs.getCreateOverview(userId);
    }
    const logs = (await readGenerationLogDb()).logs.filter((log) => log.userId === userId);
    return buildCreateGenerationOverview(logs);
}
