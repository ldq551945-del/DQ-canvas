import type { CanvasMediaPerformanceMode, CanvasNodeData } from "../types";

export const CANVAS_PERFORMANCE_STORAGE_KEY = "canvas-media-performance-mode";

export function shouldReduceCanvasEffects(mode: CanvasMediaPerformanceMode, nodes: CanvasNodeData[]) {
    if (mode === "performance") return true;
    if (mode === "quality") return false;
    const mediaCount = nodes.filter((node) => ["image", "panorama", "video", "audio"].includes(node.type)).length;
    return nodes.length >= 80 || mediaCount >= 32;
}

export function normalizeCanvasPerformanceMode(value: unknown): CanvasMediaPerformanceMode {
    return value === "quality" || value === "performance" ? value : "auto";
}
