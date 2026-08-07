"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import type { WorkbenchAgentMessage, WorkbenchAgentSession } from "@/components/agent/workbench-agent-panel";
import { loadOlderWorkbenchAgentSession, loadWorkbenchAgentSession, loadWorkbenchAgentSessions, mergeWorkbenchAgentSessions, restoreLatestWorkbenchAgentSession } from "@/components/agent/workbench-agent-session-store";
import type { AgentSkillSummary } from "@/services/api/agent-skills";
import { createCreativeConversation } from "@/services/api/creative";

type WorkbenchContext = { key: string; generation: number };
type WorkbenchIdentity = { workspace: "image" | "video"; userId: string };

export function useWorkbenchAgentSessions(workspace: "image" | "video", userId: string) {
    const contextKey = `${userId}:${workspace}`;
    const [prompt, setPrompt] = useState("");
    const [agentMessages, setAgentMessagesState] = useState<WorkbenchAgentMessage[]>([]);
    const [agentSessions, setAgentSessions] = useState<WorkbenchAgentSession[]>([]);
    const [activeAgentSessionId, setActiveAgentSessionIdState] = useState(() => nanoid());
    const [activeAgentRecordId, setActiveAgentRecordId] = useState<string>();
    const [activeCreativeConversationId, setActiveCreativeConversationId] = useState<string>();
    const [agentSessionsHydrated, setAgentSessionsHydrated] = useState(false);
    const [lastAgentPrompt, setLastAgentPrompt] = useState("");
    const [availableSkills, setAvailableSkills] = useState<AgentSkillSummary[]>([]);
    const [olderAgentMessagesLoading, setOlderAgentMessagesLoading] = useState(false);
    const contextRef = useRef<WorkbenchContext>({ key: contextKey, generation: 0 });
    const identityRef = useRef<WorkbenchIdentity>({ workspace, userId });
    const activeAgentSessionIdRef = useRef(activeAgentSessionId);
    const agentMessagesContextRef = useRef(contextKey);
    const agentMessagesSessionIdRef = useRef(activeAgentSessionId);
    const agentSessionsRef = useRef<WorkbenchAgentSession[]>([]);
    const activeConversationRef = useRef<{ key: string; id: string } | undefined>(undefined);
    const activeSessionSelectedRef = useRef(false);
    const conversationRequestRef = useRef<(WorkbenchContext & { promise: Promise<string> }) | null>(null);
    const olderMessagesRequestRef = useRef<string | undefined>(undefined);
    if (contextRef.current.key !== contextKey) {
        contextRef.current = { key: contextKey, generation: contextRef.current.generation + 1 };
        activeAgentSessionIdRef.current = "";
        agentMessagesContextRef.current = "";
        agentMessagesSessionIdRef.current = "";
        activeConversationRef.current = undefined;
        activeSessionSelectedRef.current = false;
        conversationRequestRef.current = null;
        olderMessagesRequestRef.current = undefined;
    }
    const setAgentMessages = useCallback<Dispatch<SetStateAction<WorkbenchAgentMessage[]>>>((value) => {
        agentMessagesContextRef.current = contextRef.current.key;
        agentMessagesSessionIdRef.current = activeAgentSessionIdRef.current;
        setAgentMessagesState(value);
    }, []);

    useEffect(() => {
        const context = { ...contextRef.current };
        const nextIdentity = { workspace, userId };
        const resetDraft = shouldResetWorkbenchDraft(identityRef.current, nextIdentity);
        identityRef.current = nextIdentity;
        const freshSessionId = nanoid();
        activeAgentSessionIdRef.current = freshSessionId;
        agentMessagesContextRef.current = "";
        agentMessagesSessionIdRef.current = freshSessionId;
        setAgentMessagesState([]);
        setAgentSessions([]);
        agentSessionsRef.current = [];
        if (resetDraft) setPrompt("");
        setLastAgentPrompt("");
        setActiveAgentSessionIdState(freshSessionId);
        setActiveAgentRecordId(undefined);
        setActiveCreativeConversationId(undefined);
        activeConversationRef.current = undefined;
        activeSessionSelectedRef.current = false;
        conversationRequestRef.current = null;
        olderMessagesRequestRef.current = undefined;
        setOlderAgentMessagesLoading(false);
        setAgentSessionsHydrated(false);
        void loadWorkbenchAgentSessions(workspace, userId)
            .then(async (sessions) => {
                if (!isCurrentContext(contextRef.current, context)) return;
                const merged = mergeWorkbenchAgentSessions(sessions, agentSessionsRef.current);
                agentSessionsRef.current = merged;
                setAgentSessions(merged);
                if (!activeSessionSelectedRef.current && merged[0]) {
                    activeSessionSelectedRef.current = true;
                    const latest = merged[0];
                    const conversationId = latest.creativeConversationId || latest.id;
                    activeAgentSessionIdRef.current = latest.id;
                    agentMessagesSessionIdRef.current = "";
                    setActiveAgentSessionIdState(latest.id);
                    setActiveAgentRecordId(latest.recordId);
                    activeConversationRef.current = { key: context.key, id: conversationId };
                    setActiveCreativeConversationId(conversationId);
                    setLastAgentPrompt(latest.lastPrompt);
                    try {
                        const loaded = await restoreLatestWorkbenchAgentSession(workspace, merged);
                        if (loaded && isCurrentWorkbenchSession(contextRef.current, context, activeAgentSessionIdRef.current, latest.id) && activeConversationRef.current?.id === conversationId) {
                            const next = agentSessionsRef.current.map((item) => (item.id === loaded.id ? loaded : item));
                            agentSessionsRef.current = next;
                            setAgentSessions(next);
                            setActiveAgentRecordId(loaded.recordId);
                            agentMessagesContextRef.current = context.key;
                            agentMessagesSessionIdRef.current = loaded.id;
                            setAgentMessagesState(loaded.messages);
                            setLastAgentPrompt(loaded.lastPrompt);
                        }
                    } catch {
                        // The summary identity is enough to keep later turns in the same conversation.
                    }
                }
                if (isCurrentContext(contextRef.current, context)) setAgentSessionsHydrated(true);
            })
            .catch(() => {
                if (isCurrentContext(contextRef.current, context)) setAgentSessionsHydrated(true);
            });
    }, [contextKey, userId, workspace]);

    useEffect(() => {
        agentSessionsRef.current = agentSessions;
    }, [agentSessions]);

    useEffect(() => {
        if (agentMessagesContextRef.current !== contextKey || agentMessagesSessionIdRef.current !== activeAgentSessionId || !userId || !agentMessages.length) return;
        const context = { ...contextRef.current };
        if (!isCurrentContext(contextRef.current, context)) return;
        const session: WorkbenchAgentSession = {
            id: activeAgentSessionId,
            recordId: activeAgentRecordId,
            creativeConversationId: activeCreativeConversationId,
            title: agentMessages.find((item) => item.role === "user")?.text.slice(0, 24) || "新对话",
            messages: agentMessages,
            prompt,
            lastPrompt: lastAgentPrompt,
            updatedAt: Date.now(),
        };
        const next = [session, ...agentSessionsRef.current.filter((item) => item.id !== activeAgentSessionId)].slice(0, 100);
        agentSessionsRef.current = next;
        setAgentSessions(next);
    }, [activeAgentRecordId, activeAgentSessionId, activeCreativeConversationId, agentMessages, contextKey, lastAgentPrompt, prompt, userId, workspace]);

    useEffect(() => {
        const context = { ...contextRef.current };
        const controller = new AbortController();
        setAvailableSkills([]);
        void fetch("/api/agent/skills?workspace=" + workspace, { cache: "no-store", signal: controller.signal })
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => {
                if (isCurrentContext(contextRef.current, context)) setAvailableSkills(Array.isArray(payload?.data?.skills) ? payload.data.skills : []);
            })
            .catch((error) => {
                if (error instanceof DOMException && error.name === "AbortError") return;
                if (isCurrentContext(contextRef.current, context)) setAvailableSkills([]);
            });
        return () => controller.abort();
    }, [contextKey, workspace]);

    const agentSessionByRecordId = useMemo(() => {
        const sessions = new Map<string, WorkbenchAgentSession>();
        agentSessions.forEach((session) => {
            if (session.recordId) sessions.set(session.recordId, session);
        });
        return sessions;
    }, [agentSessions]);

    const updateActiveCreativeConversationId = useCallback((id: string | undefined) => {
        activeSessionSelectedRef.current = true;
        activeConversationRef.current = id ? { key: contextRef.current.key, id } : undefined;
        setActiveCreativeConversationId(id);
    }, []);

    const setActiveAgentSessionId = useCallback((id: string) => {
        activeSessionSelectedRef.current = true;
        activeAgentSessionIdRef.current = id;
        agentMessagesSessionIdRef.current = "";
        setActiveAgentSessionIdState(id);
    }, []);

    const loadAgentSession = useCallback(
        async (session: WorkbenchAgentSession) => {
            const context = { ...contextRef.current };
            const loaded = await loadWorkbenchAgentSession(workspace, session);
            if (!isCurrentContext(contextRef.current, context)) return null;
            const next = agentSessionsRef.current.map((item) => (item.id === loaded.id ? loaded : item));
            agentSessionsRef.current = next;
            setAgentSessions(next);
            return loaded;
        },
        [workspace],
    );

    const hasOlderAgentMessages = Boolean(agentSessions.find((session) => session.id === activeAgentSessionId)?.hasOlderMessages);
    const loadOlderAgentMessages = useCallback(async () => {
        const context = { ...contextRef.current };
        const session = agentSessionsRef.current.find((item) => item.id === activeAgentSessionId);
        if (!session?.hasOlderMessages || !session.oldestSequence || olderMessagesRequestRef.current === session.id) return;
        const expectedSessionId = session.id;
        olderMessagesRequestRef.current = session.id;
        setOlderAgentMessagesLoading(true);
        try {
            const loaded = await loadOlderWorkbenchAgentSession(workspace, session);
            if (!isCurrentWorkbenchSession(contextRef.current, context, activeAgentSessionIdRef.current, expectedSessionId)) return;
            const next = agentSessionsRef.current.map((item) => (item.id === loaded.id ? loaded : item));
            agentSessionsRef.current = next;
            setAgentSessions(next);
            setAgentMessages(loaded.messages);
        } catch (error) {
            console.error("Workbench history pagination failed", error instanceof Error ? error.message : error);
        } finally {
            if (olderMessagesRequestRef.current === session.id) olderMessagesRequestRef.current = undefined;
            if (isCurrentContext(contextRef.current, context)) setOlderAgentMessagesLoading(false);
        }
    }, [activeAgentSessionId, setAgentMessages, workspace]);

    const ensureCreativeConversation = useCallback(async () => {
        const context = { ...contextRef.current };
        const active = activeConversationRef.current;
        if (active?.key === context.key) return active.id;
        activeSessionSelectedRef.current = true;
        const pending = conversationRequestRef.current;
        if (pending && isCurrentContext(pending, context)) return pending.promise;
        const request = createCreativeConversation({ surface: "chat", source: `${workspace}-workbench`, title: workspace === "image" ? "图片工作台对话" : "视频工作台对话" }).then((conversation) => {
            if (!isCurrentContext(contextRef.current, context)) throw new Error("工作台已切换，请重试");
            activeConversationRef.current = { key: context.key, id: conversation.id };
            setActiveCreativeConversationId(conversation.id);
            return conversation.id;
        });
        const pendingRequest = { ...context, promise: request };
        conversationRequestRef.current = pendingRequest;
        try {
            return await request;
        } finally {
            if (conversationRequestRef.current === pendingRequest) conversationRequestRef.current = null;
        }
    }, [workspace]);

    return {
        prompt,
        setPrompt,
        agentMessages,
        setAgentMessages,
        agentSessions,
        setAgentSessions,
        agentSessionsHydrated,
        activeAgentSessionId,
        setActiveAgentSessionId,
        setActiveAgentRecordId,
        activeCreativeConversationId,
        setActiveCreativeConversationId: updateActiveCreativeConversationId,
        ensureCreativeConversation,
        lastAgentPrompt,
        setLastAgentPrompt,
        availableSkills,
        agentSessionByRecordId,
        loadAgentSession,
        hasOlderAgentMessages,
        olderAgentMessagesLoading,
        loadOlderAgentMessages,
    };
}

function isCurrentContext(current: WorkbenchContext, expected: WorkbenchContext) {
    return current.key === expected.key && current.generation === expected.generation;
}

export function isCurrentWorkbenchSession(current: WorkbenchContext, expected: WorkbenchContext, currentSessionId: string, expectedSessionId: string) {
    return isCurrentContext(current, expected) && currentSessionId === expectedSessionId;
}

export function shouldResetWorkbenchDraft(previous: WorkbenchIdentity, next: WorkbenchIdentity) {
    if (previous.workspace !== next.workspace) return true;
    return Boolean(previous.userId) && previous.userId !== next.userId;
}
