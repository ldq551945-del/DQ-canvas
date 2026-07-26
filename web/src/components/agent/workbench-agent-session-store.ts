import type { CreativeMessage } from "@/lib/creative-runtime-contract";
import type { WorkbenchWorkspace } from "@/lib/workbench-session-contract";
import { getCreativeWorkbenchSession, listCreativeWorkbenchSessions } from "@/services/api/creative";

import type { WorkbenchAgentMessage, WorkbenchAgentSession } from "./workbench-agent-panel";

export async function loadWorkbenchAgentSessions(workspace: WorkbenchWorkspace, userId: string) {
    if (!userId) return [];
    const sessions = await listCreativeWorkbenchSessions(workspace);
    return normalizeWorkbenchAgentSessions(
        sessions.map((session) => ({
            id: session.id,
            recordId: normalizeRecordId(workspace, session.recordId),
            creativeConversationId: session.id,
            title: session.title,
            messages: [],
            prompt: "",
            lastPrompt: session.lastPrompt,
            searchText: session.searchText,
            loaded: false,
            updatedAt: session.updatedAt,
        })),
    );
}

export async function loadWorkbenchAgentSession(workspace: WorkbenchWorkspace, session: WorkbenchAgentSession) {
    if (session.loaded) return session;
    const detail = await getCreativeWorkbenchSession(session.creativeConversationId || session.id, workspace);
    return normalizeWorkbenchAgentSessions([
        {
            ...session,
            recordId: normalizeRecordId(workspace, detail.recordId) || session.recordId,
            messages: detail.messages.map(toWorkbenchMessage),
            loaded: true,
            hasOlderMessages: detail.hasMore,
            oldestSequence: detail.nextBeforeSequence,
        },
    ])[0];
}

export async function loadOlderWorkbenchAgentSession(workspace: WorkbenchWorkspace, session: WorkbenchAgentSession) {
    if (!session.loaded || !session.hasOlderMessages || !session.oldestSequence) return session;
    const detail = await getCreativeWorkbenchSession(session.creativeConversationId || session.id, workspace, session.oldestSequence);
    const existingIds = new Set(session.messages.map((message) => message.id));
    const olderMessages = detail.messages.map(toWorkbenchMessage).filter((message) => !existingIds.has(message.id));
    return normalizeWorkbenchAgentSessions([
        {
            ...session,
            messages: [...olderMessages, ...session.messages],
            hasOlderMessages: detail.hasMore,
            oldestSequence: detail.nextBeforeSequence,
        },
    ])[0];
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

export function saveWorkbenchAgentSessions(_workspace: WorkbenchWorkspace, _userId: string, sessions: WorkbenchAgentSession[]) {
    return Promise.resolve(sessions);
}

function normalizeRecordId(workspace: WorkbenchWorkspace, value?: string) {
    return value?.replace(`${workspace}-workbench:`, "") || undefined;
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
        sequence: message.sequence,
        role: message.role === "user" ? "user" : message.status === "failed" ? "error" : "assistant",
        text: message.content,
    };
}
