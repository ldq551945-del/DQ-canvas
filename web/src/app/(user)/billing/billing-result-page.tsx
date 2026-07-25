"use client";

import { Button, Spin, Tag } from "antd";
import { ArrowLeft, CheckCircle2, Clock3, ReceiptText, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cancelBillingOrder, getBillingOrder, type BillingOrder } from "@/services/api/billing";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";

export function BillingResultPage({ mode, orderId }: { mode: "success" | "cancel"; orderId: string }) {
    const [order, setOrder] = useState<BillingOrder | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const setUser = useUserStore((state) => state.setUser);

    useEffect(() => {
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let attempts = 0;
        const refreshUser = async () => {
            const response = await fetch("/api/auth/session", { cache: "no-store" });
            const payload = (await response.json().catch(() => ({}))) as { user?: LocalUser | null };
            if (payload.user) setUser(payload.user);
        };
        const load = async () => {
            if (!orderId) {
                setError("支付结果缺少订单编号");
                setLoading(false);
                return;
            }
            try {
                const payload = mode === "cancel" ? await cancelBillingOrder(orderId) : await getBillingOrder(orderId);
                if (!active) return;
                setOrder(payload.order);
                setLoading(false);
                if (payload.order.status === "paid") {
                    await refreshUser();
                    return;
                }
                if (mode === "success" && payload.order.status === "pending" && attempts < 30) {
                    attempts += 1;
                    timer = setTimeout(load, 2000);
                }
            } catch (value) {
                if (!active) return;
                setError(value instanceof Error ? value.message : "支付结果加载失败");
                setLoading(false);
            }
        };
        void load();
        return () => {
            active = false;
            if (timer) clearTimeout(timer);
        };
    }, [mode, orderId, setUser]);

    const paid = order?.status === "paid";
    const canceled = mode === "cancel" || order?.status === "canceled";
    const Icon = paid ? CheckCircle2 : canceled ? XCircle : Clock3;

    return (
        <main className="profile-page-scroll h-full min-h-0 overflow-y-auto bg-[#fafbfc] px-2 py-2 text-stone-950 sm:px-6 sm:py-8 dark:bg-[#111316] dark:text-stone-100">
            <div className="mx-auto flex min-h-0 max-w-xl items-center justify-center sm:min-h-[calc(100dvh-8rem)]">
                <section className="w-full rounded-xl border border-stone-200 bg-white p-3 text-center shadow-sm shadow-stone-200/60 sm:rounded-2xl sm:p-8 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/25">
                    {loading ? (
                        <div className="py-2 sm:py-12">
                            <Spin />
                            <div className="mt-4 text-sm text-stone-500 dark:text-stone-400">正在确认支付结果…</div>
                        </div>
                    ) : (
                        <>
                            <span
                                className={`mx-auto grid size-12 place-items-center rounded-xl sm:size-16 sm:rounded-2xl ${paid ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300" : canceled ? "bg-rose-50 text-rose-600 dark:bg-rose-400/10 dark:text-rose-300" : "bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-300"}`}
                            >
                                <Icon className="size-6 sm:size-8" />
                            </span>
                            <h1 className="mt-3 text-xl font-semibold sm:mt-5 sm:text-2xl">{paid ? "支付成功" : canceled ? "支付已取消" : "支付结果确认中"}</h1>
                            <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
                                {error || (paid ? "套餐权益和积分已经更新。" : canceled ? "订单已取消，你可以重新选择套餐和支付方式。" : "支付回调可能稍有延迟，可前往订单记录继续查看状态。")}
                            </p>
                            {order ? (
                                <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3.5 text-left sm:mt-6 sm:p-4 dark:border-stone-800 dark:bg-stone-900/55">
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="text-stone-500 dark:text-stone-400">订单号</span>
                                        <span className="break-all font-mono text-xs">{order.orderNo}</span>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                                        <span className="text-stone-500 dark:text-stone-400">当前状态</span>
                                        <Tag color={paid ? "green" : canceled ? "default" : "gold"}>{paid ? "已支付" : canceled ? "已取消" : "待确认"}</Tag>
                                    </div>
                                </div>
                            ) : null}
                            <div className="mt-4 grid gap-2.5 sm:mt-6 sm:grid-cols-2 sm:gap-3">
                                <Link href="/billing" className="block">
                                    <Button block className="!h-10" icon={<ArrowLeft className="size-4" />}>
                                        返回充值中心
                                    </Button>
                                </Link>
                                <Link href="/profile?section=orders" className="block">
                                    <Button block type="primary" className="profile-primary-button !h-10" icon={<ReceiptText className="size-4" />}>
                                        查看订单记录
                                    </Button>
                                </Link>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </main>
    );
}
