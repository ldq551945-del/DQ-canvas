export const CANVAS_GENERATION_TASK_CREATED_EVENT = "canvas:generation-task-created";

export function notifyCanvasGenerationTaskCreated(projectId: string) {
    if (typeof window === "undefined" || !projectId) return;
    window.dispatchEvent(new CustomEvent(CANVAS_GENERATION_TASK_CREATED_EVENT, { detail: { projectId } }));
}
