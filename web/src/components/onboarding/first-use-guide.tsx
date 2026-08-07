"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleAlert, Settings2, Sparkles, X } from "lucide-react";
import { Button } from "antd";

import { useUserStore } from "@/stores/use-user-store";

type FirstUseGuideProps = {
    ready: boolean;
    completed: boolean;
    missingModels: string[];
    onUseExample: () => void;
};

const STORAGE_PREFIX = "dq:first-use-guide:v1";

export function FirstUseGuide({ ready, completed, missingModels, onUseExample }: FirstUseGuideProps) {
    const user = useUserStore((state) => state.user);
    const [visible, setVisible] = useState(false);
    const storageKey = useMemo(() => (user?.id ? `${STORAGE_PREFIX}:${user.id}` : ""), [user?.id]);

    useEffect(() => {
        if (!ready || !storageKey) return;
        if (completed) {
            window.localStorage.setItem(storageKey, "done");
            setVisible(false);
            return;
        }
        setVisible(window.localStorage.getItem(storageKey) !== "done");
    }, [completed, ready, storageKey]);

    if (!ready || !visible) return null;
    const modelReady = missingModels.length === 0;
    const dismiss = () => {
        if (storageKey) window.localStorage.setItem(storageKey, "done");
        setVisible(false);
    };

    return (
        <section className="relative mt-3 w-full border-y border-[#e4e8ec] py-3 text-left dark:border-[#30363d] sm:mt-5 sm:py-4" aria-label="首次使用引导">
            <button
                type="button"
                className="absolute right-0 top-2 grid size-9 place-items-center rounded-md text-[#7d8793] transition hover:bg-[#eef1f4] hover:text-[#2f3741] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-[#242930] dark:hover:text-white"
                onClick={dismiss}
                aria-label="关闭首次使用引导"
                title="关闭"
            >
                <X className="size-4" />
            </button>
            <div className="flex min-w-0 items-start gap-3 pr-9">
                <span
                    className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${modelReady ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"}`}
                >
                    {modelReady ? <Sparkles className="size-4" /> : <CircleAlert className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-[#2b3138] dark:text-[#edf1f5]">{modelReady ? "开始第一次创作" : "完成模型配置后开始创作"}</h2>
                    <p className="mt-1 text-xs leading-5 text-[#737e8a] dark:text-[#8b96a3]">
                        {modelReady ? "描述目标，可选参考素材，然后发送；Agent 会把任务交给对应的图片、视频或音频模型。" : `当前缺少${missingModels.join("、")}，生成请求暂时无法执行。`}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        {modelReady ? (
                            <Button size="small" type="primary" className="!h-8" icon={<Sparkles className="size-3.5" />} onClick={onUseExample}>
                                填入示例
                            </Button>
                        ) : user?.role === "admin" ? (
                            <Link href="/admin?section=channels">
                                <Button size="small" type="primary" className="!h-8" icon={<Settings2 className="size-3.5" />}>
                                    配置模型
                                </Button>
                            </Link>
                        ) : null}
                        <Link href="/help">
                            <Button size="small" className="!h-8" icon={<ArrowRight className="size-3.5" />}>
                                查看创作指南
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
}
