import { create } from "zustand";

import { createClientSessionEpoch, type ClientSessionStamp } from "@/lib/client-session-epoch";
import type { CanvasProject, CreateCanvasProjectInput } from "@/lib/canvas-project-contract";
import { createCanvasProject, deleteCanvasProjects as deleteCanvasProjectsRequest, listCanvasProjects, saveCanvasProject } from "@/services/api/canvas-projects";
import { useUserStore } from "@/stores/use-user-store";

export type { CanvasProject } from "@/lib/canvas-project-contract";

type CanvasProjectPatch = Partial<Pick<CanvasProject, "creativeConversationId" | "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>;

type CanvasStore = {
    hydrated: boolean;
    hydratedUserId: string;
    syncError?: string;
    projects: CanvasProject[];
    hydrate: (force?: boolean) => Promise<void>;
    createProject: (title?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>, sourceHandoffId?: string) => Promise<string>;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => Promise<void>;
    updateProject: (id: string, patch: CanvasProjectPatch) => void;
    reset: () => void;
};

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveQueues = new Map<string, Promise<void>>();
const latestProjectTimes = new Map<string, number>();
const sessionEpoch = createClientSessionEpoch(() => useUserStore.getState().user?.id || "");
let hydrateRequestId = 0;
let hydrateRequest: (ClientSessionStamp & { requestId: number; promise: Promise<void> }) | null = null;

export const useCanvasStore = create<CanvasStore>((set, get) => ({
    hydrated: false,
    hydratedUserId: "",
    projects: [],
    hydrate: async (force = false) => {
        const userId = useUserStore.getState().user?.id || "";
        if (!userId) {
            invalidateSession();
            set({ hydrated: true, hydratedUserId: "", projects: [], syncError: undefined });
            return;
        }
        if (!force && get().hydrated && get().hydratedUserId === userId) return;
        const session = sessionEpoch.capture();
        if (!force && hydrateRequest?.userId === session.userId && hydrateRequest.epoch === session.epoch) return hydrateRequest.promise;
        const requestId = ++hydrateRequestId;
        set((state) => ({ hydrated: false, hydratedUserId: userId, projects: state.hydratedUserId === userId ? state.projects : [], syncError: undefined }));
        const promise = listCanvasProjects()
            .then((projects) => {
                if (!isActiveHydrate(session, requestId)) return;
                set({ projects, hydrated: true, hydratedUserId: userId });
            })
            .catch((error) => {
                if (isActiveHydrate(session, requestId)) set({ projects: [], hydrated: false, hydratedUserId: userId, syncError: error instanceof Error ? error.message : "画布项目加载失败" });
            })
            .finally(() => {
                if (hydrateRequest?.requestId === requestId) hydrateRequest = null;
            });
        hydrateRequest = { ...session, requestId, promise };
        return promise;
    },
    createProject: async (title = "未命名画布") => {
        const session = requireSession();
        const project = await createCanvasProject({ title });
        assertCurrent(session);
        set((state) => ({ projects: [project, ...state.projects.filter((item) => item.id !== project.id)], syncError: undefined }));
        return project.id;
    },
    importProject: async (project, sourceHandoffId) => {
        const session = requireSession();
        const created = await createCanvasProject({ title: project.title || "导入画布", sourceHandoffId, project });
        assertCurrent(session);
        set((state) => ({ projects: [created, ...state.projects.filter((item) => item.id !== created.id)], syncError: undefined }));
        return created.id;
    },
    openProject: (id) => get().projects.find((item) => item.id === id) || null,
    renameProject: (id, title) => mutateProject(id, (project) => ({ ...project, title: title.trim() || project.title })),
    deleteProjects: async (ids) => {
        const session = requireSession();
        const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
        if (!uniqueIds.length) return;
        uniqueIds.forEach((id) => clearProjectSave(session, id));
        await Promise.all(uniqueIds.map((id) => saveQueues.get(sessionEpoch.key(session, id))?.catch(() => undefined)));
        assertCurrent(session);
        await deleteCanvasProjectsRequest(uniqueIds);
        if (!sessionEpoch.isCurrent(session)) return;
        uniqueIds.forEach((id) => latestProjectTimes.delete(sessionEpoch.key(session, id)));
        set((state) => ({ projects: state.projects.filter((project) => !uniqueIds.includes(project.id)), syncError: undefined }));
    },
    updateProject: (id, patch) => mutateProject(id, (project) => ({ ...project, ...patch })),
    reset: () => {
        invalidateSession();
        set({ hydrated: false, hydratedUserId: "", projects: [], syncError: undefined });
    },
}));

function mutateProject(projectId: string, updater: (project: CanvasProject) => CanvasProject) {
    const session = sessionEpoch.capture();
    if (!session.userId) return;
    let nextProject: CanvasProject | undefined;
    useCanvasStore.setState((state) => ({
        projects: state.projects.map((project) => {
            if (project.id !== projectId) return project;
            const updated = updater(project);
            if (updated === project) return project;
            nextProject = { ...updated, updatedAt: nextUpdatedAt(session, project) };
            return nextProject;
        }),
    }));
    if (nextProject) queueSave(session, nextProject);
}

function queueSave(session: ClientSessionStamp, project: CanvasProject) {
    const key = sessionEpoch.key(session, project.id);
    clearProjectSave(session, project.id);
    saveTimers.set(
        key,
        setTimeout(() => {
            saveTimers.delete(key);
            if (!sessionEpoch.isCurrent(session)) return;
            const previous = saveQueues.get(key) || Promise.resolve();
            const operation = previous.then(async () => {
                if (!sessionEpoch.isCurrent(session)) return;
                try {
                    const saved = await saveCanvasProject(project);
                    if (!sessionEpoch.isCurrent(session)) return;
                    useCanvasStore.setState((state) => ({ projects: state.projects.map((item) => (item.id === saved.id && item.updatedAt === project.updatedAt ? saved : item)), syncError: undefined }));
                } catch (error) {
                    if (!sessionEpoch.isCurrent(session)) return;
                    const latest = useCanvasStore.getState().projects.find((item) => item.id === project.id);
                    if (latest?.updatedAt === project.updatedAt) useCanvasStore.setState({ syncError: error instanceof Error ? error.message : "画布项目保存失败" });
                }
            });
            saveQueues.set(key, operation);
            void operation.finally(() => {
                if (saveQueues.get(key) === operation) saveQueues.delete(key);
            });
        }, 250),
    );
}

function nextUpdatedAt(session: ClientSessionStamp, project: CanvasProject) {
    const key = sessionEpoch.key(session, project.id);
    const previous = Math.max(Date.parse(project.updatedAt) || 0, latestProjectTimes.get(key) || 0);
    const next = Math.max(Date.now(), previous + 1);
    latestProjectTimes.set(key, next);
    return new Date(next).toISOString();
}

function clearProjectSave(session: ClientSessionStamp, projectId: string) {
    const key = sessionEpoch.key(session, projectId);
    const timer = saveTimers.get(key);
    if (timer) clearTimeout(timer);
    saveTimers.delete(key);
}

function isActiveHydrate(session: ClientSessionStamp, requestId: number) {
    return sessionEpoch.isCurrent(session) && hydrateRequest?.requestId === requestId;
}

function requireSession() {
    const session = sessionEpoch.capture();
    if (!session.userId) throw new Error("请先登录");
    return session;
}

function assertCurrent(session: ClientSessionStamp) {
    if (!sessionEpoch.isCurrent(session)) throw new Error("登录会话已变更，请重试");
}

function invalidateSession() {
    sessionEpoch.invalidate();
    hydrateRequest = null;
    saveTimers.forEach((timer) => clearTimeout(timer));
    saveTimers.clear();
    latestProjectTimes.clear();
}
