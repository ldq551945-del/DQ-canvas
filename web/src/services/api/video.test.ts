import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ imageToDataUrl: vi.fn() }));

vi.mock("@/services/api/points", () => ({ refreshUserPointsIfSystem: vi.fn(async () => undefined), syncUserPointsFromHeaders: vi.fn() }));
vi.mock("@/services/api/video-task-tracking", () => ({ registerVideoTask: vi.fn(), syncVideoTask: vi.fn() }));
vi.mock("@/services/file-storage", () => ({ getMediaBlob: vi.fn(), uploadMediaFile: vi.fn() }));
vi.mock("@/services/image-storage", () => ({ imageToDataUrl: mocks.imageToDataUrl }));
vi.mock("@/stores/use-config-store", () => ({
    resolveModelRequestConfig: vi.fn((config: Record<string, unknown>, model: string) => ({ ...config, model, apiSource: "system" })),
}));

import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { createServerVideoGenerationTask, pollVideoGenerationTask } from "./video";

const config = {
    model: "video-v1",
    videoModel: "video-v1",
    size: "16:9",
    vquality: "720",
    videoSeconds: "5",
    videoGenerateAudio: "false",
    videoWatermark: "false",
} as AiConfig;

describe("video API service", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("submits the original public image source instead of the local asset preview", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ task: { id: "video-task-1", model: "video-v1" } }));
        vi.stubGlobal("fetch", fetchMock);
        const reference = {
            id: "reference-1",
            name: "人物参考",
            type: "image/png",
            dataUrl: "blob:local-preview",
            storageKey: "image:1",
            url: "https://cdn.example.com/original-person.png",
            remoteUrl: "https://cdn.example.com/original-person.png",
        } as ReferenceImage;

        await createServerVideoGenerationTask(config, "保持人物与场景不变，仅自然眨眼", [reference]);

        const init = fetchMock.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(String(init.body)) as { references: Array<{ type: string; url: string }> };
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("/api/video-generation-tasks");
        expect(body.references).toEqual([{ type: "image", url: "https://cdn.example.com/original-person.png" }]);
        expect(mocks.imageToDataUrl).not.toHaveBeenCalled();
    });

    it("returns a terminal failure when the upstream submission needs manual review", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ task: { id: "video-review", status: "running", needsReview: true } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(pollVideoGenerationTask(config, { id: "video-review", provider: "generation", model: "video-v1", pollPath: "server" })).resolves.toEqual({
            status: "failed",
            error: "上游创建状态待确认，系统已停止重复创建，请联系管理员处理",
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("allows recreation only when the server confirms an upstream failure", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ task: { id: "video-failed", status: "error", error: "上游生成失败", canRetry: true } }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(pollVideoGenerationTask(config, { id: "video-failed", provider: "generation", model: "video-v1", pollPath: "server" })).resolves.toEqual({
            status: "failed",
            error: "上游生成失败",
            canRetry: true,
        });
    });
});

function json(value: unknown) {
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
