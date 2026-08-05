"use client";

import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ScanFace, Sparkles, X } from "lucide-react";
import { Box3, Color, Mesh, MeshStandardMaterial, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasEmotionPresets, emotionBlendshapes, type CanvasEmotionEditRegion, type CanvasEmotionParams, type CanvasEmotionPreset, type CanvasFaceBox } from "../utils/canvas-emotion";

export type CanvasImageEmotionPayload = CanvasEmotionParams & {
    label: string;
    prompt: string;
    sourceDataUrl: string;
    maskDataUrl: string;
    characterDataUrl: string;
    editRegion: CanvasEmotionEditRegion;
    imageWidth: number;
    imageHeight: number;
};

export type CanvasEmotionCharacter = {
    id: string;
    name: string;
    faceBox: CanvasFaceBox;
};

type CanvasNodeEmotionPanelProps = {
    dataUrl: string;
    imageWidth: number;
    imageHeight: number;
    characters: CanvasEmotionCharacter[];
    activeCharacterId: string;
    preset: CanvasEmotionPreset;
    generating: boolean;
    error?: string;
    onSelectCharacter: (characterId: string) => void;
    onManualSelect: () => void;
    onPresetChange: (preset: CanvasEmotionPreset) => void;
    onClose: () => void;
    onConfirm: () => void;
};

export function CanvasNodeEmotionPanel({ dataUrl, imageWidth, imageHeight, characters, activeCharacterId, preset, generating, error, onSelectCharacter, onManualSelect, onPresetChange, onClose, onConfirm }: CanvasNodeEmotionPanelProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            data-canvas-no-zoom
            className="w-[580px] max-w-full overflow-hidden rounded-xl border shadow-[0_12px_32px_rgba(15,23,42,.14)]"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
        >
            <div className="flex min-h-11 items-center gap-1.5 border-b px-2.5" style={{ borderColor: theme.toolbar.border }}>
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {characters.map((character) => {
                        const active = activeCharacterId === character.id;
                        return (
                            <button
                                key={character.id}
                                type="button"
                                aria-pressed={active}
                                className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-1.5 pr-2 text-[11px] font-medium transition-colors"
                                style={{
                                    background: active ? theme.toolbar.activeBg : theme.node.fill,
                                    borderColor: active ? theme.node.activeStroke : theme.toolbar.border,
                                    color: active ? theme.toolbar.activeText : theme.node.text,
                                }}
                                onClick={() => onSelectCharacter(character.id)}
                            >
                                <FaceThumbnail dataUrl={dataUrl} imageWidth={imageWidth} imageHeight={imageHeight} box={character.faceBox} />
                                <span>{character.name}</span>
                            </button>
                        );
                    })}
                    <button
                        type="button"
                        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition-colors"
                        style={{ background: theme.node.fill, borderColor: theme.toolbar.border, color: theme.node.text }}
                        onClick={onManualSelect}
                    >
                        <ScanFace className="size-3.5" />
                        手动框选
                    </button>
                </div>
                <button type="button" aria-label="关闭情绪调节" className="grid size-8 shrink-0 place-items-center rounded-lg transition-colors" style={{ color: theme.toolbar.item }} onClick={onClose}>
                    <X className="size-4" />
                </button>
            </div>

            <div className="grid gap-2.5 p-2.5 sm:grid-cols-[minmax(0,1fr)_212px]">
                <EmotionHeadPreview preset={preset} />
                <EmotionPad preset={preset} onChange={onPresetChange} />
            </div>

            <div className="flex min-h-11 flex-wrap items-center gap-2 border-t px-3 py-1.5" style={{ borderColor: theme.toolbar.border }}>
                <span className="text-[10px]" style={{ color: theme.node.muted }}>
                    情绪定位
                </span>
                <span className="text-xs font-semibold">{preset.label}</span>
                {error ? (
                    <span className="min-w-0 flex-1 truncate text-right text-[10px]" style={{ color: theme.node.danger }} title={error}>
                        {error}
                    </span>
                ) : (
                    <span className="min-w-0 flex-1" />
                )}
                <button
                    type="button"
                    disabled={generating}
                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition-opacity disabled:cursor-wait disabled:opacity-55"
                    style={{ background: theme.node.activeStroke, color: theme.node.panel }}
                    onClick={onConfirm}
                >
                    <Sparkles className={`size-3.5 ${generating ? "animate-pulse" : ""}`} />
                    {generating ? "准备生成" : "生成"}
                </button>
            </div>
        </div>
    );
}

function FaceThumbnail({ dataUrl, imageWidth, imageHeight, box }: { dataUrl: string; imageWidth: number; imageHeight: number; box: CanvasFaceBox }) {
    const scaleX = imageWidth / Math.max(1, box.width);
    const scaleY = imageHeight / Math.max(1, box.height);
    return (
        <span className="relative block size-6 shrink-0 overflow-hidden rounded-md bg-black/20">
            <img
                src={dataUrl}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={{
                    width: `${scaleX * 100}%`,
                    height: `${scaleY * 100}%`,
                    left: `${-(box.x / Math.max(1, box.width)) * 100}%`,
                    top: `${-(box.y / Math.max(1, box.height)) * 100}%`,
                }}
            />
        </span>
    );
}

function EmotionPad({ preset, onChange }: { preset: CanvasEmotionPreset; onChange: (preset: CanvasEmotionPreset) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [dragging, setDragging] = useState(false);
    const selectedColumn = 2 - preset.intimacy;
    const selectedRow = 2 - preset.arousal;

    const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const column = clamp(Math.floor(((event.clientX - rect.left) / Math.max(1, rect.width)) * 5), 0, 4);
        const row = clamp(Math.floor(((event.clientY - rect.top) / Math.max(1, rect.height)) * 5), 0, 4);
        const next = canvasEmotionPresets[row * 5 + column];
        if (next && next.id !== preset.id) onChange(next);
    };

    return (
        <div className="relative min-h-[190px] rounded-xl border px-[25px] pb-[22px] pt-[24px]" style={{ background: theme.node.fill, borderColor: theme.toolbar.border }}>
            <span className="pointer-events-none absolute inset-x-0 top-1.5 text-center text-[9px]" style={{ color: theme.node.muted }}>
                激动
            </span>
            <span className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[9px]" style={{ color: theme.node.muted }}>
                平静
            </span>
            <span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-[9px] [writing-mode:vertical-rl]" style={{ color: theme.node.muted }}>
                亲近
            </span>
            <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[9px] [writing-mode:vertical-rl]" style={{ color: theme.node.muted }}>
                疏离
            </span>
            <div
                role="slider"
                aria-label="情绪强度"
                aria-valuetext={preset.label}
                tabIndex={0}
                className="relative grid size-full min-h-[144px] touch-none cursor-crosshair grid-cols-5 grid-rows-5 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ outlineColor: theme.node.activeStroke }}
                onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDragging(true);
                    updateFromPointer(event);
                }}
                onPointerMove={(event) => {
                    if (dragging) updateFromPointer(event);
                }}
                onPointerUp={(event) => {
                    setDragging(false);
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => setDragging(false)}
                onKeyDown={(event) => {
                    const column = clamp(selectedColumn + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0), 0, 4);
                    const row = clamp(selectedRow + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0), 0, 4);
                    if (column !== selectedColumn || row !== selectedRow) {
                        event.preventDefault();
                        onChange(canvasEmotionPresets[row * 5 + column]);
                    }
                }}
            >
                {canvasEmotionPresets.map((item, index) => {
                    const column = index % 5;
                    const row = Math.floor(index / 5);
                    const active = item.id === preset.id;
                    const onAxis = column === selectedColumn || row === selectedRow;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            aria-label={item.label}
                            aria-pressed={active}
                            title={item.label}
                            tabIndex={-1}
                            className="m-auto grid size-7 place-items-center rounded-full"
                            onClick={(event) => {
                                event.stopPropagation();
                                onChange(item);
                            }}
                        >
                            <span
                                className={`block rounded-full border transition-[width,height,opacity] ${active ? "size-4" : "size-2"}`}
                                style={{
                                    background: active ? theme.toolbar.activeBg : theme.node.muted,
                                    borderColor: active ? theme.node.activeStroke : "transparent",
                                    opacity: active ? 1 : onAxis ? 0.78 : 0.38,
                                }}
                            />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function EmotionHeadPreview({ preset }: { preset: CanvasEmotionPreset }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const background = theme.node.fill;
    const modelColor = useThemeStore((state) => state.theme) === "dark" ? "#cbd5e1" : "#94a3b8";

    return (
        <div className="relative min-h-[190px] overflow-hidden rounded-xl border" style={{ background, borderColor: theme.toolbar.border }}>
            <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ fov: 38, near: 0.1, far: 20, position: [0, 0, 4.15] }} gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}>
                <color attach="background" args={[background]} />
                <ambientLight intensity={0.82} />
                <directionalLight position={[-2.8, 4, 3]} intensity={1.3} color="#ffffff" />
                <directionalLight position={[3, 1, 2]} intensity={0.42} color="#c9d0dc" />
                <Suspense fallback={null}>
                    <EmotionFaceModel preset={preset} modelColor={modelColor} />
                </Suspense>
            </Canvas>
            <span className="pointer-events-none absolute bottom-2 left-2.5 rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.panel, color: theme.node.muted }}>
                实时预览 · {preset.label}
            </span>
        </div>
    );
}

function EmotionFaceModel({ preset, modelColor }: { preset: CanvasEmotionPreset; modelColor: string }) {
    const gltf = useLoader(GLTFLoader, "/canvas/models/facecap.glb", (loader) => {
        loader.setMeshoptDecoder(MeshoptDecoder);
    });
    const invalidate = useThree((state) => state.invalidate);
    const model = useMemo(() => createMannequinModel(gltf.scene, modelColor), [gltf.scene, modelColor]);
    const animationRef = useRef<number | null>(null);

    useEffect(() => {
        const targets = emotionBlendshapes(preset);
        const meshes = morphMeshes(model);
        const starts = meshes.map((mesh) => [...(mesh.morphTargetInfluences || [])]);
        const startTime = performance.now();
        const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220;

        const animate = (now: number) => {
            const progress = duration ? Math.min(1, (now - startTime) / duration) : 1;
            const eased = 1 - Math.pow(1 - progress, 3);
            meshes.forEach((mesh, meshIndex) => {
                const dictionary = mesh.morphTargetDictionary || {};
                const influences = mesh.morphTargetInfluences || [];
                Object.entries(dictionary).forEach(([name, index]) => {
                    const target = targets[name as keyof typeof targets] || 0;
                    influences[index] = (starts[meshIndex][index] || 0) + (target - (starts[meshIndex][index] || 0)) * eased;
                });
            });
            invalidate();
            if (progress < 1) animationRef.current = requestAnimationFrame(animate);
        };

        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        animationRef.current = requestAnimationFrame(animate);
        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
    }, [invalidate, model, preset]);

    return <primitive object={model} />;
}

function createMannequinModel(source: Object3D, modelColor: string) {
    const model = source.clone(true);
    model.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.material = new MeshStandardMaterial({ color: new Color(modelColor), roughness: 0.9, metalness: 0.01 });
        object.castShadow = false;
        object.receiveShadow = false;
    });
    const bounds = new Box3().setFromObject(model);
    const size = bounds.getSize(new Vector3());
    model.scale.multiplyScalar(2.35 / Math.max(size.y, 0.001));
    const normalizedBounds = new Box3().setFromObject(model);
    model.position.sub(normalizedBounds.getCenter(new Vector3()));
    return model;
}

function morphMeshes(model: Object3D) {
    const meshes: Mesh[] = [];
    model.traverse((object) => {
        if (object instanceof Mesh && object.morphTargetDictionary && object.morphTargetInfluences) meshes.push(object);
    });
    return meshes;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
