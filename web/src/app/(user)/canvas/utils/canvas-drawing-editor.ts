import type { Editor } from "tldraw";

type ScheduleViewportFit = (fit: () => void) => () => void;

export function initializeCanvasDrawingEditor(editor: Editor, scheduleViewportFit: ScheduleViewportFit = scheduleViewportFitOnAnimationFrame) {
    const [primaryPage, ...extraPages] = editor.getPages();
    if (primaryPage) editor.setCurrentPage(primaryPage.id);
    extraPages.forEach((page) => editor.deletePage(page.id));
    editor.setCurrentTool("draw");
    return scheduleViewportFit(() => editor.zoomToFit());
}

function scheduleViewportFitOnAnimationFrame(fit: () => void) {
    const frame = window.requestAnimationFrame(fit);
    return () => window.cancelAnimationFrame(frame);
}
