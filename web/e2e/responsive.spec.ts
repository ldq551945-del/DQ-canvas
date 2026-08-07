import { expect, test } from "@playwright/test";

test("theme switching is keyboard operable, persistent, and reduced-motion safe", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
        if (!sessionStorage.getItem("dq:e2e-theme-reset")) {
            localStorage.removeItem("dq:theme_store");
            sessionStorage.setItem("dq:e2e-theme-reset", "1");
        }
        let transitionCalls = 0;
        Object.defineProperty(window, "__dqThemeTransitionCalls", { configurable: true, get: () => transitionCalls });
        Object.defineProperty(document, "startViewTransition", {
            configurable: true,
            value: (callback: () => void) => {
                transitionCalls += 1;
                callback();
                return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished: Promise.resolve(), skipTransition: () => undefined };
            },
        });
    });

    await page.goto("/create", { waitUntil: "domcontentloaded" });
    const toggle = page.getByRole("button", { name: "切换到深色主题" });
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await page.evaluate(() => Reflect.get(window, "__dqThemeTransitionCalls"))).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("dq:theme_store"))).toContain('"theme":"dark"');

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    const lightToggle = page.getByRole("button", { name: "切换到浅色主题" });
    await lightToggle.focus();
    await page.keyboard.press("Space");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("mobile navigation exposes touch targets and restores keyboard focus", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("mobile-"), "mobile viewport only");
    await page.goto("/create", { waitUntil: "domcontentloaded" });

    const trigger = page.getByRole("button", { name: "打开导航菜单" });
    const triggerBounds = await trigger.boundingBox();
    expect(triggerBounds).not.toBeNull();
    expect(triggerBounds!.width).toBeGreaterThanOrEqual(40);
    expect(triggerBounds!.height).toBeGreaterThanOrEqual(40);
    await trigger.focus();
    await page.keyboard.press("Enter");

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect.poll(() => drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    const firstNavigationLink = drawer.getByRole("link").filter({ hasText: "创作" }).first();
    const linkBounds = await firstNavigationLink.boundingBox();
    expect(linkBounds).not.toBeNull();
    expect(linkBounds!.height).toBeGreaterThanOrEqual(44);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
});

test("workbench prompt exposes keyboard editing semantics", async ({ page }) => {
    await page.goto("/image", { waitUntil: "domcontentloaded" });
    const prompt = page.getByRole("textbox", { name: "创作提示词" });
    await expect(prompt).toHaveAttribute("aria-keyshortcuts", "Enter, Shift+Enter");
    await prompt.fill("第一行");
    await prompt.press("Shift+Enter");
    await prompt.type("第二行");
    await expect(prompt).toHaveValue("第一行\n第二行");
});

test("Canvas settings popover closes with Escape and returns focus", async ({ page, request }) => {
    const created = await request.post("/api/canvas/projects", {
        data: {
            title: `E2E keyboard canvas ${Date.now()}`,
            project: {
                nodes: [{ id: "config-a11y", type: "config", title: "生成配置", position: { x: 120, y: 80 }, width: 360, height: 360, metadata: { generationMode: "image", quality: "auto", size: "auto", count: 1 } }],
                connections: [],
            },
        },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const project = ((await created.json()) as { data: { project: { id: string } } }).data.project;

    await page.goto(`/canvas/${project.id}`, { waitUntil: "domcontentloaded" });
    const trigger = page.getByRole("button", { name: /1 张/ }).first();
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: /1 张/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
});

test("creative workspaces fit desktop and mobile viewports in both themes", async ({ page, request }) => {
    const created = await request.post("/api/drama/projects", { data: { title: "E2E 短剧项目", ratio: "9:16" } });
    expect(created.ok(), await created.text()).toBe(true);
    const project = ((await created.json()) as { data: { project: { id: string } } }).data.project;
    const routes = ["/create", "/image", "/video", "/canvas", "/assets", "/gallery", "/community", "/me", "/works", `/drama/${project.id}`];

    for (const route of routes) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page.locator("body")).toBeVisible();
        await expectNoHorizontalOverflow(page, route);
    }

    await page.addInitScript(() => {
        localStorage.setItem("dq:theme_store", JSON.stringify({ state: { theme: "dark" }, version: 0 }));
    });
    await page.goto("/create", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expectNoHorizontalOverflow(page, "/create dark");
});

test("Canvas confirmation dialog stays within a mobile viewport", async ({ page, request }) => {
    const title = `E2E responsive canvas ${Date.now()}`;
    const created = await request.post("/api/canvas/projects", { data: { title, project: { nodes: [], connections: [] } } });
    expect(created.ok(), await created.text()).toBe(true);

    await page.goto("/canvas", { waitUntil: "domcontentloaded" });
    const card = page.locator("article").filter({ hasText: title });
    await expect(card).toBeVisible();
    await card.getByLabel("删除", { exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "删除画布" });
    await expect(dialog).toBeVisible();
    await expectDialogWithinViewport(dialog);
    await expect(dialog.locator("button").last()).toBeVisible();
    await expectNoHorizontalOverflow(page, "Canvas delete dialog");
    await dialog.locator(".ant-modal-footer button").first().click();
});

test("workbench history and settings popovers stay usable on mobile", async ({ page }) => {
    for (const route of ["/image", "/video"]) {
        await page.goto(route, { waitUntil: "domcontentloaded" });

        const historyButton = page.locator('button[aria-label="生成记录"]').first();
        await expect(historyButton).toBeVisible();
        await historyButton.click();
        const historyPopover = page.locator(".ant-popover:visible").last();
        await expect(historyPopover).toBeVisible();
        await expectPopoverWithinViewport(historyPopover, `${route} history`);
        await expectNoHorizontalOverflow(page, `${route} history`);
        await page.keyboard.press("Escape");
        await expect(historyPopover).toBeHidden();

        const settingsButton = page.locator('button[aria-label^="打开生成参数"]').first();
        await expect(settingsButton).toBeVisible();
        await settingsButton.click();
        const settingsPopover = page.locator(".ant-popover:visible").last();
        await expect(settingsPopover).toBeVisible();
        await expectPopoverWithinViewport(settingsPopover, `${route} settings`);
        await expectNoHorizontalOverflow(page, `${route} settings`);
        await page.keyboard.press("Escape");
    }
});

test("Canvas auto performance mode falls back on low-power devices and remains overridable", async ({ page, request }) => {
    const created = await request.post("/api/canvas/projects", { data: { title: `E2E low-power canvas ${Date.now()}`, project: { nodes: [], connections: [] } } });
    expect(created.ok(), await created.text()).toBe(true);
    const project = ((await created.json()) as { data: { project: { id: string } } }).data.project;
    await page.addInitScript(() => Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 2 }));

    await page.goto(`/canvas/${project.id}`, { waitUntil: "domcontentloaded" });
    const surface = page.locator(".canvas-surface");
    await expect(surface).toHaveAttribute("data-performance-mode", "auto");
    await expect(surface).toHaveClass(/canvas-performance-mode/);

    const performanceTrigger = page.locator("[data-canvas-performance-trigger]");
    await performanceTrigger.click();
    await page.locator(".ant-dropdown:visible").getByText("画质优先", { exact: true }).click();
    await expect(surface).toHaveAttribute("data-performance-mode", "quality");
    await expect(surface).not.toHaveClass(/canvas-performance-mode/);

    await performanceTrigger.click();
    await page.locator(".ant-dropdown:visible").getByText("性能优先", { exact: true }).click();
    await expect(surface).toHaveAttribute("data-performance-mode", "performance");
    await expect(surface).toHaveClass(/canvas-performance-mode/);
});

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page, label: string) {
    await expect.poll(async () => page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))).toMatchObject({ clientWidth: expect.any(Number), scrollWidth: expect.any(Number) });
    const sizes = await page.evaluate(() => ({ document: [document.documentElement.clientWidth, document.documentElement.scrollWidth], body: [document.body.clientWidth, document.body.scrollWidth] }));
    expect(sizes.document[1], `${label} document overflow`).toBeLessThanOrEqual(sizes.document[0] + 1);
    expect(sizes.body[1], `${label} body overflow`).toBeLessThanOrEqual(sizes.body[0] + 1);

    const controls = await page.locator("main, [role='main'], button, [role='button'], input, textarea, .ant-card").evaluateAll((nodes) =>
        nodes
            .map((node) => {
                const element = node as HTMLElement;
                const bounds = element.getBoundingClientRect();
                return { visible: bounds.width > 0 && bounds.height > 0, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
            })
            .filter((item) => item.visible),
    );
    for (const control of controls) expect(control.scrollWidth, `${label} control overflow`).toBeLessThanOrEqual(control.clientWidth + 1);
}

async function expectDialogWithinViewport(dialog: import("@playwright/test").Locator) {
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    const viewport = dialog.page().viewportSize();
    expect(viewport).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width + 1);
}

async function expectPopoverWithinViewport(popover: import("@playwright/test").Locator, label: string) {
    await expect(popover).not.toHaveClass(/ant-zoom-big-(?:appear|enter)/);
    const content = popover.locator(".ant-popover-content");
    await expect(content).toBeVisible();
    const bounds = await content.boundingBox();
    expect(bounds, `${label} popover is visible`).not.toBeNull();
    const viewport = popover.page().viewportSize();
    expect(viewport).not.toBeNull();
    expect(bounds!.x, `${label} popover left`).toBeGreaterThanOrEqual(-1);
    expect(bounds!.y, `${label} popover top`).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width, `${label} popover right`).toBeLessThanOrEqual(viewport!.width + 1);
    expect(bounds!.y + bounds!.height, `${label} popover bottom`).toBeLessThanOrEqual(viewport!.height + 1);
}
