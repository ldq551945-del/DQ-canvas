"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import type { WorkbenchAgentMessage, WorkbenchAgentSession } from "@/components/agent/workbench-agent-panel";
import { loadOlderWorkbenchAgentSession, loadWorkbenchAgentSession, loadWorkbenchAgentSessions, mergeWorkbenchAgentSessions } from "@/components/agent/workbench-agent-session-store";
import type { AgentSkillSummary } from "@/services/api/agent-skills";
import { createCreativeConversation } from "@/services/api/creative";

type WorkbenchContext = { key: string; generation: number };

export function useWorkbenchAgentSessions(workspace: "image" | "video", userId: string) {
    const contextKey = `${userId}:${workspace}`;
    const [prompt, setPrompt] = useState("");
    const [agentMessages, setAgentMessagesState] = useState<WorkbenchAgentMessage[]>([]);
    const [agentSessions, setAgentSessions] = useState<WorkbenchAgentSession[]>([]);
    const [activeAgentSessionId, setActiveAgentSessionId] = useState(() => nanoid());
    const [activeAgentRecordId, setActiveAgentRecordId] = useState<string>();
    const [activeCreativeConversationId, setActiveCreativeConversationId] = useState<string>();
    const [agentSessionsHydrated, setAgentSessionsHydrated] = useState(false);
    const [lastAgentPrompt, setLastAgentPrompt] = useState("");
    const [availableSkills, setAvailableSkills] = useState<AgentSkillSummary[]>([]);
    const [olderAgentMessagesLoading, setOlderAgentMessagesLoading] = useState(false);
    const contextRef = useRef<WorkbenchContext>({ key: contextKey, generation: 0 });
    const agentMessagesContextRef = useRef(contextKey);
    const agentSessionsRef = useRef<WorkbenchAgentSession[]>([]);
    const activeConversationRef = useRef<{ key: string; id: string } | undefined>(undefined);
    const conversationRequestRef = useRef<(WorkbenchContext & { promise: Promise<string> }) | null>(null);
    const olderMessagesRequestRef = useRef<string | undefined>(undefined);
    if (contextRef.current.key !== contextKey) {
        contextRef.current = { key: contextKey, generation: contextRef.current.generation + 1 };
        agentMessagesContextRef.current = "";
        activeConversationRef.current = undefined;
        conversationRequestRef.current = null;
        olderMessagesRequestRef.current = undefined;
    }
    const setAgentMessages = useCallback<Dispatch<SetStateAction<WorkbenchAgentMessage[]>>>((value) => {
        agentMessagesContextRef.current = contextRef.current.key;
        setAgentMessagesState(value);
    }, []);

    useEffect(() => {
        const context = { ...contextRef.current };
        agentMessagesContextRef.current = "";
        setAgentMessagesState([]);
        setAgentSessions([]);
        agentSessionsRef.current = [];
        setPrompt("");
        setLastAgentPrompt("");
        setActiveAgentSessionId(nanoid());
        setActiveAgentRecordId(undefined);
        setActiveCreativeConversationId(undefined);
        activeConversationRef.current = undefined;
        conversationRequestRef.current = null;
        olderMessagesRequestRef.current = undefined;
        setOlderAgentMessagesLoading(false);
        setAgentSessionsHydrated(false);
        void loadWorkbenchAgentSessions(workspace, userId)
            .then((sessions) => {
                if (!isCurrentContext(contextRef.current, context)) return;
                const merged = mergeWorkbenchAgentSessions(sessions, agentSessionsRef.current);
                agentSessionsRef.current = merged;
                setAgentSessions(merged);
                setAgentSessionsHydrated(true);
            })
            .catch(() => {
                if (isCurrentContext(contextRef.current, context)) setAgentSessionsHydrated(true);
            });
    }, [contextKey, userId, workspace]);

    useEffect(() => {
        agentSessionsRef.current = agentSessions;
    }, [agentSessions]);

    useEffect(() => {
        if (agentMessagesContextRef.current !== contextKey || !userId || !agentMessages.length) return;
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
        activeConversationRef.current = id ? { key: contextRef.current.key, id } : undefined;
        setActiveCreativeConversationId(id);
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
        olderMessagesRequestRef.current = session.id;
        setOlderAgentMessagesLoading(true);
        try {
            const loaded = await loadOlderWorkbenchAgentSession(workspace, session);
            if (!isCurrentContext(contextRef.current, context)) return;
            const next = agentSessionsRef.current.map((item) => (item.id === loaded.id ? loaded : item));
            agentSessionsRef.current = next;
            setAgentSessions(next);
            if (activeAgentSessionId === loaded.id) setAgentMessages(loaded.messages);
        } catch (error) {
            console.error("Workbench history pagination failed", error instanceof Error ? error.message : error);
        } finally {
            if (olderMessagesRequestRef.current === session.id) olderMessagesRequestRef.current = undefined;
            if (isCurrentContext(contextRef.current, context)) setOlderAgentMessagesLoading(false);
        }
    }, [activeAgentSessionId, workspace]);

    const ensureCreativeConversation = useCallback(async () => {
        const context = { ...contextRef.current };
        const active = activeConversationRef.current;
        if (active?.key === context.key) return active.id;
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
