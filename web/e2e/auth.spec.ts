import { expect, test } from "@playwright/test";

import { E2E_ADMIN } from "./support";

test.describe.configure({ mode: "serial" });

test("login shows server errors and returns to the requested page", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login?next=%2Fimage", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "登录 DQ-绘图" })).toBeVisible();

    await page.getByPlaceholder("输入用户名或已绑定邮箱").fill(E2E_ADMIN.username);
    await page.getByPlaceholder("请输入密码").fill("wrong-password");
    await page.getByRole("button", { name: "登录并继续" }).click();
    await expect(page.getByText("用户名或密码不正确", { exact: true })).toBeVisible();

    await page.getByPlaceholder("请输入密码").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "登录并继续" }).click();
    await expect(page).toHaveURL(/\/image(?:\?|$)/);
});

test("registration and password reset surface actionable validation errors", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/register", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "注册 DQ-绘图" })).toBeVisible();
    await page.getByPlaceholder("设置登录用户名").fill(E2E_ADMIN.username);
    await page.getByPlaceholder("至少 8 位").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "注册并开始创作" }).click();
    await expect(page.getByText("用户名已存在", { exact: true })).toBeVisible();

    await page.goto("/forgot-password", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("绑定邮箱").fill("unknown-account@example.test");
    await page.getByRole("button", { name: "获取验证码" }).click();
    await expect(page.getByText("验证码已发送，请查看邮箱", { exact: true })).toBeVisible();
    await page.getByPlaceholder("6 位验证码").fill("000000");
    await page.getByPlaceholder("新密码，至少 8 位").fill("new-password-123");
    await page.getByRole("button", { name: "重置密码" }).click();
    await expect(page.getByText("没有找到可用账号", { exact: true })).toBeVisible();
});

test("session expiration clears state and preserves the current path", async ({ page }) => {
    await page.goto("/image", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "账户菜单" })).toBeVisible();

    // Rotate this context onto a dedicated session so logging out does not
    // invalidate the shared storage-state session used by later test contexts.
    const login = await page.request.post("/api/auth/login", {
        data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password },
    });
    expect(login.ok()).toBe(true);
    const logout = await page.request.post("/api/auth/logout");
    expect(logout.ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));

    await expect(page).toHaveURL(/\/login\?next=%2Fimage(?:&|$)/);
    await expect(page.getByText("登录状态已失效，请重新登录", { exact: true })).toBeVisible();
});
