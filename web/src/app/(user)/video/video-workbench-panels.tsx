"use client";

import { CheckSquare, ChevronDown, CircleStop, ClipboardPaste, Download, FolderPlus, Music2, SlidersHorizontal, Sparkles, Square, Trash2, Upload, VideoIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { App, Button, Drawer, Empty, Modal, Tag, Typography } from "antd";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";

import type { InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { formatCreditAmount, requestCreditCost } from "@/constant/credits";
import { VideoSettingsPanel, videoSizeLabel } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { preloadOnIdle } from "@/lib/preload-on-idle";
import { droppedFiles, leftDropTarget, preventFileDragEvent } from "@/lib/file-drop";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import type { GenerationTaskExecutionState } from "@/services/api/generation-task-state";
import { seedanceReferenceLabel, seedanceVideoReferenceError, seedanceVideoReferenceHint, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { deleteStoredMedia, uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { deleteGenerationLogs as deleteServerGenerationLogs } from "@/services/api/generation-logs";
import { createServerVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo } from "@/services/api/video";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelOptionLabel, selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { WorkbenchAgentConversation, WorkbenchAgentHeader, WorkbenchBackgroundTaskNotice, WorkbenchComposerFrame, WorkbenchSkillEmptyState, type WorkbenchAgentMessage } from "@/components/agent/workbench-agent-panel";
import { WorkbenchGenerationActivity, WorkbenchGenerationPlaceholder, WorkbenchGenerationStatus } from "@/components/agent/workbench-generation-placeholder";
import { WorkbenchHistoryPanel } from "@/components/agent/workbench-history-panel";
import { moveListItem, ReferenceOrderButtons, WorkbenchPromptEditor } from "@/components/agent/workbench-composer-controls";
import { preloadWorkbenchResourceDialogs, WorkbenchResourceDialogs } from "@/components/agent/workbench-resource-dialogs";
import { LazyMediaVideo } from "@/components/media/lazy-media-video";
import { ResultSelectCheckbox, WorkbenchFileInput } from "@/components/agent/workbench-result-controls";
import { findWorkbenchAgentSessionForRecord, matchesWorkbenchHistoryQuery, removeWorkbenchAgentSessionsForRecords } from "@/components/agent/workbench-agent-session-store";
import { mergeWorkbenchAgentPatch, useWorkbenchAgentRun, type WorkbenchAgentParameterPatch } from "@/hooks/use-workbench-agent-run";
import { useWorkbenchAgentSessions } from "@/hooks/use-workbench-agent-sessions";
import { useWorkbenchCreativeReview } from "@/hooks/use-workbench-creative-review";
import { useUserStore } from "@/stores/use-user-store";
import { cn } from "@/lib/utils";
import { referenceImageFromAsset, referenceVideoFromAsset, videoAssetData } from "@/lib/workbench-asset-reference";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import {
    buildLogFromVideoResults,
    buildVideoConfig,
    delay,
    filterAudioReferencesByDuration,
    isSupportedAudioFile,
    normalizeLogConfig,
    normalizeResolution,
    normalizeVideoSeconds,
    removeStoredVideoLogs,
    replaceResult,
    resultsFromLog,
    saveStoredVideoLog,
    snapshotFromLog,
    withLogOwner,
    type GeneratedVideo,
    type GenerationLog,
    type GenerationResult,
    type ReferenceDropTarget,
} from "./video-workbench-records";

export type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

export function selectVideoModel(config: AiConfig, options = selectableModelsByCapability(config, "video"), preferred?: unknown) {
    const candidates = [preferred, config.videoModel, config.model, options[0]].map((value) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "")).filter(Boolean);
    return candidates.find((candidate) => options.includes(candidate)) || "";
}

export function GenerationSettings({
    config,
    model,
    updateConfig,
    openConfigDialog,
    hideModel = false,
}: {
    config: AiConfig;
    model: string;
    updateConfig: UpdateAiConfig;
    openConfigDialog: (shouldPromptContinue?: boolean, capability?: ModelCapability) => void;
    hideModel?: boolean;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [audioOpen, setAudioOpen] = useState(false);

    return (
        <>
            {!hideModel ? (
                <label className="col-span-2 block min-w-0 sm:col-span-1">
                    <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">模型</span>
                    <ModelPicker config={config} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(true, "video")} />
                </label>
            ) : null}
            <div className="col-span-2">
                <VideoSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" />
            </div>
            <div className="col-span-2 border-t pt-2" style={{ borderColor: theme.node.stroke }}>
                <button type="button" className="flex h-9 w-full items-center justify-between rounded-lg px-2 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5" onClick={() => setAudioOpen((open) => !open)} aria-expanded={audioOpen}>
                    <span className="flex items-center gap-2">
                        <Music2 className="size-4" /> 音频设置
                    </span>
                    <ChevronDown className={cn("size-4 transition-transform", audioOpen && "rotate-180")} />
                </button>
                {audioOpen ? <AudioSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="mt-3 space-y-3 pb-1" /> : null}
            </div>
        </>
    );
}

export function ResultVideoCard({
    video,
    large,
    selected,
    onSelectedChange,
    onDownload,
    onSaveAsset,
}: {
    video: GeneratedVideo;
    large?: boolean;
    selected?: boolean;
    onSelectedChange?: (checked: boolean) => void;
    onDownload: (video: GeneratedVideo) => void;
    onSaveAsset: (video: GeneratedVideo) => void;
}) {
    return (
        <div className="relative overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <ResultSelectCheckbox selected={selected} onSelectedChange={onSelectedChange} />
            <div className={`${large ? "h-[156px] sm:h-[240px]" : "h-[144px] sm:h-[220px]"} flex w-full items-center justify-center bg-black`}>
                <video src={video.url} controls preload="none" className="h-full w-full object-contain" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        添加到素材
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        下载
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function PendingVideoCard({ state }: { state?: GenerationTaskExecutionState }) {
    return (
        <div className="relative">
            <WorkbenchGenerationPlaceholder kind="video" className="h-[144px] sm:aspect-video sm:h-auto" />
            <WorkbenchGenerationStatus state={state} />
        </div>
    );
}

export function FailedVideoCard({
    error,
    retryable,
    state,
    selected,
    onSelectedChange,
    onRetry,
}: {
    error: string;
    retryable?: boolean;
    state?: GenerationTaskExecutionState;
    selected?: boolean;
    onSelectedChange?: (checked: boolean) => void;
    onRetry: () => void;
}) {
    const failure = videoFailureDisplay(error, state);
    return (
        <div className="relative overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <ResultSelectCheckbox selected={selected} onSelectedChange={onSelectedChange} />
            <div className="flex h-[144px] flex-col items-center justify-center gap-2 p-3 text-center sm:aspect-video sm:h-auto sm:gap-3 sm:p-5">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{failure.title}</div>
                <div className="text-xs text-red-500/80 dark:text-red-300/80">{failure.hint}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            {retryable ? (
                <div className="flex justify-end border-t border-red-200 p-2 sm:p-3 dark:border-red-950">
                    <Button size="small" danger onClick={onRetry}>
                        重试
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

export function videoFailureDisplay(error: string, state?: GenerationTaskExecutionState) {
    if (state?.publicStatus === "needs_review") return { title: "待确认", hint: "上游创建结果未知，系统已停止重复创建。" };
    if (state?.publicStatus === "cancelled") return { title: "已取消", hint: "任务已取消，不会继续生成。" };
    if (state?.publicStatus === "retryable") return { title: "生成失败，可重试", hint: "上游已确认失败，可以安全重新创建任务。" };
    if (error.startsWith("上游生成阶段失败")) return { title: "上游生成失败", hint: "任务已创建，但上游生成阶段失败。" };
    if (error.startsWith("视频任务创建失败") || error.startsWith("Seedance 任务创建失败")) return { title: "任务创建失败", hint: "当前请求未能成功创建生成任务。" };
    if (error.startsWith("视频任务查询失败") || error.startsWith("Seedance 任务查询失败")) return { title: "任务查询失败", hint: "任务已提交后，轮询上游状态失败。" };
    return { title: "生成失败", hint: "请检查模型、额度和接口返回。" };
}

export function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
    onRenameLog,
    onCancelLog,
    cancellingLogIds = [],
    historyTotal,
    historyHasMore,
    historyLoadingMore,
    onLoadMore,
    compact = false,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
    onRenameLog: (log: GenerationLog, title: string) => void;
    onCancelLog?: (log: GenerationLog) => void;
    cancellingLogIds?: string[];
    historyTotal?: number;
    historyHasMore?: boolean;
    historyLoadingMore?: boolean;
    onLoadMore?: () => void;
    compact?: boolean;
}) {
    return (
        <WorkbenchHistoryPanel
            logs={logs}
            selectedLogIds={selectedLogIds}
            activeLogId={activeLogId}
            onSelectedLogIdsChange={onSelectedLogIdsChange}
            onCreateSession={onCreateSession}
            onDeleteSelected={onDeleteSelected}
            onPreviewLog={onPreviewLog}
            onRenameLog={onRenameLog}
            total={historyTotal}
            hasMore={historyHasMore}
            loadingMore={historyLoadingMore}
            onLoadMore={onLoadMore}
            compact={compact}
            renderPreview={(log) => {
                const previews = resultsFromLog(log)
                    .flatMap((result) => (result.status === "success" && result.video?.url ? [result.video] : []))
                    .slice(0, 3);
                return previews.length ? (
                    <div className="mt-2 flex gap-1 overflow-hidden">
                        {previews.map((video, index) => (
                            <LazyMediaVideo key={video.id} src={video.url} label={`视频结果 ${index + 1}`} containerClassName="size-10 shrink-0 rounded-md" videoClassName="size-full object-cover" />
                        ))}
                    </div>
                ) : null;
            }}
            renderDetails={(log) => (
                <div className="grid min-w-0 gap-2 pl-7">
                    <div className="flex min-w-0 flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.size}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.resolution}p</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.seconds}s</Tag>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-1">
                        <span
                            className={`inline-flex h-6 items-center rounded-md border px-1.5 text-xs font-medium leading-none ${
                                log.status === "成功"
                                    ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/35 dark:text-sky-300"
                                    : log.status === "生成中"
                                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/35 dark:text-amber-300"
                                      : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/35 dark:text-rose-300"
                            }`}
                        >
                            {log.status}
                        </span>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                            {formatDuration(log.durationMs)}
                        </Tag>
                    </div>
                    {log.status === "生成中" && log.task && onCancelLog && !resultsFromLog(log).some((result) => result.taskState?.publicStatus === "cancelled") ? (
                        <Button
                            danger
                            size="small"
                            className="w-fit"
                            icon={<CircleStop className="size-3.5" />}
                            loading={cancellingLogIds.includes(log.id)}
                            onClick={(event) => {
                                event.stopPropagation();
                                onCancelLog(log);
                            }}
                        >
                            取消任务
                        </Button>
                    ) : null}
                </div>
            )}
        />
    );
}
