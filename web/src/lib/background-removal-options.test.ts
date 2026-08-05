import { describe, expect, it } from "vitest";

import { BackgroundRemovalOptionsValidationError, DEFAULT_BACKGROUND_REMOVAL_OPTIONS, normalizeBackgroundRemovalOptions, serializeBackgroundRemovalOptions } from "./background-removal-options";

describe("background removal options", () => {
    it("normalizes supported presets to canonical v3 values", () => {
        expect(normalizeBackgroundRemovalOptions()).toEqual(DEFAULT_BACKGROUND_REMOVAL_OPTIONS);
        expect(normalizeBackgroundRemovalOptions({ version: 2, preset: "hair" })).toMatchObject({
            version: 3,
            model: "u2net",
            preset: "hair",
            alphaMatting: true,
            foregroundThreshold: 240,
            backgroundThreshold: 10,
            refineRange: 10,
            cleanMask: false,
            outputMode: "transparent",
            backgroundColor: [255, 255, 255, 255],
        });
        expect(normalizeBackgroundRemovalOptions({ version: 2, preset: "hard-edge", outputMode: "mask" })).toMatchObject({ preset: "hard-edge", alphaMatting: false, cleanMask: true, outputMode: "mask" });
        expect(normalizeBackgroundRemovalOptions({ version: 3, preset: "official-fine", model: "isnet-general-use" })).toMatchObject({
            preset: "official-fine",
            model: "isnet-general-use",
            alphaMatting: true,
            foregroundThreshold: 240,
            backgroundThreshold: 10,
            refineRange: 40,
            cleanMask: true,
        });
    });

    it("migrates strict v1 snapshots and their outputMask field", () => {
        expect(normalizeBackgroundRemovalOptions({ version: 1, preset: "standard", outputMask: true })).toMatchObject({ version: 3, model: "u2net", outputMode: "mask", backgroundColor: [255, 255, 255, 255] });
        expect(normalizeBackgroundRemovalOptions({ version: 1, preset: "standard", outputMask: false })).toMatchObject({ version: 3, model: "u2net", outputMode: "transparent" });
        expect(normalizeBackgroundRemovalOptions({ preset: "standard", outputMask: true })).toMatchObject({ version: 3, model: "u2net", outputMode: "mask" });
        expect(normalizeBackgroundRemovalOptions({ version: 2, preset: "standard" })).toMatchObject({ version: 3, model: "u2net" });
    });

    it("marks a modified named preset as custom", () => {
        expect(normalizeBackgroundRemovalOptions({ version: 2, preset: "hair", refineRange: 24 })).toMatchObject({ preset: "custom", alphaMatting: true, refineRange: 24 });
    });

    it("preserves all four official bgcolor channels", () => {
        expect(normalizeBackgroundRemovalOptions({ version: 2, outputMode: "color", backgroundColor: [12, 34, 56, 78] })).toMatchObject({ outputMode: "color", backgroundColor: [12, 34, 56, 78] });
    });

    it.each([
        [{ version: 4 }, "参数版本"],
        [{ version: 3, model: "birefnet-general" }, "主体识别模型"],
        [{ version: 2, preset: "unknown" }, "处理方式"],
        [{ version: 2, extra: true }, "未支持的参数"],
        [{ version: 2, outputMask: true }, "未支持的参数"],
        [{ version: 1, outputMode: "mask" }, "未支持的参数"],
        [{ version: 2, alphaMatting: 1 }, "布尔值"],
        [{ version: 2, outputMode: "jpeg" }, "输出方式"],
        [{ version: 2, backgroundColor: [0, 0, 0] }, "4 个通道"],
        [{ version: 2, backgroundColor: [0, 0, 0, 256] }, "0 到 255"],
        [{ version: 2, foregroundThreshold: 256 }, "0 到 255"],
        [{ version: 3, refineRange: 256 }, "0 到 255"],
        [{ version: 2, foregroundThreshold: 10, backgroundThreshold: 10 }, "必须小于"],
    ])("rejects an invalid option object", (input, message) => {
        expect(() => normalizeBackgroundRemovalOptions(input)).toThrow(BackgroundRemovalOptionsValidationError);
        expect(() => normalizeBackgroundRemovalOptions(input)).toThrow(message);
    });

    it("serializes only effective execution fields in a stable order", () => {
        expect(serializeBackgroundRemovalOptions(normalizeBackgroundRemovalOptions({ version: 2, preset: "hair", outputMode: "color", backgroundColor: [1, 2, 3, 4] }))).toBe('[3,"u2net",true,240,10,10,false,"color",1,2,3,4]');
        expect(serializeBackgroundRemovalOptions(normalizeBackgroundRemovalOptions({ version: 3, model: "u2net" }))).not.toBe(serializeBackgroundRemovalOptions(DEFAULT_BACKGROUND_REMOVAL_OPTIONS));
        expect(serializeBackgroundRemovalOptions(normalizeBackgroundRemovalOptions({ version: 2, preset: "custom" }))).toBe(serializeBackgroundRemovalOptions(normalizeBackgroundRemovalOptions({ version: 2, preset: "standard" })));
        expect(serializeBackgroundRemovalOptions({ ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, backgroundColor: [1, 2, 3, 4] })).toBe(serializeBackgroundRemovalOptions(DEFAULT_BACKGROUND_REMOVAL_OPTIONS));
        expect(
            serializeBackgroundRemovalOptions({
                ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS,
                outputMode: "mask",
                alphaMatting: true,
                foregroundThreshold: 200,
                backgroundThreshold: 50,
                refineRange: 80,
            }),
        ).toBe(serializeBackgroundRemovalOptions({ ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, outputMode: "mask" }));
    });
});
