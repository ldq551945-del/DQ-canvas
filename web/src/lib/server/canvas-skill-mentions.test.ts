import { describe, expect, it } from "vitest";

import type { AgentSkill } from "@/lib/auth/store-types";
import { expandCanvasVideoSkillMentions } from "./canvas-skill-mentions";

const videoSkill: AgentSkill = {
    id: "image-motion",
    name: "Image motion",
    description: "Animate a still image with natural motion.",
    instructions: "Preserve the subject and animate only the requested movement.",
    enabled: true,
    keywords: [],
    workspaces: ["video"],
};

describe("expandCanvasVideoSkillMentions", () => {
    it("expands a selected enabled video skill without changing other text", () => {
        expect(expandCanvasVideoSkillMentions("Create a short clip @\[skill:image-motion\]", ["image-motion", "image-motion"], [videoSkill])).toBe(
            "Create a short clip [Skill: Image motion]\n\nPurpose: Animate a still image with natural motion.\n\nInstructions:\nPreserve the subject and animate only the requested movement.\n\nFollow this skill's instructions closely. Return only the generated result without explanatory filler.",
        );
    });

    it("leaves disabled, non-video, unselected, and unknown mentions intact", () => {
        const skills: AgentSkill[] = [videoSkill, { ...videoSkill, id: "disabled", enabled: false }, { ...videoSkill, id: "image-only", workspaces: ["image"] }];
        const prompt = "@\[skill:disabled\] @\[skill:image-only\] @\[skill:image-motion\] @\[skill:unknown\]";

        expect(expandCanvasVideoSkillMentions(prompt, ["disabled", "image-only", "unknown"], skills)).toBe(prompt);
        expect(expandCanvasVideoSkillMentions(prompt, [], skills)).toBe(prompt);
    });
});
