import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProject: vi.fn(), listTasks: vi.fn() }));

vi.mock("@/lib/server/drama-project-service", () => ({ getDramaProjectForUser: mocks.getProject }));
vi.mock("@/lib/server/generation-task-store", () => ({ listStoredGenerationTaskRecords: mocks.listTasks }));

import { getDramaProjectCostSummary } from "./drama-project-cost-service";

describe("drama project cost summary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getProject.mockResolvedValue({ id: "project-one" });
        mocks.listTasks.mockResolvedValue({
            all: [
                { projectId: "project-one", type: "image", status: "success", estimatedPoints: 2, payload: { attempts: [{ status: "succeeded", pointsCost: 1.5 }] } },
                { projectId: "project-one", type: "video", status: "success", estimatedPoints: 8, payload: { upstream: { pointsCost: 7 } } },
                { projectId: "project-one", type: "audio", status: "error", estimatedPoints: 1, payload: { billing: { pointsCost: 1 } } },
                { projectId: "other", type: "video", status: "success", estimatedPoints: 99, payload: { upstream: { pointsCost: 99 } } },
            ],
        });
    });

    it("aggregates only the current project and excludes refunded failures", async () => {
        await expect(getDramaProjectCostSummary("user-one", "project-one")).resolves.toEqual({
            estimatedPoints: 11,
            actualPoints: 8.5,
            taskCount: 3,
            successCount: 2,
            failedCount: 1,
            byType: {
                image: { tasks: 1, estimatedPoints: 2, actualPoints: 1.5 },
                video: { tasks: 1, estimatedPoints: 8, actualPoints: 7 },
                audio: { tasks: 1, estimatedPoints: 1, actualPoints: 0 },
            },
        });
    });
});
