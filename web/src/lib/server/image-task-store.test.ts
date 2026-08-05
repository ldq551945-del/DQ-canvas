import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    mutate: vi.fn(),
    get: vi.fn(),
    collect: vi.fn(),
}));

vi.mock("@/lib/server/generation-task-store", () => ({
    countActiveStoredGenerationTasks: vi.fn(),
    createStoredGenerationTask: vi.fn(),
    getStoredGenerationTask: mocks.get,
    mutateStoredGenerationTask: mocks.mutate,
    touchStoredGenerationTask: vi.fn(),
    transitionStoredGenerationTask: vi.fn(),
}));
vi.mock("@/lib/server/local-media-references", () => ({ collectLocalMediaStorageKeys: mocks.collect }));

import { failImageTaskSetup, type ImageTask } from "./image-task-store";

describe("image task setup failure", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.collect.mockReturnValue(["temporary/reference.png", "temporary/mask.png"]);
    });

    it("atomically terminates a pending task before returning its staged reference keys", async () => {
        const task = imageTask();
        mocks.mutate.mockImplementation(async (_type: string, _id: string, _ttl: number, mutate: (current: ImageTask) => ImageTask | null) => mutate(task));

        const result = await failImageTaskSetup(task.id, task.userId);

        expect(result).toMatchObject({ outcome: "failed", storageKeys: ["temporary/reference.png", "temporary/mask.png"], task: { status: "error", references: [], candidateConfigs: [] } });
        if (result.task) expect(result.task.mask).toBeUndefined();
        expect(mocks.collect).toHaveBeenCalledWith([task.references, task.mask]);
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it("does not expose cleanup keys when the task is already active", async () => {
        const running = imageTask({ status: "running" });
        mocks.mutate.mockImplementation(async (_type: string, _id: string, _ttl: number, mutate: (current: ImageTask) => ImageTask | null) => mutate(running));
        mocks.get.mockResolvedValue(running);

        await expect(failImageTaskSetup(running.id, running.userId)).resolves.toMatchObject({ outcome: "active", storageKeys: [] });
        expect(mocks.collect).not.toHaveBeenCalled();
    });

    it("allows the caller to remove unattached staging when no task was stored", async () => {
        mocks.mutate.mockResolvedValue(null);
        mocks.get.mockResolvedValue(null);

        await expect(failImageTaskSetup("missing", "user-one")).resolves.toEqual({ outcome: "missing", task: null, storageKeys: [] });
    });
});

function imageTask(patch: Partial<ImageTask> = {}): ImageTask {
    return {
        id: "task-one",
        userId: "user-one",
        username: "user",
        displayName: "User",
        kind: "edit",
        source: "canvas",
        status: "pending",
        createdAt: 1,
        updatedAt: 1,
        config: { baseUrl: "/api/ai/system/image", apiKey: "system", apiFormat: "openai", model: "image-model" },
        prompt: "change expression",
        references: [{ dataUrl: "", url: "/api/reference-assets/temporary/reference.png" }],
        mask: { dataUrl: "", url: "/api/reference-assets/temporary/mask.png" },
        candidateConfigs: [],
        ...patch,
    };
}
