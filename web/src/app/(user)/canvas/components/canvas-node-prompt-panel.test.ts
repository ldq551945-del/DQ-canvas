import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./canvas-node-prompt-panel.tsx", import.meta.url), "utf8");

describe("CanvasNodePromptPanel composition", () => {
    it("uses the compact composer structure without an inline media replacement action", () => {
        expect(source).toContain("<GenerationModeIcon");
        expect(source).toContain("<CanvasPromptLibrary");
        expect(source).toContain("<ReferenceThumbnail");
        expect(source).toContain("h-[42px]");
        expect(source).toContain("composerHeight");
        expect(source).not.toContain("onReplaceMedia");
        expect(source).not.toContain("canReplaceMedia");
        expect(source).not.toContain("<Upload");
    });
});
