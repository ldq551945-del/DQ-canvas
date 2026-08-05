import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    dataUrl: vi.fn(),
    toGeminiPart: vi.fn((value: string, type?: string) => ({ inlineData: { mimeType: type, data: value } })),
}));

vi.mock("@/app/api/image-tasks/image-task-support", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./image-task-support")>();
    return { ...actual, imageReferenceToDataUrl: mocks.dataUrl, toGeminiImagePart: mocks.toGeminiPart };
});

import { buildGeminiImageReferenceParts } from "./image-task-gemini";
import { buildJsonImageEditBodies, buildResponsesImageBodies } from "./image-task-openai";
import type { ImageTask } from "@/lib/server/image-task-store";

describe("image task provider reference hydration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.dataUrl.mockImplementation(async (reference: { id?: string }) => `data:image/png;base64,${reference.id}`);
    });

    it("hydrates recovered references for native Gemini inlineData", async () => {
        const task = imageTask();

        const parts = await buildGeminiImageReferenceParts(task, "http://internal", "worker-context");

        expect(parts).toHaveLength(2);
        expect(mocks.dataUrl).toHaveBeenCalledWith(task.references[0], "first.png", "http://internal", "worker-context");
        expect(mocks.toGeminiPart).toHaveBeenCalledWith("data:image/png;base64,first", "image/png");
    });

    it("hydrates references and mask for non-public JSON image edits", async () => {
        const task = imageTask();
        task.mask = { id: "mask", name: "mask.png", type: "image/png", dataUrl: "", url: "/api/reference-assets/temporary/mask.png" };

        const bodies = await buildJsonImageEditBodies(task, "high", "1024x1024", "b64_json", "http://internal", "https://public.example", false, false, true, "worker-context");

        expect(bodies[0]).toMatchObject({ mask: "data:image/png;base64,mask", images: [{ image_url: "data:image/png;base64,first" }, { image_url: "data:image/png;base64,second" }] });
        expect(mocks.dataUrl).toHaveBeenCalledWith(task.mask, "mask.png", "http://internal", "worker-context");
    });

    it("hydrates recovered references for OpenAI Responses input images", async () => {
        const task = imageTask();

        const bodies = await buildResponsesImageBodies(task, "http://internal", "worker-context");
        const content = (bodies[0].input as Array<{ content: Array<{ type: string; image_url?: string }> }>)[0].content;

        expect(content).toEqual([expect.objectContaining({ type: "input_text" }), { type: "input_image", image_url: "data:image/png;base64,first" }, { type: "input_image", image_url: "data:image/png;base64,second" }]);
    });
});

function imageTask(): ImageTask {
    return {
        id: "task-one",
        userId: "user-one",
        username: "user",
        displayName: "User",
        kind: "edit",
        source: "canvas",
        status: "running",
        createdAt: 1,
        updatedAt: 1,
        config: { baseUrl: "https://provider.example", apiKey: "key", apiFormat: "openai", model: "image-model" },
        prompt: "change expression",
        references: [
            { id: "first", name: "first.png", type: "image/png", dataUrl: "", url: "/api/reference-assets/temporary/first.png" },
            { id: "second", name: "second.png", type: "image/png", dataUrl: "", url: "/api/reference-assets/temporary/second.png" },
        ],
    };
}
