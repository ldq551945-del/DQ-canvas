"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Modal } from "antd";
import { Check, Maximize2, X } from "lucide-react";
import { Tldraw, createTLStore, getSnapshot, loadSnapshot, type Editor, type TLAssetStore } from "tldraw";

import { canvasThemes } from "@/lib/canvas-theme";
import { uploadServerMedia } from "@/services/server-media-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasDrawingPreview, CanvasNodeData } from "../types";
import { createCanvasDrawingDocument, normalizeCanvasDrawingDocument, type CanvasDrawingSaveSummary } from "../utils/canvas-drawing-storage";

const SINGLE_PAGE_OPTIONS = { maxPages: 1 } as const;
const DRAWING_RENDER_MAX_DIMENSION = 2048;
const DRAWING_RENDER_PADDING = 24;

export function CanvasDrawingEditorModal({ open, node, onClose, onSaved }: { open: boolean; node: CanvasNodeData | null; onClose: () => void; onSaved: (nodeId: string, summary: CanvasDrawingSaveSummary) => void }) {
    const { message, modal } = App.useApp();
    const colorScheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorScheme];
    const assetStore = useMemo<TLAssetStore>(
        () => ({
            upload: async (_asset, file) => {
                const stored = await uploadServerMedia(file, "image");
                return { src: stored.url, meta: { storageKey: stored.storageKey, bytes: stored.bytes, mimeType: stored.mimeType } };
            },
            resolve: (asset) => {
                const src = (asset.props as { src?: unknown }).src;
                return typeof src === "string" && src ? src : null;
            },
        }),
        [],
    );
    const store = useMemo(() => createTLStore({ assets: assetStore }), [assetStore, node?.id]);
    const editorRef = useRef<Editor | null>(null);
    const currentDocumentRef = useRef(node?.metadata?.drawingDocument || null);
    const savePromiseRef = useRef<Promise<boolean> | null>(null);
    const [ready, setReady] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");

    useEffect(() => {
        if (!open || !node) return;
        setReady(false);
        setDirty(false);
        setLoadError("");
        currentDocumentRef.current = null;
        try {
            const document = normalizeCanvasDrawingDocument(node.metadata?.drawingDocument);
            if (node.metadata?.drawingDocument && !document) throw new Error("绘图文档版本或格式不受支持");
            currentDocumentRef.current = document;
            if (document?.snapshot) loadSnapshot(store, document.snapshot as never);
            setReady(true);
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : "绘图文档加载失败");
        }
    }, [node, open, store]);

    useEffect(() => {
        if (!open || !ready) return;
        return store.listen(() => setDirty(true), { source: "user", scope: "document" });
    }, [open, ready, store]);

    const handleSave = useCallback(() => {
        if (savePromiseRef.current) return savePromiseRef.current;
        const operation = (async () => {
            if (!node || !ready || !editorRef.current) return false;
            setSaving(true);
            try {
                const snapshot = getSnapshot(store);
                const document = createCanvasDrawingDocument(snapshot, currentDocumentRef.current);
                const render = await createDrawingRender(editorRef.current);
                let preview: CanvasDrawingPreview | undefined;
                if (render) {
                    const stored = await uploadServerMedia(render.blob, "image");
                    preview = {
                        storageKey: stored.storageKey,
                        serverUrl: stored.url,
                        mimeType: stored.mimeType || render.blob.type || "image/png",
                        width: render.width,
                        height: render.height,
                        bytes: stored.bytes,
                    };
                }
                currentDocumentRef.current = document;
                onSaved(node.id, { ...document, document, preview });
                setDirty(false);
                message.success("绘图已保存");
                return true;
            } catch (error) {
                message.error(error instanceof Error ? `绘图保存失败：${error.message}` : "绘图保存失败");
                return false;
            } finally {
                setSaving(false);
            }
        })();
        savePromiseRef.current = operation;
        void operation.finally(() => {
            if (savePromiseRef.current === operation) savePromiseRef.current = null;
        });
        return operation;
    }, [message, node, onSaved, ready, store]);

    const requestClose = () => {
        if (saving) return;
        if (!dirty) {
            onClose();
            return;
        }
        modal.confirm({
            title: "保存绘图修改？",
            content: "保存后会更新画布节点预览；放弃修改将恢复上次保存的版本。",
            okText: "保存并关闭",
            cancelText: "放弃修改",
            centered: true,
            onOk: async () => {
                if (!(await handleSave())) throw new Error("绘图保存失败");
                onClose();
            },
            onCancel: onClose,
        });
    };

    return (
        <Modal
            open={open}
            onCancel={requestClose}
            footer={null}
            closable={false}
            destroyOnHidden
            width="100vw"
            centered
            maskClosable={false}
            keyboard={false}
            className="canvas-drawing-editor-modal"
            styles={{ body: { padding: 0 }, container: { padding: 0, overflow: "hidden", maxWidth: "100vw" }, mask: { backdropFilter: "blur(8px)" } }}
        >
            <div className="canvas-drawing-editor flex h-[100dvh] flex-col" style={{ background: theme.canvas.backdrop, color: theme.node.text }} data-canvas-no-zoom>
                <header className="flex h-14 shrink-0 items-center justify-between border-b px-3 sm:px-4" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                    <div className="flex min-w-0 items-center gap-2">
                        <Maximize2 className="size-4 shrink-0" style={{ color: theme.node.muted }} />
                        <span className="truncate text-sm font-semibold">{node?.title || "绘图"}</span>
                        <span className="hidden text-xs sm:inline" style={{ color: loadError ? theme.node.danger : theme.node.placeholder }}>
                            {loadError ? "加载失败" : ready ? (dirty ? "有未保存修改" : "已加载") : "正在加载"}
                        </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <button
                            type="button"
                            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45"
                            style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}
                            disabled={!ready || Boolean(loadError) || saving}
                            onClick={() => void handleSave()}
                        >
                            <Check className="size-4" />
                            <span className="hidden sm:inline">{saving ? "保存中" : "保存绘图"}</span>
                        </button>
                        <button
                            type="button"
                            className="grid size-9 place-items-center rounded-md border transition disabled:opacity-45"
                            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                            aria-label="关闭绘图编辑器"
                            disabled={saving}
                            onClick={requestClose}
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                </header>
                <div className="relative min-h-0 flex-1" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                    {loadError ? (
                        <div className="grid h-full place-items-center px-6 text-center">
                            <div>
                                <div className="text-sm font-medium" style={{ color: theme.node.danger }}>
                                    绘图文档加载失败
                                </div>
                                <div className="mt-2 max-w-lg text-xs leading-5" style={{ color: theme.node.placeholder }}>
                                    {loadError}
                                </div>
                            </div>
                        </div>
                    ) : ready ? (
                        <Tldraw
                            store={store}
                            locale="zh-cn"
                            colorScheme={colorScheme}
                            options={SINGLE_PAGE_OPTIONS}
                            maxAssetSize={20 * 1024 * 1024}
                            maxImageDimension={5000}
                            acceptedVideoMimeTypes={[]}
                            licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY || undefined}
                            onMount={(editor) => {
                                editorRef.current = editor;
                                const [primaryPage, ...extraPages] = editor.getPages();
                                if (primaryPage) editor.setCurrentPage(primaryPage.id);
                                extraPages.forEach((page) => editor.deletePage(page.id));
                                editor.setCurrentTool("draw");
                                return () => {
                                    if (editorRef.current === editor) editorRef.current = null;
                                };
                            }}
                        />
                    ) : (
                        <div className="grid h-full place-items-center text-sm" style={{ color: theme.node.placeholder }}>
                            正在准备绘图画布...
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}

async function createDrawingRender(editor: Editor) {
    const shapeIds = [...editor.getCurrentPageShapeIds()];
    if (!shapeIds.length) return null;
    const bounds = editor.getShapesPageBounds(shapeIds);
    if (!bounds) throw new Error("无法读取绘图内容边界");
    const sourceDimension = Math.max(bounds.width, bounds.height) + DRAWING_RENDER_PADDING * 2;
    const scale = Math.min(4, DRAWING_RENDER_MAX_DIMENSION / Math.max(1, sourceDimension));
    const image = await editor.toImage(shapeIds, {
        format: "png",
        background: true,
        padding: DRAWING_RENDER_PADDING,
        scale,
        pixelRatio: 1,
        darkMode: false,
    });
    return { blob: image.blob, width: image.width, height: image.height };
}
