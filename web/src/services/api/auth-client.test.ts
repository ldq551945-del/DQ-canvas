import { describe, expect, it } from "vitest";

import { readAuthPayload } from "./auth-client";

describe("auth client responses", () => {
    it("preserves the server error for JSON responses", async () => {
        await expect(readAuthPayload(new Response(JSON.stringify({ error: "密码不正确" }), { status: 401, headers: { "content-type": "application/json" } }), "登录失败")).rejects.toThrow("密码不正确");
    });

    it("returns a useful fallback for non-JSON failures", async () => {
        await expect(readAuthPayload(new Response("upstream unavailable", { status: 503 }), "登录失败")).rejects.toThrow("登录失败（503）");
    });

    it("returns the typed payload for successful responses", async () => {
        await expect(readAuthPayload<{ ok: boolean }>(new Response(JSON.stringify({ ok: true }), { status: 200 }), "请求失败")).resolves.toEqual({ ok: true });
    });
});
