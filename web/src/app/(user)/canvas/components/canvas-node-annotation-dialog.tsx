"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Modal, Slider, Tooltip } from "antd";
import { Brush, CircleAlert, Eraser, LoaderCircle, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { imageToDataUrl } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";

type Point = { x: number; y: number };
type Stroke = { color: string; size: number; erase: boolean; points: Point[] };

const annotationColors = ["#ef4444", "#f59e0b", "#22c55e", "#14b8a6", "#3b82f6", "#a855f7", "#ffffff", "#111827"];

type CanvasNodeAnnotationDialogProps = {
    image: { url: string; storageKey?: string };
    open: boolean;
    onClose: () => void;
    onConfirm: (dataUrl: string) => void | Promise<void>;
};

type ImageLoadState = "loading" | "ready" | "error";

const SUBMIT_FALLBACK_MS = 1200;

export function CanvasNodeAnnotationDialog({ image, open, onClose, onConfirm }: CanvasNodeAnnotationDialogProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sourceImageRef = useRef<HTMLImageElement | null>(null);
    const drawingRef = useRef<Stroke | null>(null);
    const submitLockRef = useRef(false);
    const submitFallbackRef = useRef<number | null>(null);
    const [source, setSource] = useState("");
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
    const [loadState, setLoadState] = useState<ImageLoadState>("loading");
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [reloadNonce, setReloadNonce] = useState(0);
    const [saving, setSaving] = useState(false);
    const [mode, setMode] = useState<"brush" | "erase">("brush");
    const [color, setColor] = useState(annotationColors[0]);
    const [brushSize, setBrushSize] = useState(18);
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        sourceImageRef.current = null;
        drawingRef.current = null;
        setSource("");
        setImageSize({ width: 0, height: 0 });
        setLoadState("loading");
        setLoadError("");
        setSaveError("");
        setStrokes([]);
        setRedoStrokes([]);

        void imageToDataUrl({ url: image.url, storageKey: image.storageKey })
            .then((dataUrl) => {
                if (cancelled) return;
                if (!dataUrl) throw new Error("图片资源为空，请检查原图后重试");
                const element = new Image();
                element.onload = () => {
                    if (cancelled) return;
                    if (!element.naturalWidth || !element.naturalHeight) {
                        setLoadState("error");
                        setLoadError("图片尺寸无效，请检查原图后重试");
                        return;
                    }
                    sourceImageRef.current = element;
                    setSource(dataUrl);
                    setImageSize({ width: element.naturalWidth, height: element.naturalHeight });
                    setLoadState("ready");
                };
                element.onerror = () => {
                    if (cancelled) return;
                    setLoadState("error");
                    setLoadError("图片解码失败，请检查图片格式或重新上传");
                };
                element.src = dataUrl;
            })
            .catch((error) => {
                if (cancelled) return;
                setLoadState("error");
                setLoadError(error instanceof Error && error.message ? error.message : "图片读取失败，请稍后重试");
            });

        return () => {
            cancelled = true;
        };
    }, [image.storageKey, image.url, open, reloadNonce]);

    const releaseSubmission = useCallback(() => {
        if (submitFallbackRef.current !== null) window.clearTimeout(submitFallbackRef.current);
        submitFallbackRef.current = null;
        submitLockRef.current = false;
        setSaving(false);
    }, []);

    useEffect(() => {
        if (open) return;
        releaseSubmission();
    }, [open, releaseSubmission]);

    useEffect(
        () => () => {
            if (submitFallbackRef.current !== null) window.clearTimeout(submitFallbackRef.current);
        },
        [],
    );

    useEffect(() => redraw(canvasRef.current, strokes), [imageSize, strokes]);

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const stroke: Stroke = {
            color,
            size: brushSize,
            erase: mode === "erase",
            points: [canvasPoint(event.currentTarget, event.clientX, event.clientY)],
        };
        drawingRef.current = stroke;
        redraw(canvasRef.current, [...strokes, stroke]);
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const stroke = drawingRef.current;
        if (!stroke) return;
        event.preventDefault();
        event.stopPropagation();
        stroke.points.push(canvasPoint(event.currentTarget, event.clientX, event.clientY));
        redraw(canvasRef.current, [...strokes, stroke]);
    };

    const stopDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const stroke = drawingRef.current;
        if (!stroke) return;
        event.preventDefault();
        event.stopPropagation();
        drawingRef.current = null;
        setStrokes((current) => [...current, stroke]);
        setRedoStrokes([]);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const undo = () =>
        setStrokes((current) => {
            const last = current.at(-1);
            if (!last) return current;
            setRedoStrokes((redo) => [...redo, last]);
            return current.slice(0, -1);
        });

    const redo = () =>
        setRedoStrokes((current) => {
            const last = current.at(-1);
            if (!last) return current;
            setStrokes((items) => [...items, last]);
            return current.slice(0, -1);
        });

    const save = () => {
        if (submitLockRef.current || loadState !== "ready") return;
        const sourceImage = sourceImageRef.current;
        const annotation = canvasRef.current;
        if (!sourceImage || !annotation || !strokes.length) return;
        submitLockRef.current = true;
        setSaving(true);
        setSaveError("");

        try {
            const output = document.createElement("canvas");
            output.width = imageSize.width;
            output.height = imageSize.height;
            const context = output.getContext("2d");
            if (!context) throw new Error("浏览器未提供可用的画布导出能力");
            context.drawImage(sourceImage, 0, 0, output.width, output.height);
            context.drawImage(annotation, 0, 0);
            const result = onConfirm(output.toDataURL("image/png"));
            if (isPromiseLike(result)) {
                void Promise.resolve(result)
                    .catch((error) => setSaveError(error instanceof Error && error.message ? error.message : "标注图片保存失败，请重试"))
                    .finally(releaseSubmission);
                return;
            }
            submitFallbackRef.current = window.setTimeout(releaseSubmission, SUBMIT_FALLBACK_MS);
        } catch (error) {
            setSaveError(annotationExportError(error));
            releaseSubmission();
        }
    };

    return (
        <Modal
            title={null}
            open={open}
            onCancel={saving ? undefined : onClose}
            footer={null}
            width="min(1120px, calc(100vw - 24px))"
            centered
            destroyOnHidden
            closable={!saving}
            mask={{ closable: !saving }}
            keyboard={!saving}
            styles={{ body: { maxHeight: "calc(100dvh - 96px)", overflowX: "hidden", overflowY: "auto" } }}
        >
            <div data-canvas-no-zoom className="flex min-w-0 flex-col gap-3" style={{ color: theme.node.text }}>
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl border p-2" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                    <span className="px-1 text-sm font-semibold">标注</span>
                    <span className="mx-1 hidden h-6 w-px sm:block" style={{ background: theme.toolbar.border }} />
                    <ToolButton title="画笔" active={mode === "brush"} theme={theme} onClick={() => setMode("brush")}>
                        <Brush className="size-4" />
                    </ToolButton>
                    <ToolButton title="橡皮" active={mode === "erase"} theme={theme} onClick={() => setMode("erase")}>
                        <Eraser className="size-4" />
                    </ToolButton>
                    <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {annotationColors.map((item) => (
                            <button
                                key={item}
                                type="button"
                                aria-label={`颜色 ${item}`}
                                aria-pressed={color === item && mode === "brush"}
                                className="size-5 shrink-0 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                                style={{
                                    background: item,
                                    borderColor: color === item && mode === "brush" ? theme.node.activeStroke : "transparent",
                                    boxShadow: item === "#ffffff" ? `inset 0 0 0 1px ${theme.toolbar.border}` : undefined,
                                    outlineColor: theme.node.activeStroke,
                                }}
                                onClick={() => {
                                    setColor(item);
                                    setMode("brush");
                                }}
                            />
                        ))}
                    </div>
                    <div className="flex min-w-32 flex-1 items-center gap-2 px-1 sm:max-w-44">
                        <Brush className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
                        <Slider className="m-0 min-w-20 flex-1" min={3} max={80} value={brushSize} onChange={setBrushSize} />
                        <span className="w-7 text-right text-[11px]" style={{ color: theme.node.muted }}>
                            {brushSize}
                        </span>
                    </div>
                    <span className="hidden min-w-0 flex-1 lg:block" />
                    <ToolButton title="撤销" disabled={!strokes.length} theme={theme} onClick={undo}>
                        <Undo2 className="size-4" />
                    </ToolButton>
                    <ToolButton title="重做" disabled={!redoStrokes.length} theme={theme} onClick={redo}>
                        <Redo2 className="size-4" />
                    </ToolButton>
                    <ToolButton
                        title="清空"
                        disabled={!strokes.length}
                        theme={theme}
                        onClick={() => {
                            setStrokes([]);
                            setRedoStrokes([]);
                        }}
                    >
                        <RotateCcw className="size-4" />
                    </ToolButton>
                    <Button type="primary" icon={saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />} disabled={!strokes.length || loadState !== "ready" || saving} loading={saving} onClick={save}>
                        {saving ? "正在保存" : "保存为新节点"}
                    </Button>
                </div>

                {saveError ? (
                    <div role="alert" className="flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-sm" style={{ background: theme.node.dangerSurface, borderColor: theme.node.dangerBorder, color: theme.node.danger }}>
                        <CircleAlert className="mt-0.5 size-4 shrink-0" />
                        <span className="min-w-0 break-words">{saveError}</span>
                    </div>
                ) : null}

                <div className="flex min-h-48 min-w-0 items-center justify-center overflow-hidden rounded-xl border sm:min-h-[360px]" style={{ background: theme.node.fill, borderColor: theme.toolbar.border }}>
                    {loadState === "ready" && source && imageSize.width ? (
                        <div className="relative inline-block max-h-[68vh] max-w-full overflow-hidden">
                            <img src={source} alt="待标注图片" className="block max-h-[68vh] max-w-full select-none object-contain" draggable={false} />
                            <canvas
                                ref={canvasRef}
                                width={imageSize.width}
                                height={imageSize.height}
                                className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                                onPointerDown={startDraw}
                                onPointerMove={moveDraw}
                                onPointerUp={stopDraw}
                                onPointerCancel={stopDraw}
                            />
                        </div>
                    ) : loadState === "error" ? (
                        <div role="alert" className="flex max-w-sm flex-col items-center gap-3 px-4 text-center">
                            <CircleAlert className="size-6" style={{ color: theme.node.muted }} />
                            <span className="break-words text-sm" style={{ color: theme.node.muted }}>
                                {loadError}
                            </span>
                            <Button size="small" onClick={() => setReloadNonce((value) => value + 1)}>
                                重新读取
                            </Button>
                        </div>
                    ) : (
                        <span role="status" className="inline-flex items-center gap-2 text-sm" style={{ color: theme.node.muted }}>
                            <LoaderCircle className="size-4 animate-spin" />
                            正在读取图片...
                        </span>
                    )}
                </div>
            </div>
        </Modal>
    );
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
    return Boolean(value && typeof (value as PromiseLike<void>).then === "function");
}

export function annotationExportError(error: unknown) {
    if (error instanceof DOMException && error.name === "SecurityError") return "原图受到跨域保护，浏览器未允许导出标注结果";
    return error instanceof Error && error.message ? error.message : "标注图片导出失败，请重试";
}

function ToolButton({ title, active, disabled, children, theme, onClick }: { title: string; active?: boolean; disabled?: boolean; children: ReactNode; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onClick: () => void }) {
    return (
        <Tooltip title={title}>
            <button
                type="button"
                disabled={disabled}
                aria-label={title}
                aria-pressed={active}
                className="grid size-8 shrink-0 place-items-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-30"
                style={{
                    background: active ? theme.toolbar.activeBg : "transparent",
                    borderColor: active ? theme.node.activeStroke : "transparent",
                    color: active ? theme.toolbar.activeText : theme.toolbar.item,
                }}
                onClick={onClick}
                onMouseEnter={(event) => {
                    if (!active && !disabled) event.currentTarget.style.background = theme.toolbar.itemHover;
                }}
                onMouseLeave={(event) => {
                    if (!active) event.currentTarget.style.background = "transparent";
                }}
            >
                {children}
            </button>
        </Tooltip>
    );
}

function canvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
}

function redraw(canvas: HTMLCanvasElement | null, strokes: Stroke[]) {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach((stroke) => drawStroke(canvas, stroke));
}

function drawStroke(canvas: HTMLCanvasElement | null, stroke: Stroke) {
    const context = canvas?.getContext("2d");
    if (!context || !stroke.points.length) return;
    context.save();
    context.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.size;
    context.lineCap = "round";
    context.lineJoin = "round";
    const first = stroke.points[0];
    if (stroke.points.length === 1) {
        context.beginPath();
        context.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
        context.fill();
    } else {
        context.beginPath();
        context.moveTo(first.x, first.y);
        stroke.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        context.stroke();
    }
    context.restore();
}
