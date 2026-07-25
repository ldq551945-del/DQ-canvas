import { describe, expect, it } from "vitest";

import { splitDramaSource } from "./drama-source-splitter";

describe("splitDramaSource", () => {
    it("uses chapter headings as episode boundaries", () => {
        const result = splitDramaSource("第一章 归来\n她推开门。\n\n第二章 真相\n门后没有人。", 4000);

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ title: "第 1 集 · 第一章 归来", sourceRange: "第一章 归来" });
        expect(result[1].script).toContain("第二章 真相");
    });

    it("chunks unstructured long text without losing content", () => {
        const source = ["第一段".repeat(200), "第二段".repeat(200), "第三段".repeat(200)].join("\n\n");
        const result = splitDramaSource(source, 800);

        expect(result.length).toBeGreaterThan(1);
        expect(result.map((item) => item.script).join("\n\n")).toBe(source);
    });
});
