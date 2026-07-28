import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resultImageCardWidth } from "./image-workbench-panels";

describe("image result card layout", () => {
    it("uses the original image ratio to keep portrait cards compact", () => {
        expect(resultImageCardWidth(941, 1672, true)).toBe(203);
        expect(resultImageCardWidth(1024, 1024, true)).toBe(320);
        expect(resultImageCardWidth(1920, 1080, true)).toBe(320);
    });

    it("uses icon-only result actions with accessible names", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/image/image-workbench-panels.tsx"), "utf8");
        const cardSource = source.slice(source.indexOf("export function ResultImageCard"), source.indexOf("export function PendingImageCard"));

        expect(cardSource).toContain('aria-label="添加到素材"');
        expect(cardSource).toContain('aria-label="加入参考图"');
        expect(cardSource).toContain('aria-label="下载"');
        expect(cardSource).not.toContain("<Button className={RESULT_ACTION_BUTTON_CLASS}");
    });
});
