"use client";

import { App, Empty, Modal, Spin } from "antd";
import { BadgeCheck, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { BillingPlanGrid } from "@/components/billing/billing-plan-grid";
import { listBillingProducts, type BillingProduct } from "@/services/api/billing";

export function BillingPlansModal({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (product: BillingProduct) => void }) {
    const { message } = App.useApp();
    const [products, setProducts] = useState<BillingProduct[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open || products.length || loading) return;
        setLoading(true);
        void listBillingProducts()
            .then((payload) => setProducts(payload.products || []))
            .catch((error) => message.error(error instanceof Error ? error.message : "套餐加载失败"))
            .finally(() => setLoading(false));
    }, [loading, message, open, products.length]);

    return (
        <Modal
            rootClassName="billing-plans-modal profile-page-scroll"
            title={null}
            open={open}
            width="min(92vw, 980px)"
            centered
            footer={null}
            closable={false}
            onCancel={onClose}
            styles={{ body: { padding: 0, maxHeight: "calc(100dvh - 56px)", overflowY: "auto" } }}
        >
            <div className="bg-[#f7f7f5] text-stone-950 dark:bg-[#101113] dark:text-stone-100">
                <div className="relative overflow-hidden bg-stone-950 px-4 py-3 text-white sm:px-6 sm:py-4 dark:bg-black">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(102,117,142,0.42),transparent_34%),radial-gradient(circle_at_82%_0%,rgba(255,255,255,0.14),transparent_30%)]" />
                    <button
                        type="button"
                        className="absolute right-2.5 top-2.5 z-10 grid size-8 place-items-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20 sm:right-3 sm:top-3 sm:size-9"
                        aria-label="关闭套餐选择"
                        title="关闭"
                        onClick={onClose}
                    >
                        <X className="size-4" />
                    </button>
                    <div className="relative mx-auto flex max-w-[820px] items-center justify-between gap-4 pr-12">
                        <div className="flex items-start gap-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#d8dee8] text-[#252b33] sm:size-9 sm:rounded-xl">
                                <Sparkles className="size-4.5" />
                            </span>
                            <div>
                                <div className="text-sm font-semibold">升级创作套餐</div>
                                <div className="mt-0.5 hidden text-xs leading-5 text-stone-300 sm:block">按实际创作频率选择方案，价格与权益实时同步后台商品。</div>
                            </div>
                        </div>
                        <span className="hidden items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white sm:inline-flex">
                            <BadgeCheck className="size-4 text-[#d8dee8]" /> 支付成功自动到账
                        </span>
                    </div>
                </div>

                <div className="px-2 pb-2 pt-2 sm:px-6 sm:pb-6 sm:pt-5">
                    <div className="mx-auto max-w-[820px]">
                        <h2 className="text-lg font-semibold tracking-tight sm:text-2xl">选择适合您的套餐</h2>
                        <p className="mt-0.5 text-xs leading-5 text-stone-500 sm:mt-1 sm:text-sm sm:leading-6 dark:text-stone-400">确认方案后进入独立安全结算页。</p>
                    </div>

                    {loading ? (
                        <div className="grid min-h-20 place-items-center sm:min-h-60">
                            <Spin />
                        </div>
                    ) : products.length ? (
                        <div className="mx-auto mt-2.5 max-w-[820px] sm:mt-4">
                            <BillingPlanGrid
                                variant="modal"
                                products={products}
                                onSelect={(product) => {
                                    onClose();
                                    onSelect(product);
                                }}
                            />
                        </div>
                    ) : (
                        <div className="mx-auto mt-3 max-w-3xl rounded-xl border border-dashed border-stone-300 bg-white py-6 sm:rounded-2xl sm:py-12 dark:border-stone-700 dark:bg-stone-950">
                            <Empty description="暂无已上架套餐" />
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}
