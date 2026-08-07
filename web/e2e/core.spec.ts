import { createHmac, randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_PAYMENT_WEBHOOK_SECRET, pollTask, protocolFixtureState, resetProtocolFixture } from "./support";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }) => {
    await resetProtocolFixture(request);
});

test("first-use guide offers an executable creative next step", async ({ page }) => {
    await emptyCreativeHistory(page);
    await page.addInitScript(() => {
        for (const key of Object.keys(localStorage)) if (key.startsWith("dq:first-use-guide:")) localStorage.removeItem(key);
    });

    await page.goto("/create", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "开始第一次创作" })).toBeVisible();
    await page.getByRole("button", { name: "填入示例" }).click();
    await expect(page.getByPlaceholder("描述你的想法，或添加参考素材")).toHaveValue(/透明玻璃香水瓶/);
});

test("first-use guide sends administrators to model configuration when defaults are missing", async ({ page }) => {
    await emptyCreativeHistory(page);
    await page.route("**/api/auth/session", async (route) => {
        const response = await route.fetch();
        const payload = (await response.json()) as { settings?: Record<string, unknown> };
        payload.settings = { ...(payload.settings || {}), systemChannels: [], logicalModels: [], defaultModels: { textModel: "", imageModel: "", videoModel: "", audioModel: "" } };
        await route.fulfill({ response, json: payload });
    });

    await page.goto("/create", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "完成模型配置后开始创作" })).toBeVisible();
    await expect(page.getByRole("link", { name: "配置模型" })).toHaveAttribute("href", "/admin?section=channels");
});

test("Agent Skill creation exposes GitHub extraction failures without saving an unverified skill", async ({ page }) => {
    await page.route("**/api/admin/agent-skills/import", async (route) => {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "请先配置并启用默认文本模型，再提取 GitHub Skill" }) });
    });
    await page.goto("/admin?section=skills", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新增 Skill" }).click();
    const dialog = page.getByRole("dialog", { name: "新增 Agent Skill" });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("https://github.com/owner/repo 或 .../SKILL.md").fill("https://github.com/acme/skills");
    await dialog.getByRole("button", { name: "提取", exact: true }).click();
    await expect(dialog.getByText("请先配置并启用默认文本模型，再提取 GitHub Skill")).toBeVisible();
    await expect(dialog.getByText("AI 提取完成", { exact: false })).toHaveCount(0);
});

test("text tasks return content, fail over automatically, and surface terminal failures", async ({ request }) => {
    const fallback = await request.post("/api/text-tasks", { data: { config: { model: "e2e-text-fallback" }, messages: [{ role: "user", content: "protocol fallback" }] } });
    expect(fallback.ok(), await fallback.text()).toBe(true);
    const fallbackTask = ((await fallback.json()) as { task: { id: string } }).task;
    expect(await pollTask(request, `/api/text-tasks/${fallbackTask.id}`)).toMatchObject({ status: "success", result: { content: "协议测试文本返回成功" } });
    const state = await protocolFixtureState(request);
    expect(state.requests.filter((item) => item.method === "POST" && item.path.endsWith("/chat/completions"))).toMatchObject([
        { authorization: "Bearer e2e-primary-secret", model: "e2e-text-fallback" },
        { authorization: "Bearer e2e-backup-secret", model: "e2e-text-fallback" },
    ]);

    const failed = await request.post("/api/text-tasks", { data: { config: { model: "e2e-text-fail" }, messages: [{ role: "user", content: "protocol failure" }] } });
    expect(failed.ok(), await failed.text()).toBe(true);
    const failedTask = ((await failed.json()) as { task: { id: string } }).task;
    expect(await pollTask(request, `/api/text-tasks/${failedTask.id}`)).toMatchObject({ status: "error" });
});

test("image tasks persist media and deduplicate the same request identity", async ({ request }) => {
    const clientRequestId = `e2e-image:${randomUUID()}`;
    const body = { kind: "generation", config: { model: "e2e-image", quality: "standard", size: "64x64" }, prompt: "blue image", source: "image-workbench", context: { clientRequestId } };
    const headers = { "X-DQ-Client-Request-Id": clientRequestId };
    const [created, replay] = await Promise.all([request.post("/api/image-tasks", { data: body, headers }), request.post("/api/image-tasks", { data: body, headers })]);
    const createdPayload = (await created.json()) as { task: { id: string } };
    const replayPayload = (await replay.json()) as { task: { id: string } };
    expect(created.ok()).toBe(true);
    expect(replay.ok()).toBe(true);
    const firstTask = createdPayload.task;
    expect(replayPayload.task.id).toBe(firstTask.id);

    const completed = await pollTask(request, `/api/image-tasks/${firstTask.id}`);
    expect(completed).toMatchObject({ status: "success", result: { width: 64, height: 64, mimeType: "image/png" } });
    const mediaUrl = String((completed.result as { serverUrl?: string }).serverUrl || "");
    expect(mediaUrl).toMatch(/^\/api\/generation-log-assets\/permanent\/.+\.png$/);
    const media = await request.get(mediaUrl);
    expect(media.ok()).toBe(true);
    expect(media.headers()["content-type"]).toMatch(/^image\/png/);
    expect(Array.from((await media.body()).subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect((await protocolFixtureState(request)).requests.filter((item) => item.method === "POST" && item.path.endsWith("/images/generations"))).toHaveLength(1);
});

test("image workbench keeps consecutive results after refresh", async ({ page, request }) => {
    const suffix = randomUUID().slice(0, 8);
    const firstPrompt = `生成小狗 ${suffix}`;
    const secondPrompt = `生成唐老鸭 ${suffix}`;
    let planningRequests = 0;
    page.on("request", (outgoing) => {
        if (outgoing.method() === "POST" && new URL(outgoing.url()).pathname === "/api/agent/workbench") planningRequests += 1;
    });
    await page.goto("/image", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    const prompt = page.getByPlaceholder("今天我们要创作什么，可直接粘贴文字或图片");
    const generate = page.getByRole("button", { name: /开始生成/ });

    await prompt.fill(firstPrompt);
    await generate.evaluate((button) => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await expect.poll(() => planningRequests).toBe(1);
    await expect(page.getByTestId("image-result-card")).toHaveCount(1, { timeout: 30_000 });
    await expect.poll(async () => (await protocolFixtureState(request)).requests.filter((item) => item.method === "POST" && item.path.endsWith("/images/generations")).length).toBe(1);

    await prompt.fill(secondPrompt);
    await generate.click();
    await expect(page.getByText(firstPrompt, { exact: true })).toHaveCount(1);
    await expect(page.getByText(secondPrompt, { exact: true })).toHaveCount(1);
    await expect(page.getByTestId("image-result-card")).toHaveCount(2, { timeout: 30_000 });
    await expect.poll(async () => (await protocolFixtureState(request)).requests.filter((item) => item.method === "POST" && item.path.endsWith("/images/generations")).length).toBe(2);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(firstPrompt, { exact: true })).toHaveCount(1);
    await expect(page.getByText(secondPrompt, { exact: true })).toHaveCount(1);
    await expect(page.getByTestId("image-result-card")).toHaveCount(2, { timeout: 30_000 });

    await page.getByRole("button", { name: "生成记录" }).click();
    await expect(page.getByTestId("workbench-history-card").filter({ hasText: firstPrompt })).toHaveCount(1);
});

test("image workbench restores a failed result and its retry action after refresh", async ({ page }) => {
    const promptText = `生成失败状态 ${randomUUID().slice(0, 8)}`;
    await page.goto("/image", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    await page.getByRole("button", { name: "智能规划已开启，点击关闭" }).click();
    await expect(page.getByText("选择生成模型", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "e2e-image-fail", exact: true }).click();
    await page.keyboard.press("Escape");

    const prompt = page.getByPlaceholder("今天我们要创作什么，可直接粘贴文字或图片");
    await prompt.fill(promptText);
    await page.getByRole("button", { name: /开始生成/ }).click();
    const failedCard = page.getByTestId("image-failed-card");
    await expect(failedCard).toBeVisible({ timeout: 30_000 });
    await expect(failedCard.getByRole("button", { name: "重试" })).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(promptText, { exact: true })).toHaveCount(1);
    await expect(page.getByTestId("image-failed-card")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("image-failed-card").getByRole("button", { name: "重试" })).toBeVisible();
});

test("assets workflow creates, restores, and deletes a text asset", async ({ page }) => {
    const title = `E2E 素材 ${randomUUID().slice(0, 8)}`;
    const content = "用于浏览器回归的可复用提示词";

    await page.goto("/assets", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新增素材", exact: true }).last().click();
    const dialog = page.getByRole("dialog", { name: "新增素材" });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("给素材起一个容易检索的名字").fill(title);
    await dialog.getByPlaceholder("保存提示词、说明文案、参考描述等文本素材").fill(content);
    await dialog.locator(".ant-modal-footer button").last().click();

    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();

    await page.getByRole("button", { name: `删除 ${title}`, exact: true }).click();
    const deleteDialog = page.getByRole("dialog", { name: "删除素材" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.locator(".ant-modal-footer button").last().click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
});

test("Canvas UI persists an edited text node after refresh", async ({ page }) => {
    const content = `Canvas UI 持久化 ${randomUUID().slice(0, 8)}`;

    await page.goto("/canvas", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新建画布", exact: true }).first().click();
    await expect(page).toHaveURL(/\/canvas\/[^/]+/);

    await page.getByRole("button", { name: "添加组件", exact: true }).click();
    await page.getByRole("menuitem", { name: "文本", exact: true }).click();
    const node = page.locator("[data-node-id]").first();
    await expect(node).toBeVisible();
    await node.dblclick();
    const editor = node.getByRole("textbox");
    await expect(editor).toBeVisible();
    await editor.fill(content);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(700);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(content, { exact: true })).toBeVisible();
});

test("short drama workflow restores a saved version after editing and refresh", async ({ page }) => {
    const title = `E2E 短剧 ${randomUUID().slice(0, 8)}`;
    const originalScript = "主角推门进入房间。\n主角说：测试开始。";

    await page.goto("/drama", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新建短剧", exact: true }).click();
    const createDialog = page.getByRole("dialog", { name: "新建短剧项目" });
    await expect(createDialog).toBeVisible();
    await createDialog.getByPlaceholder("例如：月影长安").fill(title);
    await createDialog.getByPlaceholder("一句话说明人物、冲突和目标").fill("协议 fixture 短剧流程");
    await createDialog.locator(".ant-modal-footer button").last().click();
    await expect(page).toHaveURL(/\/drama\/[^/]+/);

    const script = page.getByPlaceholder("粘贴或编写本集剧本，每个段落会生成一个镜头草稿…");
    await expect(script).toBeVisible();
    await script.fill(originalScript);
    await page.getByRole("button", { name: "AI 提取内容结构", exact: true }).click();
    await expect(page.getByText(/已提取 1 个角色、1 个场景和 1 个待审核镜头/)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button").filter({ hasText: "版本" }).click();
    const versionDialog = page.getByRole("dialog", { name: "版本历史" });
    await expect(versionDialog).toBeVisible();
    await versionDialog.getByRole("button").filter({ hasText: "保存当前版本" }).click();
    await expect(versionDialog.getByText("手动保存版本", { exact: false })).toBeVisible({ timeout: 30_000 });
    await versionDialog.locator(".ant-modal-footer button").last().click();

    await page.getByRole("button", { name: "01 剧本", exact: true }).click();
    await script.fill("已修改的剧本内容");
    await page.waitForTimeout(700);
    await page.getByRole("button").filter({ hasText: "版本" }).click();
    const restoreDialog = page.getByRole("dialog", { name: "版本历史" });
    await expect(restoreDialog.getByText("手动保存版本", { exact: false })).toBeVisible();
    await restoreDialog
        .getByRole("button")
        .filter({ hasText: /恢\s*复/ })
        .first()
        .click();
    await expect(page.getByRole("button", { name: "01 剧本", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "01 剧本", exact: true }).click();
    await expect(page.getByPlaceholder("粘贴或编写本集剧本，每个段落会生成一个镜头草稿…")).toHaveValue(originalScript);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "01 剧本", exact: true }).click();
    await expect(page.getByPlaceholder("粘贴或编写本集剧本，每个段落会生成一个镜头草稿…")).toHaveValue(originalScript);
});

test("video replay and cancellation create only one upstream task", async ({ request }) => {
    const clientRequestId = `e2e-video:${randomUUID()}`;
    const body = { config: { model: "e2e-video-slow", size: "16:9", vquality: "720", videoSeconds: 5 }, prompt: "slow video", source: "video-workbench", context: { clientRequestId } };
    const headers = { "X-DQ-Client-Request-Id": clientRequestId };
    const [created, replay] = await Promise.all([request.post("/api/video-generation-tasks", { data: body, headers }), request.post("/api/video-generation-tasks", { data: body, headers })]);
    const createdPayload = (await created.json()) as { task: { id: string } };
    const replayPayload = (await replay.json()) as { task: { id: string } };
    expect(created.ok()).toBe(true);
    expect(replay.ok()).toBe(true);
    const firstTask = createdPayload.task;
    expect(replayPayload.task.id).toBe(firstTask.id);
    await expect.poll(async () => (await protocolFixtureState(request)).requests.filter((item) => item.method === "POST" && item.path.endsWith("/videos")).length).toBe(1);

    const cancelled = await request.patch(`/api/video-tasks/${firstTask.id}`, { data: { action: "cancel" } });
    expect(cancelled.ok(), await cancelled.text()).toBe(true);
    expect(await pollTask(request, `/api/video-tasks/${firstTask.id}`)).toMatchObject({ status: "cancelled" });
    expect((await protocolFixtureState(request)).requests.filter((item) => item.method === "POST" && item.path.endsWith("/videos"))).toHaveLength(1);
});

test("video workbench restores a pending task after refresh without creating another upstream task", async ({ page, request }) => {
    let planningRequests = 0;
    await page.route("**/api/agent/workbench", async (route) => {
        planningRequests += 1;
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                code: 0,
                data: {
                    intent: "generation",
                    parameterPatch: { model: "e2e-video-slow", size: "16:9", vquality: "720", videoSeconds: 5 },
                    resolvedPrompt: "slow video",
                    shouldGenerate: true,
                    reply: "开始生成。",
                    choices: [],
                    deliverables: [],
                },
                msg: "OK",
            }),
        });
    });

    await page.goto("/video", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    const promptText = `生成一段慢速测试视频 ${randomUUID().slice(0, 8)}`;
    const prompt = page.getByPlaceholder("今天我们要创作什么，可直接粘贴文字或素材");
    const generate = page.getByRole("button", { name: /开始生成/ });
    await prompt.fill(promptText);
    await generate.evaluate((button) => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await expect.poll(() => planningRequests).toBe(1);
    await expect.poll(async () => (await protocolFixtureState(request)).requests.filter((item) => item.method === "POST" && item.path.endsWith("/videos")).length).toBe(1);
    await expect(page.getByRole("status", { name: "视频正在生成" }).first()).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(promptText, { exact: true })).toHaveCount(1);
    await expect(page.getByRole("status", { name: "视频正在生成" }).first()).toBeVisible();
    await expect.poll(async () => (await protocolFixtureState(request)).requests.filter((item) => item.method === "POST" && item.path.endsWith("/videos")).length).toBe(1);
});

test("video workbench restores a successful result after refresh", async ({ page, request }) => {
    await page.goto("/video", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    await page.getByRole("button", { name: "智能规划已开启，点击关闭" }).click();
    await expect(page.getByText("选择生成模型", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "e2e-video", exact: true }).click();
    await page.keyboard.press("Escape");

    const promptText = `生成一段刷新后仍然显示的测试视频 ${randomUUID().slice(0, 8)}`;
    const prompt = page.getByPlaceholder("今天我们要创作什么，可直接粘贴文字或素材");
    await prompt.fill(promptText);
    await page.getByRole("button", { name: /开始生成/ }).click();
    await expect
        .poll(
            async () => {
                const response = await request.get("/api/generation-logs?kind=video&source=video-workbench&pageSize=100");
                if (!response.ok()) return `http-${response.status()}`;
                const payload = (await response.json()) as { items?: Array<{ status?: string; requestSnapshot?: { userPrompt?: string } }> };
                return payload.items?.find((item) => item.requestSnapshot?.userPrompt === promptText)?.status || "missing";
            },
            { timeout: 30_000 },
        )
        .toBe("success");
    await expect(page.getByText(promptText, { exact: true })).toHaveCount(1);
    await expect(page.locator("video")).toHaveCount(1, { timeout: 30_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(promptText, { exact: true })).toHaveCount(1);
    await expect(page.locator("video")).toHaveCount(1, { timeout: 30_000 });
});

test("audio and Canvas data survive server round trips", async ({ request }) => {
    const audio = await request.post("/api/audio-tasks", { data: { config: { model: "e2e-audio", voice: "alloy", format: "wav" }, prompt: "audio fixture", source: "agent", context: { clientRequestId: `e2e-audio:${randomUUID()}` } } });
    expect(audio.ok(), await audio.text()).toBe(true);
    const audioTask = ((await audio.json()) as { task: { id: string } }).task;
    expect(await pollTask(request, `/api/audio-tasks/${audioTask.id}`)).toMatchObject({ status: "success", result: { mimeType: "audio/wav" } });

    const created = await request.post("/api/canvas/projects", {
        data: {
            title: "E2E Canvas",
            project: {
                nodes: [
                    { id: "node-a", type: "text", title: "需求", position: { x: 10, y: 20 }, width: 240, height: 120, metadata: { content: "生成测试" } },
                    { id: "node-b", type: "config", title: "配置", position: { x: 360, y: 20 }, width: 240, height: 160, metadata: { size: "1280x720" } },
                ],
                connections: [{ id: "edge-a-b", fromNodeId: "node-a", toNodeId: "node-b" }],
            },
        },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const project = ((await created.json()) as { data: { project: { id: string } } }).data.project;
    const loaded = await request.get(`/api/canvas/projects/${project.id}`);
    expect(loaded.ok(), await loaded.text()).toBe(true);
    expect(await loaded.json()).toMatchObject({ data: { project: { nodes: [{ id: "node-a" }, { id: "node-b" }], connections: [{ id: "edge-a-b", fromNodeId: "node-a", toNodeId: "node-b" }] } } });
});

test("PostgreSQL payment flow verifies trade identity and completes a refund", async ({ request }) => {
    test.skip(!process.env.DQ_E2E_DATABASE_URL, "需要专用 PostgreSQL E2E 数据库");
    const productResponse = await request.post("/api/admin/billing/products", {
        data: { productKind: "points", name: `E2E 积分包 ${randomUUID().slice(0, 8)}`, description: "E2E", amountCents: 100, currency: "CNY", pointsAmount: 100, enabled: true },
    });
    expect(productResponse.ok(), await productResponse.text()).toBe(true);
    const product = ((await productResponse.json()) as { product: { id: string } }).product;

    const firstOrder = await createOrder(request, product.id);
    const checkout = await request.post(`/api/billing/orders/${firstOrder.id}/checkout`, { data: { provider: "payply" } });
    expect(checkout.ok(), await checkout.text()).toBe(true);
    const webhookBody = JSON.stringify({ eventId: `event-${randomUUID()}`, status: "succeeded", orderId: firstOrder.id, orderNo: firstOrder.orderNo, providerTradeId: "payply_trade_e2e", providerPaymentId: "payply_payment_e2e" });
    const webhook = await postSignedWebhook(request, webhookBody);
    expect(webhook.ok(), await webhook.text()).toBe(true);
    expect(await webhook.json()).toMatchObject({ orderId: firstOrder.id, orderStatus: "paid" });
    const duplicate = await postSignedWebhook(request, webhookBody);
    expect(duplicate.ok(), await duplicate.text()).toBe(true);
    expect(await duplicate.json()).toMatchObject({ duplicate: true, orderId: firstOrder.id });

    const refund = await request.post(`/api/admin/billing/orders/${firstOrder.id}/refund`, { data: { reason: "E2E 退款" } });
    expect(refund.ok(), await refund.text()).toBe(true);
    expect(await refund.json()).toMatchObject({ order: { id: firstOrder.id, status: "refunded" }, providerRefund: { provider: "payply", status: "succeeded" } });
});

async function createOrder(request: APIRequestContext, productId: string) {
    const response = await request.post("/api/billing/orders", { data: { productId, quantity: 1, provider: "payply" } });
    expect(response.ok(), await response.text()).toBe(true);
    return ((await response.json()) as { order: { id: string; orderNo: string } }).order;
}

async function postSignedWebhook(request: APIRequestContext, rawBody: string) {
    const signature = createHmac("sha256", E2E_PAYMENT_WEBHOOK_SECRET).update(rawBody).digest("hex");
    return request.post("/api/billing/webhooks/payply", { data: rawBody, headers: { "content-type": "application/json", "x-dq-signature": signature } });
}

async function emptyCreativeHistory(page: import("@playwright/test").Page) {
    await page.route("**/api/creative/conversations**", async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() === "GET" && url.pathname === "/api/creative/conversations") {
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { conversations: [], hasMore: false }, msg: "OK" }) });
            return;
        }
        await route.fallback();
    });
}
