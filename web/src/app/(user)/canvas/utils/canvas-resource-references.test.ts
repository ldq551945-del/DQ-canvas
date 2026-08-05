import { describe, expect, it } from "vitest";

import { canvasResourceMentionToken, buildSkillResourceReferences } from "./canvas-resource-references";

describe("canvas resource mention tokens", () => {
    it("uses stable node and skill IDs instead of display labels", () => {
        expect(canvasResourceMentionToken({ id: "n", nodeId: "node-1", kind: "image", label: "图片 1", title: "", active: true })).toBe("@[node:node-1]");
        const skill = buildSkillResourceReferences([{ id: "motion", name: "镜头运动", description: "" }])[0];
        expect(canvasResourceMentionToken(skill)).toBe("@[skill:motion]");
    });
});
