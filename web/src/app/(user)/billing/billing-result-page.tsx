"use client";

import { Button, Spin, Tag } from "antd";
import { ArrowLeft, BadgeCheck, CheckCircle2, CircleAlert, Clock3, ReceiptText, RefreshCw, Sparkles, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { throwIfClientSessionExpired } from "@/services/api/session-expiration";
import { cancelBillingOrder, getBillingOrder, type BillingOrder } from "@/services/api/billing";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";
import { resolveBillingResultPresentation, type BillingResultPhase, type BillingResultTone } from "./billing-result-state";

const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2_000;

export function BillingResultPage({ mode, orderId }: { mode: "success" | "cancel"; orderId: string }) {
    const [order, setOrder] = useState<BillingOrder | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const [pollingExhausted, setPollingExhausted] = useState(false);
    const [lastCheckedAt, setLastCheckedAt] = useState<number>();
    const [reloadKey, setReloadKey] = useState(0);
    const loadedOnce = useRef(false);
    const lastFocusRefreshAt = useRef(0);
    const setUser = useUserStore((state) => state.setUser);

    useEffect(() => {
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let attempts = 0;
        const background = loadedOnce.current;

        if (!orderId) {
            setError("支付结果缺少订单编号");
            setLoading(false);
            loadedOnce.current = true;
            return;
        }

        if (background) setRefreshing(true);
        else setLoading(true);
        setError("");
        setPollingExhausted(false);

        const syncUser = async () => {
            const response = await fetch("/api/auth/session", { cache: "no-store" });
            throwIfClientSessionExpired(response);
            if (!response.ok) return;
            const payload = (await response.json().catch(() => ({}))) as { user?: LocalUser | null };
            if (payload.user && active) setUser(payload.user);
        };

        const load = async (cancelPendingOrder = false) => {
            let cancelError = "";
            try {
                let payload: { order: BillingOrder };
                if (cancelPendingOrder) {
                    try {
                        payload = await cancelBillingOrder(orderId);
                    } catch (value) {
                        cancelError = value instanceof Error ? value.message : "取消订单失败";
                        payload = await getBillingOrder(orderId);
                    }
                } else {
                    payload = await getBillingOrder(orderId);
                }
                if (!active) return;
                setOrder(payload.order);
                setError(cancelError);
                setLastCheckedAt(Date.now());
                setLoading(false);
                setRefreshing(false);
                loadedOnce.current = true;

                if (payload.order.status === "paid") {
                    void syncUser().catch(() => undefined);
                    return;
                }
                if (mode !== "success" || payload.order.status !== "pending") return;
                if (attempts >= MAX_POLL_ATTEMPTS) {
                    setPollingExhausted(true);
                    return;
                }
                attempts += 1;
                timer = setTimeout(() => void load(), POLL_INTERVAL_MS);
            } catch (value) {
                if (!active) return;
                setError(value instanceof Error ? value.message : "支付结果加载失败");
                setLoading(false);
                setRefreshing(false);
                loadedOnce.current = true;
            }
        };

        void load(mode === "cancel" && reloadKey === 0);
        return () => {
            active = false;
            if (timer) clearTimeout(timer);
        };
    }, [mode, orderId, reloadKey, setUser]);

    useEffect(() => {
        const refreshAfterReturn = () => {
            if (document.visibilityState === "hidden" || Date.now() - lastFocusRefreshAt.current < 1_000) return;
            lastFocusRefreshAt.current = Date.now();
            setReloadKey((current) => current + 1);
        };
        window.addEventListener("focus", refreshAfterReturn);
        document.addEventListener("visibilitychange", refreshAfterReturn);
        return () => {
            window.removeEventListener("focus", refreshAfterReturn);
            document.removeEventListener("visibilitychange", refreshAfterReturn);
        };
    }, []);

    const presentation = resolveBillingResultPresentation({ status: order?.status, error, manual: order?.provider === "manual", pollingExhausted });
    const Icon = resultIcon(presentation.phase);
    const primaryAction = resultPrimaryAction(presentation.phase, order);

    return (
        <main className="profile-page-scroll h-full min-h-0 overflow-y-auto bg-[#fafbfc] px-2 py-2 text-stone-950 sm:px-6 sm:py-8 dark:bg-[#111316] dark:text-stone-100">
            <div className="mx-auto flex min-h-0 max-w-xl items-center justify-center sm:min-h-[calc(100dvh-8rem)]">
                <section className="w-full rounded-xl border border-stone-200 bg-white p-3 text-center shadow-sm shadow-stone-200/60 sm:rounded-2xl sm:p-8 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/25" aria-live="polite">
                    {loading ? (
                        <div className="py-8 sm:py-12">
                            <Spin />
                            <div className="mt-4 text-sm text-stone-500 dark:text-stone-400">正在取得最新订单状态...</div>
                        </div>
                    ) : (
                        <>
                            <span className={`mx-auto grid size-12 place-items-center rounded-xl sm:size-16 sm:rounded-2xl ${toneClassName(presentation.tone)}`}>
                                <Icon className={`size-6 sm:size-8 ${presentation.polling && !pollingExhausted ? "animate-pulse" : ""}`} />
                            </span>
                            <h1 className="mt-3 text-xl font-semibold sm:mt-5 sm:text-2xl">{presentation.title}</h1>
                            <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{presentation.description}</p>
                            {error && order ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs leading-5 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">{error}</div> : null}
                            {order ? <OrderSummary order={order} statusLabel={presentation.statusLabel} tagColor={presentation.tagColor} lastCheckedAt={lastCheckedAt} /> : null}
                            <div className="mt-4 grid gap-2.5 sm:mt-6 sm:grid-cols-2 sm:gap-3">
                                {primaryAction.kind === "refresh" ? (
                                    <Button block className="!h-10" icon={<RefreshCw className="size-4" />} loading={refreshing} onClick={() => setReloadKey((current) => current + 1)}>
                                        {primaryAction.label}
                                    </Button>
                                ) : (
                                    <Link href={primaryAction.href} className="block">
                                        <Button block className="!h-10" icon={primaryAction.phase === "paid" ? <Sparkles className="size-4" /> : <ArrowLeft className="size-4" />}>
                                            {primaryAction.label}
                                        </Button>
                                    </Link>
                                )}
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

function OrderSummary({ order, statusLabel, tagColor, lastCheckedAt }: { order: BillingOrder; statusLabel: string; tagColor: "default" | "green" | "gold" | "red" | "orange" | "blue"; lastCheckedAt?: number }) {
    return (
        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3.5 text-left sm:mt-6 sm:p-4 dark:border-stone-800 dark:bg-stone-900/55">
            <ResultRow label="订单" value={order.subject} />
            <ResultRow label="订单号" value={order.orderNo} mono />
            <ResultRow label="金额" value={formatMoney(order.amountCents, order.currency)} />
            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                <span className="text-stone-500 dark:text-stone-400">当前状态</span>
                <Tag className="m-0" color={tagColor}>
                    {statusLabel}
                </Tag>
            </div>
            {lastCheckedAt ? <div className="mt-3 border-t border-stone-200 pt-3 text-right text-[11px] text-stone-400 dark:border-stone-800 dark:text-stone-500">更新于 {new Date(lastCheckedAt).toLocaleTimeString("zh-CN", { hour12: false })}</div> : null}
        </div>
    );
}

function ResultRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="mt-3 flex items-start justify-between gap-3 text-sm first:mt-0">
            <span className="shrink-0 text-stone-500 dark:text-stone-400">{label}</span>
            <span className={`min-w-0 break-words text-right ${mono ? "font-mono text-xs" : "font-medium"}`}>{value}</span>
        </div>
    );
}

function resultIcon(phase: BillingResultPhase) {
    if (phase === "paid") return CheckCircle2;
    if (phase === "refunded") return BadgeCheck;
    if (phase === "refunding") return RefreshCw;
    if (phase === "closed" || phase === "canceled") return XCircle;
    if (phase === "load_failed") return CircleAlert;
    return Clock3;
}

function toneClassName(tone: BillingResultTone) {
    if (tone === "success") return "bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300";
    if (tone === "danger") return "bg-rose-50 text-rose-600 dark:bg-rose-400/10 dark:text-rose-300";
    if (tone === "warning") return "bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-300";
    if (tone === "info") return "bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300";
    return "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300";
}

function resultPrimaryAction(phase: BillingResultPhase, order: BillingOrder | null) {
    if (phase === "pending") return { kind: "refresh" as const, label: order?.provider === "manual" ? "刷新确认状态" : "立即查询" };
    if (phase === "refunding" || phase === "load_failed") return { kind: "refresh" as const, label: phase === "refunding" ? "刷新退款状态" : "重新加载" };
    if (phase === "paid") return { kind: "link" as const, label: "开始创作", href: "/create", phase };
    const href = order?.productId ? `/billing/checkout?product=${encodeURIComponent(order.productId)}` : "/profile?section=billing";
    return { kind: "link" as const, label: order?.productId ? "重新购买" : "返回套餐中心", href, phase };
}

function formatMoney(cents: number, currency: string) {
    const amount = (Math.max(0, Number(cents) || 0) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (currency === "CNY") return `¥${amount}`;
    if (currency === "USD") return `$${amount}`;
    return `${amount} ${currency}`;
}
