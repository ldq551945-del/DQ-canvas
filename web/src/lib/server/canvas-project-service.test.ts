import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CanvasProject } from "@/lib/canvas-project-contract";

const mocks = vi.hoisted(() => ({
    createCreativeConversation: vi.fn(),
    updateCreativeConversation: vi.fn(),
    createCanvasProject: vi.fn(),
    deleteCanvasProjects: vi.fn(),
    getCanvasProject: vi.fn(),
    listCanvasProjects: vi.fn(),
    listCanvasProjectSummaries: vi.fn(),
    updateCanvasProject: vi.fn(),
    deleteUserLocalMediaAssets: vi.fn(),
}));

vi.mock("@/lib/server/creative-runtime-store", () => ({ createCreativeConversation: mocks.createCreativeConversation, updateCreativeConversation: mocks.updateCreativeConversation }));
vi.mock("@/lib/server/canvas-project-store", () => ({
    CanvasProjectStoreError: class CanvasProjectStoreError extends Error {},
    createCanvasProject: mocks.createCanvasProject,
    deleteCanvasProjects: mocks.deleteCanvasProjects,
    getCanvasProject: mocks.getCanvasProject,
    listCanvasProjects: mocks.listCanvasProjects,
    listCanvasProjectSummaries: mocks.listCanvasProjectSummaries,
    updateCanvasProject: mocks.updateCanvasProject,
}));
vi.mock("@/lib/server/local-media-storage", () => ({ deleteUserLocalMediaAssets: mocks.deleteUserLocalMediaAssets }));

import { createCanvasProjectForUser, deleteCanvasProjectsForUser, updateCanvasProjectForUser } from "./canvas-project-service";

const MAX_PROJECT_BYTES = 30 * 1024 * 1024;

describe("canvas project service lifecycle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createCreativeConversation.mockResolvedValue({ id: "conversation-new" });
        mocks.updateCreativeConversation.mockResolvedValue({ id: "conversation-new", status: "archived" });
        mocks.listCanvasProjects.mockResolvedValue([]);
    });

    it("archives the new conversation when project creation fails", async () => {
        const error = new Error("write failed");
        mocks.createCanvasProject.mockRejectedValue(error);

        await expect(createCanvasProjectForUser("user-one", { title: "画布" })).rejects.toBe(error);

        expect(mocks.updateCreativeConversation).toHaveBeenCalledWith("conversation-new", "user-one", { status: "archived" });
    });

    it("archives linked conversations after deleting projects", async () => {
        mocks.getCanvasProject.mockResolvedValue(project());
        mocks.deleteCanvasProjects.mockResolvedValue(1);

        await deleteCanvasProjectsForUser("user-one", ["canvas-one"]);

        expect(mocks.updateCreativeConversation).toHaveBeenCalledWith("conversation-one", "user-one", { status: "archived" });
        expect(mocks.deleteUserLocalMediaAssets).toHaveBeenCalled();
    });

    it("accepts a canvas snapshot that is exactly 30MB", async () => {
        const current = project();
        mocks.getCanvasProject.mockResolvedValue(current);
        mocks.updateCanvasProject.mockResolvedValue(current);
        const padding = "x".repeat(MAX_PROJECT_BYTES - Buffer.byteLength(JSON.stringify({ padding: "" })));

        await expect(updateCanvasProjectForUser("user-one", current.id, { padding })).resolves.toBe(current);
        expect(mocks.updateCanvasProject).toHaveBeenCalledTimes(1);
    });

    it("rejects a canvas snapshot one byte over the 30MB limit", async () => {
        const current = project();
        mocks.getCanvasProject.mockResolvedValue(current);
        const padding = "x".repeat(MAX_PROJECT_BYTES - Buffer.byteLength(JSON.stringify({ padding: "" })) + 1);

        await expect(updateCanvasProjectForUser("user-one", current.id, { padding })).rejects.toMatchObject({ status: 413, message: "画布项目数据过大（上限 30MB）" });
        expect(mocks.updateCanvasProject).not.toHaveBeenCalled();
    });
});

function project(): CanvasProject {
    const now = new Date().toISOString();
    return {
        id: "canvas-one",
        title: "画布",
        creativeConversationId: "conversation-one",
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
