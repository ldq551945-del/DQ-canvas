export type WorkbenchAgentProgressPhase = "planning" | "submitting" | "completed" | "failed" | "cancelled";
export type WorkbenchAgentProgressStepStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type WorkbenchAgentProgress = {
    phase: WorkbenchAgentProgressPhase;
    hasReferences: boolean;
    referenceRequired?: boolean;
    shouldGenerate?: boolean;
    intent?: "conversation" | "generation";
    failedAt?: "planning" | "submitting";
};

export type WorkbenchAgentChoice = {
    label: string;
    description: string;
    prompt?: string;
    action?: "prompt" | "upload";
};

export type WorkbenchAgentMessage = {
    id: string;
    sequence?: number;
    role: "user" | "assistant" | "warning" | "error";
    text: string;
    attachments?: WorkbenchAgentAttachment[];
    progress?: WorkbenchAgentProgress;
    choices?: WorkbenchAgentChoice[];
};

export type WorkbenchAgentSession = {
    id: string;
    recordId?: string;
    creativeConversationId?: string;
    title: string;
    messages: WorkbenchAgentMessage[];
    prompt: string;
    lastPrompt: string;
    searchText?: string;
    loaded?: boolean;
    hasOlderMessages?: boolean;
    oldestSequence?: number;
    updatedAt: number;
};

type ProgressStep = {
    key: "brief" | "direction" | "deliverables" | "submit" | "review";
    label: string;
    status: WorkbenchAgentProgressStepStatus;
};

const stepDefinitions: Array<Pick<ProgressStep, "key" | "label">> = [
    { key: "brief", label: "理解当前需求与参考素材" },
    { key: "direction", label: "检查创作约束" },
    { key: "deliverables", label: "准备生成任务" },
    { key: "submit", label: "创建生成任务" },
    { key: "review", label: "整理生成结果" },
];

export function workbenchAgentProgressSteps(progress: WorkbenchAgentProgress): ProgressStep[] {
    if (progress.intent === "conversation" || (progress.phase === "planning" && !progress.intent)) {
        return [{ ...stepDefinitions[0], status: progress.phase === "completed" ? "completed" : progress.phase === "failed" ? "failed" : progress.phase === "cancelled" ? "cancelled" : "running" }];
    }
    const visible = stepDefinitions.filter((step) => progress.shouldGenerate !== false || step.key === "brief" || step.key === "direction" || step.key === "deliverables");
    if (progress.phase === "completed") return visible.map((step) => ({ ...step, status: "completed" }));

    const activeKey = progress.phase === "submitting" || progress.failedAt === "submitting" ? "submit" : progress.failedAt === "planning" ? "direction" : "brief";
    const activeIndex = visible.findIndex((step) => step.key === activeKey);
    return visible.map((step, index) => ({
        ...step,
        status: index < activeIndex ? "completed" : index > activeIndex ? "pending" : progress.phase === "failed" ? "failed" : progress.phase === "cancelled" ? "cancelled" : "running",
    }));
}

export function workbenchAgentProgressHeading(progress: WorkbenchAgentProgress) {
    if (progress.phase === "planning") return "正在理解并规划";
    if (progress.phase === "submitting") return "正在创建生成任务";
    if (progress.phase === "failed") return "Agent 执行失败";
    if (progress.phase === "cancelled") return "本次执行已取消";
    if (progress.intent === "conversation") return "已回复";
    return progress.shouldGenerate === false ? "已完成需求分析" : "创作任务已就绪";
}

export function createWorkbenchAgentProgressMessage(id: string, hasReferences: boolean, mediaLabel = "创作需求"): WorkbenchAgentMessage {
    return {
        id,
        role: "assistant",
        text: hasReferences ? `收到，我会根据当前参考素材完成这次${mediaLabel}。` : `收到，我会按你的要求完成这次${mediaLabel}。`,
        progress: { phase: "planning", hasReferences },
    };
}

export function appendWorkbenchAgentRequest(messages: WorkbenchAgentMessage[], text: string, attachments: WorkbenchAgentAttachment[], progress: WorkbenchAgentMessage): WorkbenchAgentMessage[] {
    const normalized = text.trim();
    return [...messages, { id: `${progress.id}-user`, role: "user" as const, text: normalized, ...(attachments.length ? { attachments } : {}) }, progress];
}

export function updateWorkbenchAgentProgress(messages: WorkbenchAgentMessage[], id: string, progress: WorkbenchAgentProgress, text?: string, choices?: WorkbenchAgentChoice[]): WorkbenchAgentMessage[] {
    return messages.map((message) =>
        message.id === id
            ? {
                  ...message,
                  role: progress.phase === "failed" ? "error" : progress.phase === "cancelled" ? "warning" : "assistant",
                  text: text ?? message.text,
                  progress,
                  ...(choices ? { choices } : {}),
              }
            : message,
    );
}

export function applyWorkbenchAgentPlan(messages: WorkbenchAgentMessage[], id: string, reply: string, choices?: WorkbenchAgentChoice[]): WorkbenchAgentMessage[] {
    const response: WorkbenchAgentMessage = { id, role: "assistant", text: reply, choices };
    return messages.map((message) => (message.id === id ? response : message));
}

export function updateWorkbenchAgentResponse(messages: WorkbenchAgentMessage[], id: string, text: string, role: "assistant" | "warning" | "error" = "assistant"): WorkbenchAgentMessage[] {
    return messages.map((message) => (message.id === id ? { ...message, role, text, progress: undefined, choices: undefined } : message));
}
import type { WorkbenchAgentAttachment } from "@/lib/workbench-agent-attachment";
