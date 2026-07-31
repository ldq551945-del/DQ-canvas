import { getAuthSettings, refundUserPoints, type LogicalModelCapability } from "@/lib/auth/store";
import { withCreativeFoundation, type CreativeReview } from "@/lib/creative-agent-contract";
import type { CreativeAsset, CreativeSurface } from "@/lib/creative-runtime-contract";
import { fetchInternalApi } from "@/lib/server/internal-origin";
import { resolveLogicalModel } from "@/lib/server/logical-model-router";
import { reviewCreativeOutputs } from "@/lib/server/creative-review-service";
import { requestStructuredText, type TextPlanningCandidate } from "@/lib/server/text-planning-runtime";
import { registerAgentTaskAssets } from "@/lib/server/agent-run-assets";
import { buildAgentProjectHandoff } from "@/lib/server/agent-run-project-handoff";
import { getAgentRun, updateAgentRunById, updateAgentRunTaskById, type AgentRun, type AgentRunChildTask, type AgentRunReference, type AgentRunTask } from "@/lib/server/agent-run-store";
import { assetAccessUrl, creativeAssetContext, resolveTaskReferences, selectedCanvasNodeIds } from "@/lib/server/agent-run-surface-policy";
import { agentChildTaskTerminal, agentTaskCopies, resolveAgentTaskCount, resolveAgentVideoSeconds, validateAgentTaskResult, type AgentPlan } from "@/lib/server/agent-run-validation";
import { agentRunCompletionReply, agentRunFailureMessage, agentTaskCompletionMessage, resultSummary } from "@/lib/server/agent-run-messages";
import { getCreativeAssetsByIds } from "@/lib/server/creative-runtime-store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { linkStoredGenerationTask } from "@/lib/server/generation-task-store";
import { maintenanceWorkerContextHeaders } from "@/lib/server/maintenance-auth";
import type { AgentFunctionCallResult } from "./agent-function-call";
import { agentSurfaceImageSize, canvasSnapshotNodes, isMediaReferenceType, resolveAgentTaskRatio, resolveCanvasTaskTargetNodeId } from "./agent-run-task-input";
import { planToOps, taskResultOps } from "./agent-run-canvas-ops";
import { hasSystemAiCharge, readSystemAiBilling, systemAiBillingHeaders } from "./system-ai-billing";

export { planToOps, taskResultOps } from "./agent-run-canvas-ops";

class AgentChildTaskTerminalError extends Error {}
class AgentChildTaskDeferredError extends Error {}
type AgentCopyOutcome = { index: number; result: unknown; taskId: string; assetIds: string[] };

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
            skillIds: { type: "array", maxItems: 6, items: { type: "string", maxLength: 160 } },
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

export function normalizeTasks(
    plan: AgentPlan,
    skills: Awaited<ReturnType<typeof getAuthSettings>>["agentSkills"],
    settings: Awaited<ReturnType<typeof getAuthSettings>>,
    snapshot: unknown,
    requestPrompt: string,
    surface: CreativeSurface,
    referencedAssets: CreativeAsset[],
    requestedImageSize?: string,
): AgentRunTask[] {
    const defaults = Object.assign({}, ...skills.map((skill) => skill.defaultConfig || {})) as Record<string, unknown>;
    const skillInstructions = skills
        .map((skill) => skill.instructions.trim())
        .filter(Boolean)
        .join("\n\n");
    const globalDefaults = settings.generationDefaults;
    const nodes = canvasSnapshotNodes(snapshot);
    const selectedNodeIds = new Set(selectedCanvasNodeIds(snapshot).filter((id) => nodes.has(id)));
    const assets = new Map(referencedAssets.map((asset) => [asset.id, asset]));
    const configuredImageSize = agentSurfaceImageSize(surface, snapshot);
    return plan.deliverables.map((item, index) => {
        const targetNodeId = surface === "canvas" ? resolveCanvasTaskTargetNodeId(item.targetNodeId, item.type, selectedNodeIds, nodes) : undefined;
        const target = targetNodeId ? nodes.get(targetNodeId) : undefined;
        const selectedAssets = target ? [] : resolveTaskReferences(item.assetIds, assets, item.type);
        const references = [
            ...(target?.url && isMediaReferenceType(target.type) ? [{ url: target.url, type: target.type }] : []),
            ...selectedAssets.flatMap((asset) => {
                const url = assetAccessUrl(asset);
                return url && asset.type !== "text" ? [{ assetId: asset.id, url, type: asset.type }] : [];
            }),
        ] satisfies AgentRunReference[];
        const primaryReference = references[0];
        const referenceContext = selectedAssets.map(creativeAssetContext).join("\n");
        return {
            id: item.id?.trim() || `task-${index}`,
            targetNodeId: target ? targetNodeId : undefined,
            referenceAssetId: selectedAssets[0]?.id,
            referenceUrl: primaryReference?.url,
            referenceType: primaryReference?.type,
            references,
            title: item.title.trim(),
            type: item.type,
            model: resolvePlannedModel(settings, item.type, item.model),
            prompt: `${withCreativeFoundation(item.prompt.trim(), plan.foundation)}${skillInstructions ? `\n\n执行以下已选 Skill 约束：\n${skillInstructions}` : ""}${textConstraintInstruction(requestPrompt, item.type)}${target ? `\n\n基于画布已有节点进行局部修改：${target.summary}` : ""}${referenceContext ? `\n\n使用已引用创作资产：${referenceContext}` : ""}`,
            count: resolveAgentTaskCount(item.type, item.count, defaults.count, globalDefaults.canvasImageCount),
            ratio: resolveAgentTaskRatio({
                type: item.type,
                requestedImageSize,
                configuredImageSize,
                plannedRatio: item.ratio,
                defaultSize: textDefault(defaults.size),
                globalSize: ["image", "video"].includes(item.type) ? globalDefaults.imageSize : undefined,
                reference: target || (selectedAssets[0]?.type === "image" ? selectedAssets[0] : undefined),
            }),
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

function textDefault(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
export async function executeTasks(runId: string, origin: string, cookie: string, executionId: string, executionSettings?: Awaited<ReturnType<typeof getAuthSettings>>) {
    const settings = executionSettings || (await getAuthSettings());
    while (await canContinue(runId, executionId)) {
        const run = await getAgentRun(runId);
        if (!run) return;
        const completed = new Set(run.tasks.filter((task) => task.status === "completed").map((task) => task.id));
        const ready = run.tasks.filter((task) => (task.status === "ready" || task.status === "running") && task.dependencies.every((id) => completed.has(id))).slice(0, 2);
        if (!ready.length) {
            if (run.tasks.every((task) => task.status === "completed")) {
                if (!run.reviewed && shouldBlockOnReview(run)) {
                    const review = await reviewCompletedTasks(run, origin, cookie);
                    if (review.retryTaskIds.length) {
                        await updateAgentRunById(
                            runId,
                            {
                                reviewed: true,
                                review,
                                tasks: run.tasks.map((task) =>
                                    review.retryTaskIds.includes(task.id)
                                        ? {
                                              ...task,
                                              status: "ready",
                                              attempts: Math.max(1, task.attempts),
                                              taskId: undefined,
                                              taskIds: undefined,
                                              childTasks: undefined,
                                              result: undefined,
                                              error: undefined,
                                              prompt: `${task.prompt}\n\n复盘修正：${reviewCorrection(review, task.id)}`,
                                          }
                                        : task,
                                ),
                            },
                            { type: "run.review.retry", data: { review } },
                            ["running"],
                            executionId,
                        );
                        continue;
                    }
                    await updateAgentRunById(
                        runId,
                        { reviewed: true, review, reviewStatus: review.status === "unavailable" ? "review_unavailable" : "review_completed", timings: { ...(run.timings || { requestAcceptedAt: run.createdAt }), reviewCompletedAt: Date.now() } },
                        { type: review.status === "unavailable" ? "run.review.unavailable" : "run.review.passed", data: { review } },
                        ["running"],
                        executionId,
                    );
                }
                let completedRun = (await getAgentRun(runId)) || run;
                const projectHandoff = await buildAgentProjectHandoff(completedRun);
                if (projectHandoff && !completedRun.projectHandoffEmitted) {
                    const emitted = await updateAgentRunById(runId, { projectHandoffEmitted: true }, { type: "project.handoff", data: projectHandoff }, ["running"], executionId);
                    if (!emitted) return;
                    completedRun = emitted;
                }
                const reply = `${agentRunCompletionReply(completedRun)}${projectHandoff ? `\n\n已创建${projectHandoff.surface === "canvas" ? "画布" : "短剧"}项目「${projectHandoff.title}」，可以从当前对话直接打开。` : ""}`;
                const backgroundReview = !shouldBlockOnReview(completedRun) && !completedRun.reviewed;
                const finished = await updateAgentRunById(
                    runId,
                    {
                        status: "completed",
                        executionId: undefined,
                        ...(backgroundReview ? { reviewStatus: "review_pending" as const, reviewAttempts: completedRun.reviewAttempts || 0 } : {}),
                        timings: { ...(completedRun.timings || { requestAcceptedAt: completedRun.createdAt }), allResultsReadyAt: completedRun.timings?.allResultsReadyAt || Date.now(), runCompletedAt: Date.now() },
                    },
                    { type: "run.completed", data: { completed: completedRun.tasks.length, assetIds: completedRun.assetIds, projectHandoff, reply } },
                    ["running"],
                    executionId,
                );
                if (finished && backgroundReview) await scheduleGenerationTask("agent", runId, { executionPhase: "review_pending", nextPollAt: Date.now(), lastUpstreamStatus: "review_pending" });
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
        const results = await Promise.all(ready.map((task) => runTaskWithRetry(runId, task, origin, cookie, executionId, settings)));
        if (results.some((result) => result === "deferred")) return;
    }
}

function shouldBlockOnReview(run: AgentRun) {
    return run.tasks.length > 1 || run.surface === "drama" || /严格检查|高质量模式|完整复盘/u.test(run.prompt);
}

export async function processAgentRunReview(run: AgentRun, origin: string, cookie: string) {
    if (run.status !== "completed" || run.reviewed) return { status: "completed" as const, attempts: run.reviewAttempts || 0 };
    const attempts = (run.reviewAttempts || 0) + 1;
    const started = await updateAgentRunById(run.id, { reviewStatus: "reviewing", reviewAttempts: attempts }, { type: "run.review.started", data: { attempt: attempts } }, ["completed"]);
    if (!started || started.reviewed) return { status: "completed" as const, attempts };
    try {
        const review = await reviewCompletedTasks(started, origin, cookie);
        await updateAgentRunById(
            started.id,
            { reviewed: true, review, reviewStatus: review.status === "unavailable" ? "review_unavailable" : "review_completed", timings: { ...(started.timings || { requestAcceptedAt: started.createdAt }), reviewCompletedAt: Date.now() } },
            { type: "run.review.background", data: { status: review.status, issueCount: review.issues.length } },
            ["completed"],
        );
        return { status: review.status === "unavailable" ? ("unavailable" as const) : ("completed" as const), attempts };
    } catch (error) {
        const message = toSafeGenerationErrorMessage(error, "复盘服务暂时不可用");
        if (attempts >= 3) {
            const review: CreativeReview = { mode: "unavailable", status: "unavailable", summary: message, issues: [], retryTaskIds: [] };
            await updateAgentRunById(
                started.id,
                { reviewed: true, review, reviewStatus: "review_unavailable", timings: { ...(started.timings || { requestAcceptedAt: started.createdAt }), reviewCompletedAt: Date.now() } },
                { type: "run.review.background", data: { status: "unavailable", issueCount: 0 } },
                ["completed"],
            );
            return { status: "unavailable" as const, attempts };
        }
        await updateAgentRunById(started.id, { reviewStatus: "review_pending" }, { type: "run.review.deferred", data: { attempt: attempts } }, ["completed"]);
        console.warn("Agent background review deferred", { runId: started.id, attempt: attempts, error: message });
        return { status: "retry" as const, attempts };
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
    candidate: TextPlanningCandidate,
    input: Array<{ role: string; content: string }>,
    tool: typeof agentPlanTool,
    name: string,
    signal: AbortSignal,
    userId: string,
    billingModel: string,
    allowNaturalLanguage = false,
    pointsIdempotencyKey?: string,
) {
    const requestHeaders = runtimeRequestHeaders(cookie, {
        "Content-Type": "application/json",
        ...(pointsIdempotencyKey ? { "Idempotency-Key": pointsIdempotencyKey, "X-Client-Request-Id": pointsIdempotencyKey } : {}),
        ...systemAiBillingHeaders(billingModel, pointsIdempotencyKey, candidate.upstreamModel),
    });
    const call = await requestStructuredText({
        origin,
        cookie,
        candidate,
        messages: input,
        tool: { name: tool.name, description: tool.description, parameters: tool.parameters },
        headers: requestHeaders,
        signal,
        allowNaturalLanguage,
        onInvalidResponse: (headers) => refundTextResponse(userId, billingModel, headers),
    });
    return readFunctionCallResult(call.arguments, call.headers);
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

export async function runTaskWithRetry(runId: string, task: AgentRunTask, origin: string, cookie: string, executionId: string, settings?: Awaited<ReturnType<typeof getAuthSettings>>) {
    const resumeExisting = task.childTasks?.some((child) => child.status === "pending") || (task.status === "running" && task.taskId && !task.childTasks?.length);
    const attempt = resumeExisting ? Math.max(1, task.attempts) : task.attempts + 1;
    if (!(await canContinue(runId, executionId))) return;
    if (!(await patchTask(runId, task.id, { status: "running", attempts: attempt, error: undefined }, "task.running", executionId))) return;
    try {
        const activeRun = await getAgentRun(runId);
        if (!activeRun || activeRun.executionId !== executionId) return;
        const currentTask = activeRun.tasks.find((item) => item.id === task.id) || task;
        const executableTask = await withDependencyContext(runId, currentTask);
        const dispatched = await dispatchTask(executableTask, origin, cookie, settings || (await getAuthSettings()), activeRun, executionId, attempt);
        const result = normalizeConstrainedTextResult(task, dispatched.result, attempt);
        validateAgentTaskResult(task.type, result);
        await patchTask(runId, task.id, {}, "task.validated", executionId);
        const registeredAssetIds = dispatched.assetIds ?? (await registerAgentTaskAssets(activeRun, { ...executableTask, attempts: attempt, result }, result, dispatched.sourceTaskIds)).map((asset) => asset.id);
        await patchTask(
            runId,
            task.id,
            {
                status: "completed",
                result,
                error: undefined,
                taskId: dispatched.sourceTaskIds.at(-1),
                taskIds: dispatched.sourceTaskIds,
                assetIds: registeredAssetIds,
                referenceAssetId: executableTask.referenceAssetId,
                referenceUrl: executableTask.referenceUrl,
                referenceType: executableTask.referenceType,
                references: executableTask.references,
            },
            "task.completed",
            executionId,
        );
        return "completed" as const;
    } catch (error) {
        if (error instanceof AgentChildTaskDeferredError) return "deferred" as const;
        const message = toSafeGenerationErrorMessage(error, "生成任务失败");
        if (await canContinue(runId, executionId)) {
            const latest = await getAgentRun(runId);
            const childTasks = latest?.tasks.find((item) => item.id === task.id)?.childTasks?.map((child) => (child.status === "pending" ? { ...child, status: "failed" as const, error: message } : child));
            await patchTask(runId, task.id, { status: "failed", error: message, ...(childTasks ? { childTasks } : {}) }, "task.failed", executionId);
        }
        return "failed" as const;
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
    const copies = agentTaskCopies(task.type, task.count);
    const initialChildren = normalizeChildTasks(task);
    const outcomes = await mapWithConcurrency(
        Array.from({ length: copies }, (_, index) => index),
        2,
        async (index) => {
            if (!(await canContinue(run.id, executionId))) throw new Error("Agent Run 已暂停、取消或已由新执行器接管");
            let child = initialChildren[index];
            let taskId = child?.id;
            if (!taskId) {
                const bodyForCopy = {
                    ...body,
                    context: { ...context, clientRequestId: `${run.clientRequestId}:${task.id}:${attempt}:${index + 1}` },
                };
                const response = await fetchInternalApi(`${origin}${path}`, { method: "POST", headers: runtimeRequestHeaders(cookie, { "Content-Type": "application/json" }), body: JSON.stringify(bodyForCopy), cache: "no-store" });
                if (!response.ok) throw new Error((await response.text()) || "生成任务创建失败");
                const payload = (await response.json()) as { task?: { id?: string } };
                const createdTaskId = payload.task?.id;
                if (!createdTaskId) throw new Error("生成任务未返回任务 ID");
                taskId = createdTaskId;
                await linkAgentChildTask(run, task, taskId, attempt);
                child = { id: taskId, status: "pending", attempt };
                if (!(await patchTask(run.id, task.id, { taskId, taskIds: [taskId], childTasks: [child] }, "task.created", executionId))) throw new Error("Agent Run 已由新执行器接管");
            }
            try {
                if (child?.status === "completed") {
                    const registered = await registerAgentTaskAssets(run, { ...task, title: copies > 1 ? `${task.title} ${index + 1}` : task.title, count: 1, attempts: attempt, result: child.result }, child.result, [taskId]);
                    const assetIds = registered.map((asset) => asset.id);
                    await patchTask(run.id, task.id, { assetIds }, "task.child.restored", executionId);
                    return { index, result: child.result, taskId, assetIds };
                }
                const result = await pollTask(origin, task.type === "video" ? "/api/video-tasks" : path, taskId, cookie, run.id, task.type, executionId);
                const registered = await registerAgentTaskAssets(run, { ...task, title: copies > 1 ? `${task.title} ${index + 1}` : task.title, count: 1, attempts: attempt, result }, result, [taskId]);
                const assetIds = registered.map((asset) => asset.id);
                const completedChild = { id: taskId, status: "completed" as const, attempt: child?.attempt || attempt, result };
                if (!(await patchTask(run.id, task.id, { taskId, taskIds: [taskId], childTasks: [completedChild], assetIds }, "task.child.completed", executionId))) throw new Error("Agent Run 已由新执行器接管");
                return { index, result, taskId, assetIds };
            } catch (error) {
                if (error instanceof AgentChildTaskDeferredError) throw error;
                const message = toSafeGenerationErrorMessage(error, "生成任务失败");
                if (taskId) await patchTask(run.id, task.id, { taskIds: [taskId], childTasks: [{ id: taskId, status: "failed", attempt: child?.attempt || attempt, error: message }] }, "task.child.failed", executionId);
                throw error;
            }
        },
    );
    const failed = outcomes.find((outcome) => outcome.status === "rejected");
    const completed = outcomes
        .filter((outcome): outcome is PromiseFulfilledResult<AgentCopyOutcome> => outcome.status === "fulfilled")
        .map((outcome) => outcome.value)
        .sort((left, right) => left.index - right.index);
    if (failed?.status === "rejected") throw failed.reason;
    const results = completed.map((outcome) => outcome.result);
    return {
        result: results.length === 1 ? results[0] : { results },
        sourceTaskIds: Array.from(new Set([...(task.taskIds || []), ...completed.map((outcome) => outcome.taskId)])),
        assetIds: Array.from(new Set([...(task.assetIds || []), ...completed.flatMap((outcome) => outcome.assetIds)])),
    };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<Array<PromiseSettledResult<R>>> {
    const results: Array<PromiseSettledResult<R>> = new Array(items.length);
    let cursor = 0;
    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (cursor < items.length) {
                const index = cursor++;
                try {
                    results[index] = { status: "fulfilled", value: await worker(items[index]) };
                } catch (reason) {
                    results[index] = { status: "rejected", reason };
                }
            }
        }),
    );
    return results;
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
    void type;
    if (!(await canContinue(runId, executionId))) throw new Error("Agent Run 已暂停、取消或已由新执行器接管");
    let response: Response;
    try {
        response = await fetchInternalApi(`${origin}${path}/${encodeURIComponent(taskId)}`, { headers: runtimeRequestHeaders(cookie), cache: "no-store" });
    } catch (error) {
        throw new AgentChildTaskDeferredError(error instanceof Error ? error.message : "生成任务查询暂时不可用");
    }
    if (!response.ok) {
        if ([408, 425, 429].includes(response.status) || response.status >= 500) throw new AgentChildTaskDeferredError("生成任务查询暂时不可用");
        throw new AgentChildTaskTerminalError((await response.text()) || "生成任务查询失败");
    }
    let payload: { task?: { status?: string; result?: unknown; error?: string; needsReview?: boolean } };
    try {
        payload = (await response.json()) as typeof payload;
    } catch {
        throw new AgentChildTaskDeferredError("生成任务状态暂时无法解析");
    }
    if (payload.task?.needsReview) throw new AgentChildTaskDeferredError("上游创建状态待人工确认");
    const terminal = agentChildTaskTerminal(payload.task?.status);
    if (terminal === "success") return payload.task?.result;
    if (terminal === "error") throw new AgentChildTaskTerminalError(payload.task?.error || "生成任务失败");
    if (terminal === "cancelled") throw new AgentChildTaskTerminalError(payload.task?.error || "生成任务已取消");
    throw new AgentChildTaskDeferredError("生成任务仍在处理中");
}

export async function patchTask(runId: string, taskId: string, patch: Partial<AgentRunTask>, eventType: string, executionId: string) {
    return updateAgentRunTaskById(runId, taskId, patch, eventType, executionId);
}

function runtimeRequestHeaders(cookie: string, initial?: HeadersInit) {
    const headers = new Headers(initial);
    const workerHeaders = maintenanceWorkerContextHeaders(cookie);
    if (workerHeaders) Object.entries(workerHeaders).forEach(([key, value]) => headers.set(key, value));
    else if (cookie) headers.set("cookie", cookie);
    return headers;
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
