"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Alert, Button, Modal, Segmented, Slider, Spin } from "antd";
import { Check, Eraser, Pencil, Redo2, RotateCcw, Undo2, X } from "lucide-react";

import { originalImageDownloadUrl } from "@/lib/media-image-url";
import {
    applyBackgroundRefineStroke,
    backgroundRefineInputError,
    composeBackgroundRefinePixels,
    mergeBackgroundRefineRects,
    readAlphaRect,
    writeAlphaRect,
    type BackgroundRefineMode,
    type BackgroundRefinePoint,
    type BackgroundRefineRect,
} from "../utils/canvas-background-refine";

type AlphaHistoryPatch = BackgroundRefineRect & {
    before: Uint8ClampedArray;
    after: Uint8ClampedArray;
};

type StrokeState = {
    active: boolean;
    last: BackgroundRefinePoint | null;
    beforeAlpha: Uint8ClampedArray | null;
    bounds: BackgroundRefineRect | null;
};

const MAX_HISTORY_STEPS = 20;
const MAX_HISTORY_BYTES = 48 * 1024 * 1024;
const checkerboardStyle = {
    backgroundColor: "#f8fafc",
    backgroundImage: "conic-gradient(#e5e7eb 25%, transparent 0 50%, #e5e7eb 0 75%, transparent 0)",
    backgroundPosition: "0 0",
    backgroundSize: "20px 20px",
};

export function CanvasNodeBackgroundRefineDialog({
    dataUrl,
    bytes,
    originalDataUrl,
    originalBytes,
    originalWidth,
    originalHeight,
    open,
    onClose,
    onConfirm,
}: {
    dataUrl: string;
    bytes?: number;
    originalDataUrl?: string;
    originalBytes?: number;
    originalWidth?: number;
    originalHeight?: number;
    open: boolean;
    onClose: () => void;
    onConfirm: (image: Blob) => Promise<void> | void;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sourcePixelsRef = useRef<Uint8ClampedArray | null>(null);
    const alphaRef = useRef<Uint8ClampedArray | null>(null);
    const initialCutoutAlphaRef = useRef<Uint8ClampedArray | null>(null);
    const restoreAlphaRef = useRef<Uint8ClampedArray | null>(null);
    const strokeRef = useRef<StrokeState>({ active: false, last: null, beforeAlpha: null, bounds: null });
    const undoRef = useRef<AlphaHistoryPatch[]>([]);
    const redoRef = useRef<AlphaHistoryPatch[]>([]);
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
    const [mode, setMode] = useState<BackgroundRefineMode>("erase");
    const [brushSize, setBrushSize] = useState(80);
    const [softness, setSoftness] = useState(30);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [restoreAvailable, setRestoreAvailable] = useState(false);
    const [, setHistoryVersion] = useState(0);
    const brushMax = useMemo(() => Math.min(600, Math.max(80, Math.round(Math.min(imageSize?.width || 160, imageSize?.height || 160) / 2))), [imageSize]);

    useEffect(() => {
        if (!open || !dataUrl) return;
        let cancelled = false;
        const pendingImages: HTMLImageElement[] = [];
        setLoading(true);
        setSubmitting(false);
        setError("");
        setRestoreAvailable(false);
        setImageSize(null);
        setMode("erase");
        setSoftness(30);
        undoRef.current = [];
        redoRef.current = [];
        sourcePixelsRef.current = null;
        alphaRef.current = null;
        initialCutoutAlphaRef.current = null;
        restoreAlphaRef.current = null;
        strokeRef.current = { active: false, last: null, beforeAlpha: null, bounds: null };
        setHistoryVersion((value) => value + 1);

        if (bytes && bytes > 30 * 1024 * 1024) {
            setError(backgroundRefineInputError({ bytes, width: 1, height: 1 }));
            setLoading(false);
            return;
        }

        const originalMetadataError = originalWidth && originalHeight ? backgroundRefineInputError({ bytes: originalBytes, width: originalWidth, height: originalHeight }) : "";
        const canLoadOriginal = Boolean(originalDataUrl && !originalMetadataError);
        const loadImage = (url: string) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new Image();
                pendingImages.push(image);
                image.decoding = "async";
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error("图片读取失败"));
                image.src = originalImageDownloadUrl(url);
            });

        void Promise.all([loadImage(dataUrl), canLoadOriginal && originalDataUrl ? loadImage(originalDataUrl).catch(() => null) : Promise.resolve(null)])
            .then(([cutoutImage, originalImage]) => {
                if (cancelled) return;
                const width = cutoutImage.naturalWidth;
                const height = cutoutImage.naturalHeight;
                const validationError = backgroundRefineInputError({ bytes, width, height });
                if (validationError) throw new Error(validationError);
                const canvas = canvasRef.current;
                const context = canvas?.getContext("2d", { willReadFrequently: true });
                if (!canvas || !context) throw new Error("浏览器未能初始化边缘细化画布");

                canvas.width = width;
                canvas.height = height;
                context.clearRect(0, 0, width, height);
                context.drawImage(cutoutImage, 0, 0, width, height);
                const cutoutPixels = context.getImageData(0, 0, width, height).data;
                const initialAlpha = readAlphaChannel(cutoutPixels);

                let sourcePixels = cutoutPixels;
                let restoreAlpha = initialAlpha;
                if (originalImage) {
                    context.clearRect(0, 0, width, height);
                    context.drawImage(originalImage, 0, 0, width, height);
                    sourcePixels = context.getImageData(0, 0, width, height).data;
                    restoreAlpha = readAlphaChannel(sourcePixels);
                }

                sourcePixelsRef.current = sourcePixels;
                alphaRef.current = initialAlpha.slice();
                initialCutoutAlphaRef.current = initialAlpha;
                restoreAlphaRef.current = restoreAlpha;
                setRestoreAvailable(Boolean(originalImage));
                setImageSize({ width, height });
                setBrushSize(Math.min(240, Math.max(16, Math.round(Math.min(width, height) * 0.06))));
                renderAlphaCanvas(context, sourcePixels, initialAlpha, width, { x: 0, y: 0, width, height });
            })
            .catch((loadError) => {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : "透明 PNG 读取失败，请重新抠图后再试");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
                pendingImages.forEach((image) => {
                    image.onload = null;
                    image.onerror = null;
                    image.src = "";
                });
            });
        return () => {
            cancelled = true;
            pendingImages.forEach((image) => {
                image.onload = null;
                image.onerror = null;
                image.src = "";
            });
            sourcePixelsRef.current = null;
            alphaRef.current = null;
            initialCutoutAlphaRef.current = null;
            restoreAlphaRef.current = null;
            strokeRef.current = { active: false, last: null, beforeAlpha: null, bounds: null };
        };
    }, [bytes, dataUrl, open, originalBytes, originalDataUrl, originalHeight, originalWidth]);

    const renderRect = (rect: BackgroundRefineRect) => {
        const canvas = canvasRef.current;
        const sourcePixels = sourcePixelsRef.current;
        const alpha = alphaRef.current;
        const context = canvas?.getContext("2d", { willReadFrequently: true });
        if (!canvas || !context || !sourcePixels || !alpha) return;
        const pixels = context.createImageData(rect.width, rect.height);
        pixels.data.set(composeBackgroundRefinePixels(sourcePixels, alpha, canvas.width, rect));
        context.putImageData(pixels, rect.x, rect.y);
    };

    const drawSegment = (from: BackgroundRefinePoint, to: BackgroundRefinePoint) => {
        const canvas = canvasRef.current;
        const alpha = alphaRef.current;
        const restoreAlpha = restoreAlphaRef.current;
        if (!canvas || !alpha || !restoreAlpha || (mode === "restore" && !restoreAvailable)) return;
        const bounds = applyBackgroundRefineStroke({ alpha, baselineAlpha: restoreAlpha, width: canvas.width, height: canvas.height, from, to, brushSize, softness, mode });
        if (!bounds) return;
        strokeRef.current.bounds = mergeBackgroundRefineRects(strokeRef.current.bounds, bounds);
        renderRect(bounds);
    };

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (loading || submitting || !alphaRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        strokeRef.current = { active: true, last: point, beforeAlpha: alphaRef.current.slice(), bounds: null };
        drawSegment(point, point);
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const stroke = strokeRef.current;
        if (!stroke.active || !stroke.last) return;
        event.preventDefault();
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        drawSegment(stroke.last, point);
        stroke.last = point;
    };

    const finishDraw = () => {
        const canvas = canvasRef.current;
        const alpha = alphaRef.current;
        const stroke = strokeRef.current;
        strokeRef.current = { active: false, last: null, beforeAlpha: null, bounds: null };
        if (!canvas || !alpha || !stroke.beforeAlpha || !stroke.bounds) return;
        const before = readAlphaRect(stroke.beforeAlpha, canvas.width, stroke.bounds);
        const after = readAlphaRect(alpha, canvas.width, stroke.bounds);
        if (alphaArraysEqual(before, after)) return;
        pushHistory({ ...stroke.bounds, before, after });
    };

    const pushHistory = (patch: AlphaHistoryPatch) => {
        undoRef.current.push(patch);
        redoRef.current = [];
        while (undoRef.current.length > MAX_HISTORY_STEPS || historyBytes(undoRef.current) > MAX_HISTORY_BYTES) undoRef.current.shift();
        setHistoryVersion((value) => value + 1);
    };

    const applyHistoryPatch = (patch: AlphaHistoryPatch, value: "before" | "after") => {
        const canvas = canvasRef.current;
        const alpha = alphaRef.current;
        if (!canvas || !alpha) return;
        writeAlphaRect(alpha, canvas.width, patch, patch[value]);
        renderRect(patch);
    };

    const undo = () => {
        const patch = undoRef.current.pop();
        if (!patch) return;
        applyHistoryPatch(patch, "before");
        redoRef.current.push(patch);
        setHistoryVersion((value) => value + 1);
    };

    const redo = () => {
        const patch = redoRef.current.pop();
        if (!patch) return;
        applyHistoryPatch(patch, "after");
        undoRef.current.push(patch);
        setHistoryVersion((value) => value + 1);
    };

    const reset = () => {
        const canvas = canvasRef.current;
        const alpha = alphaRef.current;
        const initialCutoutAlpha = initialCutoutAlphaRef.current;
        if (!canvas || !alpha || !initialCutoutAlpha || alphaArraysEqual(alpha, initialCutoutAlpha)) return;
        const rect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
        const before = alpha.slice();
        alpha.set(initialCutoutAlpha);
        renderRect(rect);
        pushHistory({ ...rect, before, after: initialCutoutAlpha.slice() });
    };

    const submit = async () => {
        const canvas = canvasRef.current;
        if (!canvas || !imageSize || loading || error) return;
        setSubmitting(true);
        setError("");
        try {
            const image = await canvasToPng(canvas);
            if (image.size > 30 * 1024 * 1024) throw new Error("细化后的 PNG 超过 30MB，请先缩小图片后重试");
            await onConfirm(image);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "边缘细化结果保存失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal title="细化边缘" open={open && Boolean(dataUrl)} onCancel={submitting ? undefined : onClose} footer={null} width={1060} centered destroyOnHidden maskClosable={!submitting} keyboard={!submitting} styles={{ body: { padding: 0 } }}>
            <div className="grid min-h-[440px] overflow-hidden lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="flex min-h-[360px] items-center justify-center overflow-hidden border-b border-black/10 p-4 lg:min-h-[540px] lg:border-r lg:border-b-0 dark:border-white/10" style={checkerboardStyle}>
                    {loading ? <Spin size="large" /> : null}
                    <canvas
                        ref={canvasRef}
                        className={`max-h-[68vh] max-w-full touch-none object-contain shadow-[0_10px_36px_rgba(15,23,42,.18)] ${loading || error ? "hidden" : "block"}`}
                        onPointerDown={startDraw}
                        onPointerMove={moveDraw}
                        onPointerUp={finishDraw}
                        onPointerCancel={finishDraw}
                        aria-label="边缘细化画布"
                    />
                </div>

                <div className="flex min-h-0 flex-col gap-5 p-5">
                    <div>
                        <div className="text-base font-semibold">蒙版画笔</div>
                        <div className="mt-1 text-xs opacity-55">{imageSize ? `${imageSize.width} x ${imageSize.height}px` : loading ? "读取中" : ""}</div>
                    </div>

                    {error ? <Alert type="error" showIcon message={error} /> : null}
                    {!error && imageSize && !restoreAvailable ? <Alert type="info" showIcon message="未找到原始图片，恢复功能暂不可用" /> : null}

                    <Segmented
                        block
                        value={mode}
                        disabled={!imageSize || loading || submitting || Boolean(error)}
                        options={[
                            {
                                value: "erase",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Eraser className="size-4" />
                                        擦除
                                    </span>
                                ),
                            },
                            {
                                value: "restore",
                                disabled: !restoreAvailable,
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Pencil className="size-4" />
                                        恢复
                                    </span>
                                ),
                            },
                        ]}
                        onChange={(value) => setMode(value as BackgroundRefineMode)}
                    />

                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">画笔大小</span>
                            <span className="tabular-nums opacity-65">{brushSize}px</span>
                        </div>
                        <Slider min={4} max={brushMax} step={2} value={Math.min(brushSize, brushMax)} disabled={!imageSize || loading || submitting || Boolean(error)} onChange={setBrushSize} />
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">边缘柔化</span>
                            <span className="tabular-nums opacity-65">{softness}%</span>
                        </div>
                        <Slider min={0} max={100} step={1} value={softness} disabled={!imageSize || loading || submitting || Boolean(error)} onChange={setSoftness} />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <Button icon={<Undo2 className="size-4" />} disabled={!undoRef.current.length || submitting} onClick={undo}>
                            撤销
                        </Button>
                        <Button icon={<Redo2 className="size-4" />} disabled={!redoRef.current.length || submitting} onClick={redo}>
                            重做
                        </Button>
                        <Button icon={<RotateCcw className="size-4" />} disabled={!undoRef.current.length || submitting} onClick={reset}>
                            重置
                        </Button>
                    </div>

                    <div className="mt-auto flex justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
                        <Button icon={<X className="size-4" />} disabled={submitting} onClick={onClose}>
                            取消
                        </Button>
                        <Button type="primary" icon={<Check className="size-4" />} loading={submitting} disabled={!imageSize || loading || Boolean(error)} onClick={() => void submit()}>
                            应用
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function readCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
}

function historyBytes(history: AlphaHistoryPatch[]) {
    return history.reduce((total, patch) => total + patch.before.byteLength + patch.after.byteLength, 0);
}

function readAlphaChannel(pixels: Uint8ClampedArray) {
    const alpha = new Uint8ClampedArray(pixels.length / 4);
    for (let source = 3, target = 0; source < pixels.length; source += 4, target += 1) alpha[target] = pixels[source];
    return alpha;
}

function renderAlphaCanvas(context: CanvasRenderingContext2D, sourcePixels: Uint8ClampedArray, alpha: Uint8ClampedArray, imageWidth: number, rect: BackgroundRefineRect) {
    const pixels = context.createImageData(rect.width, rect.height);
    pixels.data.set(composeBackgroundRefinePixels(sourcePixels, alpha, imageWidth, rect));
    context.putImageData(pixels, rect.x, rect.y);
}

function alphaArraysEqual(left: Uint8ClampedArray, right: Uint8ClampedArray) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}

function canvasToPng(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("浏览器未能生成细化后的 PNG"))), "image/png");
    });
}
