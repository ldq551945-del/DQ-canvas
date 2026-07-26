import { getAuthSettings } from "@/lib/auth/store";
import { nanoid } from "nanoid";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { systemAiIdempotencyKey } from "@/lib/server/system-ai-billing";
import { getAgentRun, updateAgentRunById, type AgentRun } from "@/lib/server/agent-run-store";
import { agentPlannerInput, agentPlannerSystemPrompt, agentPlanReply, conversationFallbackReply, selectAgentSkills, taskPlanSummary } from "@/lib/server/agent-run-surface-policy";
import { getCreativeAssetsByIds, getCreativeConversationContext } from "@/lib/server/creative-runtime-store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { parseAgentPlanCall, type AgentFunctionCallResult } from "./agent-function-call";
import { agentModelOptions, agentPlanFallbackExample, agentPlanTool, canContinue, directAgentPlan, executeTasks, isCanvasConversationPrompt, normalizeTasks, planToOps, refundFunctionCall, requestFunctionCall } from "./agent-run-execution";
import { normalizeAgentProjectHandoff } from "./agent-run-project-handoff";

export { isCanvasConversationPrompt } from "./agent-run-execution";

const globalAgentExecutors = globalThis as typeof globalThis & { __vozebProAgentRunControllers?: Map<string, AbortController> };
const controllers = (globalAgentExecutors.__vozebProAgentRunControllers ??= new Map<string, AbortController>());

export function abortAgentRun(id: string) {
    controllers.get(id)?.abort();
}

export async function executeAgentRun(run: AgentRun, origin: string, cookie: string) {
    abortAgentRun(run.id);
    const controller = new AbortController();
    const executionId = nanoid();
    let acceptedPlan: { userId: string; model: string; call: AgentFunctionCallResult } | undefined;
    let planningPersisted = false;
    const refundAcceptedPlan = async () => {
        if (!acceptedPlan || planningPersisted) return;
        await refundFunctionCall(acceptedPlan.userId, acceptedPlan.model, acceptedPlan.call);
        acceptedPlan = undefined;
    };
    controllers.set(run.id, controller);
    try {
        const claimed = await updateAgentRunById(run.id, { status: "running", executionId }, { type: run.tasks.length ? "run.resumed" : "run.planning" }, ["planning", "running"]);
        if (!claimed) return;
        if (claimed.tasks.length) {
            await getAuthSettings();
            await executeTasks(run.id, origin, cookie, executionId);
            return;
        }
        const settings = await getAuthSettings();
        const referencedAssets = await getCreativeAssetsByIds(claimed.referencedAssetIds);
        const skills = selectAgentSkills(settings, claimed.surface, claimed.prompt, claimed.selectedSkillIds);
        const availableModels = agentModelOptions(settings);
        await updateAgentRunById(run.id, {}, { type: "skills.selected", data: { skills: skills.map((skill) => ({ id: skill.id, name: skill.name })) } }, ["running"], executionId);
        if (!(await canContinue(run.id, executionId))) return;
        if (claimed.requestedModelIds?.length) {
            const selectedModels = claimed.requestedModelIds.map((id) => availableModels.find((item) => item.id === id && item.capability !== "text")).filter((item): item is ReturnType<typeof agentModelOptions>[number] => Boolean(item));
            if (selectedModels.length !== claimed.requestedModelIds.length) throw new Error("部分所选模型当前不可用，请重新选择");
            const plan = directAgentPlan(selectedModels, claimed.prompt, claimed.referencedAssetIds);
            const tasks = normalizeTasks(plan, skills, settings, claimed.snapshot, claimed.prompt, claimed.surface, referencedAssets);
            await updateAgentRunById(run.id, { tasks, foundation: plan.foundation, reviewed: false }, { type: "run.planned", data: { reply: plan.reply, tasks: tasks.map(taskPlanSummary) } }, ["running"], executionId);
            await executeTasks(run.id, origin, cookie, executionId);
            return;
        }
        const model = settings.defaultModels.textModel;
        const candidates = resolveLogicalModelCandidates(settings, "text", model);
        if (!model || !candidates.length) throw new Error("后台尚未配置可用的默认文本模型");
        const conversationContext = await getCreativeConversationContext(claimed.conversationId, claimed.userId, claimed.id);
        const conversationOnly = isCanvasConversationPrompt(claimed.prompt);
        const skillPrompt = skills.length ? `\n启用技能：\n${skills.map((skill) => `【${skill.name}】${skill.instructions}`).join("\n")}` : "";
        const fallbackExample = agentPlanFallbackExample(availableModels);
        const planningInput = [
            {
                role: "system",
                content: agentPlannerSystemPrompt(claimed.surface, fallbackExample, skillPrompt),
            },
            {
                role: "user",
                content: JSON.stringify(agentPlannerInput(claimed, conversationOnly, conversationContext, referencedAssets, availableModels, settings)),
            },
        ];
        let plan: Awaited<ReturnType<typeof parseAgentPlanCall>> | undefined;
        let latestPlanningError: unknown;
        for (const candidate of candidates) {
            try {
                const planCall = await requestFunctionCall(
                    origin,
                    cookie,
                    candidate.channel.id,
                    candidate.upstreamModel,
                    planningInput,
                    agentPlanTool,
                    "create_agent_plan",
                    controller.signal,
                    run.userId,
                    model,
                    conversationOnly,
                    systemAiIdempotencyKey("agent-plan", run.userId, run.id, candidate.channel.id, candidate.upstreamModel),
                );
                plan = await parseAgentPlanCall(planCall, () => refundFunctionCall(claimed.userId, model, planCall), conversationOnly ? { objective: claimed.prompt, reply: conversationFallbackReply(claimed.surface) } : undefined);
                if (plan) acceptedPlan = { userId: claimed.userId, model, call: planCall };
                break;
            } catch (error) {
                if (controller.signal.aborted) throw error;
                latestPlanningError = error;
            }
        }
        if (!plan) throw latestPlanningError instanceof Error ? latestPlanningError : new Error("没有可用的文本模型渠道");
        if (!(await canContinue(run.id, executionId))) {
            await refundAcceptedPlan();
            return;
        }
        if (conversationOnly || plan.intent === "conversation") {
            const completed = await updateAgentRunById(
                run.id,
                { status: "completed", tasks: [], reviewed: true, executionId: undefined },
                { type: "run.completed", data: { completed: 0, reply: plan.reply?.trim() || conversationFallbackReply(claimed.surface) } },
                ["running"],
                executionId,
            );
            if (!completed) {
                await refundAcceptedPlan();
                return;
            }
            planningPersisted = true;
            return;
        }
        const tasks = normalizeTasks(plan, skills, settings, claimed.snapshot, claimed.prompt, claimed.surface, referencedAssets);
        const projectHandoff = normalizeAgentProjectHandoff(plan, claimed.surface, referencedAssets, claimed.prompt);
        const reply = agentPlanReply({ ...plan, projectHandoff }, tasks, claimed.surface);
        const event = claimed.surface === "canvas" ? { type: "canvas.ops", data: { ops: planToOps(plan, tasks, run.id, claimed.snapshot), reply } } : { type: "run.planned", data: { reply, tasks: tasks.map(taskPlanSummary), projectHandoff } };
        const planned = await updateAgentRunById(run.id, { tasks, foundation: plan.foundation, projectHandoff, reviewed: tasks.length ? claimed.reviewed : true }, event, ["running"], executionId);
        if (!planned) {
            await refundAcceptedPlan();
            return;
        }
        planningPersisted = true;
        await executeTasks(run.id, origin, cookie, executionId);
    } catch (error) {
        let failure = error;
        try {
            await refundAcceptedPlan();
        } catch (refundError) {
            console.error("Agent planning refund failed", refundError instanceof Error ? refundError.message : refundError);
            failure = refundError;
        }
        const latest = await getAgentRun(run.id);
        if (latest && !["paused", "cancelled"].includes(latest.status))
            await updateAgentRunById(run.id, { status: "failed", executionId: undefined }, { type: "run.failed", data: { message: toSafeGenerationErrorMessage(failure, "Agent 执行失败") } }, ["planning", "running"], executionId);
    } finally {
        if (controllers.get(run.id) === controller) controllers.delete(run.id);
    }
}
