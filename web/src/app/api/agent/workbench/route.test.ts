import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    fetchInternalApi: vi.fn(),
    getAuthSettings: vi.fn(),
    refundUserPoints: vi.fn(async () => undefined),
    getCreativeConversationContext: vi.fn(),
    appendWorkbenchExchangeForUser: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user" })) }));
vi.mock("@/lib/auth/store", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/auth/store")>();
    return { ...actual, getAuthSettings: mocks.getAuthSettings, refundUserPoints: mocks.refundUserPoints };
});
vi.mock("@/lib/server/security", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/server/creative-runtime-store", () => ({ getCreativeConversationContext: mocks.getCreativeConversationContext }));
vi.mock("@/lib/server/creative-runtime-service", () => ({ appendWorkbenchExchangeForUser: mocks.appendWorkbenchExchangeForUser }));
vi.mock("@/lib/server/internal-origin", () => ({
    fetchInternalApi: mocks.fetchInternalApi,
    resolveInternalOrigin: vi.fn(() => "http://localhost"),
}));

import { POST } from "./route";
import { resetTextPlanningRuntime } from "@/lib/server/text-planning-runtime";

describe("workbench agent model routing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetTextPlanningRuntime();
        mocks.getAuthSettings.mockResolvedValue(settings);
        mocks.getCreativeConversationContext.mockResolvedValue({ summary: "", summaryThroughSequence: 0, recentMessages: [] });
        mocks.appendWorkbenchExchangeForUser.mockResolvedValue({});
        mocks.fetchInternalApi.mockResolvedValue(
            Response.json({
                output: [
                    {
                        type: "function_call",
                        name: "plan_workbench_action",
                        arguments: JSON.stringify({ parameterPatch: { model: "forged-image" }, resolvedPrompt: "生成商品图", shouldGenerate: true, reply: "开始" }),
                    },
                ],
            }),
        );
    });

    it("rejects more than six manually selected models", async () => {
        const response = await POST(workbenchRequest({ prompt: "生成商品图", workspace: "image", smartPlanning: false, modelIds: ["one", "two", "three", "four", "five", "six", "seven"] }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ data: null, msg: "Agent 请求内容过长" });
        expect(mocks.getAuthSettings).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("uses only resolvable backend logical models for planning and fallback", async () => {
        const response = await POST(
            new Request("http://localhost/api/agent/workbench", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    prompt: "使用 forged-image 生成商品图",
                    workspace: "image",
                    models: ["forged-image", "broken-image"],
                    currentConfig: { imageModel: "forged-image", size: "16:9", quality: "high", count: 2, baseUrl: "https://forged.example.com", apiKey: "client-secret", advancedConfig: { createPath: "/forged" } },
                }),
            }),
        );

        expect(response.status).toBe(200);
        expect((await response.json()).data.parameterPatch).not.toHaveProperty("model");

        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;
        const upstreamBody = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
        const userMessage = upstreamBody.messages.find((message) => message.role === "user");
        const planningInput = JSON.parse(userMessage?.content || "{}") as { availableModels?: Array<{ id: string; name: string }>; currentConfig?: Record<string, unknown> };
        expect(planningInput.availableModels).toEqual([{ id: "image-logical", name: "图片模型" }]);
        expect(planningInput.currentConfig).toEqual({ imageModel: "", size: "16:9", quality: "high", count: 2 });
        expect(userMessage?.content).not.toContain("client-secret");
        expect(userMessage?.content).not.toContain("forged.example.com");
    });

    it("sends the logical billing model, stable request key, and cancellation signal", async () => {
        const response = await POST(workbenchRequest({ requestId: "request-one", prompt: "生成商品图", workspace: "image" }));
        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;
        const headers = new Headers(init.headers);

        expect(response.status).toBe(200);
        expect(headers.get("x-vozeb-pro-logical-model")).toBe("planner");
        expect(headers.get("x-vozeb-pro-points-idempotency-key")).toMatch(/^workbench-plan:[a-f0-9]{32}:chat-json$/);
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("loads and records the shared creative conversation", async () => {
        mocks.getCreativeConversationContext.mockResolvedValue({
            summary: "用户正在制作咖啡品牌视觉。",
            summaryThroughSequence: 2,
            recentMessages: [{ id: "one", conversationId: "conversation-one", sequence: 3, role: "user", status: "completed", content: "保持黑金配色", metadata: {}, createdAt: 1, updatedAt: 1 }],
        });

        const attachment = { kind: "image", name: "产品参考", url: "/api/reference-assets/permanent/product.png", storageKey: "permanent/product.png", mimeType: "image/png" };
        const response = await POST(workbenchRequest({ prompt: "继续生成主图", workspace: "image", conversationId: "conversation-one", attachments: [attachment] }));
        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;
        const upstreamBody = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
        const planningInput = JSON.parse(upstreamBody.messages.find((message) => message.role === "user")?.content || "{}") as { conversationContext?: { summary?: string } };

        expect(response.status).toBe(200);
        expect(planningInput.conversationContext?.summary).toContain("咖啡品牌视觉");
        expect(mocks.appendWorkbenchExchangeForUser).toHaveBeenCalledWith("user", { conversationId: "conversation-one", workspace: "image", prompt: "继续生成主图", reply: "已收到生成需求。", attachments: [attachment] });
    });

    it("does not create media for an ordinary question even when the planner requests generation", async () => {
        mocks.fetchInternalApi.mockResolvedValue(
            Response.json({
                output: [
                    {
                        type: "function_call",
                        name: "plan_workbench_action",
                        arguments: JSON.stringify({
                            intent: "generation",
                            parameterPatch: { model: "image-logical", size: "1:1", quality: "high", count: 1 },
                            resolvedPrompt: "一张问候图片",
                            shouldGenerate: true,
                            reply: "在的，有什么可以帮你？",
                            decisions: [],
                            choices: [],
                        }),
                    },
                ],
            }),
        );

        const response = await POST(workbenchRequest({ prompt: "你在吗？", workspace: "image" }));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ data: { intent: "conversation", parameterPatch: {}, shouldGenerate: false, reply: "在的，有什么可以帮你？" } });
    });

    it("requires a resolvable default text model instead of silently generating from local regex rules", async () => {
        mocks.getAuthSettings.mockResolvedValue({ ...settings, defaultModels: { ...settings.defaultModels, textModel: "" } });

        const response = await POST(workbenchRequest({ prompt: "生成 3 张 16:9 高清商品图", workspace: "image" }));

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ data: null, msg: "请管理员先配置并启用默认文本模型" });
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("uses a validated manual generation model without a default text model", async () => {
        mocks.getAuthSettings.mockResolvedValue({ ...settings, defaultModels: { ...settings.defaultModels, textModel: "" } });

        const response = await POST(
            workbenchRequest({
                prompt: "生成 3 张 16:9 高清商品图",
                workspace: "image",
                smartPlanning: false,
                modelIds: ["image-logical"],
                currentConfig: { imageModel: "image-logical", size: "16:9", quality: "high", count: 3 },
            }),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ data: { shouldGenerate: true, parameterPatch: { model: "image-logical", size: "16:9", quality: "high", count: 3 } } });
        expect(mocks.getCreativeConversationContext).not.toHaveBeenCalled();
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("rejects manual mode without an explicitly selected model", async () => {
        const response = await POST(
            workbenchRequest({
                prompt: "生成商品图",
                workspace: "image",
                smartPlanning: false,
                currentConfig: { imageModel: "image-logical", size: "1:1", quality: "high", count: 1 },
            }),
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ data: null, msg: "请先选择一个可用的图片模型" });
        expect(mocks.fetchInternalApi).not.toHaveBeenCalled();
    });

    it("returns an explicit planning failure when the text provider is unavailable", async () => {
        mocks.fetchInternalApi.mockResolvedValue(new Response("provider unavailable", { status: 503 }));

        const response = await POST(workbenchRequest({ prompt: "生成商品图", workspace: "image" }));

        expect(response.status).toBe(502);
        expect(await response.json()).toMatchObject({ data: null, msg: "默认文本模型规划失败，请检查渠道可用性" });
        expect(mocks.fetchInternalApi).toHaveBeenCalledTimes(1);
    });

    it("uses the next planner binding when the primary text channel fails", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [settings.systemChannels[0], { ...settings.systemChannels[0], id: "backup", name: "备用渠道", models: ["vendor/planner-backup", "vendor/image"] }],
            logicalModels: settings.logicalModels.map((model) =>
                model.id === "planner"
                    ? {
                          ...model,
                          bindings: [model.bindings[0], { id: "planner-backup-binding", channelId: "backup", upstreamModel: "vendor/planner-backup", enabled: true, priority: 2 }],
                      }
                    : model,
            ),
        });
        mocks.fetchInternalApi.mockImplementation(async (url: string) => {
            if (url.includes("/main/") && (url.endsWith("/responses") || url.endsWith("/chat/completions"))) return new Response("provider unavailable", { status: 503 });
            if (url.includes("/backup/") && url.endsWith("/chat/completions"))
                return Response.json({
                    output: [{ type: "function_call", name: "plan_workbench_action", arguments: JSON.stringify({ parameterPatch: { model: "image-logical" }, resolvedPrompt: "备用渠道规划", shouldGenerate: false, reply: "备用渠道已接管。" }) }],
                });
            throw new Error(`unexpected request: ${url}`);
        });

        const response = await POST(workbenchRequest({ prompt: "规划商品图", workspace: "image" }));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ data: { reply: "备用渠道已接管。" } });
        expect(mocks.fetchInternalApi.mock.calls.some(([url]) => String(url).includes("/main/"))).toBe(true);
        expect(mocks.fetchInternalApi.mock.calls.some(([url]) => String(url).includes("/backup/"))).toBe(true);
    });

    it("automatically uses the next planner binding when the primary model times out", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [settings.systemChannels[0], { ...settings.systemChannels[0], id: "backup", name: "备用渠道", models: ["vendor/planner-backup", "vendor/image"] }],
            logicalModels: settings.logicalModels.map((model) =>
                model.id === "planner"
                    ? {
                          ...model,
                          bindings: [model.bindings[0], { id: "planner-backup-binding", channelId: "backup", upstreamModel: "vendor/planner-backup", enabled: true, priority: 2 }],
                      }
                    : model,
            ),
        });
        mocks.fetchInternalApi.mockImplementation(async (url: string) => {
            if (url.includes("/main/") && url.endsWith("/chat/completions")) throw new DOMException("timed out", "TimeoutError");
            if (url.includes("/backup/") && url.endsWith("/chat/completions"))
                return Response.json({
                    choices: [{ message: { content: JSON.stringify({ parameterPatch: { model: "image-logical" }, resolvedPrompt: "备用渠道规划", shouldGenerate: false, reply: "备用文本模型已自动接管。" }) } }],
                });
            throw new Error(`unexpected request: ${url}`);
        });

        const response = await POST(workbenchRequest({ prompt: "规划商品图", workspace: "image" }));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ data: { reply: "备用文本模型已自动接管。" } });
        expect(mocks.fetchInternalApi.mock.calls.filter(([url]) => String(url).includes("/main/"))).toHaveLength(1);
        expect(mocks.fetchInternalApi.mock.calls.filter(([url]) => String(url).includes("/backup/"))).toHaveLength(1);
    });

    it("uses distinct idempotency keys for different planner bindings on the same channel", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            systemChannels: [{ ...settings.systemChannels[0], models: [...settings.systemChannels[0].models, "vendor/planner-backup"] }],
            logicalModels: settings.logicalModels.map((model) =>
                model.id === "planner"
                    ? {
                          ...model,
                          bindings: [...model.bindings, { id: "planner-backup-binding", channelId: "main", upstreamModel: "vendor/planner-backup", enabled: true, priority: 2 }],
                      }
                    : model,
            ),
        });
        mocks.fetchInternalApi.mockImplementation(async (_url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)) as { model?: string };
            if (body.model === "vendor/planner") return new Response("provider unavailable", { status: 503 });
            return Response.json({
                output: [{ type: "function_call", name: "plan_workbench_action", arguments: JSON.stringify({ parameterPatch: { model: "image-logical" }, resolvedPrompt: "备用模型规划", shouldGenerate: false, reply: "备用模型已接管。" }) }],
            });
        });

        const response = await POST(workbenchRequest({ requestId: "same-channel-failover", prompt: "规划商品图", workspace: "image" }));
        const calls = mocks.fetchInternalApi.mock.calls.map(([, init]) => ({
            model: (JSON.parse(String(init?.body)) as { model?: string }).model,
            key: new Headers(init?.headers).get("x-vozeb-pro-points-idempotency-key"),
        }));

        expect(response.status).toBe(200);
        expect(calls.find((call) => call.model === "vendor/planner")?.key).toMatch(/^workbench-plan:[a-f0-9]{32}:chat-json$/);
        expect(calls.find((call) => call.model === "vendor/planner-backup")?.key).toMatch(/^workbench-plan:[a-f0-9]{32}:chat-json$/);
        expect(calls.find((call) => call.model === "vendor/planner")?.key).not.toBe(calls.find((call) => call.model === "vendor/planner-backup")?.key);
    });

    it("accepts strict JSON from chat providers that do not support tool calls", async () => {
        mocks.fetchInternalApi.mockResolvedValueOnce(
            Response.json({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                parameterPatch: { model: "image-logical", size: "16:9" },
                                resolvedPrompt: "商业咖啡海报，暖色侧光",
                                shouldGenerate: false,
                                reply: "已完成构图与参数规划。",
                            }),
                        },
                    },
                ],
            }),
        );

        const response = await POST(workbenchRequest({ prompt: "只规划商业咖啡海报，不生成", workspace: "image" }));

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload).toMatchObject({
            data: {
                parameterPatch: { model: "image-logical", size: "16:9" },
                shouldGenerate: false,
            },
        });
        expect(payload.data.resolvedPrompt).toContain("商业咖啡海报，暖色侧光");
        expect(payload.data.resolvedPrompt).toContain("统一创作约束");
    });

    it("rejects prose chat output instead of guessing generation parameters locally", async () => {
        mocks.fetchInternalApi.mockResolvedValueOnce(
            Response.json({ choices: [{ message: { content: "Use a warm composition and generate three images." } }] }, { headers: { "x-vozeb-pro-points-cost": "1", "x-vozeb-pro-points-record-id": "points-workbench-1" } }),
        );

        const response = await POST(workbenchRequest({ prompt: "规划咖啡海报", workspace: "image" }));

        expect(response.status).toBe(502);
        expect(await response.json()).toMatchObject({ data: null, msg: "默认文本模型规划失败，请检查渠道可用性" });
        expect(mocks.refundUserPoints).toHaveBeenCalledWith("user", "planner", 1, "text", 1, undefined, "points-workbench-1");
    });

    it("refunds the free-text quota when a zero-cost planner response is invalid", async () => {
        mocks.fetchInternalApi.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "not structured" } }] }, { headers: { "x-vozeb-pro-points-cost": "0", "x-vozeb-pro-points-record-id": "points-workbench-free" } }));

        const response = await POST(workbenchRequest({ requestId: "free-plan", prompt: "规划咖啡海报", workspace: "image" }));

        expect(response.status).toBe(502);
        expect(mocks.refundUserPoints).toHaveBeenCalledWith("user", "planner", 0, "text", 1, undefined, "points-workbench-free");
    });

    it("refunds a valid planner call when conversation persistence fails", async () => {
        mocks.fetchInternalApi.mockResolvedValueOnce(
            Response.json(
                {
                    output: [
                        {
                            type: "function_call",
                            name: "plan_workbench_action",
                            arguments: JSON.stringify({ parameterPatch: { model: "image-logical" }, resolvedPrompt: "商品主图", shouldGenerate: true, reply: "开始" }),
                        },
                    ],
                },
                { headers: { "x-vozeb-pro-points-cost": "2", "x-vozeb-pro-points-record-id": "points-save-failed" } },
            ),
        );
        mocks.appendWorkbenchExchangeForUser.mockRejectedValueOnce(new Error("会话写入失败"));

        const response = await POST(workbenchRequest({ requestId: "save-failed", conversationId: "conversation-one", prompt: "生成商品图", workspace: "image" }));

        expect(response.status).toBe(500);
        expect(mocks.refundUserPoints).toHaveBeenCalledWith("user", "planner", 2, "text", 1, undefined, "points-save-failed");
    });

    it("offers actionable alternatives when a matched skill requires a reference", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            agentSkills: [{ id: "reference-skill", name: "参考图创作", enabled: true, workspaces: ["image"], keywords: ["参考图"], requiresReference: true, action: "generate", defaultConfig: {}, instructions: "保持主体一致" }],
        });
        mocks.fetchInternalApi.mockResolvedValue(
            Response.json({
                output: [
                    {
                        type: "function_call",
                        name: "plan_workbench_action",
                        arguments: JSON.stringify({ parameterPatch: { model: "image-logical" }, resolvedPrompt: "参考图商品海报", shouldGenerate: false, reply: "参考图有助于保持主体一致。", selectedSkillIds: ["reference-skill"] }),
                    },
                ],
            }),
        );

        const response = await POST(workbenchRequest({ prompt: "把这个产品处理得更适合电商展示", workspace: "image", skillIds: ["reference-skill"], hasReferences: false }));
        const payload = await response.json();

        expect(payload.data.selectedSkillIds).toEqual(["reference-skill"]);
        expect(payload.data.choices).toEqual([expect.objectContaining({ label: "上传参考图", action: "upload" }), expect.objectContaining({ label: "改为无参考方案", action: "prompt" }), expect.objectContaining({ label: "先只做方案", action: "prompt" })]);
        expect(payload.data.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ label: "模型", value: "图片模型" })]));
    });

    it("adds a visible subject consistency decision for referenced video planning", async () => {
        mocks.getAuthSettings.mockResolvedValue(videoSettings());
        mocks.fetchInternalApi.mockResolvedValue(
            Response.json({
                output: [
                    {
                        type: "function_call",
                        name: "plan_workbench_action",
                        arguments: JSON.stringify({
                            parameterPatch: { model: "video-logical", size: "16:9", vquality: "720", videoSeconds: 5 },
                            resolvedPrompt: "保持参考人物与场景，仅让人物自然挥手",
                            shouldGenerate: false,
                            reply: "已完成参考图视频方案。",
                            decisions: [{ label: "模型", value: "视频模型", reason: "支持当前视频生成" }],
                            choices: [],
                        }),
                    },
                ],
            }),
        );

        const response = await POST(workbenchRequest({ prompt: "让参考图人物自然挥手，只做方案", workspace: "video", hasReferences: true }));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.data.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ label: "参考一致性", value: "保留主体与首帧构图" })]));
    });

    it("offers only logical models whose channels support the attached reference types", async () => {
        mocks.getAuthSettings.mockResolvedValue(referenceCapabilitySettings(true));
        mocks.fetchInternalApi.mockResolvedValue(
            Response.json({
                output: [
                    {
                        type: "function_call",
                        name: "plan_workbench_action",
                        arguments: JSON.stringify({
                            parameterPatch: { model: "video-reference", size: "16:9", vquality: "720", videoSeconds: 5 },
                            resolvedPrompt: "保持参考人物与现场构图，镜头缓慢推进",
                            shouldGenerate: true,
                            reply: "已选择支持参考图的视频模型。",
                            decisions: [{ label: "模型", value: "参考视频模型", reason: "渠道已启用参考图能力" }],
                            choices: [],
                        }),
                    },
                ],
            }),
        );

        const response = await POST(workbenchRequest({ prompt: "让参考图人物自然眨眼", workspace: "video", hasReferences: true, referenceTypes: ["image"] }));
        const payload = await response.json();
        const init = mocks.fetchInternalApi.mock.calls[0]?.[1] as RequestInit;
        const upstreamBody = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
        const planningInput = JSON.parse(upstreamBody.messages.find((message) => message.role === "user")?.content || "{}") as { availableModels?: Array<{ id: string; name: string }>; referenceTypes?: string[] };

        expect(planningInput.availableModels).toEqual([{ id: "video-reference", name: "参考视频模型" }]);
        expect(planningInput.referenceTypes).toEqual(["image"]);
        expect(payload.data).toMatchObject({ shouldGenerate: true, parameterPatch: { model: "video-reference" } });
    });

    it("blocks generation instead of selecting a model that would ignore attached references", async () => {
        mocks.getAuthSettings.mockResolvedValue(referenceCapabilitySettings(false));
        mocks.fetchInternalApi.mockResolvedValue(
            Response.json({
                output: [
                    {
                        type: "function_call",
                        name: "plan_workbench_action",
                        arguments: JSON.stringify({
                            parameterPatch: { model: "video-basic", size: "16:9", vquality: "720", videoSeconds: 5 },
                            resolvedPrompt: "保持参考人物，镜头缓慢推进",
                            shouldGenerate: true,
                            reply: "开始生成。",
                            decisions: [{ label: "模型", value: "基础视频模型", reason: "用于视频生成" }],
                            choices: [],
                        }),
                    },
                ],
            }),
        );

        const response = await POST(workbenchRequest({ prompt: "使用这张参考图生成视频", workspace: "video", hasReferences: true, referenceTypes: ["image"] }));
        const payload = await response.json();

        expect(payload.data).toMatchObject({ shouldGenerate: false, referenceMissing: false });
        expect(payload.data.reply).toContain("没有启用支持参考图的视频模型");
        expect(payload.data.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ label: "参考能力", value: "参考图暂不可用" })]));
        expect(payload.data.choices).toEqual([expect.objectContaining({ label: "改为无参考方案" }), expect.objectContaining({ label: "先只做方案" })]);
        expect(payload.data.parameterPatch).not.toHaveProperty("model");
    });

    it("blocks reference-dependent video generation when the referenced asset is missing", async () => {
        mocks.getAuthSettings.mockResolvedValue(videoSettings());
        mocks.fetchInternalApi.mockResolvedValue(
            Response.json({
                output: [
                    {
                        type: "function_call",
                        name: "plan_workbench_action",
                        arguments: JSON.stringify({
                            parameterPatch: { model: "video-logical", size: "16:9", vquality: "720", videoSeconds: 5 },
                            resolvedPrompt: "保持参考人物、服装和现场构图不变，镜头缓慢推进",
                            shouldGenerate: true,
                            reply: "正在创建参考图视频。",
                            decisions: [{ label: "参考一致性", value: "保持主体", reason: "避免人物变化" }],
                            choices: [],
                        }),
                    },
                ],
            }),
        );

        const response = await POST(workbenchRequest({ prompt: "请使用我提供的发布会现场参考照片生成 5 秒视频", workspace: "video", hasReferences: false }));
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.data).toMatchObject({ shouldGenerate: false, referenceRequired: true, referenceMissing: true });
        expect(payload.data.reply).toContain("不会在缺少素材时创建任务");
        expect(payload.data.choices).toEqual([expect.objectContaining({ label: "上传参考图", action: "upload" }), expect.objectContaining({ label: "改为无参考方案", action: "prompt" }), expect.objectContaining({ label: "先只做方案", action: "prompt" })]);
        expect(payload.data.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ label: "参考素材", value: "尚未上传" })]));
    });

    it("allows an explicit no-reference choice even when it quotes the original reference request", async () => {
        mocks.getAuthSettings.mockResolvedValue(videoSettings());
        mocks.fetchInternalApi.mockResolvedValue(
            Response.json({
                output: [
                    {
                        type: "function_call",
                        name: "plan_workbench_action",
                        arguments: JSON.stringify({
                            parameterPatch: { model: "video-logical", size: "16:9", vquality: "720", videoSeconds: 5 },
                            resolvedPrompt: "重新设计发布会人物与现场，镜头缓慢推进",
                            shouldGenerate: true,
                            reply: "已切换为无参考方案。",
                            decisions: [{ label: "画幅", value: "16:9", reason: "保留舞台环境" }],
                            choices: [],
                        }),
                    },
                ],
            }),
        );

        const response = await POST(workbenchRequest({ prompt: "不使用参考图，直接根据以下需求设计并生成：请使用我提供的发布会现场参考照片生成 5 秒视频", workspace: "video", hasReferences: false }));
        const payload = await response.json();

        expect(payload.data).toMatchObject({ shouldGenerate: true, referenceRequired: false, referenceMissing: false });
        expect(payload.data.choices).toBeUndefined();
    });

    it("does not treat a new portrait or phone-photo request as reference editing", async () => {
        mocks.getAuthSettings.mockResolvedValue({
            ...settings,
            agentSkills: [
                {
                    id: "portrait-retouch",
                    name: "自然美颜精修",
                    enabled: true,
                    workspaces: ["image"],
                    keywords: ["人像", "美颜"],
                    requiresReference: true,
                    action: "edit",
                    defaultConfig: {},
                    instructions: "保留参考人物身份",
                },
            ],
        });
        mocks.fetchInternalApi.mockResolvedValue(
            Response.json({
                output: [
                    {
                        type: "function_call",
                        name: "plan_workbench_action",
                        arguments: JSON.stringify({
                            parameterPatch: { model: "image-logical", size: "16:9", quality: "high", count: 1 },
                            resolvedPrompt: "Apple Park 发布会现场的远距离手机抓拍",
                            shouldGenerate: true,
                            reply: "已选择适合纪实摄影的模型与横向构图。",
                            decisions: [
                                { label: "模型", value: "图片模型", reason: "适合写实摄影" },
                                { label: "画幅", value: "16:9", reason: "保留舞台与人群环境" },
                            ],
                            choices: [],
                        }),
                    },
                ],
            }),
        );

        const response = await POST(workbenchRequest({ prompt: "在 Apple Park 举办 iPhone 20 发布会期间，用 iPhone 从远处人群中拍摄一张业余照片，蒂姆·库克正在台上演讲", workspace: "image", hasReferences: false }));
        const payload = await response.json();

        expect(payload.data).toMatchObject({ shouldGenerate: true, referenceRequired: false, referenceMissing: false });
    });
});

function workbenchRequest(body: unknown) {
    return new Request("http://localhost/api/agent/workbench", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const settings = {
    defaultModels: { textModel: "planner", imageModel: "image-logical", videoModel: "", audioModel: "" },
    agentSkills: [],
    systemChannels: [{ id: "main", name: "主渠道", baseUrl: "https://api.example.com/v1", apiKey: "server-only", apiFormat: "openai", models: ["vendor/planner", "vendor/image"], enabled: true }],
    logicalModels: [
        { id: "planner", name: "规划模型", capability: "text", enabled: true, bindings: [{ id: "planner-binding", channelId: "main", upstreamModel: "vendor/planner", enabled: true, priority: 1 }] },
        { id: "image-logical", name: "图片模型", capability: "image", enabled: true, bindings: [{ id: "image-binding", channelId: "main", upstreamModel: "vendor/image", enabled: true, priority: 1 }] },
        { id: "broken-image", name: "不可用图片模型", capability: "image", enabled: true, bindings: [{ id: "broken-binding", channelId: "main", upstreamModel: "vendor/missing", enabled: true, priority: 2 }] },
        { id: "disabled-image", name: "停用图片模型", capability: "image", enabled: false, bindings: [{ id: "disabled-binding", channelId: "main", upstreamModel: "vendor/image", enabled: true, priority: 3 }] },
    ],
};

function videoSettings() {
    return {
        ...settings,
        defaultModels: { ...settings.defaultModels, videoModel: "video-logical" },
        systemChannels: [{ ...settings.systemChannels[0], models: [...settings.systemChannels[0].models, "vendor/video"] }],
        logicalModels: [...settings.logicalModels, { id: "video-logical", name: "视频模型", capability: "video", enabled: true, bindings: [{ id: "video-binding", channelId: "main", upstreamModel: "vendor/video", enabled: true, priority: 1 }] }],
    };
}

function referenceCapabilitySettings(withSupportedModel: boolean) {
    const mainChannel = { ...settings.systemChannels[0], models: [...settings.systemChannels[0].models, "vendor/video-basic"], advancedConfig: { supportsReferenceImage: false, supportsReferenceVideo: false, supportsReferenceAudio: false } };
    const referenceChannel = {
        ...settings.systemChannels[0],
        id: "reference-video",
        name: "参考视频渠道",
        models: ["vendor/video-reference"],
        advancedConfig: { supportsReferenceImage: true, supportsReferenceVideo: false, supportsReferenceAudio: false },
    };
    return {
        ...settings,
        defaultModels: { ...settings.defaultModels, videoModel: withSupportedModel ? "video-reference" : "video-basic" },
        systemChannels: withSupportedModel ? [mainChannel, referenceChannel] : [mainChannel],
        logicalModels: [
            ...settings.logicalModels,
            { id: "video-basic", name: "基础视频模型", capability: "video", enabled: true, bindings: [{ id: "video-basic-binding", channelId: "main", upstreamModel: "vendor/video-basic", enabled: true, priority: 1 }] },
            ...(withSupportedModel
                ? [{ id: "video-reference", name: "参考视频模型", capability: "video", enabled: true, bindings: [{ id: "video-reference-binding", channelId: "reference-video", upstreamModel: "vendor/video-reference", enabled: true, priority: 1 }] }]
                : []),
        ],
    };
}
