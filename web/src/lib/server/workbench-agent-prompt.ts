import type { getAuthSettings } from "@/lib/auth/store";
import type { CreativeConversationContext } from "@/lib/creative-runtime-contract";
import type { WorkbenchRequestBody, WorkbenchWorkspace } from "./workbench-agent-policy";

type AuthSettings = Awaited<ReturnType<typeof getAuthSettings>>;
type WorkbenchSkill = AuthSettings["agentSkills"][number];

export function createWorkbenchPlanningMessages(input: {
    userId: string;
    prompt: string;
    body: WorkbenchRequestBody;
    workspace: WorkbenchWorkspace;
    referenceRequired: boolean;
    conversationOnly: boolean;
    skills: WorkbenchSkill[];
    conversationContext?: CreativeConversationContext;
}) {
    const { userId, prompt, body, workspace, referenceRequired, conversationOnly, skills, conversationContext } = input;
    const skillText = skills.map((skill) => `【${skill.name}】action=${skill.action || "generate"}; requiresReference=${Boolean(skill.requiresReference)}; defaults=${JSON.stringify(skill.defaultConfig || {})}\n${skill.instructions}`).join("\n\n");
    const currentModel = String(body.currentConfig?.[workspace === "image" ? "imageModel" : "videoModel"] || body.modelOptions?.[0]?.id || "");
    return [
        {
            role: "system",
            content: `你是 VOZEB PRO ${workspace === "image" ? "图片" : "视频"}创作 Agent，也能进行普通问答。先判断 intent：用户明确要求生成、制作、编辑媒体，或直接给出可执行视觉描述时为 generation；问候、闲聊、能力咨询、使用说明和知识问答为 conversation。conversation 必须 shouldGenerate=false、parameterPatch={}、decisions=[]、choices=[]，直接在 reply 回答，绝不创建媒体任务。generation 必须先形成 foundation：brief 说明目标、受众、使用场景、核心信息、约束和参考素材策略；direction 给出一个明确推荐的风格、构图/镜头、色彩、光线、视觉关键词和避免事项。普通单图/单视频为 simple；品牌系列、活动全案、多物料或明确要求成套方案时为 complex。deliverables 说明当前产物在整套方案中的角色，complex 可列配套物料，但本工作台本轮只执行当前 ${workspace === "image" ? "图片" : "视频"}。然后主动从 availableModels 中选择合适模型，并决定画幅、质量、数量或时长。availableModels 已按 referenceTypes 的真实渠道能力过滤，禁止选择或编造列表外模型。每次创作都必须在 parameterPatch 明确返回推荐的 model、size，以及图片的 quality/count 或视频的 vquality/videoSeconds；即使推荐值与 currentConfig 相同也不能省略。decisions 必须用 2–5 项说明“选择了什么、为什么”。reply 必须像创作伙伴一样直接回复用户：先概括推荐视觉方向，再说明会执行或为什么停止，不能只返回状态文案。视频工作台 hasReferences=true 时，resolvedPrompt 必须明确将参考素材作为首帧和主体依据，只添加用户要求的动作或运镜，不得擅自换人、换产品、换服装、换颜色、换背景或重做构图；decisions 必须说明参考一致性策略。信息足够且用户要求创作时应主动选择推荐方案并 shouldGenerate=true；只有用户明确只要规划、关键方向确实无法合理判断、或 referenceRequired=true 且缺少必需素材时才 shouldGenerate=false。referenceRequired=false 时不得仅因没有参考图阻止生成。存在互斥方向时提供 2–3 个 choices 供用户选择，推荐项放第一项；无需确认时 choices 返回空数组。服务端给出的 conversationOnly=true 时必须判定为 conversation。优先调用 plan_workbench_action。若上游不支持工具调用，必须直接返回与函数参数完全一致的单个 JSON 对象，不要 Markdown 或额外文本，严格仿照这个完整结构：${fallbackExample(workspace, currentModel)}。若 referenceRequired=true 且 hasReferences=false，shouldGenerate=false，并说明参考图的价值，同时提供上传参考图、改为无参考方案、先只做方案三个选择。不得暴露隐藏思维链，只输出可验证的决策摘要。\n${skillText}`,
        },
        {
            role: "user",
            content: JSON.stringify({
                userId,
                prompt,
                previousPrompt: body.previousPrompt || "",
                currentConfig: body.currentConfig || {},
                availableModels: body.modelOptions || [],
                hasReferences: Boolean(body.hasReferences),
                referenceTypes: body.referenceTypes || [],
                referenceRequired,
                conversationOnly,
                conversationContext: conversationContext
                    ? {
                          summary: conversationContext.summary,
                          recentMessages: conversationContext.recentMessages.map((message) => ({ role: message.role, content: message.content })),
                      }
                    : undefined,
            }),
        },
    ];
}

function fallbackExample(workspace: WorkbenchWorkspace, currentModel: string) {
    return JSON.stringify(
        workspace === "image"
            ? {
                  intent: "generation",
                  foundation: creativeFallback("image"),
                  deliverables: [{ title: "活动主视觉", type: "image", role: "作为首屏与传播物料的统一视觉母版" }],
                  parameterPatch: { model: currentModel, size: "16:9", quality: "high", count: 1 },
                  resolvedPrompt: "完整可执行的图片提示词",
                  shouldGenerate: true,
                  reply: "我建议采用横向纪实构图，并使用高质量单张方案。",
                  selectedSkillIds: [],
                  decisions: [
                      { label: "模型", value: currentModel, reason: "适合当前商业摄影需求" },
                      { label: "画幅", value: "16:9", reason: "容纳环境、人群和舞台关系" },
                  ],
                  choices: [],
              }
            : {
                  intent: "generation",
                  foundation: creativeFallback("video"),
                  deliverables: [{ title: "核心短视频", type: "video", role: "承载主要动作与传播节奏" }],
                  parameterPatch: { model: currentModel, size: "16:9", vquality: "720", videoSeconds: 5 },
                  resolvedPrompt: "完整可执行的视频提示词",
                  shouldGenerate: true,
                  reply: "我建议采用横向短镜头并保持动作连贯。",
                  selectedSkillIds: [],
                  decisions: [
                      { label: "模型", value: currentModel, reason: "适合当前视频创作需求" },
                      { label: "时长", value: "5 秒", reason: "动作完整且节奏紧凑" },
                  ],
                  choices: [],
              },
    );
}

export const workbenchTool = {
    type: "function",
    name: "plan_workbench_action",
    description: "形成创作决策、推荐参数并决定是否执行",
    parameters: {
        type: "object",
        properties: {
            intent: { type: "string", enum: ["conversation", "generation"] },
            foundation: {
                type: "object",
                properties: {
                    complexity: { type: "string", enum: ["simple", "complex"] },
                    brief: {
                        type: "object",
                        properties: {
                            objective: { type: "string", maxLength: 1000 },
                            audience: { type: "string", maxLength: 500 },
                            usage: { type: "string", maxLength: 500 },
                            coreMessage: { type: "string", maxLength: 800 },
                            constraints: { type: "array", maxItems: 12, items: { type: "string", maxLength: 300 } },
                            referenceStrategy: { type: "string", maxLength: 800 },
                        },
                        required: ["objective"],
                        additionalProperties: false,
                    },
                    direction: {
                        type: "object",
                        properties: {
                            summary: { type: "string", maxLength: 1000 },
                            style: { type: "string", maxLength: 500 },
                            composition: { type: "string", maxLength: 800 },
                            colors: { type: "array", maxItems: 12, items: { type: "string", maxLength: 80 } },
                            lighting: { type: "string", maxLength: 500 },
                            keywords: { type: "array", maxItems: 16, items: { type: "string", maxLength: 100 } },
                            avoid: { type: "array", maxItems: 12, items: { type: "string", maxLength: 200 } },
                        },
                        required: ["summary"],
                        additionalProperties: false,
                    },
                },
                required: ["complexity", "brief", "direction"],
                additionalProperties: false,
            },
            deliverables: {
                type: "array",
                minItems: 1,
                maxItems: 8,
                items: {
                    type: "object",
                    properties: { title: { type: "string", maxLength: 160 }, type: { type: "string", enum: ["text", "image", "video", "audio"] }, role: { type: "string", maxLength: 400 } },
                    required: ["title", "type", "role"],
                    additionalProperties: false,
                },
            },
            parameterPatch: {
                type: "object",
                properties: { size: { type: "string" }, quality: { type: "string" }, count: { type: "integer" }, model: { type: "string" }, videoSeconds: { type: ["string", "integer"] }, vquality: { type: "string" } },
                additionalProperties: false,
            },
            resolvedPrompt: { type: "string", maxLength: 12000 },
            shouldGenerate: { type: "boolean" },
            reply: { type: "string", maxLength: 1000 },
            selectedSkillIds: { type: "array", items: { type: "string" } },
            decisions: {
                type: "array",
                maxItems: 5,
                items: {
                    type: "object",
                    properties: { label: { type: "string" }, value: { type: "string" }, reason: { type: "string" } },
                    required: ["label", "value", "reason"],
                    additionalProperties: false,
                },
            },
            choices: {
                type: "array",
                maxItems: 3,
                items: {
                    type: "object",
                    properties: { label: { type: "string" }, description: { type: "string" }, prompt: { type: "string" }, action: { type: "string", enum: ["prompt", "upload"] } },
                    required: ["label", "description"],
                    additionalProperties: false,
                },
            },
        },
        required: ["intent", "foundation", "deliverables", "parameterPatch", "resolvedPrompt", "shouldGenerate", "reply", "decisions", "choices"],
        additionalProperties: false,
    },
};

function creativeFallback(workspace: WorkbenchWorkspace) {
    return {
        complexity: "simple",
        brief: { objective: workspace === "image" ? "完成一张可直接使用的核心画面" : "完成一段主体清晰、动作完整的核心视频", usage: workspace === "image" ? "线上视觉传播" : "短视频传播", coreMessage: "突出用户指定的主体和信息" },
        direction: {
            summary: "清晰、统一、具有明确视觉焦点",
            style: "克制的商业视觉",
            composition: workspace === "image" ? "主体明确，保留信息与呼吸空间" : "首帧明确，动作连续，镜头节奏稳定",
            keywords: ["统一", "清晰", "可用"],
            avoid: ["主体漂移", "无关装饰"],
        },
    };
}
