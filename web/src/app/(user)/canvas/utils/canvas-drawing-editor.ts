import type { Editor } from "tldraw";

export function initializeCanvasDrawingEditor(editor: Editor) {
    const [primaryPage, ...extraPages] = editor.getPages();
    if (primaryPage) editor.setCurrentPage(primaryPage.id);
    extraPages.forEach((page) => editor.deletePage(page.id));
    editor.setCurrentTool("draw");
    editor.zoomToFit();
}
