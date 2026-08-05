import { CANVAS_IMAGE_UPLOAD_MAX_BYTES } from "@/lib/creative-upload";
import { backgroundRemovalOutputMode } from "@/lib/background-removal-options";
import { CanvasNodeType, type CanvasNodeData } from "../types";

export const BACKGROUND_REFINE_MAX_BYTES = CANVAS_IMAGE_UPLOAD_MAX_BYTES;
export const BACKGROUND_REFINE_MAX_PIXELS = 12_000_000;

export type BackgroundRefineMode = "erase" | "restore";
export type BackgroundRefinePoint = { x: number; y: number };
export type BackgroundRefineRect = { x: number; y: number; width: number; height: number };

export function canRefineBackgroundNode(node: CanvasNodeData | null | undefined) {
    return Boolean(
        node?.type === CanvasNodeType.Image &&
        node.metadata?.content &&
        node.metadata.sourceNodeId &&
        node.metadata.backgroundRemovalOptions &&
        (node.metadata.derivedOperation === "remove-background" || node.metadata.derivedOperation === "refine-background") &&
        backgroundRemovalOutputMode(node.metadata.backgroundRemovalOptions) === "transparent",
    );
}

export function findBackgroundRefineOriginalNode(nodes: CanvasNodeData[], node: CanvasNodeData | null | undefined) {
    if (!node || (node.metadata?.derivedOperation !== "remove-background" && node.metadata?.derivedOperation !== "refine-background")) return null;
    const nodeById = new Map(nodes.map((item) => [item.id, item]));
    const visited = new Set<string>();
    let current = node;
    while (current.metadata?.derivedOperation === "refine-background") {
        if (visited.has(current.id) || !current.metadata.sourceNodeId) return null;
        visited.add(current.id);
        const parent = nodeById.get(current.metadata.sourceNodeId);
        if (!parent) return null;
        current = parent;
    }
    if (current.metadata?.derivedOperation !== "remove-background" || !current.metadata.sourceNodeId) return null;
    return nodeById.get(current.metadata.sourceNodeId) || null;
}

export function backgroundRefineInputError(input: { bytes?: number; width: number; height: number }) {
    if (input.bytes && input.bytes > BACKGROUND_REFINE_MAX_BYTES) return "图片超过 30MB，无法在浏览器中细化边缘";
    const pixels = input.width * input.height;
    if (!Number.isSafeInteger(pixels) || pixels <= 0) return "图片尺寸无效，无法细化边缘";
    if (pixels > BACKGROUND_REFINE_MAX_PIXELS) return "图片超过 1200 万像素，浏览器细化会占用过多内存，请先缩小图片后重试";
    return "";
}

export function applyBackgroundRefineStroke({
    alpha,
    baselineAlpha,
    width,
    height,
    from,
    to,
    brushSize,
    softness,
    mode,
}: {
    alpha: Uint8ClampedArray;
    baselineAlpha: Uint8ClampedArray;
    width: number;
    height: number;
    from: BackgroundRefinePoint;
    to: BackgroundRefinePoint;
    brushSize: number;
    softness: number;
    mode: BackgroundRefineMode;
}): BackgroundRefineRect | null {
    const pixelCount = width * height;
    if (alpha.length !== pixelCount || baselineAlpha.length !== pixelCount || width <= 0 || height <= 0) return null;

    const radius = Math.max(0.5, brushSize / 2);
    const feather = clamp(softness, 0, 100) / 100;
    const hardRadius = radius * (1 - feather);
    const left = clamp(Math.floor(Math.min(from.x, to.x) - radius - 1), 0, width - 1);
    const top = clamp(Math.floor(Math.min(from.y, to.y) - radius - 1), 0, height - 1);
    const right = clamp(Math.ceil(Math.max(from.x, to.x) + radius + 1), 0, width - 1);
    const bottom = clamp(Math.ceil(Math.max(from.y, to.y) + radius + 1), 0, height - 1);
    let changedLeft = width;
    let changedTop = height;
    let changedRight = -1;
    let changedBottom = -1;

    for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
            const distance = distanceToSegment(x + 0.5, y + 0.5, from, to);
            if (distance > radius) continue;
            const weight = brushWeight(distance, radius, hardRadius);
            if (weight <= 0) continue;
            const index = y * width + x;
            const current = alpha[index];
            const baseline = baselineAlpha[index];
            const next = mode === "erase" ? Math.round(current * (1 - weight)) : Math.round(current + (baseline - current) * weight);
            if (next === current) continue;
            alpha[index] = next;
            changedLeft = Math.min(changedLeft, x);
            changedTop = Math.min(changedTop, y);
            changedRight = Math.max(changedRight, x);
            changedBottom = Math.max(changedBottom, y);
        }
    }

    if (changedRight < changedLeft || changedBottom < changedTop) return null;
    return { x: changedLeft, y: changedTop, width: changedRight - changedLeft + 1, height: changedBottom - changedTop + 1 };
}

export function mergeBackgroundRefineRects(left: BackgroundRefineRect | null, right: BackgroundRefineRect | null): BackgroundRefineRect | null {
    if (!left) return right;
    if (!right) return left;
    const x = Math.min(left.x, right.x);
    const y = Math.min(left.y, right.y);
    const rightEdge = Math.max(left.x + left.width, right.x + right.width);
    const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
    return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

export function readAlphaRect(alpha: Uint8ClampedArray, imageWidth: number, rect: BackgroundRefineRect) {
    const patch = new Uint8ClampedArray(rect.width * rect.height);
    for (let row = 0; row < rect.height; row += 1) {
        const sourceStart = (rect.y + row) * imageWidth + rect.x;
        patch.set(alpha.subarray(sourceStart, sourceStart + rect.width), row * rect.width);
    }
    return patch;
}

export function writeAlphaRect(alpha: Uint8ClampedArray, imageWidth: number, rect: BackgroundRefineRect, patch: Uint8ClampedArray) {
    if (patch.length !== rect.width * rect.height) return;
    for (let row = 0; row < rect.height; row += 1) {
        const targetStart = (rect.y + row) * imageWidth + rect.x;
        alpha.set(patch.subarray(row * rect.width, (row + 1) * rect.width), targetStart);
    }
}

export function composeBackgroundRefinePixels(sourcePixels: Uint8ClampedArray, alpha: Uint8ClampedArray, imageWidth: number, rect: BackgroundRefineRect) {
    const pixels = new Uint8ClampedArray(rect.width * rect.height * 4);
    for (let y = 0; y < rect.height; y += 1) {
        for (let x = 0; x < rect.width; x += 1) {
            const sourcePixel = (rect.y + y) * imageWidth + rect.x + x;
            const sourceIndex = sourcePixel * 4;
            const targetIndex = (y * rect.width + x) * 4;
            pixels[targetIndex] = sourcePixels[sourceIndex];
            pixels[targetIndex + 1] = sourcePixels[sourceIndex + 1];
            pixels[targetIndex + 2] = sourcePixels[sourceIndex + 2];
            pixels[targetIndex + 3] = alpha[sourcePixel];
        }
    }
    return pixels;
}

function brushWeight(distance: number, radius: number, hardRadius: number) {
    if (distance <= hardRadius || radius === hardRadius) return 1;
    const linear = clamp((radius - distance) / Math.max(0.001, radius - hardRadius), 0, 1);
    return linear * linear * (3 - 2 * linear);
}

function distanceToSegment(x: number, y: number, from: BackgroundRefinePoint, to: BackgroundRefinePoint) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(x - from.x, y - from.y);
    const progress = clamp(((x - from.x) * dx + (y - from.y) * dy) / lengthSquared, 0, 1);
    return Math.hypot(x - (from.x + progress * dx), y - (from.y + progress * dy));
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
