"use client";

import { CheckSquare, CircleAlert, ClipboardPaste, Download, FolderPlus, ImagePlus, LoaderCircle, PenLine, Sparkles, Square, Trash2, Upload } from "lucide-react";
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
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { imagePreviewUrl } from "@/lib/media-image-url";
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
        smartPlanning,
        modelPickerRequest,
        setSmartPlanning,
        enableSmartPlanning,
        selectSkill,
        selectImageModel,
        agentSessionByRecordId,
        hasOlderAgentMessages,
        olderAgentMessagesLoading,
        loadOlderAgentMessages,
        importedCreatePromptRef,
        references,
        setReferences,
        results,
        setResults,
        logs,
        setLogs,
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
        patchLogResultAt,
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
        renameGenerationLog,
    } = controller;
    const agentModelOptions = selectableModelsByCapability(effectiveConfig, "image").map((id) => ({ id, name: modelOptionLabel(effectiveConfig, id), capability: "image" as const }));
    const selectedAgentModels = agentModelOptions.filter((item) => selectedModelIds.includes(item.id));
    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto p-2 lg:overflow-hidden sm:p-3">
                <section className="grid h-auto gap-3 sm:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] lg:overflow-hidden">
                    <div className="order-1 flex min-h-[9rem] flex-col overflow-hidden rounded-lg border border-border bg-card p-2 sm:min-h-[calc(100dvh-96px)] sm:rounded-xl sm:p-4 lg:order-2 lg:min-h-0">
                        <WorkbenchAgentHeader
                            subtitle="图片创作助手"
                            onNew={createSession}
                            historyContent={(query, closeHistory) => {
                                const filteredLogs = logs.filter((log) => {
                                    const session = agentSessionByRecordId.get(log.id);
                                    return matchesWorkbenchHistoryQuery(query, log.title, log.prompt, session?.searchText || "", ...(session?.messages.map((item) => item.text) || []));
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
                                            void previewGenerationLog(log);
                                        }}
                                        onRenameLog={(log, title) => void renameGenerationLog(log, title)}
                                        compact
                                    />
                                );
                            }}
                        />
                        <WorkbenchBackgroundTaskNotice count={logs.reduce((total, log) => total + (log.pendingCount || 0), 0)} />
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
                                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} hideModel />
                                </div>
                            }
                            skills={availableSkills}
                            selectedSkill={selectedSkill}
                            onSelectSkill={selectSkill}
                            onRemoveSkill={() => setSelectedSkill(undefined)}
                            smartPlanning={smartPlanning}
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
                                        disabled={!canGenerate || activeImageTasks >= imageConcurrencyLimit}
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
                            <Button type="primary" size="large" block disabled={!canGenerate || activeImageTasks >= imageConcurrencyLimit} onClick={() => void generate()}>
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
                                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!results.length} onClick={toggleAllResults}>
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
                                {activeImageTasks ? (
                                    <span className="inline-flex h-7 items-center rounded-md bg-stone-100 px-2 text-xs font-medium text-stone-700 ring-1 ring-stone-200 dark:bg-white/10 dark:text-stone-200 dark:ring-white/10">
                                        运行 {activeImageTasks}/{imageConcurrencyLimit}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                        {results.length ? (
                            <div className="flex w-full flex-wrap items-start gap-2.5 sm:gap-4">
                                {results.map((result, index) =>
                                    result.status === "success" && result.image ? (
                                        <ResultImageCard
                                            key={result.id}
                                            image={result.image}
                                            index={index}
                                            large={results.length === 1}
                                            missing={missingResultIds.includes(result.id) || !result.image.dataUrl}
                                            selected={selectedResultIds.includes(result.id)}
                                            onSelectedChange={(checked) => toggleResultSelected(result.id, checked)}
                                            onMissing={() => markResultMissing(result.id)}
                                            onEdit={addResultToReferences}
                                            onDownload={downloadImage}
                                            onSaveAsset={saveResultToAssets}
                                        />
                                    ) : result.status === "failed" ? (
                                        <FailedImageCard
                                            key={result.id}
                                            error={result.error || "生成失败"}
                                            large={results.length === 1}
                                            selected={selectedResultIds.includes(result.id)}
                                            onSelectedChange={(checked) => toggleResultSelected(result.id, checked)}
                                            onRetry={() => retryResult(index)}
                                        />
                                    ) : (
                                        <PendingImageCard key={result.id} large={results.length === 1} />
                                    ),
                                )}
                            </div>
                        ) : (
                            <CompactEmptyState title="还没有生成图片" description="完成一次生成后，结果会按时间保留在这里。" icon={<ImagePlus className="size-4" />} className="min-h-20 sm:min-h-40 lg:min-h-[360px]" />
                        )}
                    </div>
                </section>
            </main>
            <WorkbenchFileInput inputRef={fileInputRef} accept="image/*" onFiles={(files) => void addReferences(files)} />
            <Drawer title="生成记录" placement="bottom" size="min(86dvh, 720px)" open={logsOpen} onClose={() => setLogsOpen(false)} styles={{ body: { padding: 0, overflow: "hidden" } }}>
                <div className="thin-scrollbar h-full overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={(log) => void previewGenerationLog(log)}
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
