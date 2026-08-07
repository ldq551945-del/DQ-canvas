import { describe, expect, it } from "vitest";

import { resolveBillingResultPresentation } from "./billing-result-state";

describe("billing result presentation", () => {
    it.each([
        ["paid", "支付成功", "已支付"],
        ["closed", "支付未完成", "已关闭"],
        ["canceled", "支付已取消", "已取消"],
        ["refunding", "退款处理中", "退款中"],
        ["refunded", "退款已完成", "已退款"],
    ] as const)("maps %s to a distinct user-facing state", (status, title, statusLabel) => {
        expect(resolveBillingResultPresentation({ status })).toMatchObject({ phase: status, title, statusLabel });
    });

    it("distinguishes automatic confirmation, exhausted polling, and manual confirmation", () => {
        expect(resolveBillingResultPresentation({ status: "pending" }).title).toBe("正在确认支付结果");
        expect(resolveBillingResultPresentation({ status: "pending", pollingExhausted: true }).title).toBe("暂未确认到账");
        expect(resolveBillingResultPresentation({ status: "pending", manual: true }).title).toBe("等待人工确认");
    });

    it("does not turn a refresh error into a false order status", () => {
        expect(resolveBillingResultPresentation({ error: "网络错误" })).toMatchObject({ phase: "load_failed", title: "支付结果加载失败" });
        expect(resolveBillingResultPresentation({ status: "paid", error: "余额刷新失败" })).toMatchObject({ phase: "paid", title: "支付成功" });
    });
});
