import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import {
    canvasActiveTaskForNode,
    canvasBackgroundRemovalTaskNeedsSync,
    canvasTaskDescriptorForNode,
    clearCanvasBackgroundRemovalTaskMetadata,
    clearHandledCanvasBackgroundRemovalTaskMetadata,
    clearHandledCanvasBackgroundRemovalTaskMetadataFromNodes,
    reconcileCanvasHistoryBackgroundRemovalTasks,
} from "./canvas-active-task-binding";

function node(id: string, taskId?: string): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { taskId } };
}

describe("canvasActiveTaskForNode", () => {
    it("binds fan-out task progress to result targets, never their common source", () => {
        const tasks = [
            { id: "task-a", type: "image", status: "running" as const, sourceNodeId: "source", targetNodeId: "result-a", createdAt: 1, updatedAt: 1 },
            { id: "task-b", type: "image", status: "running" as const, sourceNodeId: "source", targetNodeId: "result-b", createdAt: 1, updatedAt: 1 },
        ];

        expect(canvasActiveTaskForNode(tasks, node("source"))).toBeUndefined();
        expect(canvasActiveTaskForNode(tasks, node("result-a"))?.id).toBe("task-a");
        expect(canvasActiveTaskForNode(tasks, node("result-b"))?.id).toBe("task-b");
    });

    it("retains task ID matching for old persisted canvas records", () => {
        const task = { id: "legacy-task", type: "video", status: "running" as const, sourceNodeId: "source", createdAt: 1, updatedAt: 1 };

        expect(canvasActiveTaskForNode([task], node("legacy-result", "legacy-task"))).toBe(task);
    });

    it("only binds terminal tasks by target while their result node still needs recovery", () => {
        const task = { id: "finished-task", type: "image", status: "succeeded" as const, sourceNodeId: "source", targetNodeId: "result", createdAt: 1, updatedAt: 2 };

        expect(canvasActiveTaskForNode([task], node("result"))).toBeUndefined();
        expect(canvasActiveTaskForNode([task], { ...node("result"), metadata: { status: "loading" } })).toBe(task);
    });

    it("does not reattach a handled background-removal task from a stale running response", () => {
        const task = { id: "handled-task", type: "image_process", status: "running" as const, sourceNodeId: "source", targetNodeId: "source", createdAt: 1, updatedAt: 2 };
        const source = { ...node("source", task.id), metadata: { taskId: task.id, backgroundRemovalHandledTaskId: task.id } };

        expect(canvasActiveTaskForNode([task], source)).toBeUndefined();
    });

    it("rebuilds the task descriptor needed by the node persistence effects", () => {
        const task = { id: "video-task", type: "video", status: "succeeded" as const, model: "video-model", provider: "generation" as const, pollPath: "server", serverTaskId: "video-task", durationSeconds: 5, createdAt: 1, updatedAt: 2 };
        const target = { ...node("video-result"), type: CanvasNodeType.Video };

        expect(canvasTaskDescriptorForNode(task, target)).toEqual({ videoTask: { id: "video-task", provider: "generation", model: "video-model", pollPath: "server", serverTaskId: "video-task", durationSeconds: 5 } });
    });

    it("restores a background-removal task from its persisted server payload", () => {
        const task = {
            id: "remove-background",
            type: "image_process",
            status: "succeeded" as const,
            sourceNodeId: "source",
            sourceStorageKey: "canvas/source.png",
            model: "isnet-anime",
            options: {
                version: 3 as const,
                model: "isnet-anime" as const,
                preset: "standard" as const,
                alphaMatting: false,
                foregroundThreshold: 240,
                backgroundThreshold: 10,
                refineRange: 10,
                cleanMask: false,
                outputMode: "transparent" as const,
                backgroundColor: [255, 255, 255, 255] as [number, number, number, number],
            },
            optionsHash: "a".repeat(64),
            progressStage: "inference" as const,
            progress: 50,
            stage: "rembg \u63a8\u7406",
            createdAt: 1,
            updatedAt: 2,
        };
        const source = { ...node("source"), metadata: { content: "data:image/png;base64,source", storageKey: "canvas/source.png", naturalWidth: 640, naturalHeight: 480, bytes: 123 } };

        expect(canvasTaskDescriptorForNode(task, source)).toEqual(
            expect.objectContaining({
                backgroundRemovalTask: expect.objectContaining({ id: "remove-background", model: "isnet-anime", sourceNodeId: "source", sourceStorageKey: "canvas/source.png", progressStage: "inference", progress: 50, stage: "rembg \u63a8\u7406" }),
            }),
        );
    });

    it("defensively migrates V1 task options and ignores damaged snapshots", () => {
        const source = { ...node("source"), metadata: { content: "source" } };
        const baseTask = {
            id: "legacy",
            type: "image_process",
            status: "running" as const,
            sourceStorageKey: "canvas/source.png",
            createdAt: 1,
            updatedAt: 2,
        };

        expect(canvasTaskDescriptorForNode({ ...baseTask, options: { version: 1, outputMask: true } as never }, source)).toEqual({
            backgroundRemovalTask: expect.objectContaining({ options: expect.objectContaining({ version: 3, model: "u2net", outputMode: "mask" }) }),
        });
        expect(canvasTaskDescriptorForNode({ ...baseTask, options: { version: 2, outputMask: true } as never }, source)).toEqual({});
    });

    it("replaces a stale background-removal descriptor and skips an identical snapshot", () => {
        const task = {
            id: "new-task",
            type: "image_process",
            status: "running" as const,
            sourceNodeId: "source",
            sourceStorageKey: "canvas/source.png",
            model: "u2net",
            options: {
                version: 3 as const,
                model: "u2net" as const,
                preset: "standard" as const,
                alphaMatting: false,
                foregroundThreshold: 240,
                backgroundThreshold: 10,
                refineRange: 10,
                cleanMask: false,
                outputMode: "transparent" as const,
                backgroundColor: [255, 255, 255, 255] as [number, number, number, number],
            },
            optionsHash: "a".repeat(64),
            progressStage: "saving" as const,
            progress: 75,
            stage: "\u4fdd\u5b58\u7ed3\u679c",
            createdAt: 1,
            updatedAt: 2,
        };
        const source = {
            ...node("source"),
            metadata: {
                content: "source",
                storageKey: "canvas/source.png",
                backgroundRemovalTask: {
                    id: "new-task",
                    sourceNodeId: "source",
                    sourceStorageKey: "canvas/source.png",
                    sourceContent: "source",
                    options: task.options,
                    optionsHash: task.optionsHash,
                    progressStage: "inference" as const,
                    progress: 50,
                    stage: "rembg \u63a8\u7406",
                },
            },
        };
        const synced = { ...source, metadata: { ...source.metadata, ...canvasTaskDescriptorForNode(task, source) } };

        expect(canvasBackgroundRemovalTaskNeedsSync(task, source)).toBe(true);
        expect(canvasBackgroundRemovalTaskNeedsSync(task, synced)).toBe(false);
    });

    it("does not skip a newly restored background-removal descriptor when progress is unchanged", () => {
        const pageSource = readFileSync(new URL("../[id]/canvas-client-page.tsx", import.meta.url), "utf8");

        expect(pageSource).toContain("metadata.backgroundRemovalTask === cleanedNode.metadata?.backgroundRemovalTask");
        expect(pageSource).toContain("canvasBackgroundRemovalTaskNeedsSync(task, cleanedNode)");
    });

    it("does not resurrect a handled background-removal task through undo or redo", () => {
        const task = {
            id: "handled-task",
            sourceNodeId: "source",
            sourceStorageKey: "canvas/source.png",
            sourceContent: "source",
            options: {
                version: 3 as const,
                model: "u2net" as const,
                preset: "standard" as const,
                alphaMatting: false,
                foregroundThreshold: 240,
                backgroundThreshold: 10,
                refineRange: 10,
                cleanMask: false,
                outputMode: "transparent" as const,
                backgroundColor: [255, 255, 255, 255] as [number, number, number, number],
            },
        };
        const staleHistoryNode = { ...node("source"), metadata: { content: "source", taskId: task.id, taskStatus: "running" as const, taskProgress: 50, taskStage: "rembg inference", backgroundRemovalTask: task } };
        const currentNode = { ...node("source"), metadata: { content: "source", backgroundRemovalHandledTaskId: task.id } };
        const handledTaskIds = new Set<string>();

        const undone = reconcileCanvasHistoryBackgroundRemovalTasks([staleHistoryNode], [currentNode], handledTaskIds);
        expect(undone[0].metadata?.backgroundRemovalTask).toBeUndefined();
        expect(undone[0].metadata?.backgroundRemovalHandledTaskId).toBe(task.id);
        expect(undone[0].metadata?.taskId).toBeUndefined();
        expect(undone[0].metadata?.taskStatus).toBeUndefined();
        expect(undone[0].metadata?.taskProgress).toBeUndefined();
        expect(handledTaskIds.has(task.id)).toBe(true);

        const redone = reconcileCanvasHistoryBackgroundRemovalTasks([staleHistoryNode], [], handledTaskIds);
        expect(redone[0].metadata?.backgroundRemovalTask).toBeUndefined();
        expect(redone[0].metadata?.backgroundRemovalHandledTaskId).toBe(task.id);
        expect(staleHistoryNode.metadata.backgroundRemovalTask).toBe(task);
    });

    it("clears only matching background-removal runtime metadata on completion", () => {
        const source = {
            ...node("source", "handled-task"),
            metadata: {
                content: "source",
                taskId: "handled-task",
                taskStatus: "running" as const,
                taskProgress: 50,
                taskStage: "rembg inference",
                taskUpdatedAt: 2,
                backgroundRemovalTask: {
                    id: "handled-task",
                    sourceNodeId: "source",
                    sourceStorageKey: "canvas/source.png",
                    sourceContent: "source",
                    options: {
                        version: 3 as const,
                        model: "u2net" as const,
                        preset: "standard" as const,
                        alphaMatting: false,
                        foregroundThreshold: 240,
                        backgroundThreshold: 10,
                        refineRange: 10,
                        cleanMask: false,
                        outputMode: "transparent" as const,
                        backgroundColor: [255, 255, 255, 255] as [number, number, number, number],
                    },
                },
            },
        };

        const cleared = clearCanvasBackgroundRemovalTaskMetadata(source, "handled-task");
        expect(cleared.metadata).toMatchObject({ content: "source", backgroundRemovalHandledTaskId: "handled-task" });
        expect(cleared.metadata).not.toHaveProperty("backgroundRemovalTask");
        expect(cleared.metadata).not.toHaveProperty("taskId");
        expect(cleared.metadata).not.toHaveProperty("taskStatus");
        expect(cleared.metadata).not.toHaveProperty("taskProgress");

        const newerTask = { ...source, metadata: { ...source.metadata, taskId: "new-task", taskStatus: "running" as const } };
        expect(clearCanvasBackgroundRemovalTaskMetadata(newerTask, "older-task").metadata).toMatchObject({ taskId: "new-task", taskStatus: "running", backgroundRemovalHandledTaskId: "older-task" });

        const cancelledBeforePersistence = clearCanvasBackgroundRemovalTaskMetadata(node("source"), "early-cancelled-task");
        expect(cancelledBeforePersistence.metadata?.backgroundRemovalHandledTaskId).toBe("early-cancelled-task");
    });

    it("lets a handled-task tombstone win over a late matching progress snapshot", () => {
        const stale = {
            ...node("source", "handled-task"),
            metadata: {
                taskId: "handled-task",
                taskStatus: "running" as const,
                taskProgress: 50,
                taskStage: "rembg inference",
                backgroundRemovalHandledTaskId: "handled-task",
            },
        };

        const cleaned = clearHandledCanvasBackgroundRemovalTaskMetadata(stale);
        expect(cleaned.metadata).toEqual({ backgroundRemovalHandledTaskId: "handled-task" });
        expect(cleaned).not.toBe(stale);
    });

    it("does not let an old tombstone remove a newer background-removal task", () => {
        const current = {
            ...node("source", "new-task"),
            metadata: {
                taskId: "new-task",
                taskStatus: "running" as const,
                taskProgress: 25,
                backgroundRemovalHandledTaskId: "old-task",
            },
        };

        expect(clearHandledCanvasBackgroundRemovalTaskMetadata(current)).toBe(current);
    });

    it("normalizes handled background-removal metadata before persistence", () => {
        const stable = node("stable");
        const cleanNodes = [stable];
        expect(clearHandledCanvasBackgroundRemovalTaskMetadataFromNodes(cleanNodes)).toBe(cleanNodes);

        const stale = {
            ...node("source", "handled-task"),
            metadata: { taskId: "handled-task", taskStatus: "running" as const, taskProgress: 50, backgroundRemovalHandledTaskId: "handled-task" },
        };
        const cleaned = clearHandledCanvasBackgroundRemovalTaskMetadataFromNodes([stable, stale]);
        expect(cleaned).not.toBe(cleanNodes);
        expect(cleaned[0]).toBe(stable);
        expect(cleaned[1].metadata).toEqual({ backgroundRemovalHandledTaskId: "handled-task" });
    });
});
