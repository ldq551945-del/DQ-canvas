import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/video-tasks", () => {
    it("rejects browser-side upstream task registration", async () => {
        const response = await POST();

        expect(response.status).toBe(410);
        await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("已停用") });
    });
});
