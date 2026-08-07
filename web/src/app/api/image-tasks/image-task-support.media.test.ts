import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/store", () => ({
    getAuthSettings: vi.fn(async () => ({ systemChannels: [{ id: "grok-channel", baseUrl: "https://grok.example" }] })),
}));

import type { ImageTaskConfig } from "@/lib/server/image-task-store";
import { normalizeImageResultUrlForPersistence, resolveTaskMediaUrl } from "./image-task-support";

const config = {
    baseUrl: "/api/ai/system/grok-channel",
    apiKey: "system",
    apiFormat: "openai",
    model: "grok-imagine-image-quality",
} as ImageTaskConfig;

describe("system image media persistence", () => {
    it("rewrites a Grok loopback image URL to the upstream host before proxying", () => {
        expect(resolveTaskMediaUrl(config, "http://127.0.0.1:8000/v1/media/images/image-one", "http://dq.internal")).toBe("/api/ai/system/grok-channel/_media?url=http%3A%2F%2Fdq.internal%2Fv1%2Fmedia%2Fimages%2Fimage-one");
    });

    it("recovers a persisted loopback URL through the configured channel", async () => {
        await expect(normalizeImageResultUrlForPersistence(config, "http://127.0.0.1:8000/v1/media/images/image-one", "http://dq.internal")).resolves.toBe(
            "/api/ai/system/grok-channel/_media?url=https%3A%2F%2Fgrok.example%2Fv1%2Fmedia%2Fimages%2Fimage-one",
        );
    });
});
