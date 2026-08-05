import { describe, expect, it } from "vitest";

import { DEFAULT_BACKGROUND_REMOVAL_OPTIONS } from "@/lib/background-removal-options";
import { CanvasNodeType, type CanvasNodeData } from "../types";
import { applyBackgroundRefineStroke, backgroundRefineInputError, canRefineBackgroundNode, composeBackgroundRefinePixels, findBackgroundRefineOriginalNode, mergeBackgroundRefineRects, readAlphaRect, writeAlphaRect } from "./canvas-background-refine";

function imageNode(derivedOperation?: "remove-background" | "refine-background"): CanvasNodeData {
    return {
        id: "image-one",
        type: CanvasNodeType.Image,
        title: "图片",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { content: "data:image/png;base64,AA==", derivedOperation, sourceNodeId: derivedOperation ? "source" : undefined, backgroundRemovalOptions: derivedOperation ? { ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS } : undefined },
    };
}

describe("canvas background refinement", () => {
    it("only enables refinement for background-removal derived images", () => {
        expect(canRefineBackgroundNode(imageNode("remove-background"))).toBe(true);
        expect(canRefineBackgroundNode(imageNode("refine-background"))).toBe(true);
        const maskNode = imageNode("remove-background");
        maskNode.metadata = { ...maskNode.metadata, backgroundRemovalOptions: { ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, outputMode: "mask" } };
        expect(canRefineBackgroundNode(maskNode)).toBe(false);
        const colorNode = imageNode("remove-background");
        colorNode.metadata = { ...colorNode.metadata, backgroundRemovalOptions: { ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, outputMode: "color" } };
        expect(canRefineBackgroundNode(colorNode)).toBe(false);
        expect(canRefineBackgroundNode(imageNode())).toBe(false);
        expect(canRefineBackgroundNode({ ...imageNode("remove-background"), metadata: { ...imageNode("remove-background").metadata, sourceNodeId: undefined } })).toBe(false);
        expect(canRefineBackgroundNode({ ...imageNode("remove-background"), metadata: { ...imageNode("remove-background").metadata, backgroundRemovalOptions: undefined } })).toBe(false);
        expect(canRefineBackgroundNode({ ...imageNode("remove-background"), type: CanvasNodeType.Panorama })).toBe(false);
    });

    it("follows repeated refinement nodes back to the original source image", () => {
        const original = { ...imageNode(), id: "original" };
        const cutout = { ...imageNode("remove-background"), id: "cutout", metadata: { ...imageNode("remove-background").metadata, sourceNodeId: original.id } };
        const refined = { ...imageNode("refine-background"), id: "refined", metadata: { ...imageNode("refine-background").metadata, sourceNodeId: cutout.id } };
        const refinedAgain = { ...imageNode("refine-background"), id: "refined-again", metadata: { ...imageNode("refine-background").metadata, sourceNodeId: refined.id } };
        expect(findBackgroundRefineOriginalNode([original, cutout, refined, refinedAgain], refinedAgain)?.id).toBe(original.id);
        expect(findBackgroundRefineOriginalNode([cutout, refined], refined)).toBeNull();
    });

    it("rejects oversized compressed and decoded images with explicit errors", () => {
        expect(backgroundRefineInputError({ bytes: 30 * 1024 * 1024, width: 4000, height: 3000 })).toBe("");
        expect(backgroundRefineInputError({ bytes: 30 * 1024 * 1024 + 1, width: 10, height: 10 })).toContain("30MB");
        expect(backgroundRefineInputError({ width: 4001, height: 3000 })).toContain("1200 万像素");
    });

    it("erases alpha and restores no further than the original alpha mask", () => {
        const baselineAlpha = new Uint8ClampedArray(25).fill(180);
        const alpha = baselineAlpha.slice();
        const stroke = { alpha, baselineAlpha, width: 5, height: 5, from: { x: 2.5, y: 2.5 }, to: { x: 2.5, y: 2.5 }, brushSize: 1, softness: 0 } as const;
        expect(applyBackgroundRefineStroke({ ...stroke, mode: "erase" })).toEqual({ x: 2, y: 2, width: 1, height: 1 });
        expect(alpha[12]).toBe(0);
        expect(applyBackgroundRefineStroke({ ...stroke, mode: "restore" })).toEqual({ x: 2, y: 2, width: 1, height: 1 });
        expect(alpha[12]).toBe(180);

        alpha[12] = 250;
        applyBackgroundRefineStroke({ ...stroke, mode: "restore" });
        expect(alpha[12]).toBe(180);
    });

    it("restores pixels that were transparent in the initial cutout from the original-image alpha", () => {
        const originalAlpha = new Uint8ClampedArray(9).fill(255);
        const cutoutAlpha = new Uint8ClampedArray(9);
        applyBackgroundRefineStroke({
            alpha: cutoutAlpha,
            baselineAlpha: originalAlpha,
            width: 3,
            height: 3,
            from: { x: 1.5, y: 1.5 },
            to: { x: 1.5, y: 1.5 },
            brushSize: 1,
            softness: 0,
            mode: "restore",
        });
        expect(cutoutAlpha[4]).toBe(255);
        expect(cutoutAlpha.filter(Boolean)).toHaveLength(1);
        const originalPixels = new Uint8ClampedArray([12, 34, 56, 255, 80, 90, 100, 255]);
        expect(Array.from(composeBackgroundRefinePixels(originalPixels, new Uint8ClampedArray([0, 220]), 2, { x: 0, y: 0, width: 2, height: 1 }))).toEqual([12, 34, 56, 0, 80, 90, 100, 220]);
    });

    it("supports continuous soft strokes and bounded alpha history patches", () => {
        const baselineAlpha = new Uint8ClampedArray(36).fill(255);
        const alpha = baselineAlpha.slice();
        const rect = applyBackgroundRefineStroke({
            alpha,
            baselineAlpha,
            width: 6,
            height: 6,
            from: { x: 1.5, y: 3.5 },
            to: { x: 4.5, y: 3.5 },
            brushSize: 4,
            softness: 100,
            mode: "erase",
        });
        expect(rect).not.toBeNull();
        expect(alpha[3 * 6 + 3]).toBe(0);
        expect(alpha[2 * 6 + 3]).toBeGreaterThan(0);
        expect(alpha[2 * 6 + 3]).toBeLessThan(255);

        const merged = mergeBackgroundRefineRects({ x: 1, y: 2, width: 2, height: 3 }, { x: 0, y: 3, width: 5, height: 1 });
        expect(merged).toEqual({ x: 0, y: 2, width: 5, height: 3 });
        const patch = readAlphaRect(alpha, 6, { x: 1, y: 1, width: 3, height: 2 });
        const target = new Uint8ClampedArray(36);
        writeAlphaRect(target, 6, { x: 1, y: 1, width: 3, height: 2 }, patch);
        expect(readAlphaRect(target, 6, { x: 1, y: 1, width: 3, height: 2 })).toEqual(patch);
    });
});
