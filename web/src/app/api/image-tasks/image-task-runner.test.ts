import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ record: vi.fn(async () => ({ asset: undefined })) }));

vi.mock("@/lib/server/generation-log-task-service", () => ({ recordGenerationTaskLogResult: mocks.record }));

import { writeImageGenerationLog } from "./image-task-runner";
import type { ImageTask } from "@/lib/server/image-task-store";

describe("image task result logging", () => {
    it("persists verified inline bytes before the authenticated upstream URL", async () => {
        const task = {
            id: "image-one",
            userId: "user-one",
            username: "user",
            displayName: "User",
            kind: "generation",
            source: "image-workbench",
            status: "running",
            createdAt: 1,
            updatedAt: 1,
            config: { baseUrl: "/api/ai/system/grok-channel", apiKey: "system", apiFormat: "openai", model: "grok-imagine-image" },
            candidateConfigs: [],
            prompt: "test",
            references: [],
        } as ImageTask;

        await writeImageGenerationLog(task, "success", { dataUrl: "data:image/png;base64,c2FmZQ==", remoteUrl: "https://grok.example/v1/media/images/image-one" }, 10);

        expect(mocks.record).toHaveBeenCalledWith(
            expect.objectContaining({
                asset: expect.objectContaining({
                    url: "data:image/png;base64,c2FmZQ==",
                    remoteUrl: "https://grok.example/v1/media/images/image-one",
                }),
            }),
        );
    });
});
