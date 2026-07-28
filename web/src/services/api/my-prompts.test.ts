import { afterEach, describe, expect, it, vi } from "vitest";

import { createMyPrompt, deleteMyPrompt, listMyPrompts } from "./my-prompts";

describe("my prompts api", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("requests a bounded server page", async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ items: [], tags: [], categories: [], total: 21 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(listMyPrompts({ page: 2, pageSize: 8 })).resolves.toMatchObject({ total: 21 });
        expect(fetchMock).toHaveBeenCalledWith("/api/my-prompts?page=2&pageSize=8", { cache: "no-store" });
    });

    it("creates and deletes through the user prompt routes", async () => {
        const prompt = { id: "prompt-one", title: "标题", prompt: "内容" };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ prompt }))
            .mockResolvedValueOnce(Response.json({ ok: true }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(createMyPrompt({ title: "标题", prompt: "内容", tags: ["海报"] })).resolves.toMatchObject({ id: "prompt-one" });
        await expect(deleteMyPrompt("prompt/one")).resolves.toEqual({ ok: true });
        expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/my-prompts/prompt%2Fone", { method: "DELETE" });
    });

    it("surfaces the server error message", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "提示词不存在" }, { status: 404 })));
        await expect(deleteMyPrompt("missing")).rejects.toThrow("提示词不存在");
    });
});
