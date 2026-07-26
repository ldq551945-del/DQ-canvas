"use client";

import { Button, Tooltip } from "antd";
import { Check, Clapperboard, ExternalLink, LoaderCircle, PanelsTopLeft, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SiteLogo } from "@/components/layout/site-logo";
import type { AgentMediaDownload } from "@/components/agent/agent-media-download";
import { AgentMessageActions } from "@/components/agent/agent-message-actions";
import { formatAgentMessageText } from "@/components/agent/agent-message-format";
import { AgentMediaPreview } from "@/components/agent/agent-media-preview";
import { isCreativeProjectHandoff, type CreativeAsset, type CreativeMessage, type CreativeProjectHandoff } from "@/lib/creative-runtime-contract";
import { cn } from "@/lib/utils";
import { userAvatarFallback } from "@/lib/user-avatar";
import type { MaterializedCreativeProject } from "@/services/creative-project-handoff";
import type { CreativeAgentRun } from "@/services/api/creative";
import { usePublicSessionStore } from "@/stores/use-public-session-store";

import { creativeAssetCardLayout } from "./creative-asset-layout";

export function CreativeMessages({
    messages,
    assets,
    loading,
    projectLinks,
    projectErrors,
    runDetails,
    materializingProjectId,
    onMaterializeProject,
    onRetryTask,
    onEditMessage,
    selectedAssetIds,
    onToggleAsset,
    hasOlder,
    olderLoading,
    onLoadOlder,
}: {
    messages: CreativeMessage[];
    assets: CreativeAsset[];
    loading: boolean;
    projectLinks: Record<string, MaterializedCreativeProject>;
    projectErrors: Record<string, string>;
    runDetails: Record<string, CreativeAgentRun>;
    materializingProjectId?: string;
    onMaterializeProject: (handoff: CreativeProjectHandoff) => Promise<MaterializedCreativeProject>;
    onRetryTask: (runId: string, taskId: string) => void;
    onEditMessage: (text: string) => void;
    selectedAssetIds: string[];
    onToggleAsset: (id: string) => void;
    hasOlder?: boolean;
    olderLoading?: boolean;
    onLoadOlder?: () => void;
}) {
    const endRef = useRef<HTMLDivElement>(null);
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: "VOZEB PRO", logoUrl: "/logo.svg" };
    const user = usePublicSessionStore((state) => state.payload?.user || null);
    const avatarUrl = user?.avatarUrl?.trim();
    const avatarFallback = userAvatarFallback(user?.displayName || user?.username || "用户");
    const assetsByMessage = useMemo(() => {
        const map = new Map<string, CreativeAsset[]>();
        for (const asset of assets) {
            const key = asset.messageId || asset.sourceRunId;
            if (!key) continue;
            map.set(key, [...(map.get(key) || []), asset]);
        }
        return map;
    }, [assets]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [assets.length, messages.at(-1)?.id]);

    if (loading) return <div className="grid flex-1 place-items-center text-sm text-stone-400">正在读取会话...</div>;

    return (
        <div className="mx-auto w-full max-w-[1120px] space-y-3 px-3 pb-4 pt-6 sm:space-y-8 sm:px-8 sm:pb-10 sm:pt-20">
            {hasOlder ? (
                <div className="flex justify-center">
                    <Button type="text" loading={olderLoading} onClick={onLoadOlder}>
                        加载更早消息
                    </Button>
                </div>
            ) : null}
            {messages.map((item) => {
                const itemAssets = [...(assetsByMessage.get(item.id) || []), ...(item.runId ? assetsByMessage.get(item.runId) || [] : [])].filter((asset, index, list) => list.findIndex((current) => current.id === asset.id) === index);
                const handoff = isCreativeProjectHandoff(item.metadata.projectHandoff) ? item.metadata.projectHandoff : null;
                const displayContent = formatAgentMessageText(item.content);
                const downloads = agentAssetDownloads(itemAssets);
                return (
                    <article key={item.id} className={cn("group/message flex items-start gap-3", item.role === "user" ? "justify-end" : "justify-start")}>
                        {item.role === "assistant" ? (
                            <span className="mt-1 grid size-7 shrink-0 place-items-center">
                                <SiteLogo logoUrl={site.logoUrl} className="size-5" />
                            </span>
                        ) : null}
                        <div className={cn("min-w-0", item.role === "user" ? "max-w-[85%] py-1" : "min-w-0 flex-1")}>
                            <div className={cn("whitespace-pre-wrap break-words text-[15px] leading-7", item.status === "failed" && "text-red-600 dark:text-red-300", item.status === "cancelled" && "text-stone-400")}>
                                {item.role === "assistant" && item.status === "running" ? <LoaderCircle className="mr-2 inline size-4 animate-spin text-stone-400" /> : null}
                                {displayContent}
                            </div>
                            {itemAssets.length ? <CreativeAssetGrid assets={itemAssets} selectedAssetIds={selectedAssetIds} onToggleAsset={onToggleAsset} /> : null}
                            {handoff ? (
                                <ProjectHandoffAction
                                    handoff={handoff}
                                    project={projectLinks[handoff.id]}
                                    error={projectErrors[handoff.id]}
                                    loading={materializingProjectId === handoff.id}
                                    onMaterialize={() => void onMaterializeProject(handoff).catch(() => undefined)}
                                />
                            ) : null}
                            {item.role === "assistant" && item.runId && runDetails[item.runId]?.tasks.some((task) => task.status === "failed") ? <FailedTaskActions run={runDetails[item.runId]} onRetryTask={onRetryTask} /> : null}
                            {item.status !== "running" ? <AgentMessageActions text={displayContent} downloads={downloads} onEdit={item.role === "user" ? onEditMessage : undefined} align={item.role === "user" ? "end" : "start"} /> : null}
                        </div>
                        {item.role === "user" ? (
                            <span className="mt-1 grid size-7 shrink-0 place-items-center overflow-hidden rounded-full" role="img" aria-label={user?.displayName || user?.username || "用户"}>
                                {avatarUrl ? (
                                    <img src={avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                    <span
                                        aria-hidden="true"
                                        className="grid size-full place-items-center rounded-full bg-[#66758e] text-[10px] font-semibold leading-none text-white ring-1 ring-black/5 dark:bg-[#d8dee8] dark:text-[#252b33] dark:ring-white/10"
                                    >
                                        {avatarFallback}
                                    </span>
                                )}
                            </span>
                        ) : null}
                    </article>
                );
            })}
            <div ref={endRef} className="h-36 sm:h-40" aria-hidden="true" />
        </div>
    );
}

function FailedTaskActions({ run, onRetryTask }: { run: CreativeAgentRun; onRetryTask: (runId: string, taskId: string) => void }) {
    const failedTasks = run.tasks.filter((task) => task.status === "failed");
    return (
        <div className="mt-3 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 align-top dark:border-red-900/70 dark:bg-red-950/20">
            {failedTasks.map((task) => (
                <span key={task.id} className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-red-700 dark:text-red-200">
                    <span className="max-w-44 truncate">{task.title}</span>
                    <Tooltip title={`重试「${task.title}」`}>
                        <Button
                            type="text"
                            size="small"
                            shape="circle"
                            className="!size-6 !min-w-6 !text-red-700 hover:!bg-red-100 hover:!text-red-800 dark:!text-red-200 dark:hover:!bg-red-900/50 dark:hover:!text-red-100"
                            icon={<RotateCcw className="size-3.5" />}
                            onClick={() => onRetryTask(run.id, task.id)}
                            aria-label={`重试 ${task.title}`}
                        />
                    </Tooltip>
                </span>
            ))}
        </div>
    );
}

function ProjectHandoffAction({ handoff, project, error, loading, onMaterialize }: { handoff: CreativeProjectHandoff; project?: MaterializedCreativeProject; error?: string; loading: boolean; onMaterialize: () => void }) {
    const Icon = handoff.surface === "canvas" ? PanelsTopLeft : Clapperboard;
    const label = handoff.surface === "canvas" ? "画布项目" : "短剧项目";
    return (
        <div className="mt-4 flex min-h-14 items-center gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-white text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{handoff.title}</span>
                <span className={cn("mt-0.5 block text-xs text-stone-500 dark:text-stone-400", error && "text-red-600 dark:text-red-300")}>{error || `${handoff.assets.length} 份资产已交接到${label}`}</span>
            </span>
            {project ? (
                <Link
                    href={project.href}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 transition hover:border-stone-400 hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:hover:border-stone-500 dark:hover:bg-stone-700"
                >
                    打开 <ExternalLink className="size-3.5" />
                </Link>
            ) : (
                <Button className="!h-9 !shrink-0" loading={loading} onClick={onMaterialize}>
                    {error ? "重试" : "创建项目"}
                </Button>
            )}
        </div>
    );
}

function CreativeAssetGrid({ assets, selectedAssetIds, onToggleAsset }: { assets: CreativeAsset[]; selectedAssetIds: string[]; onToggleAsset: (id: string) => void }) {
    const [loadedDimensions, setLoadedDimensions] = useState<Record<string, { width: number; height: number }>>({});
    const media = assets.filter((asset) => asset.type !== "text" && assetUrl(asset));
    const updateDimensions = useCallback((id: string, width: number, height: number) => {
        if (width <= 0 || height <= 0) return;
        setLoadedDimensions((current) => (current[id]?.width === width && current[id]?.height === height ? current : { ...current, [id]: { width, height } }));
    }, []);
    if (!media.length) return null;
    return (
        <div className={cn("mt-3 grid w-full max-w-[280px] grid-cols-1 justify-items-start gap-2 sm:mt-4 sm:gap-3", media.length > 1 && "sm:max-w-[572px] sm:grid-cols-[repeat(2,minmax(0,280px))]")}>
            {media.map((asset) => {
                const url = assetUrl(asset)!;
                const selected = selectedAssetIds.includes(asset.id);
                const layout = creativeAssetCardLayout(loadedDimensions[asset.id] || asset);
                return (
                    <figure key={asset.id} style={layout?.card} className={cn("max-w-full overflow-hidden rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900", !layout && "w-full")}>
                        {asset.type === "audio" ? (
                            <div className="p-3 sm:p-4">
                                <AgentMediaPreview type={asset.type} url={url} title={asset.title || "生成音频"} />
                            </div>
                        ) : (
                            <div style={layout?.media} className={cn("w-full overflow-hidden", !layout && asset.type === "video" && "aspect-video")}>
                                <AgentMediaPreview
                                    type={asset.type}
                                    url={url}
                                    title={asset.title || (asset.type === "video" ? "生成视频" : "生成图片")}
                                    className={cn("size-full", asset.type === "image" && "flex items-center justify-center bg-stone-100 dark:bg-stone-950")}
                                    fit={asset.type === "image" ? "contain" : "cover"}
                                    onDimensions={(width, height) => updateDimensions(asset.id, width, height)}
                                />
                            </div>
                        )}
                        <figcaption className="flex min-w-0 items-center gap-2 border-t border-stone-200 px-3 py-2 dark:border-stone-700">
                            <span className="min-w-0 flex-1 truncate text-xs text-stone-500 dark:text-stone-400">{asset.title}</span>
                            {asset.status === "ready" ? (
                                <button
                                    type="button"
                                    aria-pressed={selected}
                                    className={cn(
                                        "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition",
                                        selected
                                            ? "!bg-[#20242a] !text-white hover:!bg-[#343b44] dark:!bg-[#f3f5f7] dark:!text-[#20242a] dark:hover:!bg-white"
                                            : "border border-[#d9dee4] bg-white text-[#5f6975] hover:border-[#bfc7d0] hover:text-[#20242a] dark:border-[#3a414a] dark:bg-[#181b20] dark:text-[#aab2bd] dark:hover:border-[#596270] dark:hover:text-white",
                                    )}
                                    onClick={() => onToggleAsset(asset.id)}
                                >
                                    {selected ? <Check className="size-3" /> : <Plus className="size-3" />}
                                    {selected ? "已引用" : "引用素材"}
                                </button>
                            ) : null}
                        </figcaption>
                    </figure>
                );
            })}
        </div>
    );
}

function assetUrl(asset: CreativeAsset) {
    return asset.serverUrl || asset.remoteUrl || "";
}

function agentAssetDownloads(assets: CreativeAsset[]): AgentMediaDownload[] {
    return assets.flatMap((asset) => {
        const url = assetUrl(asset);
        return url && (asset.type === "image" || asset.type === "video") ? [{ type: asset.type, url, title: asset.title || (asset.type === "video" ? "生成视频" : "生成图片") }] : [];
    });
}
