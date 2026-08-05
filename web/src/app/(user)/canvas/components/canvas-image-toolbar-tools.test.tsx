import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DEFAULT_BACKGROUND_REMOVAL_OPTIONS } from "@/lib/background-removal-options";
import type { CanvasNodeData } from "../types";
import { BackgroundRemovalIcon, MAX_IMAGE_QUICK_TOOLS, buildImageToolbarTools, defaultImageQuickToolIds, readImageQuickToolsConfig } from "./canvas-image-toolbar-tools";

describe("canvas image quick tools", () => {
    it("uses a dashed selection and pencil icon for background removal", () => {
        const markup = renderToStaticMarkup(<BackgroundRemovalIcon />);

        expect(markup).toContain("lucide-circle-dashed");
        expect(markup).toContain("lucide-pencil");
        expect(markup).toContain("size-4 shrink-0");
        expect(markup).toContain('stroke-width="1.8"');
        expect(markup).not.toContain("-left-px");
        expect(markup).not.toContain("-right-1");
    });

    it("uses the seven-tool advanced default and leaves one slot free", () => {
        expect(defaultImageQuickToolIds).toEqual(["info", "download", "maskEdit", "emotion", "portraitTexture", "crop", "angle"]);
        expect(defaultImageQuickToolIds).toHaveLength(MAX_IMAGE_QUICK_TOOLS - 1);
    });

    it("passes the current saved options snapshot to the background-removal action", () => {
        const node = { id: "source-node" } as CanvasNodeData;
        const onRemoveBackground = vi.fn();
        const options = { ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, preset: "hair" as const, alphaMatting: true };
        const tools = buildImageToolbarTools(
            node,
            {
                onUpload: vi.fn(),
                onToggleFreeResize: vi.fn(),
                onAnnotate: vi.fn(),
                onMaskEdit: vi.fn(),
                onEmotion: vi.fn(),
                onPortraitTexture: vi.fn(),
                onRemoveBackground,
                onCrop: vi.fn(),
                onSplit: vi.fn(),
                onUpscale: vi.fn(),
                onSuperResolve: vi.fn(),
                onAngle: vi.fn(),
                onViewImage: vi.fn(),
                onCopyPrompt: vi.fn(),
                onReversePrompt: vi.fn(),
            },
            options,
        );

        tools.find((tool) => tool.id === "removeBackground")?.onClick();

        expect(onRemoveBackground).toHaveBeenCalledWith(node, options);
    });

    it("migrates an existing v6 preference without resetting its other choices", () => {
        const config = readImageQuickToolsConfig({ ids: ["info", "crop"] });
        expect(config.version).toBe(3);
        expect(config.ids).toEqual(expect.arrayContaining(["info", "crop", "removeBackground"]));
        expect(config.ids).not.toContain("delete");
        expect(config.backgroundRemoval).toEqual(DEFAULT_BACKGROUND_REMOVAL_OPTIONS);
    });

    it("preserves an explicit hidden state after migration", () => {
        const config = readImageQuickToolsConfig({ version: 1, ids: ["info", "crop"] });
        expect(config.ids).not.toContain("removeBackground");
        expect(config.version).toBe(3);
    });

    it("migrates a v2 config to v3 while preserving normalized parameters and labels", () => {
        const config = readImageQuickToolsConfig({
            version: 2,
            showLabels: true,
            ids: ["info", "removeBackground"],
            backgroundRemoval: {
                version: 1,
                preset: "hair",
                alphaMatting: true,
                foregroundThreshold: 245,
                backgroundThreshold: 8,
                refineRange: 12,
                cleanMask: false,
                outputMask: true,
            },
        });

        expect(config.backgroundRemoval).toEqual({
            version: 3,
            model: "u2net",
            preset: "custom",
            alphaMatting: true,
            foregroundThreshold: 245,
            backgroundThreshold: 8,
            refineRange: 12,
            cleanMask: false,
            outputMode: "transparent",
            backgroundColor: [255, 255, 255, 255],
        });
        expect(config).toMatchObject({ version: 3, ids: ["info", "removeBackground"], showLabels: true });
    });

    it("caps stored shortcut choices at eight and preserves the label preference", () => {
        const config = readImageQuickToolsConfig({
            version: 3,
            showLabels: true,
            ids: ["info", "delete", "saveAsset", "download", "edit", "copyPrompt", "reversePrompt", "replace", "annotation"],
        });

        expect(config.ids).toHaveLength(MAX_IMAGE_QUICK_TOOLS);
        expect(config.ids).not.toContain("annotation");
        expect(config.showLabels).toBe(true);
    });

    it("deduplicates stored tools, removes unknown ids, and keeps first-party order", () => {
        const config = readImageQuickToolsConfig({
            version: 3,
            ids: ["angle", "unknown", "info", "angle", "crop"],
        });

        expect(config.ids).toEqual(["info", "crop", "angle"]);
        expect(config.showLabels).toBe(false);
    });

    it("repairs a corrupted stored parameter object without resetting tool visibility", () => {
        const config = readImageQuickToolsConfig({ version: 2, ids: ["info"], backgroundRemoval: { foregroundThreshold: -1 } });

        expect(config.ids).toEqual(["info"]);
        expect(config.backgroundRemoval).toEqual(DEFAULT_BACKGROUND_REMOVAL_OPTIONS);
    });
});
