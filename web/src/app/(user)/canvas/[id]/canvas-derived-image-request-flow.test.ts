import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./use-canvas-node-media-actions.tsx", import.meta.url), "utf8");
const emotionWorkspaceSource = readFileSync(new URL("../components/canvas-emotion-workspace.tsx", import.meta.url), "utf8");

describe("canvas derived image request flow", () => {
    it("revalidates the annotation source after upload and before appending a node", () => {
        const flow = functionSource("const saveAnnotatedImageNode", "const generatePortraitTextureNode");
        const upload = requiredIndex(flow, "await uploadCanvasImage(dataUrl)");
        const validation = requiredIndex(flow, "const currentSource = currentCanvasDerivedImageSource");
        const append = requiredIndex(flow, "appendDerivedImageNode(currentSource");

        expect(upload).toBeLessThan(validation);
        expect(validation).toBeLessThan(append);
    });

    it("revalidates the angle source around creation and task completion", () => {
        const flow = functionSource("const generateAngleNode", "const generateEmotionNode");
        const initialValidation = requiredIndex(flow, "const source = currentCanvasDerivedImageSource");
        const childCreation = requiredIndex(flow, "childId = nanoid()");
        const launchValidation = requiredIndex(flow, "const currentSource = currentCanvasDerivedImageSource");
        const task = requiredIndex(flow, "await startAndCompleteImageTask");
        const completionValidation = requiredIndex(flow, "const completedSource = currentCanvasDerivedImageSource");

        expect(initialValidation).toBeLessThan(childCreation);
        expect(childCreation).toBeLessThan(launchValidation);
        expect(launchValidation).toBeLessThan(task);
        expect(task).toBeLessThan(completionValidation);
        expect(flow).toContain("discardAngleChild(childId)");
        expect(flow).toContain('message.error("源图片已删除或替换，已丢弃多视角结果")');
    });

    it("returns an explicit rejection so emotion preflight failures restore the editor", () => {
        const flow = functionSource("const generateEmotionNode", "const handleFontSizeChange");
        const childCreation = requiredIndex(flow, "const childId = nanoid()");

        expect(flow.slice(0, childCreation)).toContain("return false");
        expect(flow.slice(childCreation)).toContain("return true");
        expect(emotionWorkspaceSource).toContain("const accepted = await onConfirm");
        expect(emotionWorkspaceSource).toContain('if (!accepted) setStatus("editing")');
    });

    it("refreshes the unified task panel as soon as background removal creates a task", () => {
        const flow = functionSource("const removeBackgroundImageNode", "const resumeBackgroundRemovalTask");

        expect(flow).toContain("onTaskCreated: (createdTask)");
        expect(flow).toContain("backgroundRemovalTaskIdsRef.current.set(node.id, createdTask.id)");
        expect(flow).toContain("notifyCanvasGenerationTaskCreated(requestProjectId)");
    });

    it("guards task creation and result application with confirmed cancellation", () => {
        const flow = functionSource("const removeBackgroundImageNode", "const resumeBackgroundRemovalTask");
        const create = requiredIndex(flow, "await createBackgroundRemovalTask");
        const cancellationAfterCreate = requiredIndex(flow, "await confirmBackgroundRemovalCancellation");
        const wait = requiredIndex(flow, "await waitForBackgroundRemovalTask");
        const apply = requiredIndex(flow, "const outcome = applyBackgroundRemovalResult");

        expect(create).toBeLessThan(cancellationAfterCreate);
        expect(cancellationAfterCreate).toBeLessThan(wait);
        expect(wait).toBeLessThan(apply);
        expect(flow.slice(wait, apply)).toContain("backgroundRemovalCancellationRequestedRef.current.has(node.id)");
    });

    it("confirms cancellation before task binding when stop was clicked before the task id arrived", () => {
        const flow = functionSource("const removeBackgroundImageNode", "const resumeBackgroundRemovalTask");
        const taskId = requiredIndex(flow, "backgroundRemovalTaskIdsRef.current.set(node.id, task.id)");
        const cancellation = requiredIndex(flow, "if (backgroundRemovalCancellationRequestedRef.current.has(node.id))");
        const attach = requiredIndex(flow, "attachGenerationTask(node.id, controller");

        expect(taskId).toBeLessThan(cancellation);
        expect(cancellation).toBeLessThan(attach);
    });
});

function functionSource(startMarker: string, endMarker: string) {
    const start = requiredIndex(source, startMarker);
    const end = requiredIndex(source, endMarker);
    return source.slice(start, end);
}

function requiredIndex(value: string, marker: string) {
    const index = value.indexOf(marker);
    expect(index, `Missing source marker: ${marker}`).toBeGreaterThanOrEqual(0);
    return index;
}
