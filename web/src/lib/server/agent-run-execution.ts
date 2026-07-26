import { getAuthSettings, refundUserPoints, type LogicalModelCapability } from "@/lib/auth/store";
import { withCreativeFoundation, type CreativeReview } from "@/lib/creative-agent-contract";
import type { CreativeAsset, CreativeSurface } from "@/lib/creative-runtime-contract";
import { fetchInternalApi } from "@/lib/server/internal-origin";
import { resolveLogicalModel } from "@/lib/server/logical-model-router";
import { reviewCreativeOutputs } from "@/lib/server/creative-review-service";
import { strictJsonObjectText } from "@/lib/server/structured-model-output";
import { fetchOptionalResponses } from "@/lib/server/responses-request";
import { registerAgentTaskAssets } from "@/lib/server/agent-run-assets";
import { buildAgentProjectHandoff } from "@/lib/server/agent-run-project-handoff";
import { getAgentRun, updateAgentRunById, type AgentRun, type AgentRunChildTask, type AgentRunReference, type AgentRunTask } from "@/lib/server/agent-run-store";
import { assetAccessUrl, creativeAssetContext, resolveTaskReferences } from "@/lib/server/agent-run-surface-policy";
import { agentChildTaskTerminal, agentTaskCopies, resolveAgentTaskCount, resolveAgentVideoSeconds, validateAgentTaskResult, type AgentPlan } from "@/lib/server/agent-run-validation";
import { agentRunCompletionReply, agentRunFailureMessage, agentTaskCompletionMessage, resultSummary } from "@/lib/server/agent-run-messages";
import { getCreativeAssetsByIds } from "@/lib/server/creative-runtime-store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { linkStoredGenerationTask } from "@/lib/server/generation-task-store";
import type { AgentFunctionCallResult } from "./agent-function-call";
import { hasSystemAiCharge, readSystemAiBilling, systemAiBillingHeaders } from "./system-ai-billing";

const AGENT_WORK_COLUMN_X = 400;
const AGENT_NODE_START_Y = 96;
const AGENT_OUTPUT_OFFSET_Y = 260;

class AgentChildTaskTerminalError extends Error {}

export async function canContinue(id: string, executionId: string) {
    const run = await getAgentRun(id);
    return Boolean(run && run.executionId === executionId && !["paused", "cancelled", "completed"].includes(run.status));
}

export const agentPlanTool = {
    type: "function",
    name: "create_agent_plan",
    description: "创建创作计划",
    parameters: {
        type: "object",
        properties: {
            intent: { type: "string", enum: ["conversation", "generation"] },
            objective: { type: "string", maxLength: 1000 },
            audience: { type: "string", maxLength: 500 },
            reply: { type: "string", maxLength: 1200 },
            decisions: {
                type: "array",
                minItems: 2,
                maxItems: 6,
                items: {
                    type: "object",
                    properties: { label: { type: "string", maxLength: 80 }, value: { type: "string", maxLength: 200 }, reason: { type: "string", maxLength: 500 } },
                    required: ["label", "value", "reason"],
                    additionalProperties: false,
                },
            },
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
            brand: {
                type: "object",
                properties: { summary: { type: "string", maxLength: 1000 }, colors: { type: "array", maxItems: 20, items: { type: "string" } }, visualKeywords: { type: "array", maxItems: 30, items: { type: "string" } } },
                additionalProperties: false,
            },
            projectHandoff: {
                type: "object",
                properties: {
                    surface: { type: "string", enum: ["canvas", "drama"] },
                    title: { type: "string", maxLength: 120 },
                    summary: { type: "string", maxLength: 1200 },
                    style: { type: "string", maxLength: 200 },
                    ratio: { type: "string", enum: ["9:16", "16:9"] },
                    assetIds: { type: "array", maxItems: 20, items: { type: "string", maxLength: 160 } },
                },
                required: ["surface", "title"],
                additionalProperties: false,
            },
            deliverables: {
                type: "array",
                minItems: 0,
                maxItems: 50,
                items: {
                    type: "object",
                    properties: {
                        title: { type: "string", maxLength: 200 },
                        id: { type: "string", maxLength: 120 },
                        targetNodeId: { type: "string", maxLength: 160 },
                        type: { type: "string", enum: ["text", "image", "video", "audio"] },
                        model: { type: "string", maxLength: 160 },
                        prompt: { type: "string", maxLength: 4000 },
                        count: { type: "number", minimum: 1, maximum: 10 },
                        ratio: { type: "string", maxLength: 20 },
                        quality: { type: "string", maxLength: 20 },
                        seconds: { type: "number", minimum: 1, maximum: 20 },
                        voice: { type: "string", maxLength: 80 },
                        format: { type: "string", maxLength: 20 },
                        dependencies: { type: "array", maxItems: 20, items: { type: "string", maxLength: 120 } },
                        assetIds: { type: "array", maxItems: 20, items: { type: "string", maxLength: 160 } },
                    },
                    required: ["title", "type", "model", "prompt"],
                    additionalProperties: false,
                },
            },
        },
        required: ["intent", "objective", "reply", "decisions", "foundation", "deliverables"],
        additionalProperties: false,
    },
};

export function planToOps(plan: AgentPlan, tasks: AgentRunTask[], runId: string, snapshot: unknown) {
    const briefId = `brief-${runId}`;
    const brandId = `brand-${runId}`;
    const ops: unknown[] = [
        {
            type: "add_node",
            id: briefId,
            nodeType: "brief",
            title: "创作简报",
            position: { x: 0, y: AGENT_NODE_START_Y },
            metadata: { agentRunId: runId, agentBrief: { ...plan.foundation.brief, deliverables: plan.deliverables } },
        },
        { type: "add_node", id: brandId, nodeType: "brand-kit", title: "视觉方向", position: { x: 0, y: AGENT_NODE_START_Y + 320 }, metadata: { agentRunId: runId, brandKit: { ...plan.foundation.direction, approvedNodeIds: [], rejectedNodeIds: [] } } },
    ];
    const taskNodeIds = new Map(plan.deliverables.map((item, index) => [item.id?.trim() || `task-${index}`, `task-${runId}-${index}`]));
    const existingNodeIds = new Set(snapshotNodes(snapshot).keys());
    plan.deliverables.forEach((item, index) => {
        const logicalId = item.id?.trim() || `task-${index}`;
        const taskId = taskNodeIds.get(logicalId)!;
        const targetNodeId = item.targetNodeId && existingNodeIds.has(item.targetNodeId) ? item.targetNodeId : undefined;
        ops.push(
            {
                type: "add_node",
                id: taskId,
                nodeType: "task",
                title: item.title,
                position: { x: AGENT_WORK_COLUMN_X, y: AGENT_NODE_START_Y + index * 300 },
                metadata: { agentRunId: runId, agentTaskId: logicalId, targetNodeId, model: tasks[index]?.model, prompt: item.prompt, agentTaskType: item.type, agentTaskStatus: "ready", agentTaskAttempts: 0, dependencies: item.dependencies || [] },
            },
            { type: "connect_nodes", fromNodeId: briefId, toNodeId: taskId },
            { type: "connect_nodes", fromNodeId: brandId, toNodeId: taskId },
        );
        if (targetNodeId) ops.push({ type: "connect_nodes", fromNodeId: targetNodeId, toNodeId: taskId });
        for (const dependency of item.dependencies || []) {
            const dependencyNodeId = taskNodeIds.get(dependency);
            if (dependencyNodeId) ops.push({ type: "connect_nodes", fromNodeId: dependencyNodeId, toNodeId: taskId });
        }
    });
    return ops;
}

export function normalizeTasks(
    plan: AgentPlan,
    skills: Awaited<ReturnType<typeof getAuthSettings>>["agentSkills"],
    settings: Awaited<ReturnType<typeof getAuthSettings>>,
    snapshot: unknown,
    requestPrompt: string,
    surface: CreativeSurface,
    referencedAssets: CreativeAsset[],
): AgentRunTask[] {
    const defaults = Object.assign({}, ...skills.map((skill) => skill.defaultConfig || {})) as Record<string, unknown>;
    const globalDefaults = settings.generationDefaults;
    const nodes = snapshotNodes(snapshot);
    const assets = new Map(referencedAssets.map((asset) => [asset.id, asset]));
    return plan.deliverables.map((item, index) => {
        const target = surface === "canvas" && item.targetNodeId ? nodes.get(item.targetNodeId) : undefined;
        const selectedAssets = target ? [] : resolveTaskReferences(item.assetIds, assets, item.type);
        const references = [
            ...(target?.url && target.type ? [{ url: target.url, type: target.type }] : []),
            ...selectedAssets.flatMap((asset) => {
                const url = assetAccessUrl(asset);
                return url && asset.type !== "text" ? [{ assetId: asset.id, url, type: asset.type }] : [];
            }),
        ] satisfies AgentRunReference[];
        const primaryReference = references[0];
        const referenceContext = selectedAssets.map(creativeAssetContext).join("\n");
        return {
            id: item.id?.trim() || `task-${index}`,
            targetNodeId: target ? item.targetNodeId : undefined,
            referenceAssetId: selectedAssets[0]?.id,
            referenceUrl: primaryReference?.url,
            referenceType: primaryReference?.type,
            references,
            title: item.title.trim(),
            type: item.type,
            model: resolvePlannedModel(settings, item.type, item.model),
            prompt: `${withCreativeFoundation(item.prompt.trim(), plan.foundation)}${textConstraintInstruction(requestPrompt, item.type)}${target ? `\n\n基于画布已有节点进行局部修改：${target.summary}` : ""}${referenceContext ? `\n\n使用已引用创作资产：${referenceContext}` : ""}`,
            count: resolveAgentTaskCount(item.type, item.count, defaults.count, globalDefaults.canvasImageCount),
            ratio: item.ratio?.trim() || textDefault(defaults.size) || (["image", "video"].includes(item.type) ? globalDefaults.imageSize : undefined),
            quality: item.quality?.trim() || textDefault(item.type === "video" ? defaults.vquality : defaults.quality) || (item.type === "video" ? globalDefaults.videoQuality : item.type === "image" ? globalDefaults.imageQuality : undefined),
            seconds: resolveAgentVideoSeconds(item.type, item.seconds, defaults.videoSeconds, globalDefaults.videoSeconds),
            voice: item.voice?.trim() || textDefault(defaults.voice) || (item.type === "audio" ? globalDefaults.audioVoice : undefined),
            format: item.format?.trim() || textDefault(defaults.format) || (item.type === "audio" ? globalDefaults.audioFormat : undefined),
            dependencies: item.dependencies || [],
            status: "ready",
            attempts: 0,
        };
    });
}

export function agentModelOptions(settings: Awaited<ReturnType<typeof getAuthSettings>>) {
    return settings.logicalModels
        .filter((model) => model.enabled && resolveLogicalModel(settings, model.capability, model.id))
        .map((model) => {
            const resolved = resolveLogicalModel(settings, model.capability, model.id);
            return { id: model.id, name: model.name, capability: model.capability, capabilityProfile: resolved?.capabilityProfile };
        });
}

export function directAgentPlan(models: Array<ReturnType<typeof agentModelOptions>[number]>, prompt: string, assetIds: string[]): AgentPlan {
    if (!models.length || models.some((model) => model.capability === "text")) throw new Error("当前模型不支持直接生成媒体");
    return {
        intent: "generation",
        objective: prompt,
        reply: `已按你的选择使用 ${models.map((model) => `「${model.name}」`).join("、")} 分别执行生成。`,
        decisions: [{ label: "模型", value: models.map((model) => model.name).join("、"), reason: "使用你在模型面板中明确选择的模型，不再由智能规划改选" }],
        foundation: {
            complexity: "simple",
            brief: { objective: prompt, ...(assetIds.length ? { referenceStrategy: "使用已引用素材作为生成参考" } : {}) },
            direction: { summary: "严格执行用户当前描述和所选 Skill 约束" },
        },
        deliverables: models.map((model, index) => ({
            id: `direct-model-task-${index + 1}`,
            title: `${model.name} 生成`,
            type: model.capability as "image" | "video" | "audio",
            model: model.id,
            prompt,
            count: 1,
            dependencies: [],
            assetIds,
        })),
    };
}

function defaultModel(settings: Awaited<ReturnType<typeof getAuthSettings>>, capability: LogicalModelCapability) {
    const model = capability === "image" ? settings.defaultModels.imageModel : capability === "video" ? settings.defaultModels.videoModel : capability === "audio" ? settings.defaultModels.audioModel : settings.defaultModels.textModel;
    return model && resolveLogicalModel(settings, capability, model) ? model : "";
}

function resolvePlannedModel(settings: Awaited<ReturnType<typeof getAuthSettings>>, capability: LogicalModelCapability, planned: unknown) {
    const model = typeof planned === "string" ? planned.trim() : "";
    if (model && resolveLogicalModel(settings, capability, model)) return model;
    return defaultModel(settings, capability) || undefined;
}

export function agentPlanFallbackExample(models: ReturnType<typeof agentModelOptions>) {
    const sample = models.find((model) => model.capability === "image") || models[0];
    return JSON.stringify({
        intent: "generation",
        objective: "为新品发布制作一套统一视觉",
        audience: "关注产品设计与科技体验的用户",
        reply: "我建议先建立横版主视觉，再基于同一风格生成配套文案，保证主体和传播语一致。",
        decisions: [
            { label: "模型", value: sample?.name || sample?.id || "可用逻辑模型", reason: "匹配当前产物类型和画面表现需求" },
            { label: "画幅", value: "16:9", reason: "适合发布会舞台、网页头图和横屏展示" },
        ],
        foundation: {
            complexity: "complex",
            brief: {
                objective: "为新品发布制作一套统一视觉",
                audience: "关注产品设计与科技体验的用户",
                usage: "发布会、官网与社交传播",
                coreMessage: "突出产品设计和可靠体验",
                constraints: ["不夸大功能"],
                referenceStrategy: "优先保持已有产品素材的外观与颜色",
            },
            direction: {
                summary: "克制、现代、可信",
                style: "纪实科技商业视觉",
                composition: "以产品为中心，保留文案和延展空间",
                colors: ["深灰", "暖白"],
                lighting: "柔和轮廓光与清晰材质光",
                keywords: ["纪实", "高级", "清晰层次"],
                avoid: ["过度赛博", "无关装饰"],
            },
        },
        brand: { summary: "克制、现代、可信", colors: ["深灰", "暖白"], visualKeywords: ["纪实", "高级", "清晰层次"] },
        deliverables: [
            {
                id: "main-visual",
                title: "发布会主视觉",
                type: sample?.capability || "image",
                model: sample?.id || "",
                prompt: "生成完整可执行的主视觉提示词",
                count: 1,
                ratio: "16:9",
                quality: "high",
                seconds: 5,
                voice: "alloy",
                format: "mp3",
                dependencies: [],
                assetIds: [],
            },
        ],
    });
}

export function isCanvasConversationPrompt(prompt: string) {
    const text = prompt.trim();
    if (!text || requestsCanvasAction(text)) return false;
    return /^(?:你在吗|在吗|你好|您好|嗨|哈喽|hello|hi|你是谁|你叫什么|谢谢|感谢|再见)[？?!！。,.\s]*$/i.test(text) || /(?:什么|为什么|怎么|如何|能否|可以|会不会|是不是).{0,24}[？?]\s*$/i.test(text);
}

function requestsCanvasAction(prompt: string) {
    return /(?:生成|制作|创建|新增|添加|画|绘制|设计|写一个|写一段|改写|修改|编辑|删除|移除|移动|缩放|放大|缩小|连接|连线|选中|排列|整理|导入|放到画布|加入画布|节点|图片|视频|音频|文案|文字|海报|主视觉|generate|create|add|edit|delete|remove|move|connect|draw|design)/i.test(
        prompt,
    );
}

function snapshotNodes(snapshot: unknown) {
    const map = new Map<string, { summary: string; url?: string; type?: "image" | "video" | "audio" }>();
    const nodes = snapshot && typeof snapshot === "object" && Array.isArray((snapshot as { nodes?: unknown }).nodes) ? (snapshot as { nodes: Array<Record<string, unknown>> }).nodes : [];
    for (const node of nodes) {
        if (typeof node.id !== "string") continue;
        const metadata = node.metadata && typeof node.metadata === "object" ? (node.metadata as Record<string, unknown>) : {};
        const content = [metadata.content, metadata.prompt].find((item) => typeof item === "string" && item);
        const url = [metadata.remoteUrl, metadata.serverUrl, metadata.url, metadata.dataUrl].find((item) => typeof item === "string" && item) as string | undefined;
        const type = node.type === "image" || node.type === "video" || node.type === "audio" ? node.type : undefined;
        map.set(node.id, { summary: `${String(node.title || node.type || "节点").slice(0, 200)}${content ? `；内容：${String(content).slice(0, 2000)}` : ""}${url && !url.startsWith("data:") ? `；素材：${url.slice(0, 2000)}` : ""}`, url, type });
    }
    return map;
}

function textDefault(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
export async function executeTasks(runId: string, origin: string, cookie: string, executionId: string) {
    while (await canContinue(runId, executionId)) {
        const run = await getAgentRun(runId);
        if (!run) return;
        const completed = new Set(run.tasks.filter((task) => task.status === "completed").map((task) => task.id));
        const next = run.tasks.find((task) => (task.status === "ready" || task.status === "running") && task.dependencies.every((id) => completed.has(id)));
        if (!next) {
            if (run.tasks.every((task) => task.status === "completed")) {
                if (!run.reviewed) {
                    const review = await reviewCompletedTasks(run, origin, cookie);
                    if (review.retryTaskIds.length) {
                        await updateAgentRunById(
                            runId,
                            {
                                reviewed: true,
                                review,
                                tasks: run.tasks.map((task) =>
                                    review.retryTaskIds.includes(task.id)
                                        ? { ...task, status: "ready", attempts: 0, taskId: undefined, result: undefined, error: undefined, prompt: `${task.prompt}\n\n复盘修正：${reviewCorrection(review, task.id)}` }
                                        : task,
                                ),
                            },
                            { type: "run.review.retry", data: { review } },
                            ["running"],
                            executionId,
                        );
                        continue;
                    }
                    await updateAgentRunById(runId, { reviewed: true, review }, { type: review.status === "unavailable" ? "run.review.unavailable" : "run.review.passed", data: { review } }, ["running"], executionId);
                }
                let completedRun = (await getAgentRun(runId)) || run;
                const projectHandoff = await buildAgentProjectHandoff(completedRun);
                if (projectHandoff && !completedRun.projectHandoffEmitted) {
                    const emitted = await updateAgentRunById(runId, { projectHandoffEmitted: true }, { type: "project.handoff", data: projectHandoff }, ["running"], executionId);
                    if (!emitted) return;
                    completedRun = emitted;
                }
                const reply = `${agentRunCompletionReply(completedRun)}${projectHandoff ? `\n\n已创建${projectHandoff.surface === "canvas" ? "画布" : "短剧"}项目「${projectHandoff.title}」，可以从当前对话直接打开。` : ""}`;
                await updateAgentRunById(runId, { status: "completed", executionId: undefined }, { type: "run.completed", data: { completed: completedRun.tasks.length, assetIds: completedRun.assetIds, projectHandoff, reply } }, ["running"], executionId);
                return;
            }
            const blocked = run.tasks.filter((task) => task.status === "ready");
            await updateAgentRunById(
                runId,
                { status: "failed", executionId: undefined, tasks: blocked.length ? run.tasks.map((task) => (task.status === "ready" ? { ...task, status: "failed", error: "前置任务未完成" } : task)) : run.tasks },
                { type: "run.failed", data: { message: agentRunFailureMessage(run.tasks) } },
                ["running"],
                executionId,
            );
            return;
        }
        await runTaskWithRetry(runId, next, origin, cookie, executionId);
    }
}

async function reviewCompletedTasks(run: AgentRun, origin: string, cookie: string) {
    const foundation = run.foundation || {
        complexity: "complex" as const,
        brief: { objective: run.prompt },
        direction: { summary: "保持所有产物的主体、信息和视觉语言一致" },
    };
    return reviewCreativeOutputs({
        origin,
        cookie,
        userId: run.userId,
        billingId: run.id,
        foundation,
        tasks: run.tasks.map((task) => ({ id: task.id, title: task.title, type: task.type, prompt: task.prompt, resultSummary: resultSummary(task.result), imageUrls: task.type === "image" ? taskImageUrls(task.result) : [] })),
    });
}

export async function requestFunctionCall(
    origin: string,
    cookie: string,
    channelId: string,
    model: string,
    input: Array<{ role: string; content: string }>,
    tool: typeof agentPlanTool,
    name: string,
    signal: AbortSignal,
    userId: string,
    billingModel: string,
    allowNaturalLanguage = false,
    pointsIdempotencyKey?: string,
) {
    const base = `${origin}/api/ai/system/${encodeURIComponent(channelId)}`;
    const requestHeaders = { "Content-Type": "application/json", cookie, ...systemAiBillingHeaders(billingModel, pointsIdempotencyKey) };
    const response = await fetchOptionalResponses(`${base}/responses`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ model, input, tools: [tool], tool_choice: { type: "function", name } }),
        cache: "no-store",
        signal,
    });
    if (response?.ok) {
        const payload = (await response.json()) as { output_text?: string; output?: Array<{ type?: string; name?: string; arguments?: string; content?: Array<{ type?: string; text?: string }> }> };
        const call = payload.output?.find((item) => item.type === "function_call" && item.name === name);
        if (call?.arguments) return readFunctionCallResult(call.arguments, response.headers);
        const naturalText = allowNaturalLanguage ? responseOutputText(payload) : "";
        if (naturalText) return readFunctionCallResult(naturalText, response.headers);
        await refundTextResponse(userId, billingModel, response.headers);
    }
    const fallback = await fetchInternalApi(`${base}/chat/completions`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ model, messages: input, tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }], tool_choice: { type: "function", function: { name } } }),
        cache: "no-store",
        signal,
    });
    if (!fallback.ok) throw new Error((await fallback.text()) || "后台模型调用失败");
    const payload = (await fallback.json()) as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
    const message = payload.choices?.[0]?.message;
    const argumentsText = message?.tool_calls?.find((item) => item.function?.name === name)?.function?.arguments || strictJsonObjectText(message?.content) || (allowNaturalLanguage ? message?.content?.trim() : "");
    if (!argumentsText) {
        await refundTextResponse(userId, billingModel, fallback.headers);
        throw new Error("模型没有返回所需的结构化结果");
    }
    return readFunctionCallResult(argumentsText, fallback.headers);
}

export function responseOutputText(payload: { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }) {
    const direct = payload.output_text?.trim();
    if (direct) return direct;
    return (
        payload.output
            ?.flatMap((item) => item.content || [])
            .find((item) => item.type === "output_text" && item.text?.trim())
            ?.text?.trim() || ""
    );
}

export function readFunctionCallResult(argumentsText: string, headers: Headers): AgentFunctionCallResult {
    const pointsRemaining = Number(headers.get("x-vozeb-pro-points-remaining"));
    return {
        arguments: argumentsText,
        pointsRemaining: Number.isFinite(pointsRemaining) ? pointsRemaining : undefined,
        ...readSystemAiBilling(headers),
    };
}

export async function refundFunctionCall(userId: string, model: string, call: AgentFunctionCallResult) {
    if (hasSystemAiCharge(call)) await refundUserPoints(userId, model, call.pointsCost, "text", 1, undefined, call.pointsRecordId);
}

export async function refundTextResponse(userId: string, model: string, headers: Headers) {
    const billing = readSystemAiBilling(headers);
    if (hasSystemAiCharge(billing)) await refundUserPoints(userId, model, billing.pointsCost, "text", 1, undefined, billing.pointsRecordId);
}

export async function runTaskWithRetry(runId: string, task: AgentRunTask, origin: string, cookie: string, executionId: string) {
    const attempt = task.taskId || task.childTasks?.some((child) => child.status === "pending") ? Math.max(1, task.attempts) : task.attempts + 1;
    if (!(await canContinue(runId, executionId))) return;
    if (!(await patchTask(runId, task.id, { status: "running", attempts: attempt, error: undefined }, "task.running", executionId))) return;
    try {
        const activeRun = await getAgentRun(runId);
        if (!activeRun || activeRun.executionId !== executionId) return;
        const currentTask = activeRun.tasks.find((item) => item.id === task.id) || task;
        const executableTask = await withDependencyContext(runId, currentTask);
        const dispatched = await dispatchTask(executableTask, origin, cookie, await getAuthSettings(), activeRun, executionId, attempt);
        const result = normalizeConstrainedTextResult(task, dispatched.result, attempt);
        validateAgentTaskResult(task.type, result);
        await patchTask(runId, task.id, {}, "task.validated", executionId);
        const registered = await registerAgentTaskAssets(activeRun, { ...executableTask, attempts: attempt, result }, result, dispatched.sourceTaskIds);
        await patchTask(
            runId,
            task.id,
            {
                status: "completed",
                result,
                error: undefined,
                taskId: dispatched.sourceTaskIds.at(-1),
                taskIds: dispatched.sourceTaskIds,
                assetIds: registered.map((asset) => asset.id),
                referenceAssetId: executableTask.referenceAssetId,
                referenceUrl: executableTask.referenceUrl,
                referenceType: executableTask.referenceType,
                references: executableTask.references,
            },
            "task.completed",
            executionId,
        );
    } catch (error) {
        const message = toSafeGenerationErrorMessage(error, "生成任务失败");
        if (await canContinue(runId, executionId)) await patchTask(runId, task.id, { status: "failed", error: message }, "task.failed", executionId);
    }
}

export async function resumeDispatchedTask(run: AgentRun, task: AgentRunTask, taskId: string, attempt: number, origin: string, cookie: string, executionId: string) {
    await linkAgentChildTask(run, task, taskId, attempt);
    return { result: await pollTask(origin, taskPath(task.type), taskId, cookie, run.id, task.type, executionId), sourceTaskIds: [taskId] };
}

export function textConstraintInstruction(prompt: string, type: AgentRunTask["type"]) {
    if (type !== "text") return "";
    const limit = requestedTextLimit(prompt);
    const concise = /只需要|只返回|只输出|不要解释|直接(?:给|说|返回|输出)|别(?:解释|啰嗦|展开)/.test(prompt);
    return limit || concise ? `\n\n严格输出要求：${limit ? `最终结果不得超过 ${limit} 个 Unicode 字符；` : ""}${concise ? "只输出最终文本，不要标题、Markdown、解释或列表。" : ""}` : "";
}

export function normalizeConstrainedTextResult(task: AgentRunTask, value: unknown, attempt: number) {
    if (task.type !== "text" || !value || typeof value !== "object") return value;
    const limit = requestedTextLimit(task.prompt);
    const content = String((value as Record<string, unknown>).content || "").trim();
    if (!limit || Array.from(content).length <= limit) return value;
    if (attempt < 3) throw new Error(`文本超过 ${limit} 字限制，正在自动重写`);
    return { ...(value as Record<string, unknown>), content: Array.from(content).slice(0, limit).join("") };
}

export function requestedTextLimit(prompt: string) {
    return Number(prompt.match(/(?:不超过|最多|控制在|限|)(\d{1,3})\s*字(?:以内|以下|之内)?/)?.[1] || 0);
}

export async function withDependencyContext(runId: string, task: AgentRunTask): Promise<AgentRunTask> {
    if (!task.dependencies.length) return task;
    const run = await getAgentRun(runId);
    const dependencies = run?.tasks.filter((item) => task.dependencies.includes(item.id) && item.status === "completed") || [];
    const dependencyAssets = await getCreativeAssetsByIds(Array.from(new Set(dependencies.flatMap((item) => item.assetIds || []))));
    const dependencyReferences = dependencyAssets.flatMap((asset) => {
        const url = assetAccessUrl(asset);
        if (!url || !acceptsMediaReference(task.type, asset.type)) return [];
        return [{ assetId: asset.id, sourceTaskId: asset.sourceTaskId, url, type: asset.type }] satisfies AgentRunReference[];
    });
    const references = mergeTaskReferences(taskReferences(task), dependencyReferences);
    const taskContext = dependencies
        .map((item) => `【${item.title}】${resultSummary(item.result)}`)
        .filter((item) => item.length > 4)
        .join("\n");
    const assetContext = dependencyAssets.map(creativeAssetContext).join("\n");
    const context = [taskContext, assetContext].filter(Boolean).join("\n");
    const primaryReference = references[0];
    return {
        ...task,
        referenceAssetId: primaryReference?.assetId || task.referenceAssetId,
        referenceUrl: primaryReference?.url || task.referenceUrl,
        referenceType: primaryReference?.type || task.referenceType,
        references,
        prompt: context ? `${task.prompt}\n\n请保持与以下已完成产物一致，并将依赖媒体作为真实生成参考：\n${context}` : task.prompt,
    };
}

export function taskReferences(task: AgentRunTask): AgentRunReference[] {
    if (task.references?.length) return task.references;
    return task.referenceUrl && task.referenceType ? [{ assetId: task.referenceAssetId, url: task.referenceUrl, type: task.referenceType }] : [];
}

export function mergeTaskReferences(current: AgentRunReference[], additions: AgentRunReference[]) {
    const references = new Map(current.map((item) => [`${item.type}:${item.url}`, item]));
    additions.forEach((item) => references.set(`${item.type}:${item.url}`, item));
    return Array.from(references.values()).slice(0, 20);
}

export function acceptsMediaReference(taskType: AgentRunTask["type"], assetType: CreativeAsset["type"]): assetType is "image" | "video" | "audio" {
    if (taskType === "image") return assetType === "image";
    if (taskType === "video") return assetType === "image" || assetType === "video" || assetType === "audio";
    return false;
}

export function taskPath(type: AgentRunTask["type"]) {
    return type === "image" ? "/api/image-tasks" : type === "video" ? "/api/video-tasks" : type === "audio" ? "/api/audio-tasks" : "/api/text-tasks";
}

export async function dispatchTask(task: AgentRunTask, origin: string, cookie: string, settings: Awaited<ReturnType<typeof getAuthSettings>>, run: AgentRun, executionId: string, attempt: number) {
    const directTextContent = run.surface === "canvas" ? directCanvasTextContent(task) : null;
    if (directTextContent) return { result: { content: directTextContent }, sourceTaskIds: [`direct-${run.id}-${task.id}`] };
    const model = resolvePlannedModel(settings, task.type, task.model);
    const resolved = resolveLogicalModel(settings, task.type, model || "");
    const channel = resolved?.channel;
    if (!model || !channel || !resolved) throw new Error(`后台尚未配置可用的默认${task.type === "image" ? "图片" : task.type === "video" ? "视频" : task.type === "audio" ? "音频" : "文本"}模型`);
    const config = {
        apiSource: "system",
        baseUrl: `/api/ai/system/${encodeURIComponent(channel.id)}`,
        apiKey: "",
        apiFormat: channel.apiFormat || "openai",
        model,
        ...(task.type === "image" ? { quality: task.quality || "high", size: task.ratio || "auto" } : {}),
        ...(task.type === "video" ? { size: task.ratio || "16:9", videoSeconds: String(task.seconds || 5), vquality: task.quality || "720", videoGenerateAudio: "true", videoWatermark: "false" } : {}),
        ...(task.type === "audio" ? { voice: task.voice || "alloy", format: task.format || "mp3", speed: "1" } : {}),
    };
    const path = task.type === "image" ? "/api/image-tasks" : task.type === "video" ? "/api/video-generation-tasks" : task.type === "audio" ? "/api/audio-tasks" : "/api/text-tasks";
    const references = taskReferences(task);
    const source = run.surface === "canvas" ? "canvas" : run.surface === "drama" ? "drama" : "agent";
    const context = { conversationId: run.conversationId, runId: run.id, surface: run.surface, projectId: run.projectId, parentTaskId: task.id, attemptNo: attempt, clientRequestId: `${run.clientRequestId}:${task.id}:${attempt}` };
    const body =
        task.type === "image"
            ? {
                  config,
                  prompt: task.prompt,
                  source,
                  title: task.title,
                  kind: references.length ? "edit" : "generation",
                  references: references.filter((item) => item.type === "image").map((item) => ({ dataUrl: "", url: item.url })),
                  context,
              }
            : task.type === "video"
              ? { config, prompt: task.prompt, references: references.map((item) => ({ type: item.type, url: item.url })), source, context }
              : task.type === "audio"
                ? { config, prompt: task.prompt, source, context }
                : { config, messages: [{ role: "user", content: task.prompt }] };
    const results: unknown[] = [];
    const sourceTaskIds = Array.from(new Set(task.taskIds || []));
    const childTasks = normalizeChildTasks(task);
    const copies = agentTaskCopies(task.type, task.count);
    for (let index = 0; index < copies; index += 1) {
        if (!(await canContinue(run.id, executionId))) throw new Error("Agent Run 已暂停、取消或已由新执行器接管");
        let child = childTasks[index];
        let taskId = child?.id;
        if (!taskId) {
            const response = await fetchInternalApi(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body), cache: "no-store" });
            if (!response.ok) throw new Error((await response.text()) || "生成任务创建失败");
            const payload = (await response.json()) as { task?: { id?: string } };
            const createdTaskId = payload.task?.id;
            if (!createdTaskId) throw new Error("生成任务未返回任务 ID");
            taskId = createdTaskId;
            await linkAgentChildTask(run, task, taskId, attempt);
            child = { id: taskId, status: "pending", attempt };
            childTasks[index] = child;
            sourceTaskIds.push(taskId);
            if (!(await patchTask(run.id, task.id, { taskId, taskIds: [...new Set(sourceTaskIds)], childTasks: [...childTasks] }, "task.created", executionId))) throw new Error("Agent Run 已由新执行器接管");
        } else if (!sourceTaskIds.includes(taskId)) {
            sourceTaskIds.push(taskId);
        }
        if (child?.status === "completed") {
            results.push(child.result);
            continue;
        }
        const result = await pollTask(origin, task.type === "video" ? "/api/video-tasks" : path, taskId, cookie, run.id, task.type, executionId);
        childTasks[index] = { id: taskId, status: "completed", attempt: child?.attempt || attempt, result };
        if (!(await patchTask(run.id, task.id, { taskId, taskIds: [...new Set(sourceTaskIds)], childTasks: [...childTasks] }, "task.child.completed", executionId))) throw new Error("Agent Run 已由新执行器接管");
        results.push(result);
    }
    return { result: results.length === 1 ? results[0] : { results }, sourceTaskIds };
}

function normalizeChildTasks(task: AgentRunTask): AgentRunChildTask[] {
    if (task.childTasks?.length) return task.childTasks.slice(0, 10);
    const ids = task.taskIds?.length ? task.taskIds : task.taskId ? [task.taskId] : [];
    return ids.slice(0, 10).map((id) => ({ id, status: "pending", attempt: Math.max(1, task.attempts) }));
}

export function linkAgentChildTask(run: AgentRun, task: AgentRunTask, taskId: string, attempt: number) {
    return linkStoredGenerationTask(task.type, taskId, {
        conversationId: run.conversationId,
        runId: run.id,
        surface: run.surface,
        projectId: run.projectId,
        parentTaskId: run.id,
        attemptNo: attempt,
    });
}

export function directCanvasTextContent(task: AgentRunTask) {
    if (task.type !== "text") return null;
    const prompt = task.prompt.split(/\n\n(?:严格输出要求|基于画布已有节点|请保持与以下已完成产物一致)：/u)[0]?.trim() || "";
    if (!/(?:文字|文本|内容|文案|标题).{0,16}(?:节点|卡片|便签)|(?:节点|卡片|便签).{0,16}(?:文字|文本|内容|文案|标题)|画布/u.test(prompt)) return null;
    const quoted = prompt.match(/(?:内容|文字|文本|文案|标题)[^“"「『'`]{0,18}(?:写(?:着|成)?|写为|为|是|设置为|设为|改为|改成|填(?:写)?为)[:：\s]*[“"「『'`]([^”"」』'`]{1,500})[”"」』'`]/u);
    if (quoted?.[1]?.trim()) return quoted[1].trim();
    const displayed = prompt.match(/(?:写着|写有|显示|展示)[:：\s]*[“"「『'`]([^”"」』'`]{1,500})[”"」』'`]/u);
    if (displayed?.[1]?.trim()) return displayed[1].trim();
    const plain = prompt.match(/(?:内容|文字|文本|文案|标题)[^，。；;\n]{0,18}(?:写(?:成)?|写为|为|是|设置为|设为|改为|改成|填(?:写)?为)[:：\s]*([^，。；;\n]{1,160})/u);
    return plain?.[1]?.trim() || null;
}

export async function pollTask(origin: string, path: string, taskId: string, cookie: string, runId: string, type: AgentRunTask["type"], executionId: string) {
    const attempts = type === "video" ? 600 : 360;
    for (let index = 0; index < attempts; index += 1) {
        if (!(await canContinue(runId, executionId))) throw new Error("Agent Run 已暂停、取消或已由新执行器接管");
        const response = await fetchInternalApi(`${origin}${path}/${encodeURIComponent(taskId)}`, { headers: { cookie }, cache: "no-store" });
        if (!response.ok) {
            if ([408, 425, 429].includes(response.status) || response.status >= 500) {
                await new Promise((resolve) => setTimeout(resolve, 250));
                continue;
            }
            throw new AgentChildTaskTerminalError((await response.text()) || "生成任务查询失败");
        }
        const payload = (await response.json()) as { task?: { status?: string; result?: unknown; error?: string } };
        const terminal = agentChildTaskTerminal(payload.task?.status);
        if (terminal === "success") return payload.task?.result;
        if (terminal === "error") throw new AgentChildTaskTerminalError(payload.task?.error || "生成任务失败");
        if (terminal === "cancelled") throw new AgentChildTaskTerminalError(payload.task?.error || "生成任务已取消");
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("生成任务执行超时");
}

export async function patchTask(runId: string, taskId: string, patch: Partial<AgentRunTask>, eventType: string, executionId: string) {
    const run = await getAgentRun(runId);
    if (!run || run.executionId !== executionId) return null;
    const tasks = run.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
    const taskIndex = tasks.findIndex((item) => item.id === taskId);
    const task = tasks[taskIndex];
    const output = task && eventType === "task.completed" && run.surface === "canvas" ? taskResultOps(runId, taskIndex, task) : null;
    const assetIds = Array.from(new Set([...run.assetIds, ...(task?.assetIds || [])]));
    return updateAgentRunById(
        runId,
        { tasks, assetIds },
        {
            type: eventType,
            data: task
                ? {
                      taskId,
                      taskNodeId: `task-${runId}-${taskIndex}`,
                      outputNodeIds: output?.nodeIds,
                      ops: output?.ops,
                      assetIds: task.assetIds,
                      title: task.title,
                      type: task.type,
                      status: task.status,
                      attempts: task.attempts,
                      error: task.error,
                      message: eventType === "task.completed" ? agentTaskCompletionMessage(task, run.surface) : undefined,
                  }
                : { taskId },
        },
        ["running"],
        executionId,
    );
}

export function taskResultOps(runId: string, index: number, task: AgentRunTask) {
    const taskNodeId = `task-${runId}-${index}`;
    const results = taskResultItems(task.result);
    const nodeIds = results.map((_, resultIndex) => `output-${runId}-${index}-${resultIndex}`);
    const ops: Array<Record<string, unknown>> = results.flatMap((record, resultIndex) => {
        const outputNodeId = nodeIds[resultIndex];
        const metadata =
            task.type === "text"
                ? { content: String(record.content || ""), status: "success" }
                : { content: String(record.dataUrl || ""), remoteUrl: String(record.remoteUrl || record.url || ""), serverUrl: String(record.serverUrl || ""), mimeType: String(record.mimeType || ""), status: "success" };
        return [
            {
                type: "add_node",
                id: outputNodeId,
                nodeType: task.type,
                title: results.length > 1 ? `${task.title} ${resultIndex + 1}` : task.title,
                position: { x: AGENT_WORK_COLUMN_X, y: AGENT_NODE_START_Y + AGENT_OUTPUT_OFFSET_Y + index * 300 },
                metadata: { ...metadata, agentRunId: runId },
            },
            { type: "connect_nodes", fromNodeId: taskNodeId, toNodeId: outputNodeId },
        ];
    });
    ops.push({ type: "update_node", id: taskNodeId, metadata: { agentTaskStatus: "completed", agentTaskOutputNodeIds: nodeIds, agentTaskAttempts: task.attempts } });
    if (nodeIds.length) ops.push({ type: "select_nodes", ids: nodeIds });
    return { nodeIds, ops };
}

export function taskResultItems(value: unknown): Record<string, unknown>[] {
    if (!value || typeof value !== "object") return [{}];
    const record = value as Record<string, unknown>;
    const list = [record.results, record.images, record.outputs, record.items].find(Array.isArray);
    if (!Array.isArray(list) || !list.length) return [record];
    return list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").slice(0, 10);
}

export function taskImageUrls(value: unknown) {
    return taskResultItems(value)
        .map((record) => [record.remoteUrl, record.serverUrl, record.url, record.dataUrl].find((item) => typeof item === "string" && item.trim()))
        .filter((item): item is string => typeof item === "string")
        .slice(0, 6);
}

export function reviewCorrection(review: CreativeReview, taskId: string) {
    const issues = review.issues.filter((issue) => issue.taskId === taskId);
    return issues.length ? issues.map((issue) => `${issue.category}：${issue.correction || issue.message}`).join("；") : "加强与创作简报、视觉方向和依赖产物的一致性。";
}
