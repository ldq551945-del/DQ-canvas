import type { CanvasMediaPerformanceMode, CanvasNodeData } from "../types";

export const CANVAS_PERFORMANCE_STORAGE_KEY = "canvas-media-performance-mode";

export type CanvasDevicePerformanceSignals = {
    hardwareConcurrency?: number;
    deviceMemory?: number;
    saveData?: boolean;
};

type CanvasWebGlProbe = { getContext: (contextId: "webgl2") => unknown };

export function shouldUseCanvasPerformanceFallback(signals: CanvasDevicePerformanceSignals) {
    return signals.saveData === true || (Number.isFinite(signals.deviceMemory) && Number(signals.deviceMemory) <= 4) || (Number.isFinite(signals.hardwareConcurrency) && Number(signals.hardwareConcurrency) <= 4);
}

export function detectCanvasLowPerformanceDevice() {
    if (typeof navigator === "undefined") return false;
    const navigatorWithSignals = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    return shouldUseCanvasPerformanceFallback({
        hardwareConcurrency: navigatorWithSignals.hardwareConcurrency,
        deviceMemory: navigatorWithSignals.deviceMemory,
        saveData: navigatorWithSignals.connection?.saveData,
    });
}

export function canvasWebGlAvailable(createCanvas?: () => CanvasWebGlProbe) {
    if (!createCanvas && typeof document === "undefined") return false;
    try {
        const canvas = createCanvas?.() || document.createElement("canvas");
        return Boolean(canvas.getContext("webgl2"));
    } catch {
        return false;
    }
}

export function shouldReduceCanvasEffects(mode: CanvasMediaPerformanceMode, nodes: CanvasNodeData[], lowPerformanceDevice = false) {
    if (mode === "performance") return true;
    if (mode === "quality") return false;
    if (lowPerformanceDevice) return true;
    const mediaCount = nodes.filter((node) => ["image", "panorama", "video", "audio"].includes(node.type)).length;
    return nodes.length >= 80 || mediaCount >= 32;
}

export function normalizeCanvasPerformanceMode(value: unknown): CanvasMediaPerformanceMode {
    return value === "quality" || value === "performance" ? value : "auto";
}
