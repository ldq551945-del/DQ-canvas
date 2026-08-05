import type { AgentSkill } from "@/lib/auth/store-types";

const SKILL_REFERENCE_PATTERN = /@\[skill:([^\]]+)\]/g;
const VIDEO_WORKSPACE = "video";

export function expandCanvasVideoSkillMentions(prompt: string, skillIds: unknown, skills: readonly AgentSkill[] | undefined) {
    if (!prompt || !Array.isArray(skillIds) || !skills?.length) return prompt;

    const selectedIds = new Set(
        skillIds
            .filter((id): id is string => typeof id === "string")
            .map((id) => id.trim())
            .filter(Boolean),
    );
    if (!selectedIds.size) return prompt;

    const availableSkills = new Map(skills.filter((skill) => skill.enabled && (skill.workspaces || ["image"]).includes(VIDEO_WORKSPACE) && selectedIds.has(skill.id)).map((skill) => [skill.id, skill]));
    if (!availableSkills.size) return prompt;

    return prompt.replace(SKILL_REFERENCE_PATTERN, (token, id: string) => {
        const skill = availableSkills.get(id.trim());
        return skill ? renderCanvasVideoSkillPrompt(skill) : token;
    });
}

export function renderCanvasVideoSkillPrompt(skill: Pick<AgentSkill, "name" | "description" | "instructions">) {
    return [
        `[Skill: ${skill.name}]`,
        skill.description ? `Purpose: ${skill.description}` : "",
        skill.instructions ? `Instructions:\n${skill.instructions}` : "",
        "Follow this skill's instructions closely. Return only the generated result without explanatory filler.",
    ]
        .filter(Boolean)
        .join("\n\n");
}
