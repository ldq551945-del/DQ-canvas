import type { CreativeMessage } from "@/lib/creative-runtime-contract";
import { listCreativeAssets, listCreativeConversations, listCreativeMessages } from "@/services/api/creative";

import type { WorkbenchAgentMessage, WorkbenchAgentSession } from "./workbench-agent-panel";

type Workspace = "image" | "video";

export async function loadWorkbenchAgentSessions(workspace: Workspace, userId: string) {
    if (!userId) return [];
    const title = workspace === "image" ? "图片工作台对话" : "视频工作台对话";
    const source = workspace === "image" ? "image-workbench" : "video-workbench";
    const conversations = (await listCreativeConversations(source)).filter((conversation) => conversation.title === title);
    const sessions = await Promise.all(
        conversations.map(async (conversation): Promise<WorkbenchAgentSession | null> => {
            const [messages, assets] = await Promise.all([listCreativeMessages(conversation.id), listCreativeAssets(conversation.id)]);
            const workspaceMessages = messages.filter((message) => message.metadata.workspace === workspace);
            if (!workspaceMessages.length) return null;
            const storedRecordId = assets.map((asset) => asset.metadata.generationLogId).find((value): value is string => typeof value === "string" && Boolean(value));
            const recordId = storedRecordId?.replace(`${workspace}-workbench:`, "");
            const lastPrompt = workspaceMessages.findLast((message) => message.role === "user")?.content || "";
            return {
                id: conversation.id,
                recordId,
                creativeConversationId: conversation.id,
                title: workspaceMessages.find((message) => message.role === "user")?.content.slice(0, 24) || conversation.title,
                messages: workspaceMessages.map(toWorkbenchMessage),
                prompt: "",
                lastPrompt,
                updatedAt: conversation.updatedAt,
            };
        }),
    );
    return normalizeWorkbenchAgentSessions(sessions.filter((session): session is WorkbenchAgentSession => Boolean(session)));
}

export function normalizeWorkbenchAgentSessions(sessions: WorkbenchAgentSession[]) {
    return sessions.map((session) => {
        let lastUserText = "";
        const messages = session.messages.filter((message) => {
            if (message.role === "assistant" && !message.progress && message.text.trim() === "正在按当前参数创建生成任务。") return false;
            if (message.role !== "user") return true;
            const text = message.text.trim();
            if (text && text === lastUserText) return false;
            lastUserText = text;
            return true;
        });
        const latestUserText = messages.findLast((message) => message.role === "user")?.text.trim() || "";
        const prompt = session.prompt.trim();
        const nextPrompt = prompt && (prompt === latestUserText || prompt === session.lastPrompt.trim()) ? "" : session.prompt;
        return messages === session.messages && nextPrompt === session.prompt ? session : { ...session, messages, prompt: nextPrompt };
    });
}

export function saveWorkbenchAgentSessions(_workspace: Workspace, _userId: string, sessions: WorkbenchAgentSession[]) {
    return Promise.resolve(sessions);
}

export function matchesWorkbenchHistoryQuery(query: string, ...values: string[]) {
    const normalized = query.trim().toLowerCase();
    return !normalized || values.some((value) => value.toLowerCase().includes(normalized));
}

export function findWorkbenchAgentSessionForRecord(sessions: WorkbenchAgentSession[], recordId: string, prompt: string) {
    return sessions.find((session) => session.recordId === recordId) || sessions.find((session) => !session.recordId && (session.prompt === prompt || session.lastPrompt === prompt));
}

export function removeWorkbenchAgentSessionsForRecords(sessions: WorkbenchAgentSession[], recordIds: ReadonlySet<string>) {
    return sessions.filter((session) => !session.recordId || !recordIds.has(session.recordId));
}

function toWorkbenchMessage(message: CreativeMessage): WorkbenchAgentMessage {
    return {
        id: message.id,
        role: message.role === "user" ? "user" : message.status === "failed" ? "error" : "assistant",
        text: message.content,
    };
}
