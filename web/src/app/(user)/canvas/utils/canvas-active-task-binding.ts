import type { CanvasGenerationTask } from "@/services/api/generation-tasks";
import { normalizeBackgroundRemovalOptions } from "@/lib/background-removal-options";

import { isCanvasImageNodeType, type CanvasNodeData } from "../types";

/**
 * Finds the active task that owns a node's result. Generation sources can fan
 * out into multiple image, text, audio, or video result nodes, so they must
 * never be used as a write-back key. taskId is retained for legacy records
 * that were saved before targetNodeId was included in the public task shape.
 */
export function canvasActiveTaskForNode(tasks: CanvasGenerationTask[], node: CanvasNodeData) {
    const availableTasks = tasks.filter((task) => !canvasBackgroundRemovalTaskWasHandled(task, node));
    const persistedTask = availableTasks.find((task) => task.id === node.metadata?.taskId);
    if (persistedTask && (canvasGenerationTaskIsActive(persistedTask) || node.metadata?.status === "loading" || persistedTask.type === "image_process")) return persistedTask;
    return availableTasks.find((task) => task.targetNodeId === node.id && (canvasGenerationTaskIsActive(task) || node.metadata?.status === "loading"));
}

function canvasGenerationTaskIsActive(task: CanvasGenerationTask) {
    return task.status === "queued" || task.status === "running" || task.status === "paused";
}

function canvasBackgroundRemovalTaskWasHandled(task: CanvasGenerationTask, node: CanvasNodeData) {
    return task.type === "image_process" && node.metadata?.backgroundRemovalHandledTaskId === task.id;
}

export function clearCanvasBackgroundRemovalTaskMetadata(node: CanvasNodeData, taskId: string) {
    const metadata = node.metadata || {};
    const descriptorMatches = metadata?.backgroundRemovalTask?.id === taskId;
    const taskMetadataMatches = metadata?.taskId === taskId;

    const nextMetadata = { ...metadata, backgroundRemovalHandledTaskId: taskId };
    if (descriptorMatches) delete nextMetadata.backgroundRemovalTask;
    if (taskMetadataMatches) {
        delete nextMetadata.taskId;
        delete nextMetadata.taskStatus;
        delete nextMetadata.taskProgress;
        delete nextMetadata.taskStage;
        delete nextMetadata.taskCreatedAt;
        delete nextMetadata.taskStartedAt;
        delete nextMetadata.taskUpdatedAt;
        delete nextMetadata.taskDetails;
    }
    return { ...node, metadata: nextMetadata };
}

/**
 * A handled-task tombstone wins over a late task-progress snapshot. This can
 * happen when cancellation and the active-task query finish in the same
 * render cycle. Keep unrelated/newer task metadata intact.
 */
export function clearHandledCanvasBackgroundRemovalTaskMetadata(node: CanvasNodeData) {
    const handledTaskId = node.metadata?.backgroundRemovalHandledTaskId;
    if (!handledTaskId) return node;
    if (node.metadata?.taskId !== handledTaskId && node.metadata?.backgroundRemovalTask?.id !== handledTaskId) return node;
    return clearCanvasBackgroundRemovalTaskMetadata(node, handledTaskId);
}

export function clearHandledCanvasBackgroundRemovalTaskMetadataFromNodes(nodes: CanvasNodeData[]) {
    let changed = false;
    const cleaned = nodes.map((node) => {
        const next = clearHandledCanvasBackgroundRemovalTaskMetadata(node);
        if (next !== node) changed = true;
        return next;
    });
    return changed ? cleaned : nodes;
}

export function canvasTaskDescriptorForNode(task: CanvasGenerationTask, node: CanvasNodeData) {
    if (task.type === "image_process" && isCanvasImageNodeType(node.type) && task.sourceStorageKey && task.options) {
        let options;
        try {
            options = normalizeBackgroundRemovalOptions(task.options);
        } catch {
            return {};
        }
        return {
            backgroundRemovalTask: {
                id: task.id,
                sourceNodeId: task.sourceNodeId || node.id,
                sourceStorageKey: task.sourceStorageKey,
                sourceContent: node.metadata?.content || "",
                sourceNaturalWidth: node.metadata?.naturalWidth,
                sourceNaturalHeight: node.metadata?.naturalHeight,
                sourceBytes: node.metadata?.bytes,
                options,
                optionsHash: task.optionsHash,
                model: options.model,
                progressStage: task.progressStage,
                progress: task.progress,
                stage: task.stage,
            },
        };
    }
    if (task.type === "image" && (node.type === "image" || node.type === "panorama")) {
        return { imageTask: { id: task.id, kind: task.kind || "generation", model: task.model || "" } };
    }
    if (task.type === "video" && node.type === "video") {
        return {
            videoTask: {
                id: task.id,
                provider: task.provider || "generation",
                model: task.model || "",
                pollPath: task.pollPath,
                serverTaskId: task.serverTaskId,
                durationSeconds: task.durationSeconds,
            },
        };
    }
    if (task.type === "text" && node.type === "text") return { textTask: { id: task.id, model: task.model || "" } };
    if (task.type === "audio" && node.type === "audio") return { audioTask: { id: task.id, model: task.model || "" } };
    return {};
}

export function canvasBackgroundRemovalTaskNeedsSync(task: CanvasGenerationTask, node: CanvasNodeData) {
    if (task.type !== "image_process") return false;
    const current = node.metadata?.backgroundRemovalTask;
    if (!current && node.metadata?.backgroundRemovalHandledTaskId === task.id && (task.status === "succeeded" || task.status === "failed" || task.status === "cancelled")) return false;
    return (
        current?.id !== task.id ||
        current.sourceNodeId !== (task.sourceNodeId || node.id) ||
        current.sourceStorageKey !== task.sourceStorageKey ||
        current.optionsHash !== task.optionsHash ||
        current.model !== normalizeTaskModel(task.options) ||
        current.progressStage !== task.progressStage ||
        current.progress !== task.progress ||
        current.stage !== task.stage
    );
}

/**
 * Server tasks are external side effects, so undo/redo must not make a
 * terminal result resumable again. Keep handled task tombstones outside the
 * history entry and strip any matching stale descriptor while restoring it.
 */
export function reconcileCanvasHistoryBackgroundRemovalTasks(restoredNodes: CanvasNodeData[], currentNodes: CanvasNodeData[], handledTaskIds: Set<string>) {
    const currentHandledByNode = new Map<string, string>();
    currentNodes.forEach((node) => {
        const taskId = node.metadata?.backgroundRemovalHandledTaskId;
        if (!taskId) return;
        handledTaskIds.add(taskId);
        currentHandledByNode.set(node.id, taskId);
    });
    restoredNodes.forEach((node) => {
        const taskId = node.metadata?.backgroundRemovalHandledTaskId;
        if (taskId) handledTaskIds.add(taskId);
    });

    let changed = false;
    const reconciled = restoredNodes.map((node) => {
        const descriptor = node.metadata?.backgroundRemovalTask;
        const handledDescriptorId = descriptor && handledTaskIds.has(descriptor.id) ? descriptor.id : undefined;
        const handledTaskId = handledDescriptorId || currentHandledByNode.get(node.id) || node.metadata?.backgroundRemovalHandledTaskId;
        if (!handledTaskId) return node;
        if (!handledDescriptorId && node.metadata?.taskId !== handledTaskId && node.metadata?.backgroundRemovalHandledTaskId === handledTaskId) return node;

        changed = true;
        return clearCanvasBackgroundRemovalTaskMetadata(node, handledTaskId);
    });
    return changed ? reconciled : restoredNodes;
}

function normalizeTaskModel(options: unknown) {
    try {
        return normalizeBackgroundRemovalOptions(options).model;
    } catch {
        return undefined;
    }
}
