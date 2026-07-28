"use client";

import { CheckSquare, ClipboardPaste, Download, FolderPlus, ImagePlus, PenLine, SlidersHorizontal, Sparkles, Square, Trash2, Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { App, Button, Drawer, Empty, Image, Modal, Tooltip, Typography } from "antd";
import { saveAs } from "file-saver";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { formatCreditAmount, requestCreditCost } from "@/constant/credits";
import type { InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import { preloadOnIdle } from "@/lib/preload-on-idle";
import { canvasThemes } from "@/lib/canvas-theme";
import { droppedFiles, leftDropTarget, preventFileDragEvent } from "@/lib/file-drop";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { WorkbenchAgentConversation, WorkbenchAgentHeader, WorkbenchBackgroundTaskNotice, WorkbenchComposerFrame, WorkbenchSkillEmptyState, type WorkbenchAgentMessage } from "@/components/agent/workbench-agent-panel";
import { WorkbenchGenerationActivity, WorkbenchGenerationPlaceholder } from "@/components/agent/workbench-generation-placeholder";
import { WorkbenchHistoryPanel } from "@/components/agent/workbench-history-panel";
import { moveListItem, ReferenceOrderButtons, WorkbenchPromptEditor } from "@/components/agent/workbench-composer-controls";
import { preloadWorkbenchResourceDialogs, WorkbenchResourceDialogs } from "@/components/agent/workbench-resource-dialogs";
import { ResultSelectCheckbox, WorkbenchFileInput } from "@/components/agent/workbench-result-controls";
import { findWorkbenchAgentSessionForRecord, matchesWorkbenchHistoryQuery, removeWorkbenchAgentSessionsForRecords } from "@/components/agent/workbench-agent-session-store";
import { mergeWorkbenchAgentPatch, useWorkbenchAgentRun, type WorkbenchAgentParameterPatch } from "@/hooks/use-workbench-agent-run";
import { useWorkbenchAgentSessions } from "@/hooks/use-workbench-agent-sessions";
import { useWorkbenchCreativeReview } from "@/hooks/use-workbench-creative-review";
import { cn } from "@/lib/utils";
import { imageAssetData, referenceImageFromAsset } from "@/lib/workbench-asset-reference";
import { modelOptionLabel, selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { createImageGenerationTask, waitForImageGenerationTask } from "@/services/api/image";
import { resolveImageGenerationCount } from "@/lib/server/image-task-config";
import { deleteGenerationLogs as deleteServerGenerationLogs } from "@/services/api/generation-logs";
import { deleteStoredImages, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";
import { ImageTaskControllers, ImageTaskQueue } from "./image-task-runner";
import {
    buildLogFromResults,
    deleteServerImageTaskLogsForResults,
    imageServerLogIds,
    normalizeGeneratedImage,
    readStoredLogs,
    removeStoredImageLogs,
    resultsFromLog,
    saveStoredImageLog,
    snapshotFromLog,
    stableResultImageUrl,
    updateResultAt,
    withLogOwner,
    type GeneratedImage,
    type GenerationLog,
    type GenerationResult,
    type GenerationSnapshot,
    type PendingImageTask,
} from "./image-workbench-records";

export type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

export function GenerationSettings({ config, model, updateConfig, openConfigDialog, hideModel = false }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void; hideModel?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            {!hideModel ? (
                <label className="col-span-2 block min-w-0 sm:col-span-1">
                    <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">模型</span>
                    <ModelPicker config={config} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(true)} />
                </label>
            ) : null}
            <div className="col-span-2">
                <ImageSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" maxCount={10} />
            </div>
        </>
    );
}

export function ResultImageCard({
    image,
    index,
    large,
    missing,
    selected,
    onSelectedChange,
    onMissing,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    large?: boolean;
    missing?: boolean;
    selected?: boolean;
    onSelectedChange?: (checked: boolean) => void;
    onMissing?: () => void;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const hasImage = Boolean(image.dataUrl) && !missing;
    const cardWidth = resultImageCardWidth(image.width, image.height, large);
    return (
        <div className="relative max-w-full overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800" style={{ width: cardWidth }}>
            <ResultSelectCheckbox selected={selected} onSelectedChange={onSelectedChange} />
            <div className="flex w-full items-center justify-center bg-stone-50 dark:bg-stone-950" style={{ aspectRatio: `${Math.max(1, image.width)} / ${Math.max(1, image.height)}` }}>
                {hasImage ? (
                    <Image
                        rootClassName="!h-full !w-full"
                        src={imagePreviewUrl(image.dataUrl, 960)}
                        alt={`生成结果 ${index + 1}`}
                        className="!h-full !w-full object-contain"
                        style={{ objectFit: "contain" }}
                        preview={{ src: imagePreviewUrl(image.dataUrl, 1920) }}
                        onError={onMissing}
                    />
                ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-stone-500 dark:text-stone-400">
                        <ImagePlus className="size-8 text-stone-400" />
                        <span>图片已丢失</span>
                    </div>
                )}
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2 border-t border-stone-200 px-2.5 py-2 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                    <Tooltip title="添加到素材">
                        <Button type="text" shape="circle" size="small" aria-label="添加到素材" disabled={!hasImage} icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)} />
                    </Tooltip>
                    <Tooltip title="加入参考图">
                        <Button type="text" shape="circle" size="small" aria-label="加入参考图" disabled={!hasImage} icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)} />
                    </Tooltip>
                    <Tooltip title="下载">
                        <Button type="text" shape="circle" size="small" aria-label="下载" disabled={!hasImage} icon={<Download className="size-3.5" />} onClick={() => onDownload(image, index)} />
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

export function resultImageCardWidth(width: number, height: number, large = false) {
    const ratio = width > 0 && height > 0 ? width / height : 1;
    const maxWidth = large ? 320 : 280;
    const maxHeight = large ? 360 : 300;
    return Math.max(120, Math.round(Math.min(maxWidth, ratio * maxHeight)));
}

export function PendingImageCard({ large }: { large?: boolean }) {
    return <WorkbenchGenerationPlaceholder kind="image" className={large ? "h-[156px] sm:h-[240px]" : "h-[136px] sm:h-[220px]"} />;
}

export function FailedImageCard({ error, large, selected, onSelectedChange, onRetry }: { error: string; large?: boolean; selected?: boolean; onSelectedChange?: (checked: boolean) => void; onRetry: () => void }) {
    return (
        <div className="relative overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <ResultSelectCheckbox selected={selected} onSelectedChange={onSelectedChange} />
            <div className={`flex flex-col items-center justify-center gap-2 p-3 text-center sm:gap-3 sm:p-5 ${large ? "h-[156px] sm:h-[240px]" : "h-[136px] sm:h-[220px]"}`}>
                <div className="text-sm font-medium text-red-600 dark:text-red-300">生成失败</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-2 sm:p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    重试
                </Button>
            </div>
        </div>
    );
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
            compact={compact}
            renderPreview={(log) => {
                const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);
                return thumbnails.length ? (
                    <div className="mt-2 flex gap-1 overflow-hidden">
                        {thumbnails.map((image, index) => (
                            <img key={`${log.id}-${index}`} src={imagePreviewUrl(image, 96)} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                        ))}
                    </div>
                ) : null;
            }}
            renderDetails={(log) => (
                <div className="ml-6 mt-1 min-h-[62px] rounded-md border border-stone-200/70 bg-white/65 px-2.5 py-2 shadow-sm shadow-stone-200/30 dark:border-stone-800 dark:bg-stone-950/45 dark:shadow-black/10">
                    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                        <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-blue-50 px-1.5 text-xs font-medium leading-none text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">成功 {log.successCount ?? log.imageCount}</span>
                        {log.failCount ? <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-rose-50 px-1.5 text-xs font-medium leading-none text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">失败 {log.failCount}</span> : null}
                        <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-stone-100 px-1.5 text-xs font-medium leading-none text-stone-700 dark:bg-white/10 dark:text-stone-200">{log.imageCount} 张</span>
                        <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-lime-50 px-1.5 text-xs font-medium leading-none text-lime-700 dark:bg-lime-500/15 dark:text-lime-200">{formatDuration(log.durationMs)}</span>
                    </div>
                    <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs leading-5 text-stone-500 dark:text-stone-400">{log.time}</span>
                        {log.pendingCount ? (
                            <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-sky-50 px-1.5 text-xs font-medium leading-none text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/25">
                                生成中 {log.pendingCount}
                            </span>
                        ) : null}
                    </div>
                </div>
            )}
        />
    );
}
