import { describe, expect, it } from "vitest";

import { DEFAULT_BACKGROUND_REMOVAL_OPTIONS, normalizeBackgroundRemovalOptions } from "@/lib/background-removal-options";
import { CanvasNodeType, type CanvasBackgroundRemovalTask, type CanvasNodeData } from "../types";
import { backgroundRemovalTaskSourceMatches, findReusableBackgroundRemovalNode, hashBackgroundRemovalOptions } from "./canvas-background-removal";

const DEFAULT_OPTIONS_HASH = "f2a20225a31ad391b22a91009b361c8e4ffdb396218691ca9ca4f69865162309";

function resultNode(options = DEFAULT_BACKGROUND_REMOVAL_OPTIONS, optionsHash = DEFAULT_OPTIONS_HASH): CanvasNodeData {
    return {
        id: "result",
        type: CanvasNodeType.Image,
        title: "抠图结果",
        position: { x: 0, y: 0 },
        width: 320,
        height: 320,
        metadata: {
            content: "/api/reference-assets/result.png",
            storageKey: "image:result",
            derivedOperation: "remove-background",
            sourceNodeId: "source",
            sourceStorageKey: "image:source",
            backgroundRemovalOptions: options,
            backgroundRemovalOptionsHash: optionsHash,
        },
    };
}

describe("canvas background removal result reuse", () => {
    it("uses the same SHA-256 representation as the server", async () => {
        await expect(hashBackgroundRemovalOptions(DEFAULT_BACKGROUND_REMOVAL_OPTIONS)).resolves.toBe(DEFAULT_OPTIONS_HASH);
    });

    it("hashes only parameters that affect the selected output", async () => {
        await expect(hashBackgroundRemovalOptions({ ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, backgroundColor: [1, 2, 3, 4] })).resolves.toBe(DEFAULT_OPTIONS_HASH);

        const mask = { ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, outputMode: "mask" as const };
        await expect(
            hashBackgroundRemovalOptions({
                ...mask,
                alphaMatting: true,
                foregroundThreshold: 200,
                backgroundThreshold: 50,
                refineRange: 80,
            }),
        ).resolves.toBe(await hashBackgroundRemovalOptions(mask));
        await expect(hashBackgroundRemovalOptions({ ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, model: "u2net" })).resolves.not.toBe(DEFAULT_OPTIONS_HASH);
    });

    it("reuses only an exact source and execution-parameter match", () => {
        const node = resultNode();
        expect(
            findReusableBackgroundRemovalNode([node], {
                sourceNodeId: "source",
                sourceStorageKey: "image:source",
                options: DEFAULT_BACKGROUND_REMOVAL_OPTIONS,
                optionsHash: DEFAULT_OPTIONS_HASH,
            }),
        ).toBe(node);

        const hair = normalizeBackgroundRemovalOptions({ version: 1, preset: "hair" });
        expect(findReusableBackgroundRemovalNode([node], { sourceNodeId: "source", sourceStorageKey: "image:source", options: hair, optionsHash: DEFAULT_OPTIONS_HASH })).toBeNull();
        expect(findReusableBackgroundRemovalNode([node], { sourceNodeId: "other", sourceStorageKey: "image:source", options: DEFAULT_BACKGROUND_REMOVAL_OPTIONS, optionsHash: DEFAULT_OPTIONS_HASH })).toBeNull();
    });

    it("does not trust legacy or inconsistent result metadata", () => {
        expect(
            findReusableBackgroundRemovalNode([resultNode(DEFAULT_BACKGROUND_REMOVAL_OPTIONS, "")], { sourceNodeId: "source", sourceStorageKey: "image:source", options: DEFAULT_BACKGROUND_REMOVAL_OPTIONS, optionsHash: DEFAULT_OPTIONS_HASH }),
        ).toBeNull();
        expect(findReusableBackgroundRemovalNode([resultNode()], { sourceNodeId: "source", sourceStorageKey: "image:source", options: DEFAULT_BACKGROUND_REMOVAL_OPTIONS, optionsHash: "" })).toBeNull();
    });

    it("only resumes a task while its original source snapshot is current", () => {
        const source: CanvasNodeData = {
            id: "source",
            type: CanvasNodeType.Image,
            title: "来源图",
            position: { x: 0, y: 0 },
            width: 320,
            height: 320,
            metadata: { content: "/api/reference-assets/source.png", storageKey: "image:source", naturalWidth: 1200, naturalHeight: 800, bytes: 2400 },
        };
        const task: CanvasBackgroundRemovalTask = {
            id: "task-one",
            sourceNodeId: source.id,
            sourceStorageKey: "image:source",
            sourceContent: "/api/reference-assets/source.png",
            sourceNaturalWidth: 1200,
            sourceNaturalHeight: 800,
            sourceBytes: 2400,
            options: DEFAULT_BACKGROUND_REMOVAL_OPTIONS,
            optionsHash: DEFAULT_OPTIONS_HASH,
        };

        expect(backgroundRemovalTaskSourceMatches(source, task)).toBe(true);
        expect(backgroundRemovalTaskSourceMatches({ ...source, metadata: { ...source.metadata, storageKey: "image:replacement" } }, task)).toBe(false);
    });
});
