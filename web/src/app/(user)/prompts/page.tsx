"use client";

import { FolderPlus, Search } from "lucide-react";
import { type UIEvent, useEffect, useRef, useState } from "react";
import { App, Button, Input, Select, Spin, Tag } from "antd";

import { PromptCard } from "@/components/prompts/prompt-card";
import { CompactEmptyState } from "@/components/compact-empty-state";
import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { usePromptList } from "@/components/prompts/use-prompt-list";
import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";
import { useAssetStore } from "@/stores/use-asset-store";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";

export default function PromptsPage() {
    const { message } = App.useApp();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedTag, setSelectedTag] = useState(ALL_PROMPTS_OPTION);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const scrollContainerRef = useRef<HTMLElement | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const copyText = useCopyText();
    const activeTags = selectedTag === ALL_PROMPTS_OPTION ? [] : [selectedTag];
    const { query, items: promptItems, tags: promptTags, categories: promptCategoryOptions, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: activeTags, category: selectedCategory });
    const activeFilterLabels = [selectedCategory !== ALL_PROMPTS_OPTION ? selectedCategory : "", selectedTag !== ALL_PROMPTS_OPTION ? selectedTag : "", titleKeyword.trim() ? `搜索：${titleKeyword.trim()}` : ""].filter(Boolean);

    useEffect(() => {
        if (query.isError) {
            message.error(query.error instanceof Error ? query.error.message : "获取提示词失败");
        }
    }, [message, query.error, query.isError]);

    useEffect(() => {
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, [selectedCategory, selectedTag, titleKeyword]);

    const toggleTag = (tag: string) => setSelectedTag(tag === selectedTag ? ALL_PROMPTS_OPTION : tag);

    const savePromptAsset = async (item: Prompt) => {
        try {
            await addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl || "" } });
            message.success("已加入我的素材");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材保存失败");
        }
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) {
            void query.fetchNextPage();
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto bg-background px-2 py-2 sm:px-6 sm:py-8" onScroll={handleListScroll}>
                <div className="pb-3 sm:pb-8">
                    <div className="mx-auto max-w-7xl">
                        <h1 className="text-xl font-semibold text-stone-950 sm:text-2xl dark:text-stone-100">提示词中心</h1>
                        <p className="mt-1 text-xs leading-5 text-stone-500 sm:mt-3 sm:text-sm dark:text-stone-400">共 {totalPrompts} 条提示词，按标题、标签与分类快速查找灵感。</p>
                    </div>
                    {query.isLoading ? (
                        <div className="flex h-16 items-center justify-center sm:h-32">
                            <Spin />
                        </div>
                    ) : null}
                    {!query.isLoading ? (
                        <>
                            <div className="mx-auto mt-2 w-full max-w-7xl sm:mt-6">
                                <Input size="middle" className="!h-9 w-full sm:!h-11" prefix={<Search className="size-4 text-stone-400" />} value={titleKeyword} placeholder="按标题查询" onChange={(event) => setTitleKeyword(event.target.value)} />
                            </div>
                            <div className="mx-auto mt-2.5 grid max-w-6xl grid-cols-2 gap-1.5 sm:hidden">
                                <Select aria-label="提示词分类" value={selectedCategory} options={promptCategoryOptions.map((category) => ({ label: category, value: category }))} onChange={setSelectedCategory} />
                                <Select showSearch aria-label="提示词标签" optionFilterProp="label" value={selectedTag} options={promptTags.map((tag) => ({ label: tag, value: tag }))} onChange={setSelectedTag} />
                            </div>
                            <div className="mx-auto mt-4 hidden max-w-6xl gap-3 text-left sm:grid">
                                <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-start">
                                    <div className="pt-2 text-xs font-medium text-stone-500 dark:text-stone-400">分类</div>
                                    <div className="flex flex-wrap gap-2">
                                        {promptCategoryOptions.map((category) => (
                                            <Tag.CheckableTag key={category} checked={selectedCategory === category} className={cn("prompt-filter-tag", selectedCategory === category && "is-active")} onChange={() => setSelectedCategory(category)}>
                                                {category}
                                            </Tag.CheckableTag>
                                        ))}
                                    </div>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-start">
                                    <div className="pt-2 text-xs font-medium text-stone-500 dark:text-stone-400">标签</div>
                                    <div className="thin-scrollbar flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">
                                        {promptTags.map((tag) => (
                                            <Tag.CheckableTag key={tag} checked={tag === selectedTag} className={cn("prompt-filter-tag", tag === selectedTag && "is-active")} onChange={() => toggleTag(tag)}>
                                                {tag}
                                            </Tag.CheckableTag>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="mx-auto mt-2 flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white/85 px-2.5 py-1 text-xs text-stone-600 shadow-sm sm:mt-4 sm:px-3 sm:py-2 sm:text-sm dark:border-stone-800 dark:bg-stone-950/80 dark:text-stone-300">
                                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                    <span className="font-medium text-stone-900 dark:text-stone-100">当前筛选</span>
                                    {activeFilterLabels.length ? (
                                        activeFilterLabels.map((label) => (
                                            <Tag key={label} className="m-0">
                                                {label}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">全部</Tag>
                                    )}
                                </div>
                                <span className="shrink-0 tabular-nums">匹配 {totalPrompts} 条</span>
                            </div>
                        </>
                    ) : null}
                </div>

                {!query.isLoading ? (
                    <div>
                        <div className="mx-auto grid max-w-7xl gap-2 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3 2xl:grid-cols-4">
                            {promptItems.map((item) => (
                                <PromptCard
                                    key={item.id}
                                    item={item}
                                    onOpen={() => setSelectedPrompt(item)}
                                    onCopy={() => copyText(item.prompt, "提示词已复制")}
                                    extraAction={
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>
                                            加入我的素材
                                        </Button>
                                    }
                                />
                            ))}
                        </div>
                        {promptItems.length === 0 ? <CompactEmptyState title="没有找到匹配的提示词" description="尝试清除搜索词，或切换分类和标签。" /> : null}
                        <div className="mx-auto mt-6 max-w-7xl text-center text-xs text-stone-500 dark:text-stone-400">
                            {query.isFetchingNextPage ? "加载中..." : query.hasNextPage ? "继续向下滚动加载更多" : promptItems.length > 0 ? "已经到底了" : null}
                        </div>
                    </div>
                ) : null}
            </main>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, "提示词已复制")} onSaveAsset={savePromptAsset} />
        </div>
    );
}
