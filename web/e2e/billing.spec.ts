import { expect, test, type Page, type Route } from "@playwright/test";

const product = {
    id: "product-e2e-billing",
    productKind: "points" as const,
    name: "浏览器回归积分包",
    description: "用于验证结算状态",
    amountCents: 990,
    currency: "CNY",
    pointsAmount: 1_000,
    dailyPoints: 0,
    periodDays: 0,
    enabled: true,
    sortOrder: 1,
    pricing: { listUnitAmountCents: 990, saleUnitAmountCents: 990, discountCents: 0 },
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
};

test("checkout creates one order and reaches the waiting-for-payment state", async ({ page }) => {
    let orderCreates = 0;
    await page.route("**/api/billing/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/billing/products") return fulfill(route, { products: [product], paymentProviders: ["payply"] });
        if (url.pathname === "/api/billing/coupons") return fulfill(route, { code: 0, data: { coupons: [], templates: [], total: 0, page: 1, pageSize: 50 }, msg: "ok" });
        if (url.pathname === "/api/billing/quotes") {
            return fulfill(route, {
                code: 0,
                data: {
                    quote: {
                        productId: product.id,
                        quantity: 1,
                        listAmountCents: 990,
                        promotionDiscountCents: 0,
                        couponDiscountCents: 0,
                        payableAmountCents: 990,
                        pricingSnapshot: {},
                    },
                },
                msg: "ok",
            });
        }
        if (url.pathname === "/api/billing/orders" && route.request().method() === "POST") {
            orderCreates += 1;
            return fulfill(route, { order: billingOrder("pending", "payply") });
        }
        if (url.pathname === "/api/billing/orders/order-e2e-billing/checkout") {
            return fulfill(route, {
                checkout: {
                    provider: "payply",
                    orderId: "order-e2e-billing",
                    orderNo: "DQ-E2E-BILLING",
                    kind: "redirect",
                    url: "https://payments.example.test/checkout",
                },
            });
        }
        await route.fallback();
    });

    await page.goto(`/billing/checkout?product=${product.id}`);
    const submit = page.getByRole("button", { name: "确认订单并继续支付" });
    await expect(submit).toBeEnabled();
    await submit.dblclick();
    await expect(page.getByRole("heading", { name: "等待支付" })).toBeVisible();
    await expect(page.getByText("订单号 DQ-E2E-BILLING")).toBeVisible();
    expect(orderCreates).toBe(1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});

const resultCases = [
    { status: "pending", title: "正在确认支付结果", label: "确认中", action: "立即查询" },
    { status: "paid", title: "支付成功", label: "已支付", action: "开始创作", viewport: { width: 430, height: 932 } },
    { status: "closed", title: "支付未完成", label: "已关闭", action: "重新购买" },
    { status: "canceled", title: "支付已取消", label: "已取消", action: "重新购买" },
    { status: "refunding", title: "退款处理中", label: "退款中", action: "刷新退款状态", viewport: { width: 390, height: 844 } },
    { status: "refunded", title: "退款已完成", label: "已退款", action: "重新购买" },
] as const;

for (const item of resultCases) {
    test(`payment result renders the ${item.status} state`, async ({ page }) => {
        if ("viewport" in item) await page.setViewportSize(item.viewport);
        await page.route("**/api/billing/orders/order-e2e-billing", (route) => fulfill(route, { order: billingOrder(item.status, "payply") }));
        await page.goto("/billing/success?orderId=order-e2e-billing");
        await expect(page.getByRole("heading", { name: item.title })).toBeVisible();
        await expect(page.getByText(item.label, { exact: true })).toBeVisible();
        await expect(page.getByRole(item.action === "开始创作" || item.action === "重新购买" ? "link" : "button", { name: item.action })).toBeVisible();
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });
}

test("payment cancel return calls the cancel endpoint before rendering", async ({ page }) => {
    const methods: string[] = [];
    await page.route("**/api/billing/orders/order-e2e-billing/cancel", (route) => {
        methods.push(route.request().method());
        return fulfill(route, { order: billingOrder("canceled", "payply") });
    });
    await page.goto("/billing/cancel?orderId=order-e2e-billing");
    await expect(page.getByRole("heading", { name: "支付已取消" })).toBeVisible();
    expect(methods).toEqual(["POST"]);
});

test("payment result offers recovery when the order cannot be loaded", async ({ page }) => {
    await page.route("**/api/billing/orders/order-e2e-billing", (route) => fulfill(route, { error: "支付服务暂时不可用" }, 503));
    await page.goto("/billing/success?orderId=order-e2e-billing");
    await expect(page.getByRole("heading", { name: "支付结果加载失败" })).toBeVisible();
    await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
});

function billingOrder(status: (typeof resultCases)[number]["status"], provider: string) {
    return {
        id: "order-e2e-billing",
        orderNo: "DQ-E2E-BILLING",
        productId: product.id,
        productKind: product.productKind,
        status,
        subject: product.name,
        listAmountCents: product.amountCents,
        promotionDiscountCents: 0,
        couponDiscountCents: 0,
        amountCents: product.amountCents,
        currency: product.currency,
        pointsAmount: product.pointsAmount,
        dailyPoints: 0,
        periodDays: 0,
        quantity: 1,
        provider,
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
    };
}

async function fulfill(route: Route, payload: unknown, status = 200) {
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

async function horizontalOverflow(page: Page) {
    return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
}
