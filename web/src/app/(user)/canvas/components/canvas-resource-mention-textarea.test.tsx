import { describe, expect, it } from "vitest";

import { splitMentionText } from "./canvas-resource-mention-textarea";

const imageReference = {
    id: "reference-image",
    nodeId: "reference-image",
    kind: "image" as const,
    label: "图片1",
    title: "Reference",
    previewUrl: "/api/reference-assets/permanent/reference.png",
    active: true,
};

describe("CanvasResourceMentionTextarea", () => {
    it("maps a saved image token to an atomic image mention", () => {
        const parts = splitMentionText("参考 @[node:reference-image] 的光线", [imageReference]);

        expect(parts).toEqual([
            { type: "text", text: "参考 " },
            { type: "mention", token: "@[node:reference-image]", reference: imageReference },
            { type: "text", text: " 的光线" },
        ]);
    });

    it("accepts the readable @ label and preserves the canonical token", () => {
        const parts = splitMentionText("参考 @图片1 的光线", [imageReference]);

        expect(parts).toEqual([
            { type: "text", text: "参考 " },
            { type: "mention", token: "@[node:reference-image]", reference: imageReference },
            { type: "text", text: " 的光线" },
        ]);
    });

    it("keeps unavailable tokens as editable text instead of silently removing them", () => {
        expect(splitMentionText("@[node:removed-node]", [])).toEqual([{ type: "text", text: "@[node:removed-node]" }]);
    });
});
