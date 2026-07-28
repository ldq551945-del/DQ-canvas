import { describe, expect, it } from "vitest";

import { creativeAssetCardLayout } from "./creative-asset-layout";

describe("creative asset card layout", () => {
    it("keeps landscape and square media within the card width", () => {
        expect(creativeAssetCardLayout({ width: 1920, height: 1080 })).toEqual({ card: { width: "min(100%, 240px)" }, media: { aspectRatio: "1920 / 1080" } });
        expect(creativeAssetCardLayout({ width: 1024, height: 1024 })).toEqual({ card: { width: "min(100%, 240px)" }, media: { aspectRatio: "1024 / 1024" } });
    });

    it("narrows portrait cards to the rendered media width", () => {
        expect(creativeAssetCardLayout({ width: 720, height: 1280 })).toEqual({ card: { width: "min(100%, 180px)" }, media: { aspectRatio: "720 / 1280" } });
    });

    it("falls back for assets without valid dimensions", () => {
        expect(creativeAssetCardLayout({})).toBeNull();
        expect(creativeAssetCardLayout({ width: 0, height: 1080 })).toBeNull();
    });
});
