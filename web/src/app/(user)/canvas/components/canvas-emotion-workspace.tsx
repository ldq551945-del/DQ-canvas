"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, ScanFace, SquareDashedMousePointer, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "../types";
import { buildEmotionImageArtifacts, buildEmotionPrompt, neutralEmotionPreset, type CanvasEmotionPreset, type CanvasFaceBox } from "../utils/canvas-emotion";
import { detectCanvasFaces } from "../utils/canvas-face-detection";
import { CanvasNodeEmotionPanel, type CanvasEmotionCharacter, type CanvasImageEmotionPayload } from "./canvas-node-emotion-panel";

type WorkspaceStatus = "detecting" | "selecting" | "manual" | "editing" | "generating" | "error";

type CanvasEmotionWorkspaceProps = {
    node: CanvasNodeData;
    viewport: ViewportTransform;
    containerRef: RefObject<HTMLDivElement | null>;
    onClose: () => void;
    onConfirm: (payload: CanvasImageEmotionPayload) => Promise<boolean>;
};

export function CanvasEmotionWorkspace({ node, viewport, containerRef, onClose, onConfirm }: CanvasEmotionWorkspaceProps) {
    const dataUrl = node.metadata?.content || "";
    const [status, setStatus] = useState<WorkspaceStatus>("detecting");
    const [faces, setFaces] = useState<CanvasFaceBox[]>([]);
    const [characters, setCharacters] = useState<CanvasEmotionCharacter[]>([]);
    const [activeCharacterId, setActiveCharacterId] = useState("");
    const [preset, setPreset] = useState<CanvasEmotionPreset>(neutralEmotionPreset);
    const [imageSize, setImageSize] = useState({ width: node.metadata?.naturalWidth || 0, height: node.metadata?.naturalHeight || 0 });
    const [error, setError] = useState("");
    const [manualDraft, setManualDraft] = useState<CanvasFaceBox | null>(null);
    const portalTarget = containerRef.current;

    useEffect(() => {
        const controller = new AbortController();
        const sourceImage = new Image();
        sourceImage.onload = () => setImageSize({ width: sourceImage.naturalWidth, height: sourceImage.naturalHeight });
        sourceImage.src = dataUrl;
        setStatus("detecting");
        setError("");
        setFaces([]);
        setCharacters([]);
        setActiveCharacterId("");
        setPreset(neutralEmotionPreset);

        void detectCanvasFaces(dataUrl, controller.signal)
            .then((result) => {
                setImageSize({ width: result.imageWidth, height: result.imageHeight });
                setFaces(result.faces);
                if (result.faces.length) {
                    setStatus("selecting");
                    return;
                }
                setStatus("error");
                setError("未识别到清晰人脸，请手动框选");
            })
            .catch((reason) => {
                if (reason instanceof DOMException && reason.name === "AbortError") return;
                setStatus("error");
                setError(reason instanceof Error ? `${reason.message}，请手动框选` : "人脸识别失败，请手动框选");
            });

        return () => {
            controller.abort();
            sourceImage.onload = null;
        };
    }, [dataUrl]);

    const selectFace = (face: CanvasFaceBox) => {
        const existing = characters.find((character) => sameFace(character.faceBox, face));
        if (existing) {
            setActiveCharacterId(existing.id);
            setStatus("editing");
            setError("");
            return;
        }
        const characterName = (node.metadata as { characterName?: unknown } | undefined)?.characterName;
        const index = characters.length + 1;
        const character: CanvasEmotionCharacter = {
            id: `character-${face.id}`,
            name: typeof characterName === "string" && characterName.trim() && !characters.length ? characterName.trim() : `角色${index}`,
            faceBox: face,
        };
        setCharacters((current) => [...current, character]);
        setActiveCharacterId(character.id);
        setStatus("editing");
        setError("");
    };

    const beginManualSelection = () => {
        setStatus("manual");
        setManualDraft(null);
        setError("");
    };

    const confirmGeneration = async () => {
        const character = characters.find((item) => item.id === activeCharacterId);
        if (!character || !imageSize.width || !imageSize.height) return;
        setStatus("generating");
        setError("");
        try {
            const artifacts = await buildEmotionImageArtifacts(dataUrl, character.faceBox, imageSize.width, imageSize.height);
            const params = {
                presetId: preset.id,
                intimacy: preset.intimacy,
                arousal: preset.arousal,
                characterName: character.name,
                faceBox: character.faceBox,
            };
            const accepted = await onConfirm({
                ...params,
                label: preset.label,
                prompt: buildEmotionPrompt(params, artifacts.editRegion),
                sourceDataUrl: artifacts.sourceDataUrl,
                maskDataUrl: artifacts.maskDataUrl,
                characterDataUrl: artifacts.characterDataUrl,
                editRegion: artifacts.editRegion,
                imageWidth: artifacts.imageWidth,
                imageHeight: artifacts.imageHeight,
            });
            if (!accepted) setStatus("editing");
        } catch (reason) {
            setStatus("editing");
            setError(reason instanceof Error ? reason.message : "生成前处理失败");
        }
    };

    if (!portalTarget || !dataUrl) return null;
    const activeCharacter = characters.find((character) => character.id === activeCharacterId);

    return createPortal(
        <>
            <FaceSelectionOverlay
                node={node}
                viewport={viewport}
                containerRef={containerRef}
                imageWidth={imageSize.width}
                imageHeight={imageSize.height}
                faces={faces}
                characters={characters}
                activeCharacterId={activeCharacterId}
                status={status}
                manualDraft={manualDraft}
                onManualDraftChange={setManualDraft}
                onManualComplete={(face) => {
                    setFaces((current) => [...current, face]);
                    selectFace(face);
                    setManualDraft(null);
                }}
                onFaceSelect={selectFace}
            />
            <SelectionToolbar node={node} viewport={viewport} containerRef={containerRef} status={status} faceCount={faces.length} error={error} onManualSelect={beginManualSelection} onClose={onClose} />
            {activeCharacter && (status === "editing" || status === "generating") ? (
                <EmotionPanelOverlay node={node} viewport={viewport} containerRef={containerRef}>
                    <CanvasNodeEmotionPanel
                        dataUrl={dataUrl}
                        imageWidth={imageSize.width}
                        imageHeight={imageSize.height}
                        characters={characters}
                        activeCharacterId={activeCharacterId}
                        preset={preset}
                        generating={status === "generating"}
                        error={error}
                        onSelectCharacter={(id) => {
                            setActiveCharacterId(id);
                            setError("");
                        }}
                        onManualSelect={beginManualSelection}
                        onPresetChange={setPreset}
                        onClose={onClose}
                        onConfirm={() => void confirmGeneration()}
                    />
                </EmotionPanelOverlay>
            ) : null}
        </>,
        portalTarget,
    );
}

type FaceSelectionOverlayProps = {
    node: CanvasNodeData;
    viewport: ViewportTransform;
    containerRef: RefObject<HTMLDivElement | null>;
    imageWidth: number;
    imageHeight: number;
    faces: CanvasFaceBox[];
    characters: CanvasEmotionCharacter[];
    activeCharacterId: string;
    status: WorkspaceStatus;
    manualDraft: CanvasFaceBox | null;
    onManualDraftChange: (box: CanvasFaceBox | null) => void;
    onManualComplete: (box: CanvasFaceBox) => void;
    onFaceSelect: (box: CanvasFaceBox) => void;
};

function FaceSelectionOverlay({ node, viewport, containerRef, imageWidth, imageHeight, faces, characters, activeCharacterId, status, manualDraft, onManualDraftChange, onManualComplete, onFaceSelect }: FaceSelectionOverlayProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const overlayRef = useRef<HTMLDivElement>(null);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    useScreenAnchor(overlayRef, viewport, containerRef, () => imageScreenRect(node, viewport, imageWidth, imageHeight));

    if (!imageWidth || !imageHeight) return null;
    const interactive = status !== "detecting" && status !== "generating";
    const selectedCharacter = (face: CanvasFaceBox) => characters.find((character) => sameFace(character.faceBox, face));
    const pointerPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        return {
            x: clamp(((event.clientX - bounds.left) / Math.max(1, bounds.width)) * imageWidth, 0, imageWidth),
            y: clamp(((event.clientY - bounds.top) / Math.max(1, bounds.height)) * imageHeight, 0, imageHeight),
        };
    };
    const maskId = `emotion-face-mask-${node.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

    return (
        <div
            ref={overlayRef}
            data-canvas-no-zoom
            className={`absolute z-[105] overflow-hidden rounded-3xl ${status === "manual" ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
            style={{ left: 0, top: 0, width: node.width * viewport.k, height: node.height * viewport.k }}
            onPointerDown={
                status === "manual"
                    ? (event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture(event.pointerId);
                          const start = pointerPosition(event);
                          dragStartRef.current = start;
                          onManualDraftChange({ id: `manual-${Date.now()}`, x: start.x, y: start.y, width: 0, height: 0, source: "manual" });
                      }
                    : undefined
            }
            onPointerMove={
                status === "manual"
                    ? (event) => {
                          const start = dragStartRef.current;
                          if (!start) return;
                          const current = pointerPosition(event);
                          onManualDraftChange({
                              id: manualDraft?.id || `manual-${Date.now()}`,
                              x: Math.min(start.x, current.x),
                              y: Math.min(start.y, current.y),
                              width: Math.abs(current.x - start.x),
                              height: Math.abs(current.y - start.y),
                              source: "manual",
                          });
                      }
                    : undefined
            }
            onPointerUp={
                status === "manual"
                    ? (event) => {
                          const start = dragStartRef.current;
                          dragStartRef.current = null;
                          if (!start) return;
                          const current = pointerPosition(event);
                          const box: CanvasFaceBox = {
                              id: manualDraft?.id || `manual-${Date.now()}`,
                              x: Math.min(start.x, current.x),
                              y: Math.min(start.y, current.y),
                              width: Math.abs(current.x - start.x),
                              height: Math.abs(current.y - start.y),
                              source: "manual",
                          };
                          if (box.width >= Math.max(18, imageWidth * 0.025) && box.height >= Math.max(18, imageHeight * 0.025)) onManualComplete(box);
                          else onManualDraftChange(null);
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                    : undefined
            }
            onPointerCancel={
                status === "manual"
                    ? () => {
                          dragStartRef.current = null;
                          onManualDraftChange(null);
                      }
                    : undefined
            }
        >
            <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${imageWidth} ${imageHeight}`} preserveAspectRatio="none">
                <defs>
                    <mask id={maskId}>
                        <rect width={imageWidth} height={imageHeight} fill="white" />
                        {faces.map((face) => (
                            <rect key={face.id} x={face.x} y={face.y} width={face.width} height={face.height} rx={Math.min(face.width, face.height) * 0.16} fill="black" />
                        ))}
                        {manualDraft ? <rect x={manualDraft.x} y={manualDraft.y} width={manualDraft.width} height={manualDraft.height} rx={Math.min(manualDraft.width, manualDraft.height) * 0.12} fill="black" /> : null}
                    </mask>
                </defs>
                <rect width={imageWidth} height={imageHeight} fill="rgba(0,0,0,.36)" mask={`url(#${maskId})`} />
            </svg>

            {faces.map((face) => {
                const selected = selectedCharacter(face);
                const active = selected?.id === activeCharacterId;
                return (
                    <button
                        key={face.id}
                        type="button"
                        aria-label={selected ? `选择${selected.name}` : "选择此人脸"}
                        className={`absolute rounded-lg border-2 transition-colors ${interactive ? "pointer-events-auto" : "pointer-events-none"}`}
                        style={{
                            left: `${(face.x / imageWidth) * 100}%`,
                            top: `${(face.y / imageHeight) * 100}%`,
                            width: `${(face.width / imageWidth) * 100}%`,
                            height: `${(face.height / imageHeight) * 100}%`,
                            borderColor: active ? theme.node.activeStroke : "rgba(255,255,255,.94)",
                            boxShadow: "0 2px 8px rgba(0,0,0,.22)",
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onFaceSelect(face);
                        }}
                    >
                        {selected ? (
                            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[8px] font-semibold" style={{ background: theme.toolbar.panel, color: theme.node.text }}>
                                {selected.name}
                            </span>
                        ) : null}
                    </button>
                );
            })}
            {manualDraft ? (
                <div
                    className="pointer-events-none absolute rounded-lg border-2 border-dashed border-white"
                    style={{
                        left: `${(manualDraft.x / imageWidth) * 100}%`,
                        top: `${(manualDraft.y / imageHeight) * 100}%`,
                        width: `${(manualDraft.width / imageWidth) * 100}%`,
                        height: `${(manualDraft.height / imageHeight) * 100}%`,
                    }}
                />
            ) : null}
        </div>
    );
}

function SelectionToolbar({
    node,
    viewport,
    containerRef,
    status,
    faceCount,
    error,
    onManualSelect,
    onClose,
}: {
    node: CanvasNodeData;
    viewport: ViewportTransform;
    containerRef: RefObject<HTMLDivElement | null>;
    status: WorkspaceStatus;
    faceCount: number;
    error: string;
    onManualSelect: () => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const toolbarRef = useRef<HTMLDivElement>(null);
    useScreenAnchor(toolbarRef, viewport, containerRef, () => toolbarScreenRect(node, viewport, containerRef.current, toolbarRef.current));
    if (status === "editing" || status === "generating") return null;
    const label = status === "detecting" ? "正在识别人脸" : status === "manual" ? "拖动框选需要调节的人脸" : status === "selecting" ? `识别到 ${faceCount} 张人脸，请选择人物` : error || "请选择人物";

    return (
        <div
            ref={toolbarRef}
            data-canvas-no-zoom
            className="absolute z-[125] flex min-h-11 w-[420px] max-w-[calc(100%_-_24px)] items-center rounded-xl border px-2 shadow-[0_10px_28px_rgba(15,23,42,.14)]"
            style={{ left: 12, top: 76, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <button type="button" aria-label="关闭情绪调节" className="grid size-8 shrink-0 place-items-center rounded-lg" onClick={onClose}>
                <X className="size-4" />
            </button>
            <span className="mx-1.5 h-5 w-px" style={{ background: theme.toolbar.border }} />
            <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.node.fill }}>
                {status === "detecting" ? <LoaderCircle className="size-4 animate-spin" /> : <ScanFace className="size-4" />}
            </span>
            <span className="min-w-0 flex-1 truncate px-2 text-[11px] font-medium">{label}</span>
            {status !== "detecting" ? (
                <button type="button" className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium" style={{ borderColor: theme.toolbar.border }} onClick={onManualSelect}>
                    <SquareDashedMousePointer className="size-3.5" />
                    手动框选
                </button>
            ) : null}
        </div>
    );
}

function EmotionPanelOverlay({ node, viewport, containerRef, children }: { node: CanvasNodeData; viewport: ViewportTransform; containerRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
    const panelRef = useRef<HTMLDivElement>(null);
    useScreenAnchor(panelRef, viewport, containerRef, () => panelScreenRect(node, viewport, containerRef.current, panelRef.current));
    return (
        <div
            ref={panelRef}
            data-canvas-no-zoom
            className="absolute z-[120] w-[580px] max-w-[calc(100%_-_24px)]"
            style={{ left: 12, top: 76 }}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
        >
            {children}
        </div>
    );
}

function useScreenAnchor(ref: RefObject<HTMLElement | null>, viewport: ViewportTransform, containerRef: RefObject<HTMLDivElement | null>, resolve: () => { left: number; top: number; width?: number; height?: number }) {
    const resolveRef = useRef(resolve);
    resolveRef.current = resolve;
    useLayoutEffect(() => {
        const element = ref.current;
        const container = containerRef.current;
        if (!element || !container) return;
        const update = () => {
            const rect = resolveRef.current();
            element.style.left = `${rect.left}px`;
            element.style.top = `${rect.top}px`;
            if (typeof rect.width === "number") element.style.width = `${rect.width}px`;
            if (typeof rect.height === "number") element.style.height = `${rect.height}px`;
        };
        update();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
        observer?.observe(container);
        observer?.observe(element);
        window.addEventListener("resize", update);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", update);
        };
    }, [containerRef, ref, resolve, viewport.k, viewport.x, viewport.y]);
}

function imageScreenRect(node: CanvasNodeData, viewport: ViewportTransform, imageWidth: number, imageHeight: number) {
    const nodeWidth = node.width * viewport.k;
    const nodeHeight = node.height * viewport.k;
    const nodeLeft = viewport.x + node.position.x * viewport.k;
    const nodeTop = viewport.y + node.position.y * viewport.k;
    if (node.metadata?.freeResize || !imageWidth || !imageHeight) return { left: nodeLeft, top: nodeTop, width: nodeWidth, height: nodeHeight };
    const scale = Math.min(nodeWidth / imageWidth, nodeHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return { left: nodeLeft + (nodeWidth - width) / 2, top: nodeTop + (nodeHeight - height) / 2, width, height };
}

function toolbarScreenRect(node: CanvasNodeData, viewport: ViewportTransform, container: HTMLDivElement | null, element: HTMLElement | null) {
    if (!container) return { left: 12, top: 76 };
    const width = Math.min(element?.offsetWidth || 420, Math.max(0, container.clientWidth - 24));
    const height = element?.offsetHeight || 44;
    const nodeRect = imageScreenRect(node, viewport, node.metadata?.naturalWidth || node.width, node.metadata?.naturalHeight || node.height);
    const left = clamp(nodeRect.left + nodeRect.width / 2 - width / 2, 12, Math.max(12, container.clientWidth - width - 12));
    const above = nodeRect.top - height - 10;
    const top = above >= 72 ? above : clamp(nodeRect.top + nodeRect.height + 10, 72, Math.max(72, container.clientHeight - height - 12));
    return { left, top };
}

function panelScreenRect(node: CanvasNodeData, viewport: ViewportTransform, container: HTMLDivElement | null, element: HTMLElement | null) {
    if (!container) return { left: 12, top: 76 };
    const width = Math.min(element?.offsetWidth || 580, Math.max(0, container.clientWidth - 24));
    const height = Math.min(element?.offsetHeight || 303, Math.max(0, container.clientHeight - 84));
    const nodeRect = imageScreenRect(node, viewport, node.metadata?.naturalWidth || node.width, node.metadata?.naturalHeight || node.height);
    const left = clamp(nodeRect.left + nodeRect.width / 2 - width / 2, 12, Math.max(12, container.clientWidth - width - 12));
    const below = nodeRect.top + nodeRect.height + 10;
    const above = nodeRect.top - height - 10;
    const top = below + height <= container.clientHeight - 12 ? below : above;
    return { left, top: clamp(top, 72, Math.max(72, container.clientHeight - height - 12)) };
}

function sameFace(left: CanvasFaceBox, right: CanvasFaceBox) {
    return left.id === right.id || (Math.abs(left.x - right.x) < 1 && Math.abs(left.y - right.y) < 1 && Math.abs(left.width - right.width) < 1 && Math.abs(left.height - right.height) < 1);
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}
