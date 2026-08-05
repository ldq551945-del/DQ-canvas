export const LOCK_BADGE_MIN_SCREEN_SIZE = 24;
export const LOCK_BADGE_MAX_SCREEN_SIZE = 36;

const MIN_SCALE = 0.01;

export type CanvasNodeLockBadgeMetrics = {
    safeScale: number;
    screenShortEdge: number;
    badgeSize: number;
    iconSize: number;
    inset: number;
};

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function finiteSize(value: number) {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function roundScreenPixel(value: number) {
    return Math.round(value * 100) / 100;
}

export function resolveCanvasNodeLockBadgeMetrics(width: number, height: number, scale: number): CanvasNodeLockBadgeMetrics {
    const safeScale = Number.isFinite(scale) ? Math.max(scale, MIN_SCALE) : 1;
    const screenShortEdge = Math.min(finiteSize(width), finiteSize(height)) * safeScale;

    // Preserve a readable 24-36px badge whenever the node has room. At extreme
    // zoom-out, the node boundary wins so the badge never spills outside it.
    const inset = roundScreenPixel(Math.min(clamp(screenShortEdge * 0.04, 3, 8), screenShortEdge * 0.15));
    const desiredSize = clamp(screenShortEdge * 0.18, LOCK_BADGE_MIN_SCREEN_SIZE, LOCK_BADGE_MAX_SCREEN_SIZE);
    const availableSize = Math.max(0, Math.min(screenShortEdge - inset * 2, screenShortEdge * 0.45));
    const badgeSize = Math.min(roundScreenPixel(Math.min(desiredSize, availableSize)), availableSize);

    return {
        safeScale,
        screenShortEdge,
        badgeSize,
        iconSize: roundScreenPixel(badgeSize * 0.56),
        inset,
    };
}
