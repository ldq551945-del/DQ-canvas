import { normalizeCreativeDeliverables, normalizeCreativeFoundation, type CreativeDeliverableSummary, type CreativeFoundation } from "@/lib/creative-agent-contract";

type WorkbenchWorkspace = "image" | "video";

export type WorkbenchPlanDecision = {
    label: string;
    value: string;
    reason: string;
};

export type WorkbenchPlanChoice = {
    label: string;
    description: string;
    prompt?: string;
    action?: "prompt" | "upload";
};

export type WorkbenchPlan = {
    intent: "conversation" | "generation";
    foundation: CreativeFoundation;
    deliverables: CreativeDeliverableSummary[];
    parameterPatch: Record<string, string | number>;
    resolvedPrompt: string;
    shouldGenerate: boolean;
    reply: string;
    selectedSkillIds: string[];
    decisions?: WorkbenchPlanDecision[];
    choices?: WorkbenchPlanChoice[];
};

export type WorkbenchFunctionCallResult = { arguments: string; pointsCost?: number; pointsRecordId?: string };

const IMAGE_QUALITIES = new Set(["low", "medium", "high"]);
const VIDEO_QUALITIES = new Set(["480", "720", "1080"]);
const RATIOS = new Set(["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "1:1-2k", "16:9-2k", "9:16-2k", "16:9-4k", "9:16-4k"]);

export function normalizeWorkbenchPlan(value: unknown, input: { workspace: WorkbenchWorkspace; prompt: string; models: string[]; skillIds: string[] }): WorkbenchPlan | null {
    if (!isRecord(value)) return null;
    const rawPatch = isRecord(value.parameterPatch) ? value.parameterPatch : {};
    const patch: Record<string, string | number> = {};
    const size = text(rawPatch.size, 32);
    if (size && RATIOS.has(size)) patch.size = size;
    const model = text(rawPatch.model, 160);
    if (model && input.models.includes(model)) patch.model = model;
    if (input.workspace === "image") {
        const quality = text(rawPatch.quality, 16);
        if (quality && IMAGE_QUALITIES.has(quality)) patch.quality = quality;
        const count = integer(rawPatch.count);
        if (count !== null && count >= 1 && count <= 10) patch.count = count;
    } else {
        const seconds = integer(rawPatch.videoSeconds);
        if (seconds !== null && seconds >= 1 && seconds <= 60) patch.videoSeconds = String(seconds);
        const quality = text(rawPatch.vquality, 16);
        if (quality && VIDEO_QUALITIES.has(quality)) patch.vquality = quality;
    }
    const allowedSkills = new Set(input.skillIds);
    const selectedSkillIds = Array.isArray(value.selectedSkillIds) ? value.selectedSkillIds.map((item) => text(item, 120)).filter((item): item is string => Boolean(item && allowedSkills.has(item))) : [];
    const decisions = Array.isArray(value.decisions)
        ? value.decisions.slice(0, 8).flatMap((item) => {
              if (!isRecord(item)) return [];
              const label = text(item.label, 40);
              const decisionValue = text(item.value, 120);
              const reason = text(item.reason, 300);
              return label && decisionValue && reason ? [{ label, value: decisionValue, reason }] : [];
          })
        : [];
    const choices = Array.isArray(value.choices)
        ? value.choices.slice(0, 3).flatMap((item) => {
              if (!isRecord(item)) return [];
              const label = text(item.label, 40);
              const description = text(item.description, 240);
              const prompt = text(item.prompt, 1000);
              const action: WorkbenchPlanChoice["action"] = item.action === "upload" ? "upload" : "prompt";
              return label && description ? [{ label, description, ...(prompt ? { prompt } : {}), action }] : [];
          })
        : [];
    return {
        intent: value.intent === "conversation" ? "conversation" : "generation",
        foundation: normalizeCreativeFoundation(value.foundation, input.prompt),
        deliverables: normalizeCreativeDeliverables(value.deliverables, {
            title: input.workspace === "image" ? "当前图片" : "当前视频",
            type: input.workspace,
            role: input.workspace === "image" ? "当前视觉方案的核心画面" : "当前视觉方案的核心动态内容",
        }),
        parameterPatch: patch,
        resolvedPrompt: text(value.resolvedPrompt, 12000) || input.prompt,
        shouldGenerate: value.shouldGenerate !== false,
        reply: text(value.reply, 1000) || "已理解你的要求。",
        selectedSkillIds,
        ...(decisions.length ? { decisions } : {}),
        ...(choices.length ? { choices } : {}),
    };
}

export async function parseWorkbenchPlanCall(call: WorkbenchFunctionCallResult, input: { workspace: WorkbenchWorkspace; prompt: string; models: string[]; skillIds: string[] }, onInvalid: () => Promise<unknown>) {
    try {
        const plan = normalizeWorkbenchPlan(JSON.parse(call.arguments), input);
        if (!plan) throw new Error("模型返回的工作台计划无效");
        return plan;
    } catch {
        await onInvalid();
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, maxLength: number) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLength);
}

function integer(value: unknown) {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    return Number.isInteger(number) ? number : null;
}
