import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/lib/auth/store-foundation";

import { selectAgentSkills } from "./agent-run-surface-policy";

describe("selectAgentSkills", () => {
    it("honors an explicitly selected compatible skill without keyword text", () => {
        const skills = selectAgentSkills(DEFAULT_SETTINGS, "chat", "请开始执行", ["character-design"]);
        expect(skills.map((skill) => skill.id)).toContain("character-design");
    });

    it("does not allow disabled or incompatible skills to be forced", () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            agentSkills: DEFAULT_SETTINGS.agentSkills.map((skill) => (skill.id === "character-design" ? { ...skill, enabled: false } : skill)),
        };
        expect(selectAgentSkills(settings, "chat", "请开始执行", ["character-design"])).toEqual([]);
        expect(selectAgentSkills(DEFAULT_SETTINGS, "canvas", "请开始执行", ["image-motion"])).toEqual([]);
    });

    it("keeps drama skills inside drama projects", () => {
        expect(selectAgentSkills(DEFAULT_SETTINGS, "drama", "继续当前项目", ["drama-planning"]).map((skill) => skill.id)).toEqual(["drama-planning"]);
        expect(selectAgentSkills(DEFAULT_SETTINGS, "drama", "继续当前项目", ["image-motion"])).toEqual([]);
    });
});
