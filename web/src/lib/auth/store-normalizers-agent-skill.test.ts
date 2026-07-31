import { describe, expect, it } from "vitest";

import { normalizeAgentSkill } from "./store-normalizers";

describe("normalizeAgentSkill", () => {
    it("derives a zero-configuration planner summary and preserves full execution instructions", () => {
        const instructions = "完整执行规则".repeat(100);
        const skill = normalizeAgentSkill({ id: "skill", name: "技能", description: "用于规划的简要用途", instructions, enabled: true, keywords: [] });

        expect(skill.plannerSummary).toBe("用于规划的简要用途");
        expect(skill.instructions).toBe(instructions);
    });

    it("limits an explicit planner summary to 240 characters", () => {
        const skill = normalizeAgentSkill({ id: "skill", name: "技能", description: "", plannerSummary: "a".repeat(300), instructions: "执行", enabled: true, keywords: [] });

        expect(skill.plannerSummary).toHaveLength(240);
    });
});
