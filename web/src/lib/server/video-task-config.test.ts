import { describe, expect, it } from "vitest";

import { normalizeVideoAspectRatio, resolveVideoGenerationParameters, withVideoReferenceFidelity } from "./video-task-config";

describe("resolveVideoGenerationParameters", () => {
    const defaults = { imageSize: "9:16", videoQuality: "1080", videoSeconds: 10 };

    it("uses backend defaults when video parameters are missing", () => {
        expect(resolveVideoGenerationParameters({}, defaults)).toEqual({ size: "9:16", vquality: "1080", videoSeconds: 10 });
    });

    it("keeps explicit video parameters and channel flags", () => {
        expect(resolveVideoGenerationParameters({ size: "1:1", vquality: "480", videoSeconds: "6", videoGenerateAudio: "false", videoWatermark: "true" }, defaults)).toEqual({
            size: "1:1",
            vquality: "480",
            videoSeconds: 6,
            videoGenerateAudio: "false",
            videoWatermark: "true",
        });
    });

    it("treats blank or invalid values as missing", () => {
        expect(resolveVideoGenerationParameters({ size: " ", vquality: "", videoSeconds: 0 }, defaults)).toEqual({ size: "9:16", vquality: "1080", videoSeconds: 10 });
    });

    it("keeps the explicit intelligent duration option", () => {
        expect(resolveVideoGenerationParameters({ videoSeconds: "-1" }, defaults).videoSeconds).toBe(-1);
    });

    it("normalizes pixel dimensions to the provider aspect-ratio format", () => {
        expect(normalizeVideoAspectRatio("1280x720")).toBe("16:9");
        expect(normalizeVideoAspectRatio("720 × 1280")).toBe("9:16");
        expect(resolveVideoGenerationParameters({ size: "1024x1024" }, defaults).size).toBe("1:1");
    });

    it("adds a server-side subject fidelity constraint for visual references", () => {
        const prompt = withVideoReferenceFidelity("让人物自然挥手", [{ type: "image" }]);

        expect(prompt).toContain("让人物自然挥手");
        expect(prompt).toContain("将参考图作为首帧、主体身份、外观和场景的主要依据");
        expect(prompt).toContain("禁止替换主体");
    });

    it("does not change text-to-video or duplicate the fidelity constraint", () => {
        expect(withVideoReferenceFidelity("生成海边日落", [])).toBe("生成海边日落");
        const once = withVideoReferenceFidelity("让镜头缓慢推进", [{ type: "video" }]);
        expect(withVideoReferenceFidelity(once, [{ type: "video" }])).toBe(once);
    });
});
