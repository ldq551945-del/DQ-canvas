import type { BillingOrderStatus } from "@/services/api/billing";

export type BillingResultPhase = BillingOrderStatus | "loading" | "load_failed";
export type BillingResultTone = "neutral" | "success" | "warning" | "danger" | "info";

export type BillingResultPresentation = {
    phase: BillingResultPhase;
    title: string;
    description: string;
    statusLabel: string;
    tagColor: "default" | "green" | "gold" | "red" | "orange" | "blue";
    tone: BillingResultTone;
    polling: boolean;
};

export function resolveBillingResultPresentation(input: { status?: BillingOrderStatus; error?: string; manual?: boolean; pollingExhausted?: boolean }): BillingResultPresentation {
    if (input.error && !input.status) {
        return presentation("load_failed", "支付结果加载失败", "暂时无法取得订单状态，请重新查询。", "加载失败", "red", "danger");
    }
    if (!input.status) return presentation("loading", "正在查询订单", "正在取得最新支付状态。", "查询中", "default", "neutral", true);
    if (input.status === "paid") return presentation("paid", "支付成功", "套餐权益和积分已经更新，可以继续创作。", "已支付", "green", "success");
    if (input.status === "closed") return presentation("closed", "支付未完成", "订单已关闭或已过期，没有开通权益。你可以重新发起购买。", "已关闭", "red", "danger");
    if (input.status === "canceled") return presentation("canceled", "支付已取消", "订单已取消，没有产生新的套餐权益或积分。", "已取消", "default", "neutral");
    if (input.status === "refunding") return presentation("refunding", "退款处理中", "退款请求已受理，完成前无需重复提交。", "退款中", "orange", "warning", true);
    if (input.status === "refunded") return presentation("refunded", "退款已完成", "订单已退款，相关套餐权益和积分已同步撤销。", "已退款", "blue", "info");
    if (input.manual) return presentation("pending", "等待人工确认", "订单正在等待管理员核对收款，确认后权益会自动开通。", "待确认", "gold", "warning", true);
    if (input.pollingExhausted) return presentation("pending", "暂未确认到账", "支付结果仍未同步，订单会继续保留，可稍后重新查询。", "待支付", "gold", "warning");
    return presentation("pending", "正在确认支付结果", "支付回调可能稍有延迟，页面会自动查询最新状态。", "确认中", "gold", "warning", true);
}

function presentation(phase: BillingResultPhase, title: string, description: string, statusLabel: string, tagColor: BillingResultPresentation["tagColor"], tone: BillingResultTone, polling = false): BillingResultPresentation {
    return { phase, title, description, statusLabel, tagColor, tone, polling };
}
