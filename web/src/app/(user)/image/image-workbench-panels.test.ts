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

    it("uses a fixed four-column desktop grid instead of masonry columns", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/image/page.tsx"), "utf8");
        const panelSource = await readFile(resolve(process.cwd(), "src/app/(user)/image/image-workbench-panels.tsx"), "utf8");

        expect(source).toContain("xl:grid-cols-4");
        expect(source).toContain("sm:grid-cols-2");
        expect(source).not.toContain("columns-4");
        expect(source).not.toContain("break-inside-avoid");
        expect(panelSource).toContain('fluid && "aspect-square"');
        expect(panelSource).toContain('fluid ? "object-cover" : "object-contain"');
    });

    it("keeps pending and failed single-result cards visible instead of collapsing to a line", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/image/image-workbench-panels.tsx"), "utf8");
        const pageSource = await readFile(resolve(process.cwd(), "src/app/(user)/image/page.tsx"), "utf8");
        const pendingSource = source.slice(source.indexOf("export function PendingImageCard"), source.indexOf("export function FailedImageCard"));
        const failedSource = source.slice(source.indexOf("export function FailedImageCard"), source.indexOf("export function LogPanel"));

        expect(pendingSource).toContain("w-full max-w-[320px]");
        expect(failedSource).toContain('large && "max-w-[320px]"');
        expect(pageSource).toContain('resultEntries.length === 1 ? "w-[320px] max-w-full" : "min-w-0"');
    });
});
