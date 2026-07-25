"use client";

import type { ReactNode } from "react";
import { Button, Tag } from "antd";
import { Mail, Plus, RefreshCw, Send, Sparkles } from "lucide-react";

import { SectionTitle } from "@/components/admin/admin-settings-controls";
import type { AuthSettings, SiteSocialKey } from "@/lib/auth/store";
import { imagePreviewUrl } from "@/lib/media-image-url";

export const siteSocialItems: Array<{ key: SiteSocialKey; label: string; placeholder: string; icon: ReactNode }> = [
    { key: "email", label: "邮箱联系", placeholder: "mailto:csyqlz@gmail.com", icon: <Mail className="size-4" /> },
    { key: "telegram", label: "Telegram", placeholder: "未配置", icon: <Send className="size-4" /> },
    { key: "x", label: "X", placeholder: "未配置", icon: <span className="text-xs font-bold">X</span> },
    { key: "instagram", label: "Instagram", placeholder: "未配置", icon: <span className="text-[11px] font-bold">IG</span> },
];

export function SiteLogoPreview({ logoUrl }: { logoUrl: string }) {
    if (logoUrl) return <img src={logoUrl} alt="" className="size-12 rounded-md bg-stone-100 object-contain p-1 dark:bg-white/10" referrerPolicy="no-referrer" />;
    return (
        <span
            className="size-12 rounded-md bg-stone-950 dark:bg-white"
            style={{
                mask: "url(/logo.svg) center / 78% no-repeat",
                WebkitMask: "url(/logo.svg) center / 78% no-repeat",
            }}
        />
    );
}

export function SiteSettingStatus({ site }: { site: AuthSettings["site"] }) {
    const enabledSocialCount = siteSocialItems.filter((item) => site.socials[item.key]?.enabled && site.socials[item.key]?.url.trim()).length;
    const enabledFriendLinkCount = (site.friendLinks || []).filter((link) => link.enabled && link.label.trim() && link.url.trim()).length;
    const validShowcaseCount = (site.homeShowcaseItems || []).filter((item) => item.title.trim() && item.prompt.trim()).length;
    const isCustom = site.homeShowcaseMode === "custom";
    const seoReady = Boolean((site.seoTitle || site.title).trim() && site.seoDescription.trim());

    return (
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
            <SectionTitle icon={<RefreshCw className="size-4" />} title="同步状态" />
            <div className="mt-4 grid grid-cols-2 gap-2">
                <SiteStatusChip label="Logo" value={site.logoUrl.trim() ? "已设置" : "默认"} active={Boolean(site.logoUrl.trim())} />
                <SiteStatusChip label="浏览器图标" value={site.iconUrl.trim() ? "已设置" : "默认"} active={Boolean(site.iconUrl.trim())} />
                <SiteStatusChip label="SEO" value={seoReady ? "完整" : "待补充"} active={seoReady} />
                <SiteStatusChip label="社交媒体" value={`${enabledSocialCount} 项`} active={enabledSocialCount > 0} />
                <SiteStatusChip label="友情链接" value={`${enabledFriendLinkCount} 条`} active={enabledFriendLinkCount > 0} />
            </div>
            <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-stone-950 dark:text-stone-100">首页提示词</span>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-stone-700 ring-1 ring-stone-200 dark:bg-stone-950 dark:text-stone-200 dark:ring-stone-800">
                        {isCustom ? `自定义 ${validShowcaseCount}/8` : "随机提示词库"}
                    </span>
                </div>
                <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">保存后会同步到首页导航、浏览器标题、Open Graph、favicon 和首页展示区域。</div>
            </div>
        </div>
    );
}

function SiteStatusChip({ label, value, active }: { label: string; value: string; active: boolean }) {
    return (
        <div className="min-w-0 rounded-lg border border-stone-200 bg-stone-50/80 p-3 dark:border-stone-800 dark:bg-stone-900/50">
            <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
            <div className={`mt-1 truncate text-sm font-semibold ${active ? "text-stone-950 dark:text-stone-100" : "text-stone-500 dark:text-stone-400"}`}>{value}</div>
        </div>
    );
}

export function SiteShowcasePreview({ site, onAdd }: { site: AuthSettings["site"]; onAdd: () => void }) {
    const items = site.homeShowcaseItems || [];
    const customItems = items.filter((item) => item.title.trim() && item.prompt.trim()).slice(0, 3);
    const isCustom = site.homeShowcaseMode === "custom";

    return (
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm shadow-stone-200/40 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <SectionTitle icon={<Sparkles className="size-4" />} title="首页展示预览" />
                    <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{isCustom ? `后台自定义：${items.length}/8 条` : "随机展示公共提示词库内容"}</div>
                </div>
                <Tag className="m-0" color={isCustom ? "geekblue" : "green"}>
                    {isCustom ? "自定义" : "随机"}
                </Tag>
            </div>

            {isCustom ? (
                customItems.length ? (
                    <div className="mt-4 space-y-2">
                        {customItems.map((item) => (
                            <div key={item.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 rounded-lg border border-stone-200 bg-stone-50/70 p-2 dark:border-stone-800 dark:bg-stone-900/60">
                                {item.coverUrl ? (
                                    <img src={imagePreviewUrl(item.coverUrl, 256)} alt="" className="aspect-square rounded-md object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                    <div className="aspect-square rounded-md bg-[linear-gradient(135deg,#f8fafc,#dff5ff_45%,#111827)] dark:bg-[linear-gradient(135deg,#0f172a,#164e63_45%,#020617)]" />
                                )}
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100">{item.title}</div>
                                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{item.prompt}</div>
                                </div>
                            </div>
                        ))}
                        {items.length > customItems.length ? <div className="text-center text-xs text-stone-500 dark:text-stone-400">还有 {items.length - customItems.length} 条会在首页继续展示</div> : null}
                    </div>
                ) : (
                    <div className="mt-4 rounded-lg border border-dashed border-stone-200 bg-stone-50/70 px-3 py-6 text-center dark:border-stone-800 dark:bg-stone-900/50">
                        <div className="text-sm font-medium text-stone-700 dark:text-stone-200">还没有可展示内容</div>
                        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">填写标题和提示词后会出现在首页。</div>
                        <Button className="mt-3" size="small" icon={<Plus className="size-3.5" />} onClick={onAdd}>
                            添加展示
                        </Button>
                    </div>
                )
            ) : (
                <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
                                <div className="h-16 bg-[linear-gradient(145deg,#f8fafc,#e0f2fe_48%,#0f172a)] dark:bg-[linear-gradient(145deg,#0f172a,#164e63_48%,#020617)]" />
                                <div className="space-y-1 p-2">
                                    <div className="h-1.5 rounded-full bg-stone-200 dark:bg-stone-700" />
                                    <div className="h-1.5 w-2/3 rounded-full bg-stone-100 dark:bg-stone-800" />
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
                        <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">从公共提示词库随机抽取</div>
                        <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">首页接近展示区时才加载，既能换内容，也不会拖慢首屏。</div>
                    </div>
                </div>
            )}

            <div className="mt-3 text-xs leading-5 text-stone-500 dark:text-stone-400">首页展示区会懒加载，保持首屏打开速度。</div>
        </div>
    );
}
