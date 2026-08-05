"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { listCanvasGenerationTasks, type CanvasGenerationTask } from "@/services/api/generation-tasks";
import { CANVAS_GENERATION_TASK_CREATED_EVENT } from "../utils/canvas-generation-task-events";

export function useCanvasActiveTasks(projectId: string, enabled = true) {
    const query = useQuery<CanvasGenerationTask[]>({
        queryKey: ["canvas-generation-tasks", projectId],
        queryFn: ({ signal }) => listCanvasGenerationTasks(projectId, { activeOnly: false, limit: 50, signal }),
        enabled: enabled && Boolean(projectId),
        refetchInterval: (current) => {
            const tasks = current.state.data || [];
            if (tasks.some((task) => task.type === "image_process" && (task.status === "queued" || task.status === "running"))) return 1_000;
            return tasks.some((task) => task.status === "queued" || task.status === "running" || task.status === "paused") ? 2_000 : 4_000;
        },
        refetchOnWindowFocus: true,
        staleTime: 1_000,
    });

    useEffect(() => {
        const handleCreated = (event: Event) => {
            const detail = (event as CustomEvent<{ projectId?: string }>).detail;
            if (!detail?.projectId || detail.projectId === projectId) void query.refetch();
        };
        window.addEventListener(CANVAS_GENERATION_TASK_CREATED_EVENT, handleCreated);
        window.addEventListener("canvas:task-created", handleCreated);
        return () => {
            window.removeEventListener(CANVAS_GENERATION_TASK_CREATED_EVENT, handleCreated);
            window.removeEventListener("canvas:task-created", handleCreated);
        };
    }, [projectId, query.refetch]);

    return {
        tasks: (query.data || []).filter((task) => task.status === "queued" || task.status === "running" || task.status === "paused"),
        recoveryTasks: query.data || [],
        loading: query.isLoading,
        refreshing: query.isFetching,
        error: query.error instanceof Error ? query.error : null,
        refetch: query.refetch,
    };
}
