import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BACKGROUND_REMOVAL_OPTIONS } from "@/lib/background-removal-options";
import { applyBackgroundRemovalPreset, BackgroundRemovalSettingsPanel, updateBackgroundRemovalModel, updateBackgroundRemovalTuning } from "./canvas-background-removal-settings-panel";
import { triggerBackgroundRemovalSettings } from "./canvas-image-toolbar-settings-modal";

describe("BackgroundRemovalSettingsPanel", () => {
    it("uses Chinese labels mapped to the rembg remove parameters", () => {
        const markup = renderToStaticMarkup(<BackgroundRemovalSettingsPanel value={{ ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, alphaMatting: true }} onChange={vi.fn()} />);

        for (const label of ["主体识别模型", "轻量快速", "处理方式", "标准", "官方精细", "发丝与半透明", "清晰轮廓", "自定义", "自动细化边缘", "主体确认阈值", "背景确认阈值", "边缘细化范围", "清理零碎边缘"]) {
            expect(markup).toContain(label);
        }
        for (const removedLabel of ["输出方式", "黑白蒙版", "纯色背景", "背景颜色（RGBA）", "only_mask", "bgcolor"]) expect(markup).not.toContain(removedLabel);
    });

    it("applies presets while forcing transparent output for new tasks", () => {
        const hair = applyBackgroundRemovalPreset({ ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, model: "isnet-anime", outputMode: "color", backgroundColor: [1, 2, 3, 4] }, "hair");
        const hardEdge = applyBackgroundRemovalPreset(hair, "hard-edge");

        expect(hair).toMatchObject({ model: "isnet-anime", preset: "hair", alphaMatting: true, cleanMask: false, outputMode: "transparent" });
        expect(hardEdge).toMatchObject({ model: "isnet-anime", preset: "hard-edge", alphaMatting: false, cleanMask: true, outputMode: "transparent" });
        expect(applyBackgroundRemovalPreset(hair, "official-fine")).toMatchObject({ model: "isnet-anime", preset: "official-fine", alphaMatting: true, refineRange: 40, cleanMask: true });
    });

    it("switches model while forcing transparent output", () => {
        expect(updateBackgroundRemovalModel({ ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, preset: "hair", alphaMatting: true, outputMode: "color", backgroundColor: [1, 2, 3, 4] }, "u2net_human_seg")).toMatchObject({
            model: "u2net_human_seg",
            preset: "hair",
            alphaMatting: true,
            outputMode: "transparent",
        });
    });

    it("marks manual tuning as custom and keeps threshold ordering valid", () => {
        const base = { ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, foregroundThreshold: 20, backgroundThreshold: 10 };
        const background = updateBackgroundRemovalTuning(base, "backgroundThreshold", 30);
        const foreground = updateBackgroundRemovalTuning(base, "foregroundThreshold", 3);

        expect(background).toMatchObject({ preset: "custom", backgroundThreshold: 19 });
        expect(foreground).toMatchObject({ preset: "custom", foregroundThreshold: 11 });
    });

    it("opens custom parameters without bubbling into the tool visibility toggle", () => {
        const stopPropagation = vi.fn();
        const openSettings = vi.fn();

        triggerBackgroundRemovalSettings({ stopPropagation }, openSettings);

        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(openSettings).toHaveBeenCalledOnce();
    });

    it("keeps the custom-parameter action beside the background-removal label", () => {
        const source = readFileSync(new URL("./canvas-image-toolbar-settings-modal.tsx", import.meta.url), "utf8");

        expect(source).toContain('tool.id === "removeBackground" ? "w-fit flex-none" : "flex-1"');
        expect(source).toContain('aria-label="打开抠图自定义参数"');
    });

    it("commits background-removal parameters only with the top-level Dock save", () => {
        const source = readFileSync(new URL("./canvas-node-hover-toolbar.tsx", import.meta.url), "utf8");
        const topLevelSave = source.slice(source.indexOf("const saveImageToolSettings"), source.indexOf("const saveBackgroundRemovalOptions"));
        const parameterSave = source.slice(source.indexOf("const saveBackgroundRemovalOptions"), source.indexOf("return (", source.indexOf("const saveBackgroundRemovalOptions")));

        expect(topLevelSave).toContain("setBackgroundRemovalOptions(config.backgroundRemoval)");
        expect(topLevelSave).toContain("window.localStorage.setItem");
        expect(parameterSave).toContain('setDraftBackgroundRemovalOptions({ ...options, outputMode: "transparent" })');
        expect(parameterSave).not.toContain("setBackgroundRemovalOptions(options)");
        expect(parameterSave).not.toContain("window.localStorage.setItem");
    });
});
