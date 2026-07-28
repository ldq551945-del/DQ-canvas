import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/lib/auth/store-foundation";

import { selectAgentSkills } from "./agent-run-surface-policy";

describe("selectAgentSkills", () => {
    it("honors an explicitly selected compatible skill without keyword text", () => {
        const skills = selectAgentSkills(DEFAULT_SETTINGS, "chat", ["character-design"]);
        expect(skills.map((skill) => skill.id)).toContain("character-design");
    });

    it("uses the text model skill selection when the user did not select one", () => {
        expect(selectAgentSkills(DEFAULT_SETTINGS, "chat", [], ["character-design"]).map((skill) => skill.id)).toEqual(["character-design"]);
        expect(selectAgentSkills(DEFAULT_SETTINGS, "chat", [], ["missing-skill"])).toEqual([]);
    });

    it("does not allow disabled or incompatible skills to be forced", () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            agentSkills: DEFAULT_SETTINGS.agentSkills.map((skill) => (skill.id === "character-design" ? { ...skill, enabled: false } : skill)),
        };
        expect(selectAgentSkills(settings, "chat", ["character-design"])).toEqual([]);
        expect(selectAgentSkills(DEFAULT_SETTINGS, "canvas", ["image-motion"])).toEqual([]);
    });

    it("keeps drama skills inside drama projects", () => {
        expect(selectAgentSkills(DEFAULT_SETTINGS, "drama", ["drama-planning"]).map((skill) => skill.id)).toEqual(["drama-planning"]);
        expect(selectAgentSkills(DEFAULT_SETTINGS, "drama", ["image-motion"])).toEqual([]);
    });
});
