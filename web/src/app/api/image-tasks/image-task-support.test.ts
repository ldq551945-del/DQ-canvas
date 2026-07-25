import { describe, expect, it } from "vitest";

import { imageTaskPollUrls, openAiImageTaskPath } from "./image-task-support";

const config = {
    baseUrl: "/api/ai/system/global-image",
    apiFormat: "openai",
    advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "image-gpt-image-2", createPath: "/image2/images", queryPath: "/result/:task_id" },
} as never;

describe("GlobalAiOpc image task paths", () => {
    it("uses the configured create and result endpoints instead of OpenAI defaults", async () => {
        await expect(openAiImageTaskPath(config, "generation")).resolves.toBe("/image2/images");
        expect(imageTaskPollUrls(config, "http://localhost:3000/api/ai/system/global-image/image2/images", "task 1")[0]).toBe("http://localhost:3000/api/ai/system/global-image/result/task%201");
    });
});
