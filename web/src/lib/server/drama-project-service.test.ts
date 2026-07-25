import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DramaProject } from "@/lib/drama-project-contract";

const mocks = vi.hoisted(() => {
    class MockDramaProjectStoreError extends Error {
        constructor(
            message: string,
            readonly status: number,
        ) {
            super(message);
        }
    }
    return {
        DramaProjectStoreError: MockDramaProjectStoreError,
        createCreativeConversation: vi.fn(),
        updateCreativeConversation: vi.fn(),
        createDramaProject: vi.fn(),
        deleteDramaProject: vi.fn(),
        findDramaProjectBySourceHandoffId: vi.fn(),
        getDramaProject: vi.fn(),
        listDramaProjectSummaries: vi.fn(),
        updateDramaProject: vi.fn(),
        createDramaProjectVersion: vi.fn(),
        getDramaProjectVersion: vi.fn(),
        listDramaProjectVersions: vi.fn(),
        deleteUserLocalMediaAssets: vi.fn(),
    };
});

vi.mock("@/lib/server/creative-runtime-store", () => ({ createCreativeConversation: mocks.createCreativeConversation, updateCreativeConversation: mocks.updateCreativeConversation }));
vi.mock("@/lib/server/drama-project-store", () => ({
    DramaProjectStoreError: mocks.DramaProjectStoreError,
    createDramaProject: mocks.createDramaProject,
    deleteDramaProject: mocks.deleteDramaProject,
    findDramaProjectBySourceHandoffId: mocks.findDramaProjectBySourceHandoffId,
    getDramaProject: mocks.getDramaProject,
    listDramaProjectSummaries: mocks.listDramaProjectSummaries,
    updateDramaProject: mocks.updateDramaProject,
}));
vi.mock("@/lib/server/drama-project-version-store", () => ({
    createDramaProjectVersion: mocks.createDramaProjectVersion,
    getDramaProjectVersion: mocks.getDramaProjectVersion,
    listDramaProjectVersions: mocks.listDramaProjectVersions,
}));
vi.mock("@/lib/server/local-media-storage", () => ({ deleteUserLocalMediaAssets: mocks.deleteUserLocalMediaAssets }));

import { createDramaProjectForUser, deleteDramaProjectForUser, DramaProjectServiceError, restoreDramaProjectVersionForUser, updateDramaProjectForUser } from "./drama-project-service";
import { DramaProjectStoreError } from "./drama-project-store";

describe("drama project service updates", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updateDramaProject.mockImplementation(async (_userId: string, value: DramaProject) => value);
        mocks.createCreativeConversation.mockResolvedValue({ id: "conversation-new" });
        mocks.updateCreativeConversation.mockResolvedValue({ id: "conversation-new", status: "archived" });
        mocks.findDramaProjectBySourceHandoffId.mockResolvedValue(null);
        mocks.listDramaProjectSummaries.mockResolvedValue([]);
        mocks.createDramaProjectVersion.mockResolvedValue({ id: "version-new", projectId: "drama-one", version: 2, reason: "恢复前自动快照", createdAt: new Date().toISOString() });
    });

    it("does not let an older client snapshot overwrite the current project", async () => {
        const current = project("2026-07-19T08:00:02.000Z", "最新标题");
        mocks.getDramaProject.mockResolvedValue(current);

        const saved = await updateDramaProjectForUser("user-one", current.id, project("2026-07-19T08:00:01.000Z", "旧标题"));

        expect(saved).toEqual(current);
        expect(mocks.updateDramaProject).not.toHaveBeenCalled();
    });

    it("normalizes and stores a newer client snapshot", async () => {
        const current = project("2026-07-19T08:00:01.000Z", "旧标题");
        mocks.getDramaProject.mockResolvedValue(current);

        const saved = await updateDramaProjectForUser("user-one", current.id, project("2026-07-19T08:00:02.000Z", "新标题"));

        expect(saved.title).toBe("新标题");
        expect(saved.updatedAt).toBe("2026-07-19T08:00:02.000Z");
        expect(mocks.updateDramaProject).toHaveBeenCalledWith("user-one", expect.objectContaining({ id: current.id, title: "新标题", updatedAt: "2026-07-19T08:00:02.000Z" }), current.updatedAt);
    });

    it("archives the new conversation when project creation fails", async () => {
        const error = new Error("write failed");
        mocks.createDramaProject.mockRejectedValue(error);

        await expect(createDramaProjectForUser("user-one", { title: "项目" })).rejects.toBe(error);

        expect(mocks.updateCreativeConversation).toHaveBeenCalledWith("conversation-new", "user-one", { status: "archived" });
    });

    it("reuses a handoff project without listing every project snapshot", async () => {
        const existing = { ...project("2026-07-19T08:00:02.000Z", "已存在项目"), sourceHandoffId: "handoff-one" };
        mocks.findDramaProjectBySourceHandoffId.mockResolvedValue(existing);

        await expect(createDramaProjectForUser("user-one", { title: "重复创建", sourceHandoffId: "handoff-one" })).resolves.toEqual(existing);

        expect(mocks.findDramaProjectBySourceHandoffId).toHaveBeenCalledWith("user-one", "handoff-one");
        expect(mocks.createCreativeConversation).not.toHaveBeenCalled();
        expect(mocks.createDramaProject).not.toHaveBeenCalled();
    });

    it("archives the linked conversation after deleting a project", async () => {
        mocks.getDramaProject.mockResolvedValue({ ...project("2026-07-19T08:00:02.000Z", "项目"), creativeConversationId: "conversation-one" });
        mocks.deleteDramaProject.mockResolvedValue(true);

        await deleteDramaProjectForUser("user-one", "drama-one");

        expect(mocks.updateCreativeConversation).toHaveBeenCalledWith("conversation-one", "user-one", { status: "archived" });
        expect(mocks.deleteUserLocalMediaAssets).toHaveBeenCalled();
    });

    it("restores an older snapshot after saving the current project", async () => {
        const current = project("2026-07-19T08:00:02.000Z", "当前版本");
        const legacySnapshot = {
            id: current.id,
            title: "历史版本",
            summary: "旧项目摘要",
            style: "旧画风",
            ratio: "9:16",
            status: "active",
            activeEpisodeId: "episode-one",
            characters: [],
            scenes: [],
            episodes: [{ id: "episode-one", title: "第 1 集", script: "旧剧本", shots: [] }],
            createdAt: current.createdAt,
            updatedAt: "2026-07-18T08:00:00.000Z",
        };
        mocks.getDramaProject.mockResolvedValue(current);
        mocks.getDramaProjectVersion.mockResolvedValue({ id: "version-one", projectId: current.id, version: 1, reason: "初稿", createdAt: current.createdAt, snapshot: legacySnapshot });

        const restored = await restoreDramaProjectVersionForUser("user-one", current.id, "version-one");

        expect(mocks.createDramaProjectVersion).toHaveBeenCalledWith("user-one", current.id, "恢复前自动快照", current);
        expect(restored).toMatchObject({
            title: "历史版本",
            props: [],
            clues: [],
            defaultVideoMode: "storyboard",
            episodes: [{ id: "episode-one", sourceRange: "", reviewStatus: "draft" }],
        });
        expect(mocks.updateDramaProject).toHaveBeenCalledWith("user-one", expect.objectContaining({ title: "历史版本" }), current.updatedAt);
    });

    it("maps a concurrent persistence conflict to a user-readable 409", async () => {
        const current = project("2026-07-19T08:00:01.000Z", "旧标题");
        mocks.getDramaProject.mockResolvedValue(current);
        mocks.updateDramaProject.mockRejectedValueOnce(new DramaProjectStoreError("短剧项目已在其他页面更新，请刷新后重试", 409));

        await expect(updateDramaProjectForUser("user-one", current.id, project("2026-07-19T08:00:02.000Z", "新标题"))).rejects.toMatchObject({ status: 409, message: "短剧项目已在其他页面更新，请刷新后重试" });
    });

    it("returns 404 before reading another user's version", async () => {
        mocks.getDramaProject.mockResolvedValue(null);

        await expect(restoreDramaProjectVersionForUser("user-two", "drama-one", "version-one")).rejects.toMatchObject({ status: 404 });

        expect(mocks.getDramaProjectVersion).not.toHaveBeenCalled();
        expect(mocks.createDramaProjectVersion).not.toHaveBeenCalled();
    });
});

function project(updatedAt: string, title: string): DramaProject {
    return {
        id: "drama-one",
        title,
        summary: "",
        style: "电影感",
        ratio: "9:16",
        status: "active",
        activeEpisodeId: "episode-one",
        characters: [],
        scenes: [],
        props: [],
        clues: [],
        defaultVideoMode: "storyboard",
        episodes: [{ id: "episode-one", title: "第 1 集", script: "", outline: "", hook: "", nextPreview: "", sourceRange: "", reviewStatus: "draft", shots: [] }],
        createdAt: "2026-07-19T08:00:00.000Z",
        updatedAt,
    };
}
