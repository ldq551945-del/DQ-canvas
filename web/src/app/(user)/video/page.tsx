"use client";

import { CheckSquare, ClipboardPaste, Download, FolderPlus, Music2, Sparkles, Square, Trash2, Upload, VideoIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { App, Button, Drawer, Modal, Tag, Typography } from "antd";
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
import { generationLogPublicPrompt } from "@/lib/generation-log-snapshot";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { seedanceReferenceLabel, seedanceVideoReferenceError, seedanceVideoReferenceHint, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { deleteStoredMedia, uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { deleteGenerationLogs as deleteServerGenerationLogs } from "@/services/api/generation-logs";
import { createServerVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo } from "@/services/api/video";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelOptionLabel, selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { WorkbenchAgentConversation, WorkbenchAgentHeader, WorkbenchBackgroundTaskNotice, WorkbenchComposerFrame, WorkbenchSkillEmptyState, type WorkbenchAgentMessage } from "@/components/agent/workbench-agent-panel";
import { workbenchReferencesFromAttachments } from "@/components/agent/workbench-agent-references";
import { CompactEmptyState } from "@/components/compact-empty-state";
import { WorkbenchGenerationActivity, WorkbenchGenerationPlaceholder } from "@/components/agent/workbench-generation-placeholder";
import { WorkbenchHistoryPanel } from "@/components/agent/workbench-history-panel";
import { moveListItem, ReferenceOrderButtons, WorkbenchPromptEditor } from "@/components/agent/workbench-composer-controls";
import { preloadWorkbenchResourceDialogs, WorkbenchResourceDialogs } from "@/components/agent/workbench-resource-dialogs";
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
    normalizeVideoSeconds,
    readStoredLogs,
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

import { UpdateAiConfig, selectVideoModel, GenerationSettings, ResultVideoCard, PendingVideoCard, FailedVideoCard, videoFailureDisplay, LogPanel } from "./video-workbench-panels";

import { useVideoWorkbenchController } from "./use-video-workbench-controller";

export default function VideoPage() {
    const controller = useVideoWorkbenchController();
    const {
        searchParams,
        message,
        fileInputRef,
        activeLogIdsRef,
        startingVideoTasksRef,
        queuedVideoLogsRef,
        queuedVideoLogIdsRef,
        videoConcurrencyLimitRef,
        activeLogIdRef,
        logsRef,
        deletedResultLogIdsRef,
        effectiveConfig,
        updateConfig,
        isAiConfigReady,
        openConfigDialog,
        addAsset,
        userId,
        prompt,
        setPrompt,
        agentMessages,
        setAgentMessages,
        agentSessions,
        setAgentSessions,
        agentSessionsHydrated,
        activeAgentSessionId,
        setActiveAgentSessionId,
        setActiveAgentRecordId,
        activeCreativeConversationId,
        setActiveCreativeConversationId,
        ensureCreativeConversation,
        lastAgentPrompt,
        setLastAgentPrompt,
        availableSkills,
        selectedSkill,
        setSelectedSkill,
        selectedModelIds,
        smartPlanning,
        modelPickerRequest,
        setSmartPlanning,
        enableSmartPlanning,
        selectSkill,
        selectVideoModelOption,
        agentSessionByRecordId,
        hasOlderAgentMessages,
        olderAgentMessagesLoading,
        loadOlderAgentMessages,
        importedPromptRef,
        references,
        setReferences,
        videoReferences,
        setVideoReferences,
        audioReferences,
        setAudioReferences,
        results,
        setResults,
        logs,
        setLogs,
        activeVideoCount,
        setActiveVideoCount,
        logsOpen,
        setLogsOpen,
        promptDialogOpen,
        setPromptDialogOpen,
        assetPickerOpen,
        setAssetPickerOpen,
        referenceDragTarget,
        setReferenceDragTarget,
        selectedLogIds,
        setSelectedLogIds,
        selectedResultIds,
        setSelectedResultIds,
        previewLog,
        setPreviewLog,
        deleteConfirmOpen,
        setDeleteConfirmOpen,
        userIdRef,
        videoModelOptions,
        model,
        pointsCost,
        canGenerate,
        videoConcurrencyLimit,
        previewPendingCount,
        addReferences,
        referenceDropZoneClass,
        referenceFileAccepted,
        handleReferenceDragOver,
        handleReferenceDragLeave,
        handleReferenceDrop,
        addReferencesFromClipboard,
        currentVideoTaskCount,
        syncActiveVideoCount,
        beginStartingVideoTask,
        finishStartingVideoTask,
        enqueueVideoLog,
        removeQueuedVideoLog,
        startQueuedVideoLogs,
        scheduleVideoLog,
        generate,
        agentRunning,
        runAgentGenerate,
        retryAgentMessage,
        cancelAgentRun,
        buildRequestSnapshot,
        retryResult,
        downloadVideo,
        saveResultToAssets,
        insertPickedAsset,
        createSession,
        deleteSelectedLogs,
        saveLog,
        refreshLogs,
        getLatestLog,
        resumePendingLogs,
        pollGenerationLog,
        previewGenerationLog,
        currentResultIds,
        selectedVisibleResultIds,
        allResultsSelected,
        toggleAllResults,
        toggleResultSelected,
        deleteSelectedResults,
        renameGenerationLog,
    } = controller;
    const agentModelOptions = videoModelOptions.map((id) => ({ id, name: modelOptionLabel(effectiveConfig, id), capability: "video" as const }));
    const selectedAgentModels = agentModelOptions.filter((item) => selectedModelIds.includes(item.id));
    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto p-2 lg:overflow-hidden sm:p-3">
                <section className="grid h-auto gap-3 sm:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:overflow-hidden">
                    <div className="order-1 flex min-h-[9rem] flex-col overflow-hidden rounded-lg border border-border bg-card p-2 sm:min-h-[calc(100dvh-96px)] sm:rounded-xl sm:p-4 lg:order-2 lg:min-h-0">
                        <WorkbenchAgentHeader
                            subtitle="视频创作助手"
                            onNew={createSession}
                            historyContent={(query, closeHistory) => {
                                const filteredLogs = logs.filter((log) => {
                                    const session = agentSessionByRecordId.get(log.id);
                                    return matchesWorkbenchHistoryQuery(query, log.title, generationLogPublicPrompt(log), session?.searchText || "", ...(session?.messages.map((item) => item.text) || []));
                                });
                                return (
                                    <LogPanel
                                        logs={filteredLogs}
                                        selectedLogIds={selectedLogIds}
                                        activeLogId={previewLog?.id}
                                        onSelectedLogIdsChange={setSelectedLogIds}
                                        onCreateSession={createSession}
                                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                                        onPreviewLog={(log) => {
                                            closeHistory();
                                            previewGenerationLog(log);
                                        }}
                                        onRenameLog={(log, title) => void renameGenerationLog(log, title)}
                                        compact
                                    />
                                );
                            }}
                        />
                        <WorkbenchBackgroundTaskNotice count={activeVideoCount} />
                        {agentMessages.length ? (
                            <WorkbenchAgentConversation
                                messages={agentMessages}
                                running={agentRunning}
                                hasOlderMessages={hasOlderAgentMessages}
                                olderMessagesLoading={olderAgentMessagesLoading}
                                onLoadOlder={() => void loadOlderAgentMessages()}
                                onChoice={(choice) => {
                                    if (choice.action === "upload") fileInputRef.current?.click();
                                    else setPrompt(choice.prompt || choice.description);
                                }}
                                onEditMessage={(editedMessage) => {
                                    const restored = workbenchReferencesFromAttachments(editedMessage.attachments);
                                    setPrompt(editedMessage.text);
                                    setReferences(restored.images);
                                    setVideoReferences(restored.videos);
                                    setAudioReferences(restored.audio);
                                    message.info("已回填消息，可修改后重新发送");
                                }}
                                onRetryMessage={retryAgentMessage}
                            />
                        ) : (
                            <WorkbenchSkillEmptyState skills={availableSkills} onSelect={selectSkill} />
                        )}

                        <WorkbenchComposerFrame
                            summary={`${videoSizeLabel(effectiveConfig.size)} · ${normalizeVideoSeconds(effectiveConfig.videoSeconds)} 秒`}
                            onAdd={() => fileInputRef.current?.click()}
                            onLibrary={() => setAssetPickerOpen(true)}
                            settingsContent={
                                <div className="grid grid-cols-2 gap-3">
                                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} hideModel />
                                </div>
                            }
                            skills={availableSkills}
                            selectedSkill={selectedSkill}
                            onSelectSkill={selectSkill}
                            onRemoveSkill={() => setSelectedSkill(undefined)}
                            smartPlanning={smartPlanning}
                            modelPickerRequest={modelPickerRequest}
                            defaultModelCapability="video"
                            onSmartPlanningChange={(enabled) => (enabled ? enableSmartPlanning() : setSmartPlanning(false))}
                            models={agentModelOptions}
                            selectedModels={selectedAgentModels}
                            onToggleModel={(item) => selectVideoModelOption(item.id)}
                            onClearModels={enableSmartPlanning}
                            submit={
                                agentRunning ? (
                                    <Button danger shape="circle" className="!h-9 !w-9 !min-w-9" icon={<Square className="size-3.5 fill-current" />} onClick={cancelAgentRun} aria-label="停止 Agent 并取消本次生成" />
                                ) : (
                                    <Button
                                        type="primary"
                                        shape="round"
                                        className="!h-9 !gap-1.5 !px-3 tabular-nums sm:!px-4"
                                        disabled={!canGenerate || activeVideoCount >= videoConcurrencyLimit}
                                        icon={<Sparkles className="size-4" />}
                                        onClick={() => void runAgentGenerate()}
                                        aria-label={`开始生成，消耗 ${formatCreditAmount(pointsCost)} 积分`}
                                    >
                                        <span className="text-xs font-semibold">生成</span>
                                        <span className="hidden text-xs font-semibold opacity-80 sm:inline">· {formatCreditAmount(pointsCost)}</span>
                                    </Button>
                                )
                            }
                        >
                            <WorkbenchPromptEditor
                                value={prompt}
                                placeholder="今天我们要创作什么，可直接粘贴文字或素材"
                                onChange={setPrompt}
                                onSubmit={() => void runAgentGenerate()}
                                onPasteFiles={(files) => void addReferences(files)}
                                onOpenPrompts={() => setPromptDialogOpen(true)}
                                onOpenAssets={() => setAssetPickerOpen(true)}
                            />

                            <div className={cn("order-1 min-w-0", !references.length && "hidden")}>
                                <div className="hidden">
                                    <span className="text-base font-semibold">参考图</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            剪切板
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            上传
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    className={`${referenceDropZoneClass("image")} !min-h-0 !border-0 !p-0`}
                                    onDragEnter={handleReferenceDragOver("image")}
                                    onDragOver={handleReferenceDragOver("image")}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop("image")}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-16 shrink-0 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">
                                            <img src={imagePreviewUrl(item.dataUrl, 256)} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{seedanceReferenceLabel("image", index)}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-white/95 text-red-600 opacity-90 shadow-sm ring-1 ring-red-200 transition hover:opacity-100 dark:bg-black/70 dark:text-red-200 dark:ring-red-900/60"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考图"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考图，最多 9 张</div> : null}
                                </div>
                            </div>

                            <div className={cn("order-1 min-w-0", !videoReferences.length && "hidden")}>
                                <div className="hidden">
                                    <span className="text-base font-semibold">参考视频</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        上传
                                    </Button>
                                </div>
                                <div
                                    className={`${referenceDropZoneClass("video")} !min-h-0 !border-0 !p-0`}
                                    onDragEnter={handleReferenceDragOver("video")}
                                    onDragOver={handleReferenceDragOver("video")}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop("video")}
                                >
                                    {videoReferences.map((item, index) => (
                                        <div key={item.id} className="group relative h-20 w-32 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-black dark:border-stone-800">
                                            <video src={item.url} className="size-full object-cover" muted preload="metadata" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{seedanceReferenceLabel("video", index)}</span>
                                            <ReferenceOrderButtons index={index} total={videoReferences.length} onMove={(offset) => setVideoReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-white/95 text-red-600 opacity-90 shadow-sm ring-1 ring-red-200 transition hover:opacity-100 dark:bg-black/70 dark:text-red-200 dark:ring-red-900/60"
                                                onClick={() => setVideoReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考视频"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!videoReferences.length ? <div className="flex min-w-full items-center justify-center text-sm text-stone-500">暂无参考视频，最多 3 个</div> : null}
                                </div>
                            </div>

                            <div className={cn("order-1 min-w-0", !audioReferences.length && "hidden")}>
                                <div className="hidden">
                                    <span className="text-base font-semibold">参考音频</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        上传
                                    </Button>
                                </div>
                                <div
                                    className={`${referenceDropZoneClass("audio")} !min-h-0 !border-0 !p-0`}
                                    onDragEnter={handleReferenceDragOver("audio")}
                                    onDragOver={handleReferenceDragOver("audio")}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop("audio")}
                                >
                                    {audioReferences.map((item, index) => (
                                        <div key={item.id} className="group relative flex h-20 w-48 shrink-0 flex-col justify-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 dark:border-stone-800 dark:bg-stone-900">
                                            <div className="flex min-w-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                                                <Music2 className="size-4 shrink-0" />
                                                <span className="shrink-0 rounded bg-stone-200 px-1 text-[10px] text-stone-700 dark:bg-stone-800 dark:text-stone-200">{seedanceReferenceLabel("audio", index)}</span>
                                                <span className="truncate">{item.name}</span>
                                            </div>
                                            <audio src={item.url} controls className="h-8 w-full" preload="metadata" />
                                            <ReferenceOrderButtons index={index} total={audioReferences.length} onMove={(offset) => setAudioReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-white/95 text-red-600 opacity-90 shadow-sm ring-1 ring-red-200 transition hover:opacity-100 dark:bg-black/70 dark:text-red-200 dark:ring-red-900/60"
                                                onClick={() => setAudioReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考音频"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!audioReferences.length ? <div className="flex min-w-full items-center justify-center text-center text-sm text-stone-500">暂无参考音频，最多 3 个，mp3/wav，单个 15MB 内</div> : null}
                                </div>
                            </div>
                        </WorkbenchComposerFrame>

                        <div className="hidden">
                            <Button type="primary" size="large" block disabled={!canGenerate || activeVideoCount >= videoConcurrencyLimit} onClick={() => void generate()}>
                                <span className="inline-flex items-center justify-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                                        <Sparkles className="size-[17px]" />
                                        <span className="text-sm font-semibold leading-none">{formatCreditAmount(pointsCost)}</span>
                                    </span>
                                    <span>开始生成</span>
                                </span>
                            </Button>
                            {activeVideoCount ? (
                                <div className="mt-2 text-center text-xs text-stone-500 dark:text-stone-400">
                                    当前用户运行 {activeVideoCount}/{videoConcurrencyLimit}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="thin-scrollbar order-2 rounded-xl border border-border bg-card p-2.5 lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:p-5 sm:p-4">
                        <div className="mb-2.5 flex items-center justify-between gap-2 sm:mb-4 sm:gap-3">
                            <h2 className="text-lg font-semibold sm:text-xl">生成结果</h2>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!results.length} onClick={toggleAllResults}>
                                    {allResultsSelected ? "取消" : "全选"}
                                </Button>
                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedVisibleResultIds.length} onClick={() => void deleteSelectedResults()}>
                                    删除{selectedVisibleResultIds.length ? ` ${selectedVisibleResultIds.length}` : ""}
                                </Button>
                                {previewPendingCount ? <WorkbenchGenerationActivity kind="video" count={previewPendingCount} /> : null}
                                {activeVideoCount ? (
                                    <Tag className="m-0 px-2 py-1">
                                        运行 {activeVideoCount}/{videoConcurrencyLimit}
                                    </Tag>
                                ) : null}
                            </div>
                        </div>
                        {results.length ? (
                            <div className={results.length === 1 ? "grid max-w-[360px] gap-2.5 sm:gap-4" : "grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4 2xl:grid-cols-3"}>
                                {results.map((result) =>
                                    result.status === "success" && result.video ? (
                                        <ResultVideoCard
                                            key={result.id}
                                            video={result.video}
                                            large={results.length === 1}
                                            selected={selectedResultIds.includes(result.id)}
                                            onSelectedChange={(checked) => toggleResultSelected(result.id, checked)}
                                            onDownload={downloadVideo}
                                            onSaveAsset={saveResultToAssets}
                                        />
                                    ) : result.status === "failed" ? (
                                        <FailedVideoCard key={result.id} error={result.error || "生成失败"} selected={selectedResultIds.includes(result.id)} onSelectedChange={(checked) => toggleResultSelected(result.id, checked)} onRetry={retryResult} />
                                    ) : (
                                        <PendingVideoCard key={result.id} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <CompactEmptyState title="还没有生成视频" description="完成一次生成后，结果会按时间保留在这里。" icon={<VideoIcon className="size-4" />} className="min-h-20 sm:min-h-40 lg:min-h-[360px]" />
                        )}
                    </div>
                </section>
            </main>
            <WorkbenchFileInput inputRef={fileInputRef} accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" onFiles={(files) => void addReferences(files)} />
            <Drawer title="生成记录" placement="bottom" size="min(86dvh, 720px)" open={logsOpen} onClose={() => setLogsOpen(false)} styles={{ body: { padding: 0, overflow: "hidden" } }}>
                <div className="thin-scrollbar h-full overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={previewGenerationLog}
                        onRenameLog={(log, title) => void renameGenerationLog(log, title)}
                    />
                </div>
            </Drawer>
            <WorkbenchResourceDialogs
                promptOpen={promptDialogOpen}
                assetOpen={assetPickerOpen}
                onPromptOpenChange={setPromptDialogOpen}
                onPromptSelect={setPrompt}
                onAssetInsert={(payload) => void insertPickedAsset(payload)}
                onAssetClose={() => setAssetPickerOpen(false)}
            />
            <Modal title="删除生成记录" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedLogIds.length} 条生成记录吗？
            </Modal>
        </div>
    );
}
