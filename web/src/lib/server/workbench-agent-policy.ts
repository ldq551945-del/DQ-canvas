import type { getAuthSettings } from "@/lib/auth/store";
import { normalizeCreativeDeliverables, normalizeCreativeFoundation, withCreativeFoundation } from "@/lib/creative-agent-contract";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import type { WorkbenchPlan, WorkbenchPlanChoice, WorkbenchPlanDecision } from "./workbench-agent-plan";

export type WorkbenchWorkspace = "image" | "video";
export type WorkbenchReferenceType = "image" | "video" | "audio";
export type WorkbenchModelOption = { id: string; name: string };
export type WorkbenchRequestBody = {
    conversationId?: string;
    prompt?: string;
    previousPrompt?: string;
    workspace?: WorkbenchWorkspace;
    models?: string[];
    modelIds?: string[];
    skillIds?: string[];
    smartPlanning?: boolean;
    currentConfig?: Record<string, unknown>;
    hasReferences?: boolean;
    referenceTypes?: WorkbenchReferenceType[];
    modelOptions?: WorkbenchModelOption[];
};

type AuthSettings = Awaited<ReturnType<typeof getAuthSettings>>;

export function buildTrustedWorkbenchBody(settings: AuthSettings, body: WorkbenchRequestBody): WorkbenchRequestBody {
    const workspace: WorkbenchWorkspace = body.workspace === "video" ? "video" : "image";
    const referenceTypes = normalizeReferenceTypes(body.referenceTypes, workspace);
    const availableModelOptions = workbenchModelOptions(settings, workspace, referenceTypes);
    const availableModelIds = availableModelOptions.map((model) => model.id);
    const modelKey = workspace === "image" ? "imageModel" : "videoModel";
    const manualSelectionRequested = body.smartPlanning === false;
    const requestedModelIds = Array.from(new Set(Array.isArray(body.modelIds) ? body.modelIds : []))
        .filter((id) => availableModelIds.includes(id))
        .slice(0, 6);
    const manualSelection = manualSelectionRequested && requestedModelIds.length > 0;
    const modelOptions = manualSelectionRequested ? availableModelOptions.filter((model) => requestedModelIds.includes(model.id)) : availableModelOptions;
    const models = modelOptions.map((model) => model.id);
    const currentConfig = workbenchCurrentConfig(body.currentConfig, workspace, models);
    if (manualSelection && !currentConfig[modelKey]) currentConfig[modelKey] = requestedModelIds[0];
    return {
        ...body,
        workspace,
        models,
        modelIds: manualSelection ? requestedModelIds : [],
        skillIds: selectedWorkbenchSkillIds(settings, workspace, body.skillIds),
        smartPlanning: manualSelectionRequested ? false : true,
        modelOptions,
        referenceTypes,
        hasReferences: referenceTypes.length > 0 || body.hasReferences === true,
        currentConfig,
    };
}

export function analyzeWorkbenchRequest(settings: AuthSettings, workspace: WorkbenchWorkspace, prompt: string, selectedSkillIds: string[] = []) {
    const explicitNoReference = requestsNoReference(prompt);
    const planOnly = requestsPlanOnly(prompt);
    const existingReferenceRequested = requestsExistingReference(prompt);
    const selectedIds = new Set(selectedSkillIds);
    const skills = settings.agentSkills.filter((skill) => {
        if (!skill.enabled || !(skill.workspaces || ["image"]).includes(workspace)) return false;
        const explicitlySelected = selectedIds.has(skill.id) || prompt.includes(skill.name);
        const keywordMatched = skill.keywords.some((keyword) => prompt.includes(keyword));
        if (!explicitlySelected && !keywordMatched) return false;
        if (!skill.requiresReference) return true;
        return explicitlySelected || existingReferenceRequested || (skill.action === "edit" && requestsEditAction(prompt));
    });
    return {
        skills,
        planOnly,
        conversationOnly: !selectedIds.size && requestsConversation(prompt),
        referenceRequired: !explicitNoReference && (skills.some((skill) => skill.requiresReference) || existingReferenceRequested),
    };
}

export function finalizeWorkbenchPlan(plan: WorkbenchPlan, input: { body: WorkbenchRequestBody; prompt: string; workspace: WorkbenchWorkspace; skillIds: string[]; referenceRequired: boolean; planOnly: boolean; conversationOnly: boolean }) {
    const { body, prompt, workspace, skillIds, referenceRequired, planOnly, conversationOnly } = input;
    if (conversationOnly || plan.intent === "conversation") {
        return {
            ...plan,
            intent: "conversation" as const,
            parameterPatch: {},
            resolvedPrompt: prompt,
            shouldGenerate: false,
            selectedSkillIds: [],
            decisions: [],
            choices: [],
            referenceRequired: false,
            referenceMissing: false,
        };
    }
    const modelKey = workspace === "image" ? "imageModel" : "videoModel";
    const lockedModel = body.smartPlanning === false && body.modelIds?.length === 1 ? body.modelIds[0] : "";
    if (lockedModel && body.models?.includes(lockedModel)) {
        plan.parameterPatch.model = lockedModel;
        plan.decisions = withLockedModelDecision(plan.decisions, lockedModel, body.modelOptions);
    }
    if (!plan.selectedSkillIds.length) plan.selectedSkillIds = skillIds;
    if (!plan.decisions?.length) plan.decisions = inferredDecisions(plan.parameterPatch, body.currentConfig, body.modelOptions, workspace);
    if (workspace === "video" && body.hasReferences) plan.decisions = withVideoReferenceDecision(plan.decisions);
    const referenceCapabilityMissing = Boolean(body.referenceTypes?.length && !body.models?.length);
    if (referenceCapabilityMissing) {
        plan.shouldGenerate = false;
        plan.reply = `当前后台没有启用支持${referenceTypeLabel(body.referenceTypes || [])}的${workspace === "image" ? "图片" : "视频"}模型，我不会创建一个会忽略参考素材的任务。`;
        plan.decisions = withMissingReferenceCapabilityDecision(plan.decisions, body.referenceTypes || []);
        plan.choices = planOnly ? [] : unsupportedReferenceChoices(prompt);
    }
    const referenceMissing = referenceRequired && !body.hasReferences;
    if (referenceMissing) {
        plan.shouldGenerate = false;
        plan.decisions = withMissingReferenceDecision(plan.decisions);
        if (planOnly) plan.choices = [];
        else {
            plan.reply = "这个需求依赖你提到的参考素材，但当前还没有检测到附件。请先上传参考图，或选择无参考方案；我不会在缺少素材时创建任务。";
            plan.choices = missingReferenceChoices(prompt);
        }
    }
    return { ...plan, resolvedPrompt: withCreativeFoundation(plan.resolvedPrompt, plan.foundation), referenceRequired, referenceMissing };
}

export function directWorkbenchPlan(input: { body: WorkbenchRequestBody; prompt: string; workspace: WorkbenchWorkspace; skillIds: string[]; referenceRequired: boolean; planOnly: boolean; conversationOnly: boolean }) {
    const { body, prompt, workspace, skillIds } = input;
    const modelId = body.modelIds?.[0] || "";
    const current = body.currentConfig || {};
    const parameterPatch: Record<string, string | number> = { model: modelId };
    for (const key of workspace === "image" ? (["size", "quality", "count"] as const) : (["size", "vquality", "videoSeconds"] as const)) {
        const value = current[key];
        if (typeof value === "string" || typeof value === "number") parameterPatch[key] = value;
    }
    const mediaLabel = workspace === "image" ? "图片" : "视频";
    const plan: WorkbenchPlan = {
        intent: "generation",
        foundation: normalizeCreativeFoundation(undefined, prompt),
        deliverables: normalizeCreativeDeliverables(undefined, { title: `当前${mediaLabel}`, type: workspace, role: `使用手动选择模型生成当前${mediaLabel}` }),
        parameterPatch,
        resolvedPrompt: prompt,
        shouldGenerate: true,
        reply: `已按你手动选择的${mediaLabel}模型和当前参数创建生成任务。`,
        selectedSkillIds: skillIds,
        decisions: [],
    };
    return finalizeWorkbenchPlan(plan, input);
}

function selectedWorkbenchSkillIds(settings: AuthSettings, workspace: WorkbenchWorkspace, value: unknown) {
    if (!Array.isArray(value)) return [];
    const allowed = new Set(settings.agentSkills.filter((skill) => skill.enabled && (skill.workspaces || ["image"]).includes(workspace)).map((skill) => skill.id));
    return [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.has(item)))].slice(0, 8);
}

function withLockedModelDecision(decisions: WorkbenchPlanDecision[] | undefined, modelId: string, modelOptions: WorkbenchModelOption[] | undefined) {
    const option = modelOptions?.find((item) => item.id === modelId);
    return [{ label: "模型", value: option?.name || modelId, reason: "按你在输入区手动选择的模型执行" }, ...(decisions || []).filter((item) => item.label !== "模型")].slice(0, 5);
}

function workbenchModelOptions(settings: AuthSettings, workspace: WorkbenchWorkspace, referenceTypes: WorkbenchReferenceType[]): WorkbenchModelOption[] {
    return settings.logicalModels
        .filter(
            (model) =>
                model.enabled &&
                model.capability === workspace &&
                resolveLogicalModelCandidates(settings, workspace, model.id).some(
                    (candidate) => channelSupportsReferenceTypes(candidate.channel.advancedConfig, referenceTypes) && profileSupportsReferenceTypes(candidate.capabilityProfile, referenceTypes),
                ),
        )
        .map((model) => ({ id: model.id, name: model.name }));
}

function normalizeReferenceTypes(value: unknown, workspace: WorkbenchWorkspace): WorkbenchReferenceType[] {
    if (!Array.isArray(value)) return [];
    const allowed = workspace === "image" ? new Set<WorkbenchReferenceType>(["image"]) : new Set<WorkbenchReferenceType>(["image", "video", "audio"]);
    return [...new Set(value.filter((item): item is WorkbenchReferenceType => typeof item === "string" && allowed.has(item as WorkbenchReferenceType)))];
}

function channelSupportsReferenceTypes(config: AuthSettings["systemChannels"][number]["advancedConfig"], referenceTypes: WorkbenchReferenceType[]) {
    if (!referenceTypes.length || !config) return true;
    return referenceTypes.every((type) => (type === "image" ? config.supportsReferenceImage : type === "video" ? config.supportsReferenceVideo : config.supportsReferenceAudio));
}

function profileSupportsReferenceTypes(profile: ReturnType<typeof import("@/lib/model-routing-config").resolveLogicalModelCapabilityProfile>, referenceTypes: WorkbenchReferenceType[]) {
    return !profile || referenceTypes.every((type) => (type === "image" ? profile.supportsReferenceImage : type === "video" ? profile.supportsReferenceVideo : profile.supportsReferenceAudio));
}

function workbenchCurrentConfig(value: unknown, workspace: WorkbenchWorkspace, models: string[]) {
    const input = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const text = (field: string, maxLength = 32) => (typeof input[field] === "string" ? input[field].trim().slice(0, maxLength) : "");
    const modelKey = workspace === "image" ? "imageModel" : "videoModel";
    const model = text(modelKey, 160);
    if (workspace === "image") return { imageModel: models.includes(model) ? model : "", size: text("size"), quality: text("quality", 16), count: Math.max(1, Math.min(10, Math.floor(Number(input.count) || 1))) };
    return { videoModel: models.includes(model) ? model : "", size: text("size"), vquality: text("vquality", 16), videoSeconds: text("videoSeconds", 16) };
}

function withVideoReferenceDecision(decisions: WorkbenchPlanDecision[] | undefined) {
    const current = decisions || [];
    if (current.some((item) => /参考|主体一致|首帧/.test(`${item.label}${item.value}${item.reason}`))) return current;
    return [...current, { label: "参考一致性", value: "保留主体与首帧构图", reason: "只添加用户要求的动作和运镜，避免换人、换物或重做场景" }].slice(0, 5);
}

function withMissingReferenceDecision(decisions: WorkbenchPlanDecision[] | undefined) {
    const current = (decisions || []).filter((item) => !/参考|主体一致|首帧/.test(`${item.label}${item.value}${item.reason}`));
    return [...current, { label: "参考素材", value: "尚未上传", reason: "先上传参考图，或明确选择无参考方案后再创建生成任务" }].slice(0, 5);
}

function withMissingReferenceCapabilityDecision(decisions: WorkbenchPlanDecision[] | undefined, referenceTypes: WorkbenchReferenceType[]) {
    const current = (decisions || []).filter((item) => !/模型|参考能力|渠道能力/.test(`${item.label}${item.value}${item.reason}`));
    return [{ label: "参考能力", value: `${referenceTypeLabel(referenceTypes)}暂不可用`, reason: "后台没有启用支持当前附件类型的生成模型，继续执行可能退化成无参考生成" }, ...current].slice(0, 5);
}

function inferredDecisions(patch: Record<string, string | number>, currentConfig: Record<string, unknown> | undefined, modelOptions: WorkbenchModelOption[] | undefined, workspace: WorkbenchWorkspace) {
    const current = currentConfig || {};
    const modelId = String(patch.model || current[workspace === "image" ? "imageModel" : "videoModel"] || "");
    const model = modelOptions?.find((item) => item.id === modelId);
    const values = [
        modelId ? { label: "模型", value: model?.name || modelId, reason: "根据当前创作类型和后台可用能力选择" } : null,
        patch.size || current.size ? { label: "画幅", value: String(patch.size || current.size), reason: "匹配主体构图和主要展示场景" } : null,
        workspace === "image" && (patch.quality || current.quality) ? { label: "质量", value: String(patch.quality || current.quality), reason: "平衡细节表现、速度和生成成本" } : null,
        workspace === "image" && (patch.count || current.count) ? { label: "数量", value: `${patch.count || current.count} 张`, reason: "提供足够方案用于比较和筛选" } : null,
        workspace === "video" && (patch.vquality || current.vquality) ? { label: "清晰度", value: String(patch.vquality || current.vquality), reason: "兼顾画面细节和生成稳定性" } : null,
        workspace === "video" && (patch.videoSeconds || current.videoSeconds) ? { label: "时长", value: `${patch.videoSeconds || current.videoSeconds} 秒`, reason: "保证叙事动作完整且节奏紧凑" } : null,
    ];
    return values.filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 5);
}

function missingReferenceChoices(prompt: string): WorkbenchPlanChoice[] {
    return [
        { label: "上传参考图", description: "保留人物、产品或画面主体的一致性", action: "upload" },
        { label: "改为无参考方案", description: "让 Agent 重新设计主体、构图和视觉风格", action: "prompt", prompt: `不使用参考图，直接根据以下需求设计并生成：${prompt}` },
        { label: "先只做方案", description: "先给出构图、模型和参数建议，不创建任务", action: "prompt", prompt: `只分析并给出创作方案，不生成：${prompt}` },
    ];
}

function unsupportedReferenceChoices(prompt: string): WorkbenchPlanChoice[] {
    return [
        { label: "改为无参考方案", description: "移除附件依赖，由 Agent 重新设计主体和画面", action: "prompt", prompt: `不使用参考素材，直接根据以下需求重新设计并生成：${prompt}` },
        { label: "先只做方案", description: "保留创作分析，但不创建可能忽略附件的任务", action: "prompt", prompt: `只分析并给出创作方案，不生成：${prompt}` },
    ];
}

function referenceTypeLabel(types: WorkbenchReferenceType[]) {
    return [...new Set(types)].map((type) => (type === "image" ? "参考图" : type === "video" ? "参考视频" : "参考音频")).join("、") || "参考素材";
}

function requestsNoReference(prompt: string) {
    return /(?:不|无需|不用|不要)(?:再)?(?:使用|依赖|基于|参考)?(?:任何)?(?:参考图|参考照片|参考素材|参考视频|参考音频|附件)/i.test(prompt);
}

function requestsPlanOnly(prompt: string) {
    return /(?:只(?:分析|做方案|给出.{0,8}方案|规划)|不生成|不要生成|无需生成)/i.test(prompt);
}

function requestsConversation(prompt: string) {
    const text = prompt.trim();
    if (!text || requestsCreationAction(text)) return false;
    return /^(?:你在吗|在吗|你好|您好|嗨|哈喽|hello|hi|你是谁|你叫什么|谢谢|感谢|再见)[？?!！。,.\s]*$/i.test(text) || /(?:什么|为什么|怎么|如何|能否|可以|会不会|是不是).{0,24}[？?]\s*$/i.test(text);
}

function requestsCreationAction(prompt: string) {
    return /(?:生成|制作|创建|创作|画|绘制|设计|做一张|做个|做一个|拍一张|写实|改图|修图|编辑|美颜|精修|换背景|图生视频|文生视频|做视频|生成视频|animate|generate|create|design|draw|make\s+(?:an?\s+)?(?:image|video))/i.test(prompt);
}

function requestsExistingReference(prompt: string) {
    return (
        /(?:使用|用|基于|根据|依照|参照|以).{0,24}(?:我(?:提供|上传|给)的?|已上传的?|上传的|这张|该张|这幅|所附|附件中的?|参考(?:图|照片|素材|视频|音频|画面))/i.test(prompt) ||
        /(?:让|使).{0,12}(?:这张|该张|参考).{0,12}(?:图|照片|画面).{0,12}(?:动|动画|视频)/i.test(prompt) ||
        /(?:use|based on|animate).{0,24}(?:my|provided|uploaded|this|the)?\s*(?:reference|image|photo|video|audio)/i.test(prompt) ||
        /(?:image-to-video|img2video|i2v|图生视频)/i.test(prompt)
    );
}

function requestsEditAction(prompt: string) {
    return /(?:美颜|精修|修复|编辑|修改|调整|优化|去除|移除|抠图|换装|换背景|改成|变成)/i.test(prompt);
}
