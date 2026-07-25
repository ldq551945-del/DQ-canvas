import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasProject } from "@/lib/canvas-project-contract";
import type { DramaProject, DramaProjectSummary } from "@/lib/drama-project-contract";
import { summarizeDramaProject } from "@/lib/drama-project-summary";
import type { Asset } from "@/lib/library-asset-contract";

const mocks = vi.hoisted(() => ({
    listAssets: vi.fn(),
    createAsset: vi.fn(),
    saveAsset: vi.fn(),
    deleteAsset: vi.fn(),
    uploadImage: vi.fn(),
    uploadMediaFile: vi.fn(),
    listCanvasProjects: vi.fn(),
    createCanvasProject: vi.fn(),
    saveCanvasProject: vi.fn(),
    deleteCanvasProjects: vi.fn(),
    listDramaProjectSummaries: vi.fn(),
    getDramaProject: vi.fn(),
    createDramaProject: vi.fn(),
    saveDramaProject: vi.fn(),
    deleteDramaProject: vi.fn(),
    createDramaProjectVersion: vi.fn(),
    listDramaProjectVersions: vi.fn(),
    restoreDramaProjectVersion: vi.fn(),
}));

vi.mock("@/services/api/library-assets", () => ({
    listLibraryAssets: mocks.listAssets,
    createLibraryAsset: mocks.createAsset,
    saveLibraryAsset: mocks.saveAsset,
    deleteLibraryAsset: mocks.deleteAsset,
}));
vi.mock("@/services/image-storage", () => ({ uploadImage: mocks.uploadImage }));
vi.mock("@/services/file-storage", () => ({ uploadMediaFile: mocks.uploadMediaFile }));
vi.mock("@/services/api/canvas-projects", () => ({
    listCanvasProjects: mocks.listCanvasProjects,
    createCanvasProject: mocks.createCanvasProject,
    saveCanvasProject: mocks.saveCanvasProject,
    deleteCanvasProjects: mocks.deleteCanvasProjects,
}));
vi.mock("@/services/api/drama-projects", () => ({
    listDramaProjectSummaries: mocks.listDramaProjectSummaries,
    getDramaProject: mocks.getDramaProject,
    createDramaProject: mocks.createDramaProject,
    saveDramaProject: mocks.saveDramaProject,
    deleteDramaProject: mocks.deleteDramaProject,
    createDramaProjectVersion: mocks.createDramaProjectVersion,
    listDramaProjectVersions: mocks.listDramaProjectVersions,
    restoreDramaProjectVersion: mocks.restoreDramaProjectVersion,
}));

import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { useDramaStore } from "@/app/(user)/drama/stores/use-drama-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";

describe("client store session isolation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useUserStore.getState().setUser(null);
        useAssetStore.getState().reset();
        useCanvasStore.getState().reset();
        useDramaStore.getState().reset();
    });

    it("reloads assets after a reset instead of reusing the previous user's request", async () => {
        const oldRequest = deferred<Asset[]>();
        const freshAssets = [textAsset("asset-b", "用户 B 素材")];
        mocks.listAssets.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce(freshAssets);

        useUserStore.getState().setUser(user("user-a"));
        const oldHydrate = useAssetStore.getState().hydrate();
        useAssetStore.getState().reset();
        useUserStore.getState().setUser(user("user-b"));
        const freshHydrate = useAssetStore.getState().hydrate();

        oldRequest.resolve([textAsset("asset-a", "用户 A 素材")]);
        await Promise.all([oldHydrate, freshHydrate]);

        expect(mocks.listAssets).toHaveBeenCalledTimes(2);
        expect(useAssetStore.getState().assets).toEqual(freshAssets);
    });

    it("reloads Canvas projects for the new user after a reset", async () => {
        const oldRequest = deferred<CanvasProject[]>();
        const freshProjects = [canvasProject("canvas-b", "用户 B 画布")];
        mocks.listCanvasProjects.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce(freshProjects);

        useUserStore.getState().setUser(user("user-a"));
        const oldHydrate = useCanvasStore.getState().hydrate();
        useCanvasStore.getState().reset();
        useUserStore.getState().setUser(user("user-b"));
        const freshHydrate = useCanvasStore.getState().hydrate();

        oldRequest.resolve([canvasProject("canvas-a", "用户 A 画布")]);
        await Promise.all([oldHydrate, freshHydrate]);

        expect(mocks.listCanvasProjects).toHaveBeenCalledTimes(2);
        expect(useCanvasStore.getState().projects).toEqual(freshProjects);
    });

    it("reloads Drama projects for the new user after a reset", async () => {
        const oldRequest = deferred<DramaProjectSummary[]>();
        const freshProjects = [summarizeDramaProject(dramaProject("drama-b", "用户 B 短剧"))];
        mocks.listDramaProjectSummaries.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce(freshProjects);

        useUserStore.getState().setUser(user("user-a"));
        const oldHydrate = useDramaStore.getState().hydrate();
        useDramaStore.getState().reset();
        useUserStore.getState().setUser(user("user-b"));
        const freshHydrate = useDramaStore.getState().hydrate();

        oldRequest.resolve([summarizeDramaProject(dramaProject("drama-a", "用户 A 短剧"))]);
        await Promise.all([oldHydrate, freshHydrate]);

        expect(mocks.listDramaProjectSummaries).toHaveBeenCalledTimes(2);
        expect(useDramaStore.getState().summaries).toEqual(freshProjects);
    });

    it("loads only the requested Drama project and ignores a previous user's late response", async () => {
        const oldRequest = deferred<DramaProject>();
        const freshProject = dramaProject("drama-shared", "用户 B 短剧");
        mocks.getDramaProject.mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce(freshProject);

        useUserStore.getState().setUser(user("user-a"));
        const oldLoad = useDramaStore.getState().loadProject("drama-shared");
        useDramaStore.getState().reset();
        useUserStore.getState().setUser(user("user-b"));
        const freshLoad = useDramaStore.getState().loadProject("drama-shared");

        oldRequest.resolve(dramaProject("drama-shared", "用户 A 短剧"));
        await Promise.allSettled([oldLoad, freshLoad]);

        expect(mocks.getDramaProject).toHaveBeenCalledTimes(2);
        expect(useDramaStore.getState().projects).toEqual([freshProject]);
        expect(useDramaStore.getState().summaries).toEqual([summarizeDramaProject(freshProject)]);
    });

    it("keeps stable character and scene ids when applying Drama analysis", () => {
        useUserStore.getState().setUser(user("user-a"));
        const project = dramaProject("drama-a", "用户 A 短剧");
        project.characters = [
            { id: "character-hero", name: "女主", description: "人工设定" },
            { id: "character-support", name: "店员", description: "保留角色" },
        ];
        project.scenes = [
            { id: "scene-home", name: "客厅", description: "人工场景" },
            { id: "scene-street", name: "街道", description: "保留场景" },
        ];
        useDramaStore.setState({ projects: [project], hydrated: true, hydratedUserId: "user-a" });

        useDramaStore.getState().applyContentAnalysis("drama-a", "drama-a-episode-1", {
            episode: { outline: "对峙", hook: "危机", nextPreview: "追击", sourceRange: "第一章" },
            characters: [
                { name: " 女主 ", description: "分析更新" },
                { name: "反派", description: "新增角色" },
            ],
            scenes: [
                { name: "客厅", description: "分析场景" },
                { name: "天台", description: "新增场景" },
            ],
            props: [],
            clues: [],
            shots: [
                {
                    title: "对峙",
                    description: "双方相遇",
                    sourceText: "双方在天台相遇",
                    shotBoundary: "场景节拍",
                    dialogue: "开始吧",
                    narration: "",
                    utterances: [],
                    duration: 5,
                    characterNames: ["女主", "反派"],
                    sceneName: "天台",
                    propNames: [],
                    clueNames: [],
                },
            ],
        });

        const updated = useDramaStore.getState().projects[0];
        expect(updated.characters).toEqual(
            expect.arrayContaining([
                { id: "character-hero", name: " 女主 ", description: "分析更新" },
                { id: "character-support", name: "店员", description: "保留角色" },
            ]),
        );
        expect(updated.scenes).toEqual(
            expect.arrayContaining([
                { id: "scene-home", name: "客厅", description: "分析场景" },
                { id: "scene-street", name: "街道", description: "保留场景" },
            ]),
        );
        const newCharacter = updated.characters.find((item) => item.name === "反派");
        const newScene = updated.scenes.find((item) => item.name === "天台");
        expect(newCharacter?.id).toMatch(/^character-/);
        expect(newScene?.id).toMatch(/^scene-/);
        expect(updated.episodes[0].shots[0]).toMatchObject({ characterIds: ["character-hero", newCharacter?.id], sceneId: newScene?.id });
    });

    it("does not reset queued or running Drama shot tasks", () => {
        useUserStore.getState().setUser(user("user-a"));
        const project = dramaProject("drama-a", "用户 A 短剧");
        project.episodes[0].reviewStatus = "visual_ready";
        const runningShot = {
            ...dramaShot("shot-running"),
            storyboardStatus: "running" as const,
            storyboardTaskId: "image-task-running",
        };
        const idleShot = dramaShot("shot-idle");
        project.episodes[0].shots = [runningShot, idleShot];
        useDramaStore.setState({ projects: [project], hydrated: true, hydratedUserId: "user-a" });

        useDramaStore.getState().queueShots("drama-a", "drama-a-episode-1", [runningShot.id, idleShot.id]);

        const shots = useDramaStore.getState().projects[0].episodes[0].shots;
        expect(shots[0]).toEqual(runningShot);
        expect(shots[1]).toMatchObject({ id: "shot-idle", storyboardStatus: "queued", storyboardAttempt: 1, generationStatus: "idle", audioStatus: "idle" });
    });

    it("waits for an in-flight save before restoring a Drama version", async () => {
        vi.useFakeTimers();
        try {
            useUserStore.getState().setUser(user("user-a"));
            const project = dramaProject("drama-a", "当前版本");
            const pendingSave = deferred<DramaProject>();
            const restored = { ...project, title: "历史版本", updatedAt: new Date(Date.now() + 1000).toISOString() };
            mocks.saveDramaProject.mockReturnValueOnce(pendingSave.promise);
            mocks.restoreDramaProjectVersion.mockResolvedValueOnce(restored);
            useDramaStore.setState({ projects: [project], hydrated: true, hydratedUserId: "user-a" });

            useDramaStore.getState().updateProject(project.id, { title: "待保存版本" });
            await vi.advanceTimersByTimeAsync(250);
            const restoring = useDramaStore.getState().restoreVersion(project.id, "version-1");

            expect(mocks.restoreDramaProjectVersion).not.toHaveBeenCalled();
            pendingSave.resolve({ ...project, title: "待保存版本" });
            await restoring;

            expect(mocks.restoreDramaProjectVersion).toHaveBeenCalledWith(project.id, "version-1");
            expect(useDramaStore.getState().projects[0].title).toBe("历史版本");
        } finally {
            vi.useRealTimers();
        }
    });
});

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

function user(id: string) {
    return {
        id,
        username: id,
        email: `${id}@example.test`,
        displayName: id,
        role: "user" as const,
        status: "active" as const,
        planId: "free",
        planName: "免费",
        pointsBalance: 0,
    };
}

function textAsset(id: string, title: string): Asset {
    const now = new Date().toISOString();
    return { id, kind: "text", title, coverUrl: "", tags: [], data: { content: title }, createdAt: now, updatedAt: now };
}

function canvasProject(id: string, title: string): CanvasProject {
    const now = new Date().toISOString();
    return {
        id,
        title,
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        createdAt: now,
        updatedAt: now,
    };
}

function dramaProject(id: string, title: string): DramaProject {
    const now = new Date().toISOString();
    return {
        id,
        title,
        summary: "",
        style: "电影感",
        ratio: "9:16",
        status: "active",
        characters: [],
        scenes: [],
        props: [],
        clues: [],
        defaultVideoMode: "storyboard",
        episodes: [{ id: `${id}-episode-1`, title: "第 1 集", script: "", outline: "", hook: "", nextPreview: "", sourceRange: "", reviewStatus: "draft", shots: [] }],
        activeEpisodeId: `${id}-episode-1`,
        createdAt: now,
        updatedAt: now,
    };
}

function dramaShot(id: string) {
    return {
        id,
        order: 1,
        title: "镜头",
        description: "描述",
        sourceText: "描述",
        shotBoundary: "段落边界",
        dialogue: "",
        narration: "",
        utterances: [],
        imagePrompt: "画面",
        videoPrompt: "动作",
        cameraMotion: "推进",
        duration: 5,
        characterIds: [],
        propIds: [],
        clueIds: [],
        storyboardStatus: "idle" as const,
        generationStatus: "idle" as const,
        audioStatus: "idle" as const,
    };
}
