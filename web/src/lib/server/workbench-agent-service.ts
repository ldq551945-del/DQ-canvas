import { getAuthSettings, refundUserPoints } from "@/lib/auth/store";
import { appendWorkbenchExchangeForUser } from "@/lib/server/creative-runtime-service";
import { getCreativeConversationContext } from "@/lib/server/creative-runtime-store";
import { fetchInternalApi, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { fetchOptionalResponses } from "@/lib/server/responses-request";
import { strictJsonObjectText } from "@/lib/server/structured-model-output";
import { parseWorkbenchPlanCall, type WorkbenchFunctionCallResult } from "./workbench-agent-plan";
import { createWorkbenchPlanningMessages, workbenchTool } from "./workbench-agent-prompt";
import { analyzeWorkbenchRequest, buildTrustedWorkbenchBody, directWorkbenchPlan, finalizeWorkbenchPlan, type WorkbenchRequestBody } from "./workbench-agent-policy";

export type { WorkbenchRequestBody } from "./workbench-agent-policy";

export class WorkbenchPlanningError extends Error {
    constructor(
        message: string,
        readonly status = 502,
    ) {
        super(message);
    }
}

export async function planWorkbenchAgent(input: { requestUrl: string; cookie: string; userId: string; body: WorkbenchRequestBody; prompt: string }) {
    const settings = await getAuthSettings();
    const body = buildTrustedWorkbenchBody(settings, input.body);
    const workspace = body.workspace || "image";
    if (body.smartPlanning === false && !body.modelIds?.length) {
        throw new WorkbenchPlanningError(`请先选择一个可用的${workspace === "video" ? "视频" : "图片"}模型`, 400);
    }
    const { skills, referenceRequired, planOnly, conversationOnly } = analyzeWorkbenchRequest(settings, workspace, input.prompt, body.skillIds);
    const conversationId = cleanId(body.conversationId);
    const skillIds = skills.map((skill) => skill.id);
    if (body.smartPlanning === false && body.modelIds?.length) {
        const finalized = directWorkbenchPlan({ body, prompt: input.prompt, workspace, skillIds, referenceRequired, planOnly, conversationOnly });
        await saveWorkbenchExchange(input, conversationId, workspace, finalized);
        return { ...finalized, ...(conversationId ? { conversationId } : {}) };
    }
    const model = settings.defaultModels.textModel;
    const candidates = resolveLogicalModelCandidates(settings, "text", model);
    if (!model || !candidates.length) throw new WorkbenchPlanningError("请管理员先配置并启用默认文本模型", 503);
    let conversationContext;
    try {
        conversationContext = conversationId ? await getCreativeConversationContext(conversationId, input.userId) : undefined;
    } catch (error) {
        throw new WorkbenchPlanningError(error instanceof Error ? error.message : "创作会话不可用", errorStatus(error, 404));
    }
    const messages = createWorkbenchPlanningMessages({ userId: input.userId, prompt: input.prompt, body, workspace, referenceRequired, conversationOnly, skills, conversationContext });
    const origin = resolveInternalOrigin(new URL(input.requestUrl).origin);
    const headers = { "Content-Type": "application/json", cookie: input.cookie };
    let finalized: ReturnType<typeof finalizeWorkbenchPlan> | undefined;
    let latestError: unknown;
    for (const candidate of candidates) {
        try {
            let call = await callResponsesPlanner(origin, candidate.channel.id, candidate.upstreamModel, messages, headers, input.userId, model);
            if (!call) call = await callChatPlanner(origin, candidate.channel.id, candidate.upstreamModel, messages, headers, input.userId, model);
            if (!call) throw new WorkbenchPlanningError("文本模型没有返回工作台执行计划");
            const plan = await parseWorkbenchPlanCall(call, { workspace, prompt: input.prompt, models: body.models || [], skillIds }, () => refundTextCost(input.userId, model, call.pointsCost, call.pointsRecordId));
            if (!plan) throw new WorkbenchPlanningError("文本模型返回的工作台计划无效，相关积分已退款");
            finalized = finalizeWorkbenchPlan(plan, { body, prompt: input.prompt, workspace, skillIds, referenceRequired, planOnly, conversationOnly });
            break;
        } catch (error) {
            latestError = error;
        }
    }
    if (!finalized) throw latestError instanceof WorkbenchPlanningError ? latestError : new WorkbenchPlanningError(latestError instanceof Error ? latestError.message : "没有可用的文本模型渠道");
    await saveWorkbenchExchange(input, conversationId, workspace, finalized);
    return { ...finalized, ...(conversationId ? { conversationId } : {}) };
}

async function saveWorkbenchExchange(input: { userId: string; prompt: string }, conversationId: string, workspace: "image" | "video", plan: ReturnType<typeof finalizeWorkbenchPlan>) {
    if (!conversationId) return;
    try {
        await appendWorkbenchExchangeForUser(input.userId, { conversationId, workspace, prompt: input.prompt, reply: plan.shouldGenerate ? "已收到生成需求。" : plan.reply });
    } catch (error) {
        throw new WorkbenchPlanningError(error instanceof Error ? error.message : "工作台会话保存失败", errorStatus(error, 500));
    }
}

function cleanId(value: unknown) {
    return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function errorStatus(error: unknown, fallback: number) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : fallback;
    return Number.isInteger(status) && status >= 400 && status < 600 ? status : fallback;
}

async function callResponsesPlanner(origin: string, channelId: string, upstreamModel: string, messages: Array<{ role: string; content: string }>, headers: Record<string, string>, userId: string, model: string) {
    const response = await fetchOptionalResponses(`${origin}/api/ai/system/${encodeURIComponent(channelId)}/responses`, {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({ model: upstreamModel, input: messages, tools: [workbenchTool], tool_choice: { type: "function", name: "plan_workbench_action" } }),
    });
    if (!response?.ok) return null;
    const payload = (await response.json()) as { output?: Array<{ type?: string; name?: string; arguments?: string }> };
    const argumentsText = payload.output?.find((item) => item.type === "function_call" && item.name === "plan_workbench_action")?.arguments || "";
    if (argumentsText) return readFunctionCallResult(argumentsText, response.headers);
    await refundTextResponse(userId, model, response.headers);
    return null;
}

async function callChatPlanner(origin: string, channelId: string, upstreamModel: string, messages: Array<{ role: string; content: string }>, headers: Record<string, string>, userId: string, model: string) {
    const fallback = await fetchInternalApi(`${origin}/api/ai/system/${encodeURIComponent(channelId)}/chat/completions`, {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({
            model: upstreamModel,
            messages,
            tools: [{ type: "function", function: { name: workbenchTool.name, description: workbenchTool.description, parameters: workbenchTool.parameters } }],
            tool_choice: { type: "function", function: { name: workbenchTool.name } },
        }),
    });
    if (!fallback.ok) throw new WorkbenchPlanningError("默认文本模型规划失败，请检查渠道可用性");
    const payload = (await fallback.json()) as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
    const message = payload.choices?.[0]?.message;
    const argumentsText = message?.tool_calls?.find((item) => item.function?.name === workbenchTool.name)?.function?.arguments || strictJsonObjectText(message?.content);
    if (argumentsText) return readFunctionCallResult(argumentsText, fallback.headers);
    await refundTextResponse(userId, model, fallback.headers);
    return null;
}

function readFunctionCallResult(argumentsText: string, headers: Headers): WorkbenchFunctionCallResult {
    const pointsCost = Number(headers.get("x-vozeb-pro-points-cost"));
    return {
        arguments: argumentsText,
        pointsCost: Number.isFinite(pointsCost) && pointsCost > 0 ? pointsCost : undefined,
        pointsRecordId: headers.get("x-vozeb-pro-points-record-id") || undefined,
    };
}

async function refundTextCost(userId: string, model: string, cost?: number, pointsRecordId?: string) {
    if (cost && pointsRecordId) await refundUserPoints(userId, model, cost, "text", 1, undefined, pointsRecordId);
}

async function refundTextResponse(userId: string, model: string, headers: Headers) {
    const cost = Number(headers.get("x-vozeb-pro-points-cost"));
    const pointsRecordId = headers.get("x-vozeb-pro-points-record-id") || undefined;
    if (Number.isFinite(cost) && cost > 0 && pointsRecordId) await refundUserPoints(userId, model, cost, "text", 1, undefined, pointsRecordId);
}
