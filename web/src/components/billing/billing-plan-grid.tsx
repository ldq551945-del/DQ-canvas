"use client";

import { Button } from "antd";
import { ArrowUpRight, Check } from "lucide-react";
import { useEffect, useState } from "react";

import { CreditSymbol, formatCreditAmount } from "@/constant/credits";
import type { BillingProduct } from "@/services/api/billing";

type BillingPlanGridProps = {
    products: BillingProduct[];
    onSelect: (product: BillingProduct) => void;
    variant?: "modal" | "page";
};

export function BillingPlanGrid({ products, onSelect, variant = "page" }: BillingPlanGridProps) {
    const recommendedId = products.find((product) => productMetadata(product).recommended)?.id || products[Math.min(1, products.length - 1)]?.id;
    const [activeProductId, setActiveProductId] = useState(recommendedId);

    useEffect(() => {
        if (!products.some((product) => product.id === activeProductId)) setActiveProductId(recommendedId);
    }, [activeProductId, products, recommendedId]);

    const activeProduct = products.find((product) => product.id === activeProductId) || products[0];
    const activeProductIndex = Math.max(
        0,
        products.findIndex((product) => product.id === activeProduct?.id),
    );
    return (
        <>
            <div className="mb-2 sm:hidden">
                <div className="mb-2 flex items-center justify-between px-1 text-xs">
                    <span className="font-medium text-stone-500 dark:text-stone-400">选择方案</span>
                    <span className="tabular-nums text-stone-400 dark:text-stone-500">
                        {products.length ? activeProductIndex + 1 : 0} / {products.length}
                    </span>
                </div>
                <div className="-mx-1 px-1 pb-1">
                    <div className={`grid gap-1.5 ${products.length === 1 ? "grid-cols-1" : "grid-cols-2"}`} role="tablist" aria-label="套餐选择">
                        {products.map((product) => {
                            const selected = product.id === activeProduct?.id;
                            return (
                                <button
                                    key={product.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={selected}
                                    className={`relative min-w-0 overflow-hidden rounded-lg border px-2 py-1.5 text-left transition ${
                                        selected
                                            ? "border-[#aebdce] bg-[#e9eef5] text-[#263141] shadow-[0_5px_16px_rgba(71,85,105,0.09)] dark:border-[#536173] dark:bg-[#252d37] dark:text-white"
                                            : "border-stone-200 bg-stone-50 text-stone-600 hover:border-[#cbd4df] hover:bg-white dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-300 dark:hover:border-[#3d4856] dark:hover:bg-[#1f252c]"
                                    }`}
                                    onClick={(event) => {
                                        setActiveProductId(product.id);
                                        event.currentTarget.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
                                    }}
                                >
                                    <span className="block truncate text-sm font-semibold">{product.name}</span>
                                    <span className={`mt-1 block truncate text-xs ${selected ? "font-medium text-[#52627a] dark:text-[#d8dee8]" : "text-stone-400 dark:text-stone-500"}`}>¥ {formatYuan(product.amountCents)}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="sm:hidden">
                {activeProduct ? <PlanCard product={activeProduct} index={products.findIndex((item) => item.id === activeProduct.id)} recommended={activeProduct.id === recommendedId} variant={variant} onSelect={onSelect} /> : null}
            </div>

            <div className={`hidden sm:grid ${gridClass(products.length)}`}>
                {products.map((product, index) => {
                    return <PlanCard key={product.id} product={product} index={index} recommended={product.id === recommendedId} variant={variant} onSelect={onSelect} />;
                })}
            </div>
        </>
    );
}

function PlanCard({ product, index, recommended, variant, onSelect }: { product: BillingProduct; index: number; recommended: boolean; variant: "modal" | "page"; onSelect: (product: BillingProduct) => void }) {
    const metadata = productMetadata(product);
    const isPointsProduct = product.productKind === "points";
    const features = featureLines(product, metadata.features).slice(0, variant === "modal" ? 3 : 4);
    return (
        <article
            className={`relative overflow-hidden rounded-lg border bg-white p-1.5 text-stone-950 shadow-[0_8px_24px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(15,23,42,0.10)] sm:rounded-[1.4rem] sm:p-6 dark:bg-stone-950 dark:text-white dark:shadow-black/25 ${
                recommended ? "border-[#9aa7ba] ring-1 ring-[#9aa7ba]/45 dark:border-[#74839a] dark:ring-[#74839a]/45" : "border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
            }`}
        >
            <div className="pointer-events-none absolute -right-16 -top-20 size-48 rounded-full bg-[#66758e]/10 blur-3xl dark:bg-[#66758e]/12" />
            <div className="relative flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold tracking-[0.14em] text-stone-400 sm:text-[11px] sm:tracking-[0.16em] dark:text-stone-500">VOZEB PASS · {String(index + 1).padStart(2, "0")}</span>
                {recommended ? (
                    <span className="rounded-full border border-[#cfd7e3] bg-[#eef2f7] px-2 py-0.5 text-[10px] font-semibold text-[#52627a] sm:px-3 sm:py-1 sm:text-[11px] dark:border-[#52627a]/60 dark:bg-[#66758e]/15 dark:text-[#d8dee8]">推荐方案</span>
                ) : metadata.highlight ? (
                    <span className="rounded-full border border-stone-200 px-3 py-1 text-[11px] font-medium text-stone-500 dark:border-stone-700 dark:text-stone-400">{metadata.highlight}</span>
                ) : null}
            </div>

            <div className="relative mt-1 sm:mt-5">
                <h3 className="text-base font-semibold tracking-tight sm:text-[1.7rem]">{product.name}</h3>
                <p className="mt-2 hidden line-clamp-2 text-sm leading-6 text-stone-500 sm:block dark:text-stone-400">{product.description || "适合持续完成多媒体创作与商业项目交付。"}</p>
            </div>

            <div className="relative mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-t border-stone-200 pt-1 sm:mt-5 sm:gap-4 sm:pb-2 sm:pt-5 dark:border-stone-800">
                <div className="flex items-end gap-1">
                    <span className="pb-1 text-sm font-medium">¥</span>
                    <span className="text-lg font-semibold leading-none tracking-[-0.045em] sm:text-[2.65rem]">{formatYuan(product.amountCents)}</span>
                    <span className="pb-1 text-sm text-stone-500 dark:text-stone-400">/ {isPointsProduct ? "一次性" : periodLabel(product.periodDays)}</span>
                </div>
                <Button type="primary" size="small" className="profile-primary-button !h-7 !rounded-lg px-1.5 text-xs sm:!h-10 sm:min-w-36 sm:!rounded-xl" onClick={() => onSelect(product)}>
                    <span className="inline-flex items-center gap-2">
                        {isPointsProduct ? "立即充值" : "购买套餐"} <ArrowUpRight className="size-4" />
                    </span>
                </Button>
            </div>

            <ul className="relative mt-1 space-y-0.5 border-t border-stone-200 pt-1 sm:mt-5 sm:space-y-2.5 sm:pt-5 dark:border-stone-800">
                <li className="flex gap-2 text-xs leading-5 text-stone-600 dark:text-stone-300 sm:gap-2.5 sm:text-sm">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-[#eef2f7] text-[#66758e] dark:bg-[#66758e]/15 dark:text-[#d8dee8]">
                        <CreditSymbol className="text-[10px]" />
                    </span>
                    <span>
                        <strong className="font-semibold text-stone-950 dark:text-white">{formatCreditAmount(product.pointsAmount)}</strong> {isPointsProduct ? "永久积分" : "创作积分"}
                    </span>
                </li>
                {features.map((line) => (
                    <li key={line} className="hidden gap-2.5 text-sm leading-5 text-stone-600 sm:flex dark:text-stone-300">
                        <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-[#eef2f7] text-[#66758e] dark:bg-[#66758e]/15 dark:text-[#d8dee8]">
                            <Check className="size-3" />
                        </span>
                        <span>{line}</span>
                    </li>
                ))}
            </ul>
        </article>
    );
}

function gridClass(count: number) {
    if (count === 1) return "mx-auto grid max-w-lg items-start gap-5";
    if (count === 2) return "mx-auto grid w-full max-w-[920px] items-start gap-5 md:grid-cols-2";
    if (count === 3) return "mx-auto grid w-full max-w-6xl items-start gap-5 md:grid-cols-2 xl:grid-cols-3";
    return "grid w-full items-start gap-5 md:grid-cols-2 xl:grid-cols-4";
}

function productMetadata(product: BillingProduct) {
    const metadata = product.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata) ? (product.metadata as Record<string, unknown>) : {};
    const features = Array.isArray(metadata.features) ? metadata.features.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 6) : [];
    return {
        recommended: metadata.recommended === true,
        highlight: typeof metadata.highlight === "string" ? metadata.highlight.trim().slice(0, 24) : "",
        features,
    };
}

function featureLines(product: BillingProduct, configured: string[]) {
    if (configured.length) return configured;
    if (product.productKind === "points") return ["支付成功后一次性到账", "永久积分不会按日过期", "订单与积分流水可查"];
    return ["图片、视频、音频与 Agent 创作", "适用于个人创作与商业项目交付", "订单、套餐和积分流水统一管理", product.periodDays ? `${product.periodDays} 天完整套餐权益` : "长期有效套餐权益"];
}

function periodLabel(periodDays: number) {
    if (!periodDays) return "长期";
    if (periodDays === 30) return "月";
    if (periodDays === 365) return "年";
    return `${periodDays} 天`;
}

function formatYuan(amountCents: number) {
    return (Math.max(0, amountCents) / 100).toLocaleString("zh-CN", { minimumFractionDigits: amountCents % 100 ? 2 : 0, maximumFractionDigits: 2 });
}
