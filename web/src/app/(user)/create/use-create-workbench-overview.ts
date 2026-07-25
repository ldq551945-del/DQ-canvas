"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CanvasProject } from "@/lib/canvas-project-contract";
import { listCanvasProjects } from "@/services/api/canvas-projects";
import { listGenerationLogs, type StoredGenerationLogRecord } from "@/services/api/generation-logs";

import { createRecentAssets } from "./create-workbench-overview-data";

export function useCreateWorkbenchOverview() {
    const [canvasProjects, setCanvasProjects] = useState<CanvasProject[]>([]);
    const [generationLogs, setGenerationLogs] = useState<StoredGenerationLogRecord[]>([]);
    const [canvasLoading, setCanvasLoading] = useState(true);
    const [generationLoading, setGenerationLoading] = useState(true);
    const [canvasError, setCanvasError] = useState<string>();
    const [generationError, setGenerationError] = useState<string>();
    const [reloadToken, setReloadToken] = useState(0);

    const reload = useCallback(() => setReloadToken((value) => value + 1), []);

    useEffect(() => {
        let active = true;
        setCanvasLoading(true);
        setGenerationLoading(true);
        setCanvasError(undefined);
        setGenerationError(undefined);

        void listCanvasProjects()
            .then((projects) => {
                if (active) setCanvasProjects(projects);
            })
            .catch((error) => {
                if (active) setCanvasError(error instanceof Error ? error.message : "画布项目加载失败");
            })
            .finally(() => {
                if (active) setCanvasLoading(false);
            });

        void listGenerationLogs({ pageSize: 100 })
            .then((payload) => {
                if (active) setGenerationLogs(payload.items);
            })
            .catch((error) => {
                if (active) setGenerationError(error instanceof Error ? error.message : "生成记录加载失败");
            })
            .finally(() => {
                if (active) setGenerationLoading(false);
            });

        return () => {
            active = false;
        };
    }, [reloadToken]);

    const latestProject = useMemo(() => [...canvasProjects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0], [canvasProjects]);
    const runningTasks = useMemo(
        () =>
            generationLogs
                .filter((log) => log.status === "pending")
                .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
                .slice(0, 4),
        [generationLogs],
    );
    const recentAssets = useMemo(() => createRecentAssets(generationLogs), [generationLogs]);

    return {
        latestProject,
        runningTasks,
        recentAssets,
        canvasLoading,
        generationLoading,
        canvasError,
        generationError,
        reload,
    };
}
