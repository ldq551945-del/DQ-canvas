import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/lib/auth/store-foundation";

import { agentPlannerInput, compactCanvasSnapshot, plannerAgentSkills, selectAgentSkills } from "./agent-run-surface-policy";
import { filterAgentPlannerModels, resolveAgentPlanningProfile } from "./agent-run-planning-profile";

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

describe("agentPlannerInput", () => {
    it("keeps selected Canvas nodes, one-hop relations and exact size while dropping unrelated nodes", () => {
        const snapshot = {
            projectId: "canvas-one",
            title: "商品画布",
            imageSize: "1:1",
            selectedNodeIds: ["selected"],
            nodes: [
                { id: "config", type: "config", title: "配置", metadata: { size: "400x600" } },
                { id: "selected", type: "image", title: "当前商品", metadata: { url: "/api/reference-assets/current", naturalWidth: 400, naturalHeight: 600 } },
                { id: "related", type: "text", title: "关联文案", metadata: { content: "红色包装" } },
                { id: "unrelated", type: "image", title: "旧图片", metadata: { url: "/api/reference-assets/old" } },
            ],
            connections: [{ id: "edge", fromNodeId: "related", toNodeId: "selected" }],
            viewport: { x: 100, y: 200, k: 0.5 },
        };

        const compact = compactCanvasSnapshot(snapshot);

        expect(compact).toMatchObject({ projectId: "canvas-one", imageSize: "1:1", selectedNodeIds: ["selected"] });
        expect(compact.nodes.map((node) => node.id)).toEqual(["config", "selected", "related"]);
        expect(compact.nodes[0]).toMatchObject({ metadata: { size: "400x600" } });
        expect(compact).not.toHaveProperty("viewport");
    });

    it("enforces message, asset and Skill planner budgets without sending full instructions", () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            agentSkills: [
                {
                    id: "skill-one",
                    name: "商品技能",
                    description: "商品规划摘要",
                    plannerSummary: "精简规划说明".repeat(40),
                    instructions: "完整执行说明".repeat(1000),
                    enabled: true,
                    keywords: [],
                    workspaces: ["canvas" as const],
                },
            ],
        };
        const recentMessages = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: String(index).repeat(1200), sequence: index + 1 }));
        const assets = Array.from({ length: 9 }, (_, index) => ({ id: `asset-${index}`, type: "text", title: `素材 ${index}`, textContent: "素材正文".repeat(500), metadata: {} }));
        const input = agentPlannerInput(
            { surface: "canvas", prompt: "生成商品图", snapshot: { selectedNodeIds: [], nodes: [], connections: [] }, selectedSkillIds: [] } as never,
            { summary: "长期摘要".repeat(2000), summaryThroughSequence: 0, recentMessages } as never,
            assets as never,
            "conversation-memory-candidates",
            settings.agentSkills,
            [{ id: "image", name: "图片", capability: "image" }],
            settings,
        ) as Record<string, unknown>;
        const context = input.conversationContext as { summary: string; recentMessages: Array<{ content: string; sequence: number }> };
        const skill = (input.availableSkills as Array<Record<string, unknown>>)[0];

        expect(context.summary.length).toBeLessThanOrEqual(3000);
        expect(context.recentMessages.length).toBeGreaterThanOrEqual(4);
        expect(context.recentMessages.length).toBeLessThanOrEqual(6);
        expect(context.recentMessages.at(-1)?.sequence).toBe(10);
        expect(context.recentMessages.every((message) => message.content.length <= 800)).toBe(true);
        expect((input.referencedAssets as unknown[]).length).toBeGreaterThanOrEqual(4);
        expect((input.referencedAssets as unknown[]).length).toBeLessThanOrEqual(6);
        expect(String(skill.plannerSummary)).toBe("精简规划说明".repeat(40).slice(0, String(skill.plannerSummary).length));
        expect(String(skill.plannerSummary).length).toBeLessThanOrEqual(240);
        expect(skill).not.toHaveProperty("instructions");
        expect(JSON.stringify(input).length).toBeLessThanOrEqual(12_000);
        expect(input.planningBudget).toEqual({ complexity: "ordinary", maxOutputTokens: 1200 });
    });

    it("uses larger bounded budgets only for multi-output and complex project planning", () => {
        expect(resolveAgentPlanningProfile({ surface: "chat", prompt: "生成四张角色图" })).toMatchObject({ complexity: "multi", maxInputChars: 22_000, maxOutputTokens: 1600 });
        expect(resolveAgentPlanningProfile({ surface: "drama", prompt: "继续当前项目" })).toMatchObject({ complexity: "complex", maxInputChars: 32_000, maxOutputTokens: 2400 });
    });

    it("prefilters models by request capability while preserving real text planning", () => {
        const models = ["text", "image", "video", "audio"].map((capability) => ({ id: capability, capability }));
        expect(filterAgentPlannerModels(models, { surface: "chat", prompt: "你好，你能做什么" }).map((item) => item.capability)).toEqual(["text"]);
        expect(filterAgentPlannerModels(models, { surface: "chat", prompt: "生成一张商品海报" }).map((item) => item.capability)).toEqual(["text", "image"]);
        expect(filterAgentPlannerModels(models, { surface: "chat", prompt: "让这张图动起来，生成视频" }).map((item) => item.capability)).toEqual(["text", "image", "video"]);
    });

    it("prefilters planner Skills by surface and request without dropping explicit choices", () => {
        expect(plannerAgentSkills(DEFAULT_SETTINGS, { surface: "chat", prompt: "生成商品主图", selectedSkillIds: [] }).map((skill) => skill.id)).toContain("ecommerce-image");
        expect(plannerAgentSkills(DEFAULT_SETTINGS, { surface: "chat", prompt: "你好", selectedSkillIds: [] })).toEqual([]);
        expect(plannerAgentSkills(DEFAULT_SETTINGS, { surface: "chat", prompt: "普通请求", selectedSkillIds: ["image-motion"] }).map((skill) => skill.id)).toEqual(["image-motion"]);
    });
});
