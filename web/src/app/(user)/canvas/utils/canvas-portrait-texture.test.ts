import { describe, expect, it } from "vitest";

import { buildPortraitTexturePrompt, DEFAULT_PORTRAIT_TEXTURE_SETTINGS, normalizePortraitTextureSettings, PORTRAIT_TEXTURE_GROUPS, resolvePortraitTextureRetryState, resolvePortraitTextureSize } from "./canvas-portrait-texture";

describe("canvas portrait texture", () => {
    it("exposes five three-level groups with the expected defaults", () => {
        expect(PORTRAIT_TEXTURE_GROUPS).toHaveLength(5);
        expect(PORTRAIT_TEXTURE_GROUPS.every((group) => group.options.length === 3)).toBe(true);
        expect(DEFAULT_PORTRAIT_TEXTURE_SETTINGS).toEqual({
            personSceneFusion: "deep",
            lightingFusion: "natural",
            skin: "natural",
            texture: "natural",
            sharpness: "standard",
        });
    });

    it("normalizes unknown and partially invalid persisted values", () => {
        expect(normalizePortraitTextureSettings(undefined)).toEqual(DEFAULT_PORTRAIT_TEXTURE_SETTINGS);
        expect(
            normalizePortraitTextureSettings({
                personSceneFusion: "light",
                lightingFusion: "invalid",
                skin: "real",
                texture: null,
                sharpness: "high",
            }),
        ).toEqual({
            personSceneFusion: "light",
            lightingFusion: "natural",
            skin: "real",
            texture: "natural",
            sharpness: "high",
        });
    });

    it("compiles all settings and invariant identity constraints into the prompt", () => {
        const prompt = buildPortraitTexturePrompt("保留原图气质", {
            personSceneFusion: "light",
            lightingFusion: "atmosphere",
            skin: "real",
            texture: "grain",
            sharpness: "high",
        });
        expect(prompt).toContain("保留原图气质");
        expect(prompt).toContain("人景融合（轻度对齐）");
        expect(prompt).toContain("光影融合（氛围强化）");
        expect(prompt).toContain("皮肤（真实肌理）");
        expect(prompt).toContain("纹理（颗粒质感）");
        expect(prompt).toContain("锐度（高清锐化）");
        expect(prompt).toContain("必须保持原人物身份、五官、发型、服装、姿势、构图、场景和画面比例");
    });

    it("inherits the source aspect ratio when the source has no explicit size", () => {
        expect(resolvePortraitTextureSize(undefined, 1600, 900, "1:1")).toBe("16:9");
        expect(resolvePortraitTextureSize(undefined, 900, 1600, "1:1")).toBe("9:16");
    });

    it("keeps an explicit source size before natural dimensions and fallback", () => {
        expect(resolvePortraitTextureSize("3:2", 900, 1600, "1:1")).toBe("3:2");
        expect(resolvePortraitTextureSize(undefined, undefined, undefined, "4:3")).toBe("4:3");
    });

    it("retries from the result snapshot instead of later source settings", () => {
        const retry = resolvePortraitTextureRetryState({
            resultSettings: { ...DEFAULT_PORTRAIT_TEXTURE_SETTINGS, skin: "real" },
            sourceSettings: { ...DEFAULT_PORTRAIT_TEXTURE_SETTINGS, skin: "clear" },
            resultBasePrompt: "参考图1",
            fallbackBasePrompt: "已经变化的源提示词",
        });

        expect(retry.basePrompt).toBe("参考图1");
        expect(retry.settings?.skin).toBe("real");
        expect(retry.prompt).toContain("皮肤（真实肌理）");
        expect(retry.prompt).not.toContain("皮肤（清透修饰）");
    });
});
