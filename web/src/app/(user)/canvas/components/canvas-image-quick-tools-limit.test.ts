import { describe, expect, it } from "vitest";

import { MAX_IMAGE_QUICK_TOOLS, readImageQuickToolsConfig } from "./canvas-image-toolbar-tools";

describe("canvas image quick tool limit", () => {
    it("keeps at most eight tools pinned in the quick Dock", () => {
        const config = readImageQuickToolsConfig({
            version: 3,
            ids: ["info", "delete", "saveAsset", "download", "edit", "copyPrompt", "reversePrompt", "replace", "resize"],
        });

        expect(MAX_IMAGE_QUICK_TOOLS).toBe(8);
        expect(config.ids).toHaveLength(8);
        expect(config.ids).not.toContain("resize");
    });

    it("does not reserve a pinned-tool slot for the independent lock action", () => {
        const config = readImageQuickToolsConfig({
            version: 3,
            ids: ["info", "delete", "saveAsset", "download", "edit", "copyPrompt", "reversePrompt", "replace", "node-lock"],
        });

        expect(config.ids).toHaveLength(MAX_IMAGE_QUICK_TOOLS);
        expect(config.ids).not.toContain("node-lock");
    });
});
