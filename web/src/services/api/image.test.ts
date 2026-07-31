import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api/points", () => ({ refreshUserPointsIfSystem: vi.fn(), syncUserPointsFromHeaders: vi.fn() }));

import { waitForImageGenerationTask } from "./image";
import type { AiConfig } from "@/stores/use-config-store";

describe("图片任务轮询", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("uses the server error message when a restored task has expired", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json({ error: "图片任务不存在" }, { status: 404 })),
        );

        await expect(waitForImageGenerationTask({ apiSource: "system" } as AiConfig, { id: "expired-task", kind: "generation", model: "image-model" })).rejects.toThrow("图片任务不存在");
    });

    it("stops polling when the upstream submission needs manual review", async () => {
        const fetchMock = vi.fn(async () => Response.json({ task: { id: "review-task", kind: "generation", model: "image-model", status: "running", needsReview: true } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(waitForImageGenerationTask({ apiSource: "system" } as AiConfig, { id: "review-task", kind: "generation", model: "image-model" })).rejects.toThrow("上游创建状态待确认");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
