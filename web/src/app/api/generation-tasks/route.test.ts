import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), listStoredGenerationTaskRecords: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/server/generation-task-store", () => ({ listStoredGenerationTaskRecords: mocks.listStoredGenerationTaskRecords }));

import { GET } from "./route";

describe("GET /api/generation-tasks", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentUser.mockResolvedValue({ id: "user-one" });
        mocks.listStoredGenerationTaskRecords.mockResolvedValue({
            items: [
                {
                    id: "running",
                    userId: "user-one",
                    type: "image",
                    status: "running",
                    payload: { progress: 0.4, prompt: "portrait", sourceNodeId: "node-one", targetNodeId: "result-one", billing: { pointsCost: 4, pointsRecordId: "charge-one" } },
                    projectId: "canvas-one",
                    surface: "canvas",
                    createdAt: 1000,
                    updatedAt: 2000,
                    expiresAt: 5000,
                    executionPhase: "polling",
                },
            ],
            total: 1,
        });
    });

    it("scopes active tasks to the current user and canvas project", async () => {
        const response = await GET(new Request("http://localhost/api/generation-tasks?projectId=canvas-one&limit=10"));

        expect(response.status).toBe(200);
        expect(mocks.listStoredGenerationTaskRecords).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", projectId: "canvas-one", surface: "canvas", statuses: ["pending", "running", "paused"], includeAll: false }));
        expect(await response.json()).toEqual({
            code: 0,
            data: {
                tasks: [expect.objectContaining({ id: "running", status: "running", progress: 40, stage: "polling", sourceNodeId: "node-one", targetNodeId: "result-one", billing: { pointsCost: 4, refunded: false } })],
                total: 1,
            },
            msg: "OK",
        });
    });

    it("requires authentication", async () => {
        mocks.getCurrentUser.mockResolvedValue(null);
        const response = await GET(new Request("http://localhost/api/generation-tasks"));
        expect(response.status).toBe(401);
        expect(mocks.listStoredGenerationTaskRecords).not.toHaveBeenCalled();
    });

    it("keeps paused tasks visible to the active task indicator", async () => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({
            items: [{ id: "paused", userId: "user-one", type: "video", status: "paused", payload: {}, projectId: "canvas-one", surface: "canvas", createdAt: 1000, updatedAt: 2000, expiresAt: 5000 }],
            total: 1,
        });

        const response = await GET(new Request("http://localhost/api/generation-tasks?projectId=canvas-one"));
        expect((await response.json()).data.tasks).toEqual([expect.objectContaining({ id: "paused", status: "paused" })]);
    });

    it("maps persisted background-removal milestones without time-derived progress", async () => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({
            items: [
                {
                    id: "cutout",
                    userId: "user-one",
                    type: "image_process",
                    status: "running",
                    payload: {
                        sourceNodeId: "source",
                        sourceStorageKey: "source.png",
                        model: "isnet-anime",
                        progressStage: "inference",
                        progress: 91,
                        options: { version: 3, model: "isnet-anime", outputMode: "transparent", backgroundColor: [255, 255, 255, 255] },
                        optionsHash: "hash",
                    },
                    projectId: "canvas-one",
                    surface: "canvas",
                    createdAt: 1_000,
                    updatedAt: 2_000,
                    expiresAt: 5_000,
                    executionPhase: "polling",
                    lastUpstreamStatus: "processing",
                },
            ],
            total: 1,
        });

        const response = await GET(new Request("http://localhost/api/generation-tasks?projectId=canvas-one"));

        expect((await response.json()).data.tasks).toEqual([expect.objectContaining({ id: "cutout", model: "isnet-anime", progressStage: "inference", progress: 50, stage: "rembg \u63a8\u7406", sourceNodeId: "source", sourceStorageKey: "source.png" })]);
    });

    it("migrates legacy V1 background-removal snapshots and drops invalid ones", async () => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({
            items: [
                { id: "legacy", userId: "user-one", type: "image_process", status: "running", payload: { options: { version: 1, outputMask: true } }, projectId: "canvas-one", surface: "canvas", createdAt: 1, updatedAt: 2, expiresAt: 3 },
                { id: "invalid", userId: "user-one", type: "image_process", status: "running", payload: { options: { version: 2, outputMask: true } }, projectId: "canvas-one", surface: "canvas", createdAt: 1, updatedAt: 2, expiresAt: 3 },
            ],
            total: 2,
        });

        const response = await GET(new Request("http://localhost/api/generation-tasks?projectId=canvas-one"));
        const tasks = (await response.json()).data.tasks;

        expect(tasks[0].options).toMatchObject({ version: 3, model: "u2net", outputMode: "mask" });
        expect(tasks[0].options).not.toHaveProperty("outputMask");
        expect(tasks[1].options).toBeUndefined();
    });

    it.each([
        ["success", "completed", 100, "\u5df2\u5b8c\u6210"],
        ["error", "failed", 75, "\u5931\u8d25"],
        ["cancelled", "cancelled", 50, "\u5df2\u53d6\u6d88"],
    ])("terminates background-removal progress for %s", async (status, progressStage, progress, stage) => {
        mocks.listStoredGenerationTaskRecords.mockResolvedValueOnce({
            items: [{ id: "cutout", userId: "user-one", type: "image_process", status, payload: { progressStage: "inference", progress }, projectId: "canvas-one", surface: "canvas", createdAt: 1_000, updatedAt: 2_000, expiresAt: 5_000 }],
            total: 1,
        });

        const response = await GET(new Request("http://localhost/api/generation-tasks?projectId=canvas-one&activeOnly=false"));

        expect((await response.json()).data.tasks[0]).toMatchObject({ progressStage, progress, stage });
    });
});
