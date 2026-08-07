import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

import { E2E_ADMIN } from "./support";

const PUBLIC_WORK_COUNT = 19;
const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test.describe("public gallery and creator profile", () => {
    test.skip(!process.env.DQ_E2E_DATABASE_URL, "需要 DQ_E2E_DATABASE_URL 指向隔离的 PostgreSQL 测试库");

    test("publishes reviewed works and renders paginated mobile galleries", async ({ page, request }) => {
        const seed = await seedPublicWorks(request);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/gallery?sort=latest&keyword=${encodeURIComponent(seed.prefix)}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { name: "灵感发现" })).toBeVisible();
        await expect(page.getByRole("button", { name: `查看作品：${seed.titles.at(-1)}` })).toBeVisible();
        await expect(page.getByRole("button", { name: /^查看作品：/ })).toHaveCount(12);
        await expectLoadedImage(page, seed.titles.at(-1)!);
        await expectNoHorizontalOverflow(page, "390px gallery");

        await page
            .getByRole("button", { name: `查看 ${E2E_ADMIN.displayName} 的主页` })
            .first()
            .click();
        await expect(page.getByRole("heading", { name: E2E_ADMIN.displayName, exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "加载更多" })).toBeVisible();
        await page.getByRole("button", { name: "加载更多" }).click();
        await expect(page.getByRole("button", { name: `查看作品：${seed.titles[0]}` })).toBeVisible();
        await expectNoHorizontalOverflow(page, "390px creator modal");
        await page.locator(".ant-modal-close").click();

        await page.getByRole("link", { name: "查看更多" }).click();
        await expect(page).toHaveURL(/cursor=/);
        await expect(page.getByRole("button", { name: /^查看作品：/ })).toHaveCount(PUBLIC_WORK_COUNT - 12);
        await expect(page.getByRole("button", { name: `查看作品：${seed.titles[0]}` })).toBeVisible();
        await expectNoHorizontalOverflow(page, "390px gallery next page");

        await page.setViewportSize({ width: 430, height: 932 });
        await page.goto(`/u/${encodeURIComponent(E2E_ADMIN.username)}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { name: E2E_ADMIN.displayName, exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: /^查看作品：/ })).toHaveCount(18);
        await page.getByRole("button", { name: "加载更多" }).click();
        await expect(page.getByRole("button", { name: /^查看作品：/ })).toHaveCount(PUBLIC_WORK_COUNT);
        await expect(page.getByRole("button", { name: `查看作品：${seed.titles[0]}` })).toBeVisible();
        await expectNoHorizontalOverflow(page, "430px creator page");
    });
});

async function seedPublicWorks(request: APIRequestContext) {
    const prefix = `E2E公开作品-${randomUUID().slice(0, 8)}`;
    const uploadedResponse = await request.post("/api/reference-assets", {
        data: { dataUrl: ONE_PIXEL_PNG, type: "image", persistent: true, purpose: "canvas-image", originalName: `${prefix}.png` },
    });
    const uploaded = await responseJson<{ token: string; url: string; mimeType: string; bytes: number }>(uploadedResponse);

    const libraryAsset = await responseData<{ asset: { id: string } }>(
        request.post("/api/library-assets", {
            data: {
                kind: "image",
                title: `${prefix}-素材`,
                source: "e2e-gallery",
                metadata: { prompt: `${prefix} 的公开提示词` },
                data: {
                    storageKey: uploaded.token,
                    serverUrl: uploaded.url,
                    dataUrl: uploaded.url,
                    bytes: uploaded.bytes,
                    mimeType: uploaded.mimeType,
                    width: 1,
                    height: 1,
                },
            },
        }),
    );

    const titles: string[] = [];
    for (let index = 1; index <= PUBLIC_WORK_COUNT; index += 1) {
        const title = `${prefix}-${String(index).padStart(2, "0")}`;
        titles.push(title);
        const created = await responseData<{ work: { id: string; currentVersion: { id: string } } }>(
            request.post("/api/works", {
                data: {
                    sourceType: "media",
                    sourceId: libraryAsset.asset.id,
                    title,
                    description: "用于验证作品广场和创作者主页真实分页。",
                    publicPrompt: `${prefix} 的公开提示词 ${index}`,
                    category: "其他",
                    tags: [prefix],
                    visibility: "public",
                    authorDisplay: "profile",
                    coverStorageKey: uploaded.token,
                    assetStorageKeys: [uploaded.token],
                },
            }),
        );
        await responseData(request.post(`/api/works/${encodeURIComponent(created.work.id)}/submit`));
        await responseData(
            request.post(`/api/admin/works/${encodeURIComponent(created.work.id)}/review`, {
                data: { versionId: created.work.currentVersion.id, decision: "approved" },
            }),
        );
    }
    return { prefix, titles };
}

async function responseData<T = unknown>(responsePromise: Promise<APIResponse>) {
    const response = await responsePromise;
    const payload = await responseJson<{ code: number; data: T; msg?: string }>(response);
    expect(payload.code, payload.msg || "API response code").toBe(0);
    return payload.data;
}

async function responseJson<T>(response: APIResponse) {
    const body = await response.text();
    expect(response.ok(), body).toBe(true);
    return JSON.parse(body) as T;
}

async function expectLoadedImage(page: Page, title: string) {
    const image = page.getByRole("img", { name: title });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    expect(overflow, `${label} horizontal overflow`).toBeLessThanOrEqual(1);
}
