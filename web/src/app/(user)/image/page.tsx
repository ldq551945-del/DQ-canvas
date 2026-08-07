"use client";

import { CheckSquare, CircleAlert, CircleStop, ClipboardPaste, Download, FolderPlus, ImagePlus, LoaderCircle, PenLine, Sparkles, Square, Trash2, Upload } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { App, Button, Drawer, Image, Modal, Tooltip, Typography } from "antd";
import { saveAs } from "file-saver";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { formatCreditAmount, requestCreditCost } from "@/constant/credits";
import type { InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import { preloadOnIdle } from "@/lib/preload-on-idle";
import { canvasThemes } from "@/lib/canvas-theme";
import { droppedFiles, leftDropTarget, preventFileDragEvent } from "@/lib/file-drop";
import { generationLogPublicPrompt } from "@/lib/generation-log-snapshot";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { WorkbenchAgentConversation, WorkbenchAgentHeader, WorkbenchBackgroundTaskNotice, WorkbenchComposerFrame, WorkbenchSkillEmptyState, type WorkbenchAgentMessage } from "@/components/agent/workbench-agent-panel";
import { workbenchReferencesFromAttachments } from "@/components/agent/workbench-agent-references";
import { CompactEmptyState } from "@/components/compact-empty-state";
import { WorkbenchGenerationActivity, WorkbenchGenerationPlaceholder } from "@/components/agent/workbench-generation-placeholder";
import { WorkbenchHistoryPanel } from "@/components/agent/workbench-history-panel";
import { WorkbenchHistoryLoadError } from "@/components/agent/workbench-history-load-error";
import { focusWorkbenchPromptEditor, moveListItem, ReferenceOrderButtons, WorkbenchPromptEditor } from "@/components/agent/workbench-composer-controls";
import { preloadWorkbenchResourceDialogs, WorkbenchResourceDialogs } from "@/components/agent/workbench-resource-dialogs";
import { ResultSelectCheckbox, WorkbenchFileInput } from "@/components/agent/workbench-result-controls";
import { findWorkbenchAgentSessionForRecord, matchesWorkbenchHistoryQuery, removeWorkbenchAgentSessionsForRecords } from "@/components/agent/workbench-agent-session-store";
import { workbenchConversationRecordGroups } from "@/components/agent/workbench-conversation-results";
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
    summarizeImageConversationLogs,
    updateResultAt,
    withLogOwner,
    type GeneratedImage,
    type GenerationLog,
    type GenerationResult,
    type GenerationSnapshot,
    type PendingImageTask,
} from "./image-workbench-records";

import { UpdateAiConfig, GenerationSettings, ResultImageCard, PendingImageCard, FailedImageCard, LogPanel } from "./image-workbench-panels";

import { useImageWorkbenchController } from "./use-image-workbench-controller";

export default function ImagePage() {
    const controller = useImageWorkbenchController();
    const {
        searchParams,
        message,
        fileInputRef,
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
        selectedAgentModelId,
        setSelectedAgentModelId,
        smartPlanning,
        modelPickerRequest,
        setSmartPlanning,
        enableSmartPlanning,
        selectSkill,
        selectImageModel,
        hasOlderAgentMessages,
        olderAgentMessagesLoading,
        loadOlderAgentMessages,
        importedCreatePromptRef,
        references,
        setReferences,
        resultEntries,
        setResults,
        logs,
        setLogs,
        historyLoading,
        historyLoadingMore,
        historyTotal,
        historyHasMore,
        historyLoadError,
        logsOpen,
        setLogsOpen,
        promptDialogOpen,
        setPromptDialogOpen,
        assetPickerOpen,
        setAssetPickerOpen,
        isReferenceDragActive,
        setIsReferenceDragActive,
        selectedLogIds,
        setSelectedLogIds,
        selectedResultIds,
        setSelectedResultIds,
        missingResultIds,
        setMissingResultIds,
        previewLog,
        setPreviewLog,
        deleteConfirmOpen,
        setDeleteConfirmOpen,
        resultsByLogIdRef,
        logsRef,
        activeLogIdRef,
        taskControllersRef,
        logWriteQueuesRef,
        deletedLogIdsRef,
        deletedResultIdsRef,
        imageConcurrencyLimitRef,
        userIdRef,
        mountedRef,
        activeImageTasks,
        imageSubmitting,
        setActiveImageTasks,
        imageTaskQueueRef,
        imageTaskQueue,
        model,
        canGenerate,
        generationCount,
        imageConcurrencyLimit,
        previewPendingCount,
        pointsCost,
        addReferences,
        retryReferenceUpload,
        handleReferenceDragOver,
        handleReferenceDragLeave,
        handleReferenceDrop,
        addReferencesFromClipboard,
        replaceLogs,
        upsertLog,
        saveLog,
        getLatestLog,
        getLogResults,
        setLogResults,
        persistLogResults,
        patchLogResult,
        runQueuedImageTask,
        resumePendingLogs,
        completeGenerationTask,
        generate,
        agentRunning,
        runAgentGenerate,
        retryAgentMessage,
        cancelAgentRun,
        downloadImage,
        addResultToReferences,
        saveResultToAssets,
        insertPickedAsset,
        createSession,
        deleteSelectedLogs,
        refreshLogs,
        loadMoreLogs,
        previewGenerationLog,
        buildRequestSnapshot,
        runGenerationSlot,
        retryResult,
        currentResultIds,
        selectedVisibleResultIds,
        allResultsSelected,
        missingVisibleResultIds,
        toggleAllResults,
        toggleResultSelected,
        markResultMissing,
        deleteResultsByIds,
        deleteSelectedResults,
        deleteMissingResults,
        cancellingLogIds,
        cancelGenerationLog,
        renameGenerationLog,
    } = controller;
    const agentModelOptions = selectableModelsByCapability(effectiveConfig, "image").map((id) => ({ id, name: modelOptionLabel(effectiveConfig, id), capability: "image" as const }));
    const selectedAgentModels = agentModelOptions.filter((item) => selectedModelIds.includes(item.id));
    const conversationLogs = workbenchConversationRecordGroups(logs).map(({ record, records }) => {
        const session = findWorkbenchAgentSessionForRecord(agentSessions, record.id, record.creativeConversationId);
        return summarizeImageConversationLogs(records, session?.title);
    });
    const activeHistoryLogId = previewLog ? conversationLogs.find((log) => log.id === previewLog.id || Boolean(log.creativeConversationId && log.creativeConversationId === previewLog.creativeConversationId))?.id : undefined;
    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto p-2 lg:overflow-hidden sm:p-3">
                <section className="grid h-auto gap-3 sm:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:overflow-hidden">
                    <div className="order-1 flex min-h-[9rem] flex-col overflow-hidden rounded-lg border border-border bg-card p-2 sm:min-h-[calc(100dvh-96px)] sm:rounded-xl sm:p-4 lg:order-2 lg:min-h-0">
                        <WorkbenchAgentHeader
                            subtitle="图片创作助手"
                            onNew={createSession}
                            historyContent={(query, closeHistory) => {
                                const filteredLogs = conversationLogs.filter((log) => {
                                    const session = findWorkbenchAgentSessionForRecord(agentSessions, log.id, log.creativeConversationId);
                                    return matchesWorkbenchHistoryQuery(query, log.title, generationLogPublicPrompt(log), session?.searchText || "", ...(session?.messages.map((item) => item.text) || []));
                                });
                                return (
                                    <LogPanel
                                        logs={filteredLogs}
                                        selectedLogIds={selectedLogIds}
                                        activeLogId={activeHistoryLogId}
                                        onSelectedLogIdsChange={setSelectedLogIds}
                                        onCreateSession={createSession}
                                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                                        onPreviewLog={(log) => {
                                            closeHistory();
                                            void previewGenerationLog(log);
                                        }}
                                        onRenameLog={(log, title) => void renameGenerationLog(log, title)}
                                        historyTotal={historyTotal}
                                        historyHasMore={historyHasMore}
                                        historyLoadingMore={historyLoadingMore}
                                        onLoadMore={() => void loadMoreLogs()}
                                        compact
                                    />
                                );
                            }}
                        />
                        <WorkbenchBackgroundTaskNotice count={logs.reduce((total, log) => total + (log.pendingCount || 0), 0)} />
                        <WorkbenchHistoryLoadError error={historyLoadError} loading={historyLoading} onRetry={() => void refreshLogs()} />
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
                                    setPrompt(editedMessage.text);
                                    setReferences(workbenchReferencesFromAttachments(editedMessage.attachments).images);
                                    message.info("已回填消息，可修改后重新发送");
                                }}
                                onRetryMessage={retryAgentMessage}
                            />
                        ) : (
                            <WorkbenchSkillEmptyState skills={availableSkills} onSelect={selectSkill} />
                        )}

                        <WorkbenchComposerFrame
                            summary={`${effectiveConfig.size} · ${effectiveConfig.count} 张`}
                            onAdd={() => fileInputRef.current?.click()}
                            onLibrary={() => setAssetPickerOpen(true)}
                            settingsContent={
                                <div className="grid grid-cols-2 gap-3">
                                    <GenerationSettings
                                        config={effectiveConfig}
                                        model={model}
                                        updateConfig={(key, value) => {
                                            setSmartPlanning(false);
                                            updateConfig(key, value);
                                        }}
                                        openConfigDialog={openConfigDialog}
                                        hideModel
                                    />
                                </div>
                            }
                            skills={availableSkills}
                            selectedSkill={selectedSkill}
                            onSelectSkill={selectSkill}
                            onRemoveSkill={() => {
                                setSmartPlanning(false);
                                setSelectedSkill(undefined);
                            }}
                            smartPlanning={smartPlanning}
                            agentModelId={selectedAgentModelId}
                            onAgentModelChange={(value) => {
                                setSmartPlanning(false);
                                setSelectedAgentModelId(value);
                            }}
                            agentModelDisabled={agentRunning}
                            modelPickerRequest={modelPickerRequest}
                            defaultModelCapability="image"
                            onSmartPlanningChange={(enabled) => (enabled ? enableSmartPlanning() : setSmartPlanning(false))}
                            models={agentModelOptions}
                            selectedModels={selectedAgentModels}
                            onToggleModel={(item) => selectImageModel(item.id)}
                            onClearModels={enableSmartPlanning}
                            submit={
                                agentRunning ? (
                                    <Button danger shape="circle" className="!h-9 !w-9 !min-w-9" icon={<Square className="size-3.5 fill-current" />} onClick={cancelAgentRun} aria-label="停止 Agent 并取消本次生成" />
                                ) : (
                                    <Button
                                        type="primary"
                                        shape="round"
                                        className="!h-9 !px-3 tabular-nums"
                                        loading={imageSubmitting}
                                        disabled={imageSubmitting || !canGenerate || activeImageTasks >= imageConcurrencyLimit}
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
                                placeholder="今天我们要创作什么，可直接粘贴文字或图片"
                                onChange={setPrompt}
                                onSubmit={() => {
                                    if (canGenerate) void runAgentGenerate();
                                }}
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
                                    className={cn(
                                        "hover-scrollbar flex min-h-0 w-full min-w-0 max-w-full gap-2 overflow-x-auto overflow-y-hidden p-0 overscroll-x-contain",
                                        isReferenceDragActive && "border-cyan-400 bg-cyan-50/60 ring-1 ring-cyan-200 dark:border-cyan-400 dark:bg-cyan-500/10 dark:ring-cyan-400/25",
                                    )}
                                    onDragEnter={handleReferenceDragOver}
                                    onDragOver={handleReferenceDragOver}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop}
                                    onWheel={(event) => {
                                        if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                        event.preventDefault();
                                        event.currentTarget.scrollLeft += event.deltaY;
                                    }}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-16 shrink-0 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">
                                            <img src={item.previewUrl || imagePreviewUrl(item.dataUrl, 256)} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(index)}</span>
                                            {item.uploadStatus === "uploading" ? (
                                                <span className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/45 text-[10px] font-medium text-white backdrop-blur-[1px]" title={item.uploadError}>
                                                    <LoaderCircle className="size-4 animate-spin" />
                                                    上传中
                                                </span>
                                            ) : item.uploadStatus === "failed" ? (
                                                <button
                                                    type="button"
                                                    className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-red-950/70 text-[10px] font-medium text-white backdrop-blur-[1px] transition hover:bg-red-950/80"
                                                    title={item.uploadError || "参考图上传失败"}
                                                    onClick={() => void retryReferenceUpload(item.id)}
                                                    aria-label={`重试上传参考图：${item.name}`}
                                                >
                                                    <CircleAlert className="size-4" />
                                                    点击重试
                                                </button>
                                            ) : null}
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button
                                                type="button"
                                                className="absolute right-1 top-1 z-20 flex size-6 items-center justify-center rounded bg-white/95 text-red-600 opacity-90 shadow-sm ring-1 ring-red-200 transition hover:opacity-100 dark:bg-black/70 dark:text-red-200 dark:ring-red-900/60"
                                                onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                aria-label="移除参考图"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </WorkbenchComposerFrame>

                        <div className="hidden">
                            <Button type="primary" size="large" block loading={imageSubmitting} disabled={imageSubmitting || !canGenerate || activeImageTasks >= imageConcurrencyLimit} onClick={() => void generate()}>
                                <span className="inline-flex items-center justify-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                                        <Sparkles className="size-[17px]" />
                                        <span className="text-sm font-semibold leading-none">{formatCreditAmount(pointsCost)}</span>
                                    </span>
                                    <span>开始生成</span>
                                </span>
                            </Button>
                            {activeImageTasks ? (
                                <div className="mt-2 text-center text-xs text-stone-500 dark:text-stone-400">
                                    当前用户运行 {activeImageTasks}/{imageConcurrencyLimit}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="thin-scrollbar order-2 rounded-xl border border-border bg-card p-2.5 lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:p-5 sm:p-4">
                        <div className="mb-2.5 flex items-center justify-between gap-2 sm:mb-4 sm:gap-3">
                            <div>
                                <h2 className="text-lg font-semibold sm:text-xl">生成结果</h2>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!resultEntries.length} onClick={toggleAllResults}>
                                    {allResultsSelected ? "取消" : "全选"}
                                </Button>
                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedVisibleResultIds.length} onClick={() => void deleteSelectedResults()}>
                                    删除{selectedVisibleResultIds.length ? ` ${selectedVisibleResultIds.length}` : ""}
                                </Button>
                                {missingVisibleResultIds.length ? (
                                    <Button size="small" icon={<Trash2 className="size-3.5" />} onClick={() => void deleteMissingResults()}>
                                        清理丢失 {missingVisibleResultIds.length}
                                    </Button>
                                ) : null}
                                {previewPendingCount ? <WorkbenchGenerationActivity kind="image" count={previewPendingCount} /> : null}
                                {previewLog?.status === "生成中" && !resultEntries.some((entry) => entry.result.taskState?.publicStatus === "cancelled") ? (
                                    <Button danger size="small" icon={<CircleStop className="size-3.5" />} loading={cancellingLogIds.includes(previewLog.id)} onClick={() => void cancelGenerationLog(previewLog)}>
                                        取消任务
                                    </Button>
                                ) : null}
                                {activeImageTasks ? (
                                    <span className="inline-flex h-7 items-center rounded-md bg-stone-100 px-2 text-xs font-medium text-stone-700 ring-1 ring-stone-200 dark:bg-white/10 dark:text-stone-200 dark:ring-white/10">
                                        运行 {activeImageTasks}/{imageConcurrencyLimit}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                        {resultEntries.length ? (
                            <div data-testid="image-results-grid" className={resultEntries.length === 1 ? "flex w-full items-start" : "grid w-full grid-cols-1 items-start gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4"}>
                                {resultEntries.map((entry) => (
                                    <div key={entry.key} data-testid="image-result-slot" data-record-id={entry.recordId} className={resultEntries.length === 1 ? "w-[320px] max-w-full" : "min-w-0"}>
                                        {entry.result.status === "success" && entry.result.image ? (
                                            <ResultImageCard
                                                image={entry.result.image}
                                                index={entry.displayIndex}
                                                large={resultEntries.length === 1}
                                                fluid={resultEntries.length > 1}
                                                missing={missingResultIds.includes(entry.key) || !entry.result.image.dataUrl}
                                                selected={selectedResultIds.includes(entry.key)}
                                                onSelectedChange={(checked) => toggleResultSelected(entry.key, checked)}
                                                onMissing={() => markResultMissing(entry.key)}
                                                onEdit={addResultToReferences}
                                                onDownload={downloadImage}
                                                onSaveAsset={saveResultToAssets}
                                            />
                                        ) : entry.result.status === "failed" ? (
                                            <FailedImageCard
                                                error={entry.result.error || "生成失败"}
                                                retryable={entry.result.canRetry === true}
                                                state={entry.result.taskState}
                                                large={resultEntries.length === 1}
                                                selected={selectedResultIds.includes(entry.key)}
                                                onSelectedChange={(checked) => toggleResultSelected(entry.key, checked)}
                                                onRetry={() => retryResult(entry.recordId, entry.resultId)}
                                            />
                                        ) : (
                                            <PendingImageCard large={resultEntries.length === 1} state={entry.result.taskState || entry.result.task?.taskState} />
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <CompactEmptyState
                                title="还没有生成图片"
                                description={model ? "描述想要的画面并开始生成，结果会按时间保留在这里。" : "当前没有可用图片模型，配置完成后即可开始生成。"}
                                icon={<ImagePlus className="size-4" />}
                                action={
                                    <Button size="small" type="primary" icon={model ? <Sparkles className="size-3.5" /> : <CircleAlert className="size-3.5" />} onClick={() => (model ? focusWorkbenchPromptEditor() : openConfigDialog(true, "image"))}>
                                        {model ? "开始创作" : "查看模型配置"}
                                    </Button>
                                }
                                className="min-h-20 sm:min-h-40 lg:min-h-[360px]"
                            />
                        )}
                    </div>
                </section>
            </main>
            <WorkbenchFileInput inputRef={fileInputRef} accept="image/*" onFiles={(files) => void addReferences(files)} />
            <Drawer title="生成记录" placement="bottom" size="min(86dvh, 720px)" open={logsOpen} onClose={() => setLogsOpen(false)} styles={{ body: { padding: 0, overflow: "hidden" } }}>
                <div className="thin-scrollbar h-full overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
                    <LogPanel
                        logs={conversationLogs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={activeHistoryLogId}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={(log) => void previewGenerationLog(log)}
                        onRenameLog={(log, title) => void renameGenerationLog(log, title)}
                        historyTotal={historyTotal}
                        historyHasMore={historyHasMore}
                        historyLoadingMore={historyLoadingMore}
                        onLoadMore={() => void loadMoreLogs()}
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
