import { describe, expect, it } from "vitest";

import { buildEmotionPrompt, canvasEmotionPresets, clampAxis, clampFaceBox, emotionBlendshapes, emotionGenerationSize, findEmotionPreset, neutralEmotionPreset, type CanvasFaceBox } from "./canvas-emotion";

const faceBox: CanvasFaceBox = {
    id: "face-one",
    x: 100,
    y: 80,
    width: 120,
    height: 140,
    source: "detected",
};

describe("canvas emotion", () => {
    it("exposes the upstream 5x5 emotion coordinate map", () => {
        expect(canvasEmotionPresets).toHaveLength(25);
        expect(canvasEmotionPresets[0]).toMatchObject({ label: "欣喜若狂", intimacy: 2, arousal: 2 });
        expect(neutralEmotionPreset).toMatchObject({ label: "中性克制", intimacy: 0, arousal: 0 });
        expect(canvasEmotionPresets.at(-1)).toMatchObject({ label: "绝望", intimacy: -2, arousal: -2 });
        expect(new Set(canvasEmotionPresets.map((preset) => preset.id))).toHaveLength(25);
    });

    it("rounds and clamps coordinate lookups", () => {
        expect(clampAxis(5)).toBe(2);
        expect(clampAxis(-2.8)).toBe(-2);
        expect(findEmotionPreset(1.4, -0.7)).toMatchObject({ intimacy: 1, arousal: -1 });
    });

    it("maps coordinate presets to bounded FaceCap blendshapes", () => {
        expect(emotionBlendshapes(neutralEmotionPreset)).toEqual({});

        const joyful = emotionBlendshapes(findEmotionPreset(2, 2));
        expect(joyful.mouthSmile_L).toBeGreaterThan(0.5);
        expect(joyful.mouthSmile_R).toBe(joyful.mouthSmile_L);
        expect(joyful.jawOpen).toBeGreaterThan(0);

        const despair = emotionBlendshapes(findEmotionPreset(-2, -2));
        expect(despair.mouthFrown_L).toBeGreaterThan(0.5);
        expect(despair.browInnerUp).toBeGreaterThan(0);
        expect(Object.values(despair).every((value) => value >= 0 && value <= 1)).toBe(true);
    });

    it("builds an edit-only prompt with local target coordinates and identity constraints", () => {
        const prompt = buildEmotionPrompt(
            {
                presetId: "emotion-2-2",
                intimacy: 0,
                arousal: 0,
                characterName: "角色1",
                faceBox,
            },
            { x: 40, y: 30, width: 300, height: 340 },
        );
        expect(prompt).toContain("仅修改第一张输入图中“角色1”脸部的表情");
        expect(prompt).toContain("目标情绪：欣喜若狂");
        expect(prompt).toContain("x=60px，y=50px，width=120px，height=140px");
        expect(prompt).toContain("第二张输入图仅用于核对同一人物身份");
        expect(prompt).toContain("透明蒙版内允许编辑");
        expect(prompt).toContain("画面其他人物不变");
    });

    it("selects a supported provider size from the edit crop ratio", () => {
        expect(emotionGenerationSize({ x: 0, y: 0, width: 1200, height: 700 })).toBe("1536x1024");
        expect(emotionGenerationSize({ x: 0, y: 0, width: 700, height: 1200 })).toBe("1024x1536");
        expect(emotionGenerationSize({ x: 0, y: 0, width: 900, height: 900 })).toBe("1024x1024");
    });

    it("keeps face boxes inside valid image bounds", () => {
        expect(clampFaceBox({ ...faceBox, x: -10, y: 95, width: 200, height: 30 }, 100, 100)).toMatchObject({
            x: 0,
            y: 95,
            width: 100,
            height: 5,
        });
        expect(clampFaceBox(faceBox, 0, 0)).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
    });
});
