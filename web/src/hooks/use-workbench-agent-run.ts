"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { nanoid } from "nanoid";
import type { CreativeDeliverableSummary, CreativeFoundation } from "@/lib/creative-agent-contract";
import type { WorkbenchAgentAttachment } from "@/lib/workbench-agent-attachment";
import { formatAgentMessageText } from "@/components/agent/agent-message-format";
import { refreshUserPointsIfSystem } from "@/services/api/points";

import {
    appendWorkbenchAgentRequest,
    applyWorkbenchAgentPlan,
    createWorkbenchAgentProgressMessage,
    updateWorkbenchAgentResponse,
    updateWorkbenchAgentProgress,
    type WorkbenchAgentChoice,
    type WorkbenchAgentMessage,
} from "@/components/agent/workbench-agent-progress";

export type WorkbenchAgentWorkspace = "image" | "video";
export type WorkbenchAgentReferenceType = "image" | "video" | "audio";
export type WorkbenchAgentParameterPatch = Partial<Record<"model" | "size" | "quality" | "count" | "vquality" | "videoSeconds", string | number>>;

type AgentRunStage = "planning" | "submitting";
export type WorkbenchCreativeReviewContext = { recordId: string; foundation: CreativeFoundation; deliverables: CreativeDeliverableSummary[] };
type WorkbenchGenerationSubmitter = (input: { promptOverride: string; signal: AbortSignal; parameterPatch: WorkbenchAgentParameterPatch; conversationId: string }) => Promise<string | null | undefined>;
type PendingAgentGenerate = {
    messageId: string;
    hasReferences: boolean;
    resolvedPrompt: string;
    parameterPatch: WorkbenchAgentParameterPatch;
    conversationId: string;
    foundation?: CreativeFoundation;
    deliverables: CreativeDeliverableSummary[];
    submitGeneration: WorkbenchGenerationSubmitter;
};
type WorkbenchAgentPlanPayload = {
    intent?: unknown;
    parameterPatch?: unknown;
    resolvedPrompt?: unknown;
    shouldGenerate?: unknown;
    reply?: unknown;
    choices?: unknown;
    referenceRequired?: unknown;
    foundation?: unknown;
    deliverables?: unknown;
};

type UseWorkbenchAgentRunOptions = {
    workspace: WorkbenchAgentWorkspace;
    prompt: string;
    previousPrompt: string;
    models: string[];
    modelIds: string[];
    skillIds: string[];
    smartPlanning: boolean;
    currentConfig: Record<string, unknown>;
    hasReferences: boolean;
    referenceTypes: WorkbenchAgentReferenceType[];
    attachments: WorkbenchAgentAttachment[];
    conversationId?: string;
    ensureCreativeConversation: () => Promise<string>;
    setPrompt: (value: string) => void;
    setLastAgentPrompt: (value: string) => void;
    setAgentMessages: Dispatch<SetStateAction<WorkbenchAgentMessage[]>>;
    applyParameterPatch: (patch: WorkbenchAgentParameterPatch) => void;
    submitGeneration: WorkbenchGenerationSubmitter;
    onRequestSent?: () => void;
    onManualModelRequired?: () => void;
};

export function useWorkbenchAgentRun({
    workspace,
    prompt,
    previousPrompt,
    models,
    modelIds,
    skillIds,
    smartPlanning,
    currentConfig,
    hasReferences,
    referenceTypes,
    attachments,
    conversationId,
    ensureCreativeConversation,
    setPrompt,
    setLastAgentPrompt,
    setAgentMessages,
    applyParameterPatch,
    submitGeneration,
    onRequestSent,
    onManualModelRequired,
}: UseWorkbenchAgentRunOptions) {
    const [agentRunning, setAgentRunning] = useState(false);
    const [pendingAgentGenerate, setPendingAgentGenerate] = useState<PendingAgentGenerate | null>(null);
    const [creativeReviewContext, setCreativeReviewContext] = useState<WorkbenchCreativeReviewContext | null>(null);
    const agentRequestRef = useRef<{ messageId: string; controller: AbortController; stage: AgentRunStage } | null>(null);
    const retryActionsRef = useRef(new Map<string, () => void>());
    const mediaLabel = workspace === "image" ? "图片" : "视频";

    const runAgentGenerate = useCallback(async () => {
        const text = prompt.trim();
        if (!text || agentRequestRef.current) return;
        if (workbenchRequiresManualModel(smartPlanning, modelIds)) {
            onManualModelRequired?.();
            return;
        }
        const progressId = nanoid();
        const submittedAttachments = attachments.map((item) => ({ ...item }));
        let resolvedConversationId = conversationId;
        setPendingAgentGenerate(null);
        setCreativeReviewContext(null);
        const executePlanning = async (appendRequest: boolean) => {
            if (agentRequestRef.current) return;
            const controller = new AbortController();
            agentRequestRef.current = { messageId: progressId, controller, stage: "planning" };
            if (appendRequest) {
                setPrompt("");
                setAgentMessages((items) => appendWorkbenchAgentRequest(items, text, submittedAttachments, createWorkbenchAgentProgressMessage(progressId, hasReferences)));
                onRequestSent?.();
            } else {
                setAgentMessages((items) => updateWorkbenchAgentProgress(items, progressId, { phase: "planning", hasReferences }, "正在理解你的需求。"));
            }
            setAgentRunning(true);
            try {
                resolvedConversationId ||= await ensureCreativeConversation();
                const response = await fetch("/api/agent/workbench", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: controller.signal,
                    body: JSON.stringify({
                        requestId: progressId,
                        workspace,
                        conversationId: resolvedConversationId,
                        prompt: text,
                        previousPrompt,
                        models,
                        modelIds,
                        skillIds,
                        smartPlanning,
                        currentConfig,
                        hasReferences,
                        referenceTypes,
                        attachments: submittedAttachments,
                    }),
                });
                const payload = (await response.json().catch(() => ({}))) as { data?: WorkbenchAgentPlanPayload; msg?: string };
                if (!response.ok || !payload.data) throw new Error(payload.msg || "Agent 参数解析失败");
                if (controller.signal.aborted || agentRequestRef.current?.messageId !== progressId) return;

                const patch = normalizeParameterPatch(payload.data.parameterPatch);
                applyParameterPatch(patch);
                const resolvedPrompt = typeof payload.data.resolvedPrompt === "string" && payload.data.resolvedPrompt.trim() ? payload.data.resolvedPrompt : text;
                setLastAgentPrompt(resolvedPrompt);
                const shouldGenerate = payload.data.shouldGenerate !== false;
                const reply = typeof payload.data.reply === "string" && payload.data.reply.trim() ? payload.data.reply : "已完成处理。";
                const choices = Array.isArray(payload.data.choices) ? (payload.data.choices as WorkbenchAgentChoice[]) : [];
                const intent = payload.data.intent === "conversation" ? "conversation" : "generation";
                const foundation = payload.data.foundation && typeof payload.data.foundation === "object" ? (payload.data.foundation as CreativeFoundation) : undefined;
                const deliverables = Array.isArray(payload.data.deliverables) ? (payload.data.deliverables as CreativeDeliverableSummary[]) : [];
                setAgentMessages((items) => applyWorkbenchAgentPlan(items, progressId, shouldGenerate ? "已理解需求，正在创建生成任务。" : reply, choices));
                if (shouldGenerate) {
                    if (agentRequestRef.current?.messageId === progressId) agentRequestRef.current.stage = "submitting";
                    setPendingAgentGenerate({
                        messageId: progressId,
                        hasReferences,
                        resolvedPrompt,
                        parameterPatch: patch,
                        conversationId: resolvedConversationId,
                        foundation: intent === "generation" ? foundation : undefined,
                        deliverables,
                        submitGeneration,
                    });
                } else {
                    retryActionsRef.current.delete(progressId);
                    agentRequestRef.current = null;
                    setAgentRunning(false);
                }
            } catch (error) {
                if (agentRequestRef.current?.messageId !== progressId) return;
                const errorMessage = error instanceof Error ? error.message : `${mediaLabel} Agent 规划失败`;
                const failure = buildWorkbenchAgentFailureUpdate({ aborted: controller.signal.aborted, failedAt: "planning", hasReferences, mediaLabel, errorMessage });
                setPendingAgentGenerate(null);
                setAgentMessages((items) => updateWorkbenchAgentProgress(items, progressId, failure.progress, failure.text));
                if (!controller.signal.aborted) retryActionsRef.current.set(progressId, () => void executePlanning(false));
                else retryActionsRef.current.delete(progressId);
                agentRequestRef.current = null;
                setAgentRunning(false);
            } finally {
                void refreshUserPointsIfSystem("system");
            }
        };
        await executePlanning(true);
    }, [
        applyParameterPatch,
        attachments,
        conversationId,
        currentConfig,
        ensureCreativeConversation,
        hasReferences,
        mediaLabel,
        models,
        modelIds,
        onManualModelRequired,
        onRequestSent,
        previousPrompt,
        prompt,
        referenceTypes,
        setAgentMessages,
        setLastAgentPrompt,
        setPrompt,
        skillIds,
        smartPlanning,
        submitGeneration,
        workspace,
    ]);

    const cancelAgentRun = useCallback(() => {
        const active = agentRequestRef.current;
        if (!active) return;
        active.controller.abort();
        retryActionsRef.current.delete(active.messageId);
        setPendingAgentGenerate(null);
        setAgentMessages((items) => updateWorkbenchAgentProgress(items, active.messageId, { phase: "cancelled", hasReferences, failedAt: active.stage }, "你已停止本轮 Agent，本次没有创建生成任务。"));
        agentRequestRef.current = null;
        setAgentRunning(false);
    }, [hasReferences, setAgentMessages]);

    useEffect(() => {
        if (!pendingAgentGenerate) return;
        const pending = pendingAgentGenerate;
        const active = agentRequestRef.current;
        setPendingAgentGenerate(null);
        if (!active || active.messageId !== pending.messageId || active.controller.signal.aborted) {
            setAgentRunning(false);
            return;
        }
        const retrySubmission = () => {
            if (agentRequestRef.current) return;
            const controller = new AbortController();
            agentRequestRef.current = { messageId: pending.messageId, controller, stage: "submitting" };
            setAgentMessages((items) => updateWorkbenchAgentProgress(items, pending.messageId, { phase: "submitting", hasReferences: pending.hasReferences, shouldGenerate: true }, "正在重新创建生成任务。"));
            setAgentRunning(true);
            setPendingAgentGenerate(pending);
        };
        void pending
            .submitGeneration({ promptOverride: pending.resolvedPrompt, signal: active.controller.signal, parameterPatch: pending.parameterPatch, conversationId: pending.conversationId })
            .then((recordId) => {
                if (active.controller.signal.aborted || agentRequestRef.current?.messageId !== pending.messageId) return;
                const acceptedRecordId = acceptWorkbenchGenerationSubmission(recordId, mediaLabel);
                retryActionsRef.current.delete(pending.messageId);
                if (pending.foundation) setCreativeReviewContext({ recordId: acceptedRecordId, foundation: pending.foundation, deliverables: pending.deliverables });
                setAgentMessages((items) => updateWorkbenchAgentResponse(items, pending.messageId, `已提交${mediaLabel}生成任务，结果会显示在工作区。`));
            })
            .catch((error) => {
                if (active.controller.signal.aborted) return;
                const errorMessage = error instanceof Error ? error.message : `${mediaLabel}生成任务创建失败`;
                const failure = buildWorkbenchAgentFailureUpdate({ aborted: false, failedAt: "submitting", hasReferences: pending.hasReferences, shouldGenerate: true, mediaLabel, errorMessage });
                retryActionsRef.current.set(pending.messageId, retrySubmission);
                setAgentMessages((items) => updateWorkbenchAgentProgress(items, pending.messageId, failure.progress, failure.text));
            })
            .finally(() => {
                if (agentRequestRef.current?.messageId === pending.messageId) agentRequestRef.current = null;
                setAgentRunning(false);
            });
    }, [mediaLabel, pendingAgentGenerate, setAgentMessages]);

    const retryAgentMessage = useCallback((messageId: string) => retryActionsRef.current.get(messageId)?.(), []);

    return { agentRunning, runAgentGenerate, retryAgentMessage, cancelAgentRun, creativeReviewContext };
}

export function acceptWorkbenchGenerationSubmission(recordId: string | null | undefined, mediaLabel: string) {
    if (!recordId) throw new Error(`${mediaLabel}生成任务未能创建，请检查模型与参数`);
    return recordId;
}

export function workbenchRequiresManualModel(smartPlanning: boolean, modelIds: string[]) {
    return !smartPlanning && modelIds.length === 0;
}

export function buildWorkbenchAgentFailureUpdate({
    aborted,
    failedAt,
    hasReferences,
    shouldGenerate,
    mediaLabel,
    errorMessage,
}: {
    aborted: boolean;
    failedAt: "planning" | "submitting";
    hasReferences: boolean;
    shouldGenerate?: boolean;
    mediaLabel: string;
    errorMessage: string;
}): { progress: { phase: "cancelled" | "failed"; hasReferences: boolean; shouldGenerate?: boolean; failedAt: "planning" | "submitting" }; text: string } {
    const baseProgress = { hasReferences, failedAt, ...(shouldGenerate === undefined ? {} : { shouldGenerate }) };
    if (aborted) {
        return {
            progress: { phase: "cancelled", ...baseProgress },
            text: "你已停止本轮 Agent，本次没有创建生成任务。",
        };
    }

    const prefix = failedAt === "planning" ? "规划没有完成，本次没有创建生成任务。" : `任务没有创建成功，本次没有进入${mediaLabel}生成队列。`;
    return {
        progress: { phase: "failed", ...baseProgress },
        text: `${prefix}${workbenchAgentRecoveryHint(errorMessage)}`,
    };
}

function workbenchAgentRecoveryHint(errorMessage: string) {
    const message = formatAgentMessageText(errorMessage.trim());
    const reason = message ? `原因：${message}` : "原因：未知错误";
    if (/默认文本模型|文本模型|规划失败|执行计划/.test(message)) return `${reason}。请在后台模型渠道中确认默认文本模型已启用、绑定渠道有密钥，并重新发送需求。`;
    if (/视频模型|可用视频模型|video/i.test(message)) return `${reason}。请在后台确认视频逻辑模型和上游渠道可用，或切换到可用视频模型后重试。`;
    if (/参考|素材|公网|NEXT_PUBLIC_SITE_URL/i.test(message)) return `${reason}。请重新上传参考素材、切换可用渠道，或选择无参考方案/只做方案。`;
    return `${reason}。可以调整需求后重试；若持续失败，请检查后台模型渠道、额度和并发设置。`;
}

function normalizeParameterPatch(value: unknown): WorkbenchAgentParameterPatch {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const input = value as Record<string, unknown>;
    const patch: WorkbenchAgentParameterPatch = {};
    (["model", "size", "quality", "count", "vquality", "videoSeconds"] as const).forEach((key) => {
        const next = input[key];
        if (typeof next === "string" || typeof next === "number") patch[key] = next;
    });
    return patch;
}

export function mergeWorkbenchAgentPatch<T extends object>(config: T, patch: WorkbenchAgentParameterPatch | undefined, workspace: WorkbenchAgentWorkspace): T {
    const next: Record<string, unknown> = { ...(config as Record<string, unknown>) };
    if (!patch) return next as T;
    if (patch.size) next.size = String(patch.size);
    if (workspace === "image") {
        if (patch.model) next.imageModel = String(patch.model);
        if (patch.quality) next.quality = String(patch.quality);
        if (patch.count) next.count = String(patch.count);
    } else {
        if (patch.model) next.videoModel = String(patch.model);
        if (patch.vquality) next.vquality = String(patch.vquality);
        if (patch.videoSeconds) next.videoSeconds = String(patch.videoSeconds);
    }
    return next as T;
}
