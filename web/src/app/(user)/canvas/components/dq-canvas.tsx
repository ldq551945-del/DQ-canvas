"use client";

import React, { useEffect, useRef, useState } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "../types";

type DQCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
};

export function DQCanvas({ containerRef, viewport, backgroundMode = "lines", onViewportChange, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick, onContextMenu, onDrop, children }: DQCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const viewportRef = useRef(viewport);
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
    });
    const touchPointersRef = useRef(new Map<number, { clientX: number; clientY: number }>());
    const pinchStateRef = useRef<{
        active: boolean;
        startDistance: number;
        startScale: number;
        worldX: number;
        worldY: number;
    }>({ active: false, startDistance: 0, startScale: viewport.k, worldX: 0, worldY: 0 });
    const scaleRef = useRef(viewport.k);
    const frameRef = useRef<number | null>(null);
    const nextViewportRef = useRef<ViewportTransform | null>(null);
    const [isSpacePressed, setIsSpacePressed] = useState(false);

    useEffect(() => {
        viewportRef.current = viewport;
        scaleRef.current = viewport.k;
    }, [viewport]);

    useEffect(
        () => () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        },
        [],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") setIsSpacePressed(false);
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown")) return;

        const delta = -event.deltaY;
        const factor = Math.pow(1.1, delta / 100);
        const newScale = Math.min(Math.max(viewport.k * factor, 0.05), 5);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldX = (mouseX - viewport.x) / viewport.k;
        const worldY = (mouseY - viewport.y) / viewport.k;

        onViewportChange({
            x: mouseX - worldX * newScale,
            y: mouseY - worldY * newScale,
            k: newScale,
        });
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],[data-node-id],[data-connection-id],[data-connection-create-menu],[data-canvas-node-create-menu]")) return;
        onCanvasDoubleClick?.(event);
    };

    const updateTouchPointer = (event: Pick<PointerEvent | React.PointerEvent, "pointerId" | "clientX" | "clientY">) => {
        if (!touchPointersRef.current.has(event.pointerId)) return;
        touchPointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    };

    const readTouchPair = () => Array.from(touchPointersRef.current.values()).slice(0, 2);

    const startPinchZoom = () => {
        const [first, second] = readTouchPair();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!first || !second || !rect) return;
        const midpoint = midpointOf(first, second);
        const localX = midpoint.clientX - rect.left;
        const localY = midpoint.clientY - rect.top;
        const current = viewportRef.current;
        pinchStateRef.current = {
            active: true,
            startDistance: distanceBetween(first, second),
            startScale: current.k,
            worldX: (localX - current.x) / current.k,
            worldY: (localY - current.y) / current.k,
        };
        panState.current.isPanning = false;
        document.body.style.cursor = "default";
    };

    const updatePinchZoom = (event: PointerEvent) => {
        updateTouchPointer(event);
        if (!pinchStateRef.current.active || touchPointersRef.current.size < 2) return false;
        const [first, second] = readTouchPair();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!first || !second || !rect) return false;
        event.preventDefault();
        const midpoint = midpointOf(first, second);
        const distance = Math.max(1, distanceBetween(first, second));
        const startDistance = Math.max(1, pinchStateRef.current.startDistance);
        const newScale = Math.min(Math.max(pinchStateRef.current.startScale * (distance / startDistance), 0.05), 5);
        const localX = midpoint.clientX - rect.left;
        const localY = midpoint.clientY - rect.top;
        const next = {
            x: localX - pinchStateRef.current.worldX * newScale,
            y: localY - pinchStateRef.current.worldY * newScale,
            k: newScale,
        };
        scaleRef.current = newScale;
        viewportRef.current = next;
        onViewportChange(next);
        return true;
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom]")) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");

        if (event.pointerType === "touch") {
            event.currentTarget.setPointerCapture(event.pointerId);
            touchPointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
            if (touchPointersRef.current.size >= 2) {
                event.preventDefault();
                startPinchZoom();
                return;
            }
        }

        if (event.button === 0 && (event.ctrlKey || event.metaKey) && isBackgroundClick) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
            return;
        }

        if (event.button === 1 || (event.button === 0 && !isSpacePressed && isBackgroundClick)) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: viewport.x,
                initialY: viewport.y,
                hasMoved: false,
            };
            document.body.style.cursor = "grabbing";
            return;
        }

        if (event.button === 0 && isSpacePressed && isBackgroundClick) {
            event.preventDefault();
        }
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (event.pointerType === "touch" && updatePinchZoom(event)) return;
            if (!panState.current.isPanning) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            nextViewportRef.current = {
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: scaleRef.current,
            };
            if (frameRef.current) return;
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;
                if (nextViewportRef.current) onViewportChange(nextViewportRef.current);
            });
        };

        const handlePointerUp = (event: PointerEvent) => {
            if (event.pointerType === "touch") {
                touchPointersRef.current.delete(event.pointerId);
                if (touchPointersRef.current.size < 2) pinchStateRef.current.active = false;
            }
            if (!panState.current.isPanning) return;

            if (!panState.current.hasMoved) {
                onCanvasDeselect?.();
            }
            panState.current.isPanning = false;
            document.body.style.cursor = "default";
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
        };
    }, [onCanvasDeselect, onViewportChange]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const preventWheelScroll = (event: WheelEvent) => event.preventDefault();
        container.addEventListener("wheel", preventWheelScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventWheelScroll);
    }, [containerRef]);

    return (
        <div
            ref={containerRef}
            className="canvas-surface relative h-full w-full cursor-grab select-none overflow-hidden"
            style={{ background: theme.canvas.backdrop, touchAction: "none", overscrollBehavior: "none" }}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            onContextMenu={onContextMenu}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            <CanvasGrid viewport={viewport} mode={backgroundMode} />
            <div
                className="absolute origin-top-left"
                style={{
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
                }}
            >
                {children}
            </div>
        </div>
    );
}

function distanceBetween(first: { clientX: number; clientY: number }, second: { clientX: number; clientY: number }) {
    return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function midpointOf(first: { clientX: number; clientY: number }, second: { clientX: number; clientY: number }) {
    return { clientX: (first.clientX + second.clientX) / 2, clientY: (first.clientY + second.clientY) / 2 };
}

function CanvasGrid({ viewport, mode }: { viewport: ViewportTransform; mode: CanvasBackgroundMode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (mode === "blank") return null;

    const gridSize = 48 * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
    const backgroundImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;

    return (
        <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
                backgroundImage,
                backgroundSize: `${gridSize}px ${gridSize}px`,
                backgroundPosition: `${x}px ${y}px`,
            }}
        />
    );
}
