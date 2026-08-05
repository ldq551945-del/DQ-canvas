"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal, Segmented, Slider, Tooltip } from "antd";
import { Camera, LoaderCircle, RotateCcw, WandSparkles } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasImageAngleParams = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
};

const defaultParams: CanvasImageAngleParams = { horizontalAngle: 0, pitchAngle: 0, cameraDistance: 4.8, wideAngle: false };
const anglePresets = [
    { label: "正面", horizontalAngle: 0, pitchAngle: 0 },
    { label: "左侧", horizontalAngle: -90, pitchAngle: 0 },
    { label: "右侧", horizontalAngle: 90, pitchAngle: 0 },
    { label: "背面", horizontalAngle: 180, pitchAngle: 0 },
    { label: "俯拍", horizontalAngle: 0, pitchAngle: 55 },
    { label: "仰拍", horizontalAngle: 0, pitchAngle: -45 },
] as const;

type CanvasNodeAngleDialogProps = {
    dataUrl: string;
    open: boolean;
    onClose: () => void;
    onConfirm: (params: CanvasImageAngleParams) => void | Promise<void>;
};

const SUBMIT_FALLBACK_MS = 1200;

export function CanvasNodeAngleDialog({ dataUrl, open, onClose, onConfirm }: CanvasNodeAngleDialogProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [params, setParams] = useState(defaultParams);
    const [submitting, setSubmitting] = useState(false);
    const dragRef = useRef<{ x: number; y: number; horizontal: number; pitch: number } | null>(null);
    const submitLockRef = useRef(false);
    const submitFallbackRef = useRef<number | null>(null);

    useEffect(() => {
        if (open) setParams(defaultParams);
    }, [dataUrl, open]);

    const releaseSubmission = useCallback(() => {
        if (submitFallbackRef.current !== null) window.clearTimeout(submitFallbackRef.current);
        submitFallbackRef.current = null;
        submitLockRef.current = false;
        setSubmitting(false);
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

    const update = <Key extends keyof CanvasImageAngleParams>(key: Key, value: CanvasImageAngleParams[Key]) => {
        setParams((current) => ({ ...current, [key]: value }));
    };

    const startCameraDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { x: event.clientX, y: event.clientY, horizontal: params.horizontalAngle, pitch: params.pitchAngle };
    };

    const moveCamera = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        event.preventDefault();
        event.stopPropagation();
        setParams((current) => ({
            ...current,
            horizontalAngle: clamp(Math.round(drag.horizontal + (event.clientX - drag.x) * 0.8), -180, 180),
            pitchAngle: clamp(Math.round(drag.pitch - (event.clientY - drag.y) * 0.55), -75, 75),
        }));
    };

    const stopCameraDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const marker = cameraMarker(params.horizontalAngle, params.pitchAngle);
    const activePreset = anglePresets.find((preset) => preset.horizontalAngle === params.horizontalAngle && preset.pitchAngle === params.pitchAngle);
    const submit = () => {
        if (submitLockRef.current) return;
        submitLockRef.current = true;
        setSubmitting(true);
        try {
            const result = onConfirm(params);
            if (isPromiseLike(result)) {
                void Promise.resolve(result)
                    .catch(() => undefined)
                    .finally(releaseSubmission);
                return;
            }
            submitFallbackRef.current = window.setTimeout(releaseSubmission, SUBMIT_FALLBACK_MS);
        } catch {
            releaseSubmission();
        }
    };

    return (
        <Modal
            title="多视角"
            open={open && Boolean(dataUrl)}
            onCancel={submitting ? undefined : onClose}
            footer={null}
            width="min(760px, calc(100vw - 24px))"
            centered
            destroyOnHidden
            closable={!submitting}
            mask={{ closable: !submitting }}
            keyboard={!submitting}
            styles={{ body: { maxHeight: "calc(100dvh - 120px)", overflowX: "hidden", overflowY: "auto" } }}
        >
            <div data-canvas-no-zoom className="min-w-0 space-y-3" style={{ color: theme.node.text }}>
                <p className="m-0 text-xs" style={{ color: theme.node.muted }}>
                    拖动摄影机或选择预设，AI 将基于原图重新生成真实新视角。
                </p>

                <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="list" aria-label="视角预设">
                    <PresetButton active={!activePreset} label="自定义" theme={theme} />
                    {anglePresets.map((preset) => (
                        <PresetButton
                            key={preset.label}
                            active={activePreset?.label === preset.label}
                            label={preset.label}
                            theme={theme}
                            onClick={() => setParams((current) => ({ ...current, horizontalAngle: preset.horizontalAngle, pitchAngle: preset.pitchAngle }))}
                        />
                    ))}
                </div>

                <div className="grid gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
                    <div
                        className="relative grid min-h-[230px] cursor-grab touch-none place-items-center overflow-hidden rounded-xl border active:cursor-grabbing"
                        style={{ background: theme.node.fill, borderColor: theme.toolbar.border }}
                        onPointerDown={startCameraDrag}
                        onPointerMove={moveCamera}
                        onPointerUp={stopCameraDrag}
                        onPointerCancel={stopCameraDrag}
                    >
                        <GlobeGrid color={theme.node.muted} />
                        <img src={imagePreviewUrl(dataUrl, 512)} alt="视角参考" className="relative z-10 size-24 rounded-xl border object-cover" style={{ borderColor: theme.toolbar.border, transform: previewTransform(params) }} draggable={false} />
                        <div
                            className="pointer-events-none absolute z-20 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border"
                            style={{ left: `${marker.x}%`, top: `${marker.y}%`, background: theme.toolbar.panel, borderColor: theme.node.activeStroke, color: theme.node.text }}
                        >
                            <Camera className="size-3.5" />
                        </div>
                        <span className="pointer-events-none absolute bottom-2 text-[10px]" style={{ color: theme.node.muted }}>
                            拖动调整摄影机
                        </span>
                    </div>

                    <div className="flex min-w-0 flex-col justify-center gap-2 rounded-xl border p-3" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                        <AngleSlider label="水平环绕" value={params.horizontalAngle} min={-180} max={180} suffix="°" onChange={(value) => update("horizontalAngle", value)} />
                        <AngleSlider label="垂直俯仰" value={params.pitchAngle} min={-75} max={75} suffix="°" onChange={(value) => update("pitchAngle", value)} />
                        <AngleSlider label="景别缩放" value={params.cameraDistance} min={1} max={10} step={0.1} suffix={distanceLabel(params.cameraDistance)} onChange={(value) => update("cameraDistance", value)} />
                        <div className="grid min-h-9 grid-cols-[68px_minmax(0,1fr)] items-center gap-2">
                            <span className="text-xs" style={{ color: theme.node.muted }}>
                                镜头
                            </span>
                            <Segmented
                                block
                                size="small"
                                value={params.wideAngle ? "wide" : "standard"}
                                options={[
                                    { label: "标准", value: "standard" },
                                    { label: "广角", value: "wide" },
                                ]}
                                onChange={(value) => update("wideAngle", value === "wide")}
                            />
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: theme.toolbar.border }}>
                    <span className="text-xs" style={{ color: theme.node.muted }}>
                        当前视角
                    </span>
                    <span className="text-xs font-semibold">{activePreset?.label || "自定义"}</span>
                    <span className="text-[11px]" style={{ color: theme.node.muted }}>
                        {params.horizontalAngle}° / {params.pitchAngle}° · {params.cameraDistance.toFixed(1)} {distanceLabel(params.cameraDistance)}
                    </span>
                    <span className="min-w-0 flex-1" />
                    <Button icon={<RotateCcw className="size-4" />} onClick={() => setParams(defaultParams)}>
                        重置
                    </Button>
                    <Button type="primary" icon={submitting ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />} loading={submitting} disabled={submitting} onClick={submit}>
                        {submitting ? "正在提交" : "生成新角度"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
    return Boolean(value && typeof (value as PromiseLike<void>).then === "function");
}

function AngleSlider({ label, value, min, max, step = 1, suffix, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (value: number) => void }) {
    return (
        <div className="grid min-h-9 grid-cols-[68px_minmax(0,1fr)_66px] items-center gap-2">
            <span className="text-xs opacity-65">{label}</span>
            <Slider min={min} max={max} step={step} value={value} onChange={onChange} />
            <span className="whitespace-nowrap text-right text-[11px] font-semibold">
                {Number.isInteger(value) ? value : value.toFixed(1)}
                {suffix === "°" ? suffix : ` ${suffix}`}
            </span>
        </div>
    );
}

function PresetButton({ active, label, theme, onClick }: { active: boolean; label: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onClick?: () => void }) {
    return (
        <Tooltip title={label === "自定义" ? "拖动或调整滑杆后自动进入自定义视角" : undefined}>
            <button
                type="button"
                aria-pressed={active}
                className="h-8 shrink-0 rounded-lg border px-3 text-xs font-medium transition-colors"
                style={{
                    background: active ? theme.toolbar.activeBg : theme.toolbar.panel,
                    borderColor: active ? theme.node.activeStroke : theme.toolbar.border,
                    color: active ? theme.toolbar.activeText : theme.toolbar.item,
                }}
                onClick={onClick}
            >
                {label}
            </button>
        </Tooltip>
    );
}

function GlobeGrid({ color }: { color: string }) {
    return (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-6 h-[calc(100%-48px)] w-[calc(100%-48px)] opacity-25" viewBox="0 0 200 200" fill="none" stroke={color} strokeWidth="1">
            <circle cx="100" cy="100" r="82" />
            <ellipse cx="100" cy="100" rx="42" ry="82" />
            <ellipse cx="100" cy="100" rx="68" ry="82" />
            <ellipse cx="100" cy="100" rx="82" ry="28" />
            <ellipse cx="100" cy="100" rx="82" ry="56" />
            <path d="M18 100h164M100 18v164" />
        </svg>
    );
}

function cameraMarker(horizontal: number, pitch: number) {
    const horizontalRad = (horizontal * Math.PI) / 180;
    const pitchRad = (pitch * Math.PI) / 180;
    return { x: 50 + Math.sin(horizontalRad) * Math.cos(pitchRad) * 40, y: 50 - Math.sin(pitchRad) * 40 };
}

function previewTransform(params: CanvasImageAngleParams) {
    const scale = clamp(1.08 - params.cameraDistance * 0.035 - (params.wideAngle ? 0.08 : 0), 0.72, 1.08);
    return `perspective(520px) rotateY(${params.horizontalAngle * -0.18}deg) rotateX(${params.pitchAngle * 0.16}deg) scale(${scale})`;
}

function distanceLabel(value: number) {
    if (value <= 3) return "近景";
    if (value >= 7) return "全景";
    return "中景";
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
