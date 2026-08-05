import { describe, expect, it } from "vitest";

import { LOCK_BADGE_MAX_SCREEN_SIZE, LOCK_BADGE_MIN_SCREEN_SIZE, resolveCanvasNodeLockBadgeMetrics } from "./canvas-node-lock-badge";

describe("resolveCanvasNodeLockBadgeMetrics", () => {
    it("keeps a readable minimum size once the node has enough screen space", () => {
        const metrics = resolveCanvasNodeLockBadgeMetrics(320, 320, 0.2);

        expect(metrics.screenShortEdge).toBe(64);
        expect(metrics.badgeSize).toBe(LOCK_BADGE_MIN_SCREEN_SIZE);
    });

    it("caps the badge for large nodes and high zoom", () => {
        const metrics = resolveCanvasNodeLockBadgeMetrics(640, 400, 5);

        expect(metrics.badgeSize).toBe(LOCK_BADGE_MAX_SCREEN_SIZE);
        expect(metrics.iconSize).toBeCloseTo(20.16);
    });

    it("shrinks below the nominal minimum at extreme zoom to stay inside the node", () => {
        const metrics = resolveCanvasNodeLockBadgeMetrics(160, 160, 0.05);

        expect(metrics.screenShortEdge).toBe(8);
        expect(metrics.badgeSize).toBeCloseTo(3.6);
        expect(metrics.badgeSize + metrics.inset * 2).toBeLessThanOrEqual(metrics.screenShortEdge);
    });

    it("transitions exactly at the readable minimum and maximum thresholds", () => {
        const beforeMinimum = resolveCanvasNodeLockBadgeMetrics(53.32, 53.32, 1);
        const afterMinimum = resolveCanvasNodeLockBadgeMetrics(53.34, 53.34, 1);
        const beforeMaximum = resolveCanvasNodeLockBadgeMetrics(199.9, 199.9, 1);
        const atMaximum = resolveCanvasNodeLockBadgeMetrics(200, 200, 1);

        expect(beforeMinimum.badgeSize).toBeLessThan(LOCK_BADGE_MIN_SCREEN_SIZE);
        expect(afterMinimum.badgeSize).toBe(LOCK_BADGE_MIN_SCREEN_SIZE);
        expect(beforeMaximum.badgeSize).toBeLessThan(LOCK_BADGE_MAX_SCREEN_SIZE);
        expect(atMaximum.badgeSize).toBe(LOCK_BADGE_MAX_SCREEN_SIZE);
    });

    it("uses the short edge for extreme aspect ratios", () => {
        const wide = resolveCanvasNodeLockBadgeMetrics(10_000, 160, 0.05);
        const tall = resolveCanvasNodeLockBadgeMetrics(160, 10_000, 0.05);

        expect(wide).toEqual(tall);
        expect(wide.badgeSize + wide.inset * 2).toBeLessThanOrEqual(8);
    });

    it("depends on rendered screen size rather than world dimensions alone", () => {
        const first = resolveCanvasNodeLockBadgeMetrics(320, 320, 0.5);
        const second = resolveCanvasNodeLockBadgeMetrics(160, 160, 1);

        expect({ badgeSize: first.badgeSize, iconSize: first.iconSize, inset: first.inset, screenShortEdge: first.screenShortEdge }).toEqual({
            badgeSize: second.badgeSize,
            iconSize: second.iconSize,
            inset: second.inset,
            screenShortEdge: second.screenShortEdge,
        });
    });

    it.each([
        [160, 160, 0],
        [320, 180, 0.05],
        [320, 320, 0.2],
        [640, 360, 0.5],
        [640, 640, 1],
        [640, 640, 5],
        [Number.NaN, 320, 1],
        [320, 320, Number.NaN],
    ])("returns finite non-negative metrics that fit for %s x %s at %s scale", (width, height, scale) => {
        const metrics = resolveCanvasNodeLockBadgeMetrics(width, height, scale);

        expect(Object.values(metrics).every(Number.isFinite)).toBe(true);
        expect(metrics.badgeSize).toBeGreaterThanOrEqual(0);
        expect(metrics.inset).toBeGreaterThanOrEqual(0);
        expect(metrics.badgeSize).toBeLessThanOrEqual(LOCK_BADGE_MAX_SCREEN_SIZE);
        expect(metrics.badgeSize + metrics.inset * 2).toBeLessThanOrEqual(metrics.screenShortEdge + Number.EPSILON);
        expect(metrics.badgeSize).toBeLessThanOrEqual(metrics.screenShortEdge * 0.45 + Number.EPSILON);
    });
});
