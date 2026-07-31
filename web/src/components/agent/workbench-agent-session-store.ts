import type { CreativeMessage } from "@/lib/creative-runtime-contract";
import { WORKBENCH_PUBLIC_MESSAGE_VISIBILITY, type WorkbenchWorkspace } from "@/lib/workbench-session-contract";
import { normalizeWorkbenchAgentAttachments } from "@/lib/workbench-agent-attachment";
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
            messages: detail.messages.flatMap(toWorkbenchMessage),
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
    const olderMessages = detail.messages.flatMap(toWorkbenchMessage).filter((message) => !existingIds.has(message.id));
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
        const messages = session.messages.filter((message) => {
            if (message.role === "assistant" && !message.progress && message.text.trim() === "正在按当前参数创建生成任务。") return false;
            return true;
        });
        const latestUserText = messages.findLast((message) => message.role === "user")?.text.trim() || "";
        const prompt = session.prompt.trim();
        const nextPrompt = prompt && (prompt === latestUserText || prompt === session.lastPrompt.trim()) ? "" : session.prompt;
        return messages === session.messages && nextPrompt === session.prompt ? session : { ...session, messages, prompt: nextPrompt };
    });
}

export function mergeWorkbenchAgentSessions(serverSessions: WorkbenchAgentSession[], localSessions: WorkbenchAgentSession[]) {
    const merged = [...serverSessions];
    for (const local of localSessions) {
        const index = merged.findIndex((item) => item.id === local.id || Boolean(local.creativeConversationId && item.creativeConversationId === local.creativeConversationId) || Boolean(local.recordId && item.recordId === local.recordId));
        if (index < 0) {
            merged.unshift(local);
            continue;
        }
        const server = merged[index];
        merged[index] = {
            ...server,
            ...local,
            recordId: local.recordId || server.recordId,
            creativeConversationId: local.creativeConversationId || server.creativeConversationId,
            messages: local.messages.length ? local.messages : server.messages,
            loaded: local.loaded ?? server.loaded,
            hasOlderMessages: local.hasOlderMessages ?? server.hasOlderMessages,
            oldestSequence: local.oldestSequence ?? server.oldestSequence,
        };
    }
    return normalizeWorkbenchAgentSessions(merged).slice(0, 100);
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

export function findWorkbenchAgentSessionForRecord(sessions: WorkbenchAgentSession[], recordId: string, conversationId?: string) {
    return sessions.find((session) => session.recordId === recordId) || sessions.find((session) => Boolean(conversationId && session.creativeConversationId === conversationId));
}

export function removeWorkbenchAgentSessionsForRecords(sessions: WorkbenchAgentSession[], recordIds: ReadonlySet<string>) {
    return sessions.filter((session) => !session.recordId || !recordIds.has(session.recordId));
}

function toWorkbenchMessage(message: CreativeMessage): WorkbenchAgentMessage[] {
    if (message.metadata.contentVisibility !== WORKBENCH_PUBLIC_MESSAGE_VISIBILITY) return [];
    const attachments = normalizeWorkbenchAgentAttachments(message.metadata.attachments);
    return [
        {
            id: message.id,
            sequence: message.sequence,
            role: message.role === "user" ? "user" : message.status === "failed" ? "error" : "assistant",
            text: message.content,
            ...(attachments.length ? { attachments } : {}),
        },
    ];
}
