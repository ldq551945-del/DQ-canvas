"use client";

import { App } from "antd";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import { type WorkbenchAgentMessage } from "@/components/agent/workbench-agent-panel";
import { workbenchAttachmentsFromReferences } from "@/components/agent/workbench-agent-references";
import { workbenchConversationResultEntries } from "@/components/agent/workbench-conversation-results";
import { expandWorkbenchConversationSelection, findWorkbenchAgentSessionForRecord, removeWorkbenchAgentSessionsForRecords } from "@/components/agent/workbench-agent-session-store";
import { preloadWorkbenchResourceDialogs } from "@/components/agent/workbench-resource-dialogs";
import { requestCreditCost } from "@/constant/credits";
import { mergeWorkbenchAgentPatch, useWorkbenchAgentRun, type WorkbenchAgentParameterPatch } from "@/hooks/use-workbench-agent-run";
import { useWorkbenchAgentSessions } from "@/hooks/use-workbench-agent-sessions";
import { useWorkbenchCreativeReview } from "@/hooks/use-workbench-creative-review";
import { createFreshGenerationTaskContext, stableGenerationTaskRequestId } from "@/lib/generation-request-context";
import { generationLogPublicPrompt } from "@/lib/generation-log-snapshot";
import { closestImageAspectRatio, resolveImageRequestSize } from "@/lib/image-size";
import { mediaDownloadFileName } from "@/lib/media-file";
import { originalImageDownloadUrl, originalImageExtension } from "@/lib/media-image-url";
import { preloadOnIdle } from "@/lib/preload-on-idle";
import { resolveImageGenerationCount } from "@/lib/server/image-task-config";
import { imageAssetData, referenceImageFromAsset } from "@/lib/workbench-asset-reference";
import { deleteGenerationLogResults as deleteServerGenerationLogResults, deleteGenerationLogs as deleteServerGenerationLogs, renameGenerationLog as renameServerGenerationLog } from "@/services/api/generation-logs";
import { updateCreativeConversation } from "@/services/api/creative";
import { ImageGenerationTaskTerminalError, cancelImageGenerationTask, createImageGenerationTask, isImageGenerationTaskDeferredError, waitForImageGenerationTask } from "@/services/api/image";
import { isDefinitiveGenerationTaskRequestFailure } from "@/services/api/generation-task-request-error";
import { GenerationTaskStatePersistenceGate, isGenerationTaskNeedsReviewError } from "@/services/api/generation-task-state";
import type { AgentSkillSummary } from "@/services/api/agent-skills";
import { deleteStoredImages, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import { ImageSubmissionGate, ImageTaskControllers, ImageTaskQueue } from "./image-task-runner";
import {
    buildLogFromResults,
    deleteServerImageTaskLogsForResults,
    filterCoveredLocalImageTaskLogs,
    imageServerLogIds,
    normalizeGeneratedImage,
    readStoredLogPage,
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
import { useImageReferenceInputs } from "./use-image-reference-inputs";

const HISTORY_PAGE_SIZE = 20;

export function useImageWorkbenchController() {
    const searchParams = useSearchParams();
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const userId = useUserStore((state) => state.user?.id || "");
    const publicSessionReady = usePublicSessionStore((state) => state.ready);
    const defaultSmartPlanning = usePublicSessionStore((state) => state.payload?.settings?.generationDefaults?.workbenchSmartPlanning?.image) !== false;
    const {
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
        agentSessionByRecordId,
        loadAgentSession,
        hasOlderAgentMessages,
        olderAgentMessagesLoading,
        loadOlderAgentMessages,
    } = useWorkbenchAgentSessions("image", userId);
    const [selectedSkill, setSelectedSkill] = useState<AgentSkillSummary>();
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [selectedAgentModelId, setSelectedAgentModelId] = useState("");
    const [smartPlanning, setSmartPlanning] = useState(true);
    const [modelPickerRequest, setModelPickerRequest] = useState(0);
    const planningDefaultKeyRef = useRef("");
    const requestModelSelection = useCallback(() => {
        setModelPickerRequest((value) => value + 1);
        message.info("智能规划已关闭，可选择图片模型锁定候选；不选择也可由 Agent 自动匹配");
    }, [message]);
    const resetPlanningToDefault = useCallback(
        (notify: boolean) => {
            setSelectedModelIds([]);
            setSelectedSkill(undefined);
            setSelectedAgentModelId("");
            setSmartPlanning(defaultSmartPlanning);
            if (!defaultSmartPlanning && notify) requestModelSelection();
        },
        [defaultSmartPlanning, requestModelSelection],
    );
    const importedCreatePromptRef = useRef("");
    useEffect(() => {
        const importedPrompt = searchParams.get("source") === "create" ? searchParams.get("prompt")?.trim() || "" : "";
        const importKey = `${userId}:${importedPrompt}`;
        if (!agentSessionsHydrated || !importedPrompt || importedCreatePromptRef.current === importKey) return;
        importedCreatePromptRef.current = importKey;
        setPrompt(importedPrompt);
    }, [agentSessionsHydrated, searchParams, setPrompt, userId]);
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [historyPage, setHistoryPage] = useState(0);
    const [historyPageSize, setHistoryPageSize] = useState(HISTORY_PAGE_SIZE);
    const [historyLoadError, setHistoryLoadError] = useState("");
    const [logsOpen, setLogsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
    const [missingResultIds, setMissingResultIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [cancellingLogIds, setCancellingLogIds] = useState<string[]>([]);
    const resultsByLogIdRef = useRef(new Map<string, GenerationResult[]>());
    const logsRef = useRef<GenerationLog[]>([]);
    const activeLogIdRef = useRef<string | null>(null);
    const taskControllersRef = useRef(new ImageTaskControllers());
    const logWriteQueuesRef = useRef(new Map<string, Promise<unknown>>());
    const taskStatePersistenceRef = useRef(new GenerationTaskStatePersistenceGate());
    const deletedLogIdsRef = useRef(new Set<string>());
    const deletedResultIdsRef = useRef(new Set<string>());
    const imageConcurrencyLimitRef = useRef(4);
    const userIdRef = useRef("");
    const mountedRef = useRef(false);
    const historyRequestRef = useRef(0);
    const [activeImageTasks, setActiveImageTasks] = useState(0);
    const [imageSubmitting, setImageSubmitting] = useState(false);
    const imageSubmissionGateRef = useRef(new ImageSubmissionGate());
    const imageTaskQueueRef = useRef<ImageTaskQueue | null>(null);
    if (!imageTaskQueueRef.current) {
        imageTaskQueueRef.current = new ImageTaskQueue({
            getConcurrencyLimit: () => imageConcurrencyLimitRef.current,
            isResultDeleted: (logId, resultId) => deletedResultIdsRef.current.has(`${logId}:${resultId}`),
            onActiveCountChange: (count) => {
                if (mountedRef.current) setActiveImageTasks(count);
            },
        });
    }
    const imageTaskQueue = imageTaskQueueRef.current;

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim()) && references.every((reference) => !reference.uploadStatus);
    const generationCount = resolveImageGenerationCount(effectiveConfig.count);
    const imageConcurrencyLimit = Math.max(1, Math.min(10, Math.floor(Number(effectiveConfig.generationConcurrency?.image) || 4)));
    const pointsCost = requestCreditCost({
        apiSource: effectiveConfig.apiSource,
        modelPointCosts: effectiveConfig.modelPointCosts,
        generationPointMultipliers: effectiveConfig.generationPointMultipliers,
        kind: "image",
        model,
        count: generationCount,
        quality: effectiveConfig.quality,
    });

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        historyRequestRef.current += 1;
        userIdRef.current = userId;
        deletedLogIdsRef.current.clear();
        deletedResultIdsRef.current.clear();
        resultsByLogIdRef.current.clear();
        activeLogIdRef.current = null;
        setPreviewLog(null);
        setResults([]);
        setSelectedLogIds([]);
        setSelectedResultIds([]);
        setMissingResultIds([]);
        setCancellingLogIds([]);
        setSelectedSkill(undefined);
        setSelectedModelIds([]);
        setSelectedAgentModelId("");
        setSmartPlanning(true);
        setHistoryLoadError("");
        setHistoryLoading(false);
        setHistoryLoadingMore(false);
        setHistoryTotal(0);
        setHistoryPage(0);
        setHistoryPageSize(HISTORY_PAGE_SIZE);
        replaceLogs([], { resumePending: false });
        if (userId) void refreshLogs(userId);
    }, [userId]);

    useEffect(() => {
        if (!agentSessionsHydrated || !activeCreativeConversationId || activeLogIdRef.current) return;
        const currentLog = logs.find((log) => log.creativeConversationId === activeCreativeConversationId);
        if (!currentLog) return;
        const restoredResults = resultsFromLog(currentLog);
        activeLogIdRef.current = currentLog.id;
        resultsByLogIdRef.current.set(currentLog.id, restoredResults);
        setActiveAgentRecordId(currentLog.id);
        setPreviewLog(currentLog);
        setResults(restoredResults);
    }, [activeCreativeConversationId, agentSessionsHydrated, logs, setActiveAgentRecordId]);

    useEffect(() => {
        if (!publicSessionReady) return;
        const key = `${userId || "guest"}:${defaultSmartPlanning}`;
        if (planningDefaultKeyRef.current === key) return;
        planningDefaultKeyRef.current = key;
        resetPlanningToDefault(true);
    }, [defaultSmartPlanning, publicSessionReady, resetPlanningToDefault, userId]);

    useEffect(() => {
        return preloadOnIdle(() => {
            preloadWorkbenchResourceDialogs();
        });
    }, []);

    useEffect(() => {
        imageConcurrencyLimitRef.current = imageConcurrencyLimit;
        imageTaskQueue.startQueuedTasks();
    }, [imageConcurrencyLimit, imageTaskQueue]);

    useEffect(() => {
        return () => {
            taskControllersRef.current.clear();
            imageTaskQueue.clearQueue();
        };
    }, [imageTaskQueue]);

    const { addReferences, retryReferenceUpload, addReferencesFromClipboard, handleReferenceDragOver, handleReferenceDragLeave, handleReferenceDrop } = useImageReferenceInputs({
        references,
        setReferences,
        setDragActive: setIsReferenceDragActive,
        notice: message,
    });

    function replaceLogs(nextLogs: GenerationLog[], options?: { resumePending?: boolean }) {
        const visibleLogs = nextLogs.filter((log) => !deletedLogIdsRef.current.has(log.id));
        logsRef.current = visibleLogs;
        if (mountedRef.current) setLogs(visibleLogs);
        const activeLogId = activeLogIdRef.current;
        if (activeLogId) {
            const nextActiveLog = visibleLogs.find((log) => log.id === activeLogId);
            if (nextActiveLog && mountedRef.current) setPreviewLog(nextActiveLog);
        }
        if (mountedRef.current && options?.resumePending !== false) resumePendingLogs(visibleLogs);
    }

    function upsertLog(log: GenerationLog, options?: { resumePending?: boolean }) {
        replaceLogs(
            [log, ...logsRef.current.filter((item) => item.id !== log.id)].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
            options,
        );
        if (activeLogIdRef.current === log.id && mountedRef.current) setPreviewLog(log);
    }

    const saveLog = async (log: GenerationLog, options?: { resumePending?: boolean }) => {
        const ownedLog = withLogOwner(log, userIdRef.current);
        upsertLog(ownedLog, options);
        if (ownedLog.status !== "生成中") return;
        const previousWrite = logWriteQueuesRef.current.get(log.id) || Promise.resolve();
        const nextWrite = previousWrite.catch(() => {}).then(() => saveStoredImageLog(ownedLog));
        logWriteQueuesRef.current.set(log.id, nextWrite);
        await nextWrite;
        if (logWriteQueuesRef.current.get(log.id) === nextWrite) logWriteQueuesRef.current.delete(log.id);
    };

    function getLatestLog(logId: string) {
        return logsRef.current.find((log) => log.id === logId) || null;
    }

    function getLogResults(log: GenerationLog) {
        const cached = resultsByLogIdRef.current.get(log.id);
        if (cached) return cached;
        const nextResults = resultsFromLog(log);
        resultsByLogIdRef.current.set(log.id, nextResults);
        return nextResults;
    }

    function setLogResults(logId: string, nextResults: GenerationResult[]) {
        resultsByLogIdRef.current.set(logId, nextResults);
        if (activeLogIdRef.current === logId && mountedRef.current) setResults(nextResults);
    }

    function persistLogResults(logId: string, snapshot: GenerationSnapshot, nextResults: GenerationResult[], durationMs: number, error?: string) {
        const baseLog = getLatestLog(logId);
        if (!baseLog) return null;
        const nextLog = buildLogFromResults(baseLog, snapshot, nextResults, durationMs, String(Math.max(1, nextResults.length)), error);
        void saveLog(nextLog);
        return nextLog;
    }

    function patchLogResult(logId: string, resultId: string, patch: Partial<GenerationResult>, snapshot: GenerationSnapshot, durationMs: number, persist = true) {
        const log = getLatestLog(logId);
        if (!log) return [];
        if (deletedResultIdsRef.current.has(`${logId}:${resultId}`)) return getLogResults(log);
        const currentResults = getLogResults(log);
        let matched = false;
        const nextResults = currentResults.map((item) => {
            if (item.id !== resultId) return item;
            matched = true;
            return { ...item, ...patch, id: resultId };
        });
        if (!matched) {
            nextResults.push({ id: resultId, status: patch.status || "pending", ...patch });
        }
        setLogResults(logId, nextResults);
        if (persist) persistLogResults(logId, snapshot, nextResults, durationMs);
        return nextResults;
    }

    async function runQueuedImageTask<T>(logId: string, resultId: string, worker: () => Promise<T>) {
        return imageTaskQueue.run(logId, resultId, worker);
    }

    function resumePendingLogs(nextLogs: GenerationLog[]) {
        nextLogs.forEach((log) => {
            (log.imageTasks || []).forEach((pendingTask) => {
                const snapshot = snapshotFromLog(log, effectiveConfig, pendingTask.resultId);
                const requestKey = pendingImageTaskKey(pendingTask);
                if (!requestKey || taskControllersRef.current.has(log.id, pendingTask.resultId, requestKey)) return;
                const controller = taskControllersRef.current.create(log.id, pendingTask.resultId, requestKey);
                const worker = pendingTask.taskId
                    ? () => completeGenerationTask(log.id, pendingTask.resultId, pendingTask.index, snapshot, { ...pendingTask, taskId: pendingTask.taskId! }, controller)
                    : () => runGenerationSlot(log.id, pendingTask.resultId, pendingTask.index, snapshot, performance.now(), log.durationMs || 0, pendingTask, controller);
                void runQueuedImageTask(log.id, pendingTask.resultId, worker)
                    .catch((error) => {
                        if (controller.signal.aborted) return;
                        const terminal = error instanceof ImageGenerationTaskTerminalError || isGenerationTaskNeedsReviewError(error) || isDefinitiveGenerationTaskRequestFailure(error);
                        if (!terminal || isImageGenerationTaskDeferredError(error)) {
                            schedulePendingImageResume(log.id, pendingTask.resultId);
                            return;
                        }
                        const durationMs = Math.max(log.durationMs || 0, Date.now() - pendingTask.startedAt);
                        patchLogResult(
                            log.id,
                            pendingTask.resultId,
                            {
                                status: "failed",
                                error: error instanceof Error ? error.message : "生成失败",
                                canRetry: error instanceof ImageGenerationTaskTerminalError && error.canRetry,
                                image: undefined,
                                task: undefined,
                                taskState: pendingTask.taskState,
                            },
                            snapshot,
                            durationMs,
                        );
                    })
                    .finally(() => taskControllersRef.current.remove(log.id, pendingTask.resultId, requestKey));
            });
        });
    }

    function schedulePendingImageResume(logId: string, resultId: string) {
        globalThis.setTimeout(() => {
            if (!mountedRef.current) return;
            const latest = getLatestLog(logId);
            if (latest?.status !== "生成中" || !latest.imageTasks?.some((task) => task.resultId === resultId)) return;
            resumePendingLogs([latest]);
        }, 15_000);
    }

    async function completeGenerationTask(logId: string, resultId: string, index: number, snapshot: GenerationSnapshot, pendingTask: PendingImageTask & { taskId: string }, controller?: AbortController) {
        const result = await waitForImageGenerationTask(
            snapshot.config,
            { id: pendingTask.taskId, kind: pendingTask.kind, model: pendingTask.model },
            {
                signal: controller?.signal,
                onTaskState: (taskState) => {
                    pendingTask.taskState = taskState;
                    const persist = taskStatePersistenceRef.current.shouldPersist(`${logId}:${resultId}:${pendingTask.taskId}`, taskState);
                    patchLogResult(logId, resultId, { status: "pending", task: { ...pendingTask }, taskState }, snapshot, taskState.elapsedMs || Date.now() - pendingTask.startedAt, persist);
                },
            },
        );
        const imageMeta = await normalizeGeneratedImage(result.dataUrl, result.remoteUrl, result.serverUrl, result);
        const durationMs = Date.now() - pendingTask.startedAt;
        const nextImage: GeneratedImage = {
            id: resultId,
            dataUrl: imageMeta.url,
            remoteUrl: imageMeta.remoteUrl,
            serverUrl: imageMeta.serverUrl,
            storageKey: imageMeta.storageKey,
            taskId: pendingTask.taskId,
            slotIndex: index,
            durationMs,
            width: imageMeta.width,
            height: imageMeta.height,
            bytes: imageMeta.bytes,
            mimeType: imageMeta.mimeType,
        };
        patchLogResult(logId, resultId, { status: "success", image: nextImage, error: undefined, canRetry: undefined, task: undefined, taskState: undefined }, snapshot, durationMs);
        return nextImage;
    }

    const generate = async ({ promptOverride, userPrompt, signal, parameterPatch, conversationId }: { promptOverride?: string; userPrompt?: string; signal?: AbortSignal; parameterPatch?: WorkbenchAgentParameterPatch; conversationId?: string } = {}) => {
        const text = (promptOverride ?? prompt).trim();
        if (!text) {
            message.error("请输入生图提示词");
            return;
        }

        const snapshot = buildRequestSnapshot(text, parameterPatch, userPrompt);
        if (!snapshot) return;
        if (!imageSubmissionGateRef.current.tryStart()) {
            message.info("图片任务正在提交，请勿重复点击");
            return;
        }
        setImageSubmitting(true);
        try {
            let sharedConversationId = conversationId || activeCreativeConversationId;
            try {
                sharedConversationId ||= await ensureCreativeConversation();
            } catch (error) {
                if (signal) throw error;
                message.error(error instanceof Error ? error.message : "创作会话创建失败");
                return;
            }
            const snapshotCount = snapshot.count;
            if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");

            const baseResults: GenerationResult[] = [];
            const baseDurationMs = 0;
            const startedResults = [
                ...baseResults,
                ...Array.from({ length: snapshotCount }, (_, offset): GenerationResult => {
                    const id = nanoid();
                    const index = baseResults.length + offset;
                    return {
                        id,
                        status: "pending",
                        task: {
                            resultId: id,
                            clientRequestId: stableGenerationTaskRequestId("image-workbench", [sharedConversationId, id]),
                            kind: snapshot.references.length ? "edit" : "generation",
                            model: snapshot.config.imageModel || snapshot.config.model,
                            index,
                            startedAt: Date.now(),
                        },
                    };
                }),
            ];
            const pendingLog = { ...buildLogFromResults(null, snapshot, startedResults, baseDurationMs, String(startedResults.length)), creativeConversationId: sharedConversationId };
            const logId = pendingLog.id;

            setSelectedResultIds([]);
            setMissingResultIds([]);
            setActiveAgentRecordId(logId);
            activeLogIdRef.current = logId;
            setPreviewLog(pendingLog);
            setLogResults(logId, startedResults);
            await saveLog(pendingLog, { resumePending: false });
            if (signal?.aborted) {
                deletedLogIdsRef.current.add(logId);
                replaceLogs(logsRef.current.filter((log) => log.id !== logId));
                activeLogIdRef.current = null;
                setActiveAgentRecordId(undefined);
                setPreviewLog(null);
                setLogResults(logId, []);
                await removeStoredImageLogs([logId]);
                throw new DOMException("请求已取消", "AbortError");
            }

            resumePendingLogs([pendingLog]);
            if (mountedRef.current) message.success("已加入当前用户生成队列");
            return logId;
        } finally {
            imageSubmissionGateRef.current.finish();
            if (mountedRef.current) setImageSubmitting(false);
        }
    };

    const { agentRunning, runAgentGenerate, retryAgentMessage, cancelAgentRun, creativeReviewContext } = useWorkbenchAgentRun({
        workspace: "image",
        prompt,
        previousPrompt: lastAgentPrompt,
        models: selectableModelsByCapability(effectiveConfig, "image"),
        modelIds: selectedModelIds,
        agentModelId: selectedAgentModelId || undefined,
        skillIds: selectedSkill ? [selectedSkill.id] : [],
        smartPlanning,
        currentConfig: {
            imageModel: effectiveConfig.imageModel,
            size: effectiveConfig.size,
            quality: effectiveConfig.quality,
            count: effectiveConfig.count,
            referenceAspectRatio: closestImageAspectRatio(references[0]?.width, references[0]?.height),
        },
        hasReferences: references.length > 0,
        referenceTypes: references.length ? ["image"] : [],
        attachments: workbenchAttachmentsFromReferences({ images: references }),
        conversationId: activeCreativeConversationId,
        ensureCreativeConversation,
        setPrompt,
        setLastAgentPrompt,
        setAgentMessages,
        applyParameterPatch: (patch) => {
            if (patch.size) updateConfig("size", String(patch.size));
            if (patch.quality) updateConfig("quality", String(patch.quality));
            if (patch.count) updateConfig("count", String(patch.count));
            if (patch.model) updateConfig("imageModel", String(patch.model));
        },
        submitGeneration: ({ promptOverride, userPrompt, signal, parameterPatch, conversationId }) => generate({ promptOverride, userPrompt, signal, parameterPatch, conversationId }),
        onRequestSent: () => {
            setReferences([]);
            updateConfig("count", "1");
        },
        onManualModelRequired: requestModelSelection,
    });
    useWorkbenchCreativeReview({
        workspace: "image",
        recordId: previewLog?.id,
        completed: previewLog?.status === "成功" && !results.some((result) => result.status === "pending"),
        reviewContext: creativeReviewContext,
        assets: results.flatMap((result) => {
            if (result.status !== "success" || !result.image) return [];
            const url = stableResultImageUrl(result.image);
            return url ? [{ id: result.id, url }] : [];
        }),
    });

    const downloadImage = (image: GeneratedImage, index: number) => {
        if (!image.dataUrl) {
            message.error("图片不可用，无法下载");
            return;
        }
        saveAs(originalImageDownloadUrl(image.dataUrl), mediaDownloadFileName(image.id || `image-${index + 1}`, image.mimeType, image.storageKey || image.serverUrl || image.dataUrl));
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        if (!image.dataUrl) {
            message.error("图片不可用，无法加入参考图");
            return;
        }
        const stored = await uploadImage(image.dataUrl);
        setReferences((value) => [
            ...value,
            {
                id: nanoid(),
                name: `result-${index + 1}.${originalImageExtension(stored.url, stored.mimeType)}`,
                type: stored.mimeType,
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                url: image.remoteUrl || image.serverUrl,
                remoteUrl: image.remoteUrl,
                serverUrl: image.serverUrl,
                width: stored.width,
                height: stored.height,
            },
        ]);
        message.success("已加入参考图");
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        if (!image.dataUrl) {
            message.error("图片不可用，无法加入素材");
            return;
        }
        const stored = await uploadImage(image.dataUrl);
        await addAsset({
            kind: "image",
            title: `生成结果 ${index + 1}`,
            coverUrl: stored.url,
            tags: [],
            source: "生图工作台",
            data: imageAssetData(stored, image),
            metadata: { source: "image-page", prompt },
        });
        message.success("已加入我的素材");
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, referenceImageFromAsset(payload, stored, nanoid())]);
        } else {
            message.warning("生图工作台只能使用文本或图片素材");
        }
        setAssetPickerOpen(false);
    };

    const selectSkill = (skill: AgentSkillSummary) => {
        setSmartPlanning(false);
        const defaults = skill.defaultConfig || {};
        if (defaults.quality !== undefined) updateConfig("quality", String(defaults.quality));
        if (defaults.count !== undefined) updateConfig("count", String(defaults.count));
        if (defaults.size !== undefined) updateConfig("size", String(defaults.size));
        setSelectedSkill(skill);
    };

    const selectImageModel = (value: string) => {
        setSmartPlanning(false);
        const selected = selectedModelIds.includes(value);
        const next = selected ? selectedModelIds.filter((id) => id !== value) : [...selectedModelIds, value].slice(-6);
        setSelectedModelIds(next);
        if (next.length) updateConfig("imageModel", selected ? next[0] : value);
    };

    const enableSmartPlanning = () => {
        setSelectedModelIds([]);
        setSelectedSkill(undefined);
        setSelectedAgentModelId("");
        setSmartPlanning(true);
    };

    const createSession = () => {
        if (agentRunning) return message.info("Agent 正在处理当前需求，请稍候");
        if (logsRef.current.some((log) => log.status === "生成中")) message.info("后台生成任务会继续运行，可在历史记录中查看进度");
        setActiveAgentSessionId(nanoid());
        setActiveAgentRecordId(undefined);
        setActiveCreativeConversationId(undefined);
        setAgentMessages([]);
        setLastAgentPrompt("");
        setPrompt("");
        setSelectedSkill(undefined);
        resetPlanningToDefault(true);
        updateConfig("count", "1");
        setReferences([]);
        setResults([]);
        setSelectedLogIds([]);
        setSelectedResultIds([]);
        setPreviewLog(null);
        activeLogIdRef.current = null;
    };

    const deleteSelectedLogs = async () => {
        const selectedLogs = expandWorkbenchConversationSelection(logsRef.current, selectedLogIds);
        const deleteIds = selectedLogs.map((log) => log.id);
        if (!deleteIds.length) {
            setDeleteConfirmOpen(false);
            return;
        }
        const deleteIdSet = new Set(deleteIds);
        const conversationIds = Array.from(new Set(selectedLogs.map((log) => log.creativeConversationId).filter((id): id is string => Boolean(id))));
        const conversationIdSet = new Set(conversationIds);
        const deletingActiveLog = Boolean(previewLog && deleteIdSet.has(previewLog.id));
        const imageKeys = selectedLogs.flatMap((log) => log.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key)));
        deleteIds.forEach((id) => {
            deletedLogIdsRef.current.add(id);
            resultsByLogIdRef.current.delete(id);
        });
        replaceLogs(logsRef.current.filter((log) => !deleteIdSet.has(log.id)));
        setAgentSessions((current) => {
            const next = removeWorkbenchAgentSessionsForRecords(current, deleteIdSet).filter((session) => !conversationIdSet.has(session.creativeConversationId || session.id) && (!deletingActiveLog || session.id !== activeAgentSessionId));
            return next;
        });
        if (deletingActiveLog) {
            setPreviewLog(null);
            setResults([]);
            setSelectedResultIds([]);
            setActiveAgentSessionId(nanoid());
            setActiveAgentRecordId(undefined);
            setActiveCreativeConversationId(undefined);
            setAgentMessages([]);
            setLastAgentPrompt("");
            setPrompt("");
            setSelectedSkill(undefined);
            resetPlanningToDefault(true);
            setReferences([]);
            activeLogIdRef.current = null;
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
        const serverIds = deleteIds.flatMap(imageServerLogIds);
        const results = await Promise.allSettled([deleteStoredImages(imageKeys), deleteServerGenerationLogs(serverIds), removeStoredImageLogs(deleteIds), ...conversationIds.map((id) => updateCreativeConversation(id, { status: "archived" }))]);
        const failed = results.filter((result) => result.status === "rejected");
        if (failed.length) {
            message.warning("记录已移除，部分关联资源删除失败，请稍后重试");
        } else {
            message.success(`已删除 ${deleteIds.length} 条生成记录`);
        }
        await refreshLogs();
    };

    const refreshLogs = async (ownerUserId = userIdRef.current) => {
        const requestId = ++historyRequestRef.current;
        if (mountedRef.current) {
            setHistoryLoading(Boolean(ownerUserId));
            setHistoryLoadingMore(false);
            setHistoryLoadError("");
        }
        try {
            const result = ownerUserId ? await readStoredLogPage(ownerUserId, { page: 1, pageSize: HISTORY_PAGE_SIZE }) : { items: [], total: 0, page: 1, pageSize: HISTORY_PAGE_SIZE };
            const nextLogs = result.items;
            if (!mountedRef.current || requestId !== historyRequestRef.current || ownerUserId !== userIdRef.current) return logsRef.current;
            setHistoryTotal(result.total);
            setHistoryPage(result.page);
            setHistoryPageSize(result.pageSize);
            replaceLogs(nextLogs);
            return nextLogs;
        } catch (error) {
            if (mountedRef.current && requestId === historyRequestRef.current && ownerUserId === userIdRef.current) {
                setHistoryLoadError(error instanceof Error && error.message ? error.message : "生成记录加载失败，请稍后重试");
            }
            return logsRef.current;
        } finally {
            if (mountedRef.current && requestId === historyRequestRef.current) setHistoryLoading(false);
        }
    };

    const loadMoreLogs = async () => {
        const ownerUserId = userIdRef.current;
        if (!ownerUserId || historyLoadingMore || historyPage * historyPageSize >= historyTotal) return;
        const requestId = ++historyRequestRef.current;
        setHistoryLoading(false);
        setHistoryLoadingMore(true);
        setHistoryLoadError("");
        try {
            const result = await readStoredLogPage(ownerUserId, { page: historyPage + 1, pageSize: historyPageSize });
            if (!mountedRef.current || requestId !== historyRequestRef.current || ownerUserId !== userIdRef.current) return;
            const known = new Set(logsRef.current.map((log) => log.id));
            const mergedLogs = [...logsRef.current, ...result.items.filter((log) => !known.has(log.id))].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            const deduplicatedLogs = filterCoveredLocalImageTaskLogs(mergedLogs, mergedLogs).logs;
            setHistoryTotal(result.total);
            setHistoryPage(result.page);
            setHistoryPageSize(result.pageSize);
            replaceLogs(deduplicatedLogs);
        } catch (error) {
            if (mountedRef.current && requestId === historyRequestRef.current) setHistoryLoadError(error instanceof Error && error.message ? error.message : "更多生成记录加载失败，请稍后重试");
        } finally {
            if (mountedRef.current && requestId === historyRequestRef.current) setHistoryLoadingMore(false);
        }
    };

    const previewGenerationLog = async (log: GenerationLog) => {
        const currentLog = getLatestLog(log.id) || log;
        activeLogIdRef.current = currentLog.id;
        setPreviewLog(currentLog);
        setLogsOpen(false);
        const publicPrompt = generationLogPublicPrompt(currentLog);
        const session = findWorkbenchAgentSessionForRecord(agentSessions, currentLog.id, currentLog.creativeConversationId);
        const fallbackMessages: WorkbenchAgentMessage[] = [
            ...(publicPrompt ? [{ id: `history-${currentLog.id}-user`, role: "user" as const, text: publicPrompt }] : []),
            {
                id: `history-${currentLog.id}-assistant`,
                role: currentLog.status === "失败" ? "error" : "assistant",
                text: currentLog.status === "失败" ? currentLog.error || "该任务生成失败。" : currentLog.status === "生成中" ? "该任务仍在生成中。" : "已打开这条历史生成记录，可以继续修改或重新生成。",
            },
        ];
        setActiveAgentRecordId(currentLog.id);
        setActiveAgentSessionId(session?.id || `log-${currentLog.id}`);
        setActiveCreativeConversationId(session?.creativeConversationId || currentLog.creativeConversationId);
        setAgentMessages(session?.loaded && session.messages.length ? session.messages : fallbackMessages);
        setPrompt(session?.prompt || "");
        setLastAgentPrompt(session?.lastPrompt || publicPrompt);
        setSelectedSkill(undefined);
        resetPlanningToDefault(false);
        setSmartPlanning(false);
        setReferences([]);
        setSelectedResultIds([]);
        const historyModel = selectableModelsByCapability(effectiveConfig, "image").find((value) => value === (currentLog.config.imageModel || currentLog.model));
        if (historyModel) {
            setSelectedModelIds([historyModel]);
            updateConfig("imageModel", historyModel);
        }
        if (currentLog.config.quality) updateConfig("quality", currentLog.config.quality);
        if (currentLog.config.size) updateConfig("size", currentLog.config.size);
        updateConfig("count", "1");
        setLogResults(currentLog.id, getLogResults(currentLog));
        if (session && !session.loaded)
            void loadAgentSession(session)
                .then((loaded) => {
                    if (!loaded || activeLogIdRef.current !== currentLog.id) return;
                    setActiveAgentRecordId(loaded.recordId || currentLog.id);
                    setActiveAgentSessionId(loaded.id);
                    setActiveCreativeConversationId(loaded.creativeConversationId);
                    setAgentMessages(loaded.messages.length ? loaded.messages : fallbackMessages);
                    setLastAgentPrompt(loaded.lastPrompt || publicPrompt);
                })
                .catch(() => {
                    if (activeLogIdRef.current === currentLog.id) message.warning("完整对话加载失败，已显示当前生成记录");
                });
    };

    const buildRequestSnapshot = (promptOverride?: string, parameterPatch?: WorkbenchAgentParameterPatch, userPromptOverride?: string) => {
        const text = (promptOverride ?? prompt).trim();
        if (!text) {
            message.error("请输入生图提示词");
            return null;
        }
        const requestConfig = mergeWorkbenchAgentPatch(effectiveConfig, parameterPatch, "image");
        requestConfig.size = resolveImageRequestSize({
            prompt: text,
            configuredSize: effectiveConfig.size,
            referenceWidth: references[0]?.width,
            referenceHeight: references[0]?.height,
            plannedSize: parameterPatch?.size,
            defaultSize: requestConfig.size,
        });
        const requestModel = String(parameterPatch?.model || requestConfig.imageModel || requestConfig.model || "");
        if (!isAiConfigReady(requestConfig, requestModel)) {
            message.warning("请联系管理员在后台配置可用生图模型");
            openConfigDialog(true);
            return null;
        }
        return { text, userText: (userPromptOverride ?? prompt).trim() || text, config: { ...requestConfig, model: requestModel, count: "1" }, references: [...references], count: resolveImageGenerationCount(requestConfig.count) };
    };

    const runGenerationSlot = async (logId: string, resultId: string, index: number, snapshot: GenerationSnapshot, batchStartedAt: number, baseDurationMs: number, pendingRequest: PendingImageTask, controller?: AbortController) => {
        const latestTitle = getLatestLog(logId)?.title || snapshot.text.slice(0, 36) || "生图工作台";
        const conversationId = getLatestLog(logId)?.creativeConversationId;
        const clientRequestId = pendingRequest.clientRequestId || stableGenerationTaskRequestId("image-workbench", [conversationId || logId, resultId]);
        const task = await createImageGenerationTask(snapshot.config, snapshot.text, snapshot.references, undefined, {
            signal: controller?.signal,
            logSource: "image-workbench",
            logTitle: latestTitle,
            conversationId,
            surface: "chat",
            clientRequestId,
            generationLogId: `image-workbench:${logId}`,
            generationSlotId: resultId,
        });
        const pendingTask: PendingImageTask & { taskId: string } = { ...pendingRequest, clientRequestId, resultId, taskId: task.id, kind: task.kind, model: task.model, index };
        patchLogResult(logId, resultId, { status: "pending", task: pendingTask, error: undefined, canRetry: undefined, image: undefined }, snapshot, baseDurationMs + performance.now() - batchStartedAt);
        return completeGenerationTask(logId, resultId, index, snapshot, pendingTask, controller);
    };

    const retryResult = async (recordId: string, resultId: string) => {
        const currentLog = getLatestLog(recordId);
        if (!currentLog) return;
        const currentResults = getLogResults(currentLog);
        const index = currentResults.findIndex((result) => result.id === resultId);
        const currentResult = currentResults[index];
        if (!currentResult) return;
        const snapshot = snapshotFromLog(currentLog, effectiveConfig, currentResult.id);
        const retryContext = createFreshGenerationTaskContext("image-workbench-retry", [currentLog.id, currentResult.id]);
        const pendingTask: PendingImageTask = {
            resultId: currentResult.id,
            clientRequestId: retryContext.clientRequestId,
            kind: snapshot.references.length ? "edit" : "generation",
            model: snapshot.config.imageModel || snapshot.config.model,
            index,
            startedAt: Date.now(),
        };
        const nextResults = updateResultAt(currentResults, index, { status: "pending", error: undefined, canRetry: undefined, image: undefined, task: pendingTask });
        const nextLog = buildLogFromResults(currentLog, snapshot, nextResults, currentLog.durationMs || 0, String(nextResults.length));
        setLogResults(currentLog.id, nextResults);
        await saveLog(nextLog, { resumePending: false });
        resumePendingLogs([nextLog]);
        message.success("已重新加入生成队列");
    };

    const resultEntries = workbenchConversationResultEntries(logs, previewLog, (log) => (log.id === previewLog?.id ? results : resultsByLogIdRef.current.get(log.id) || resultsFromLog(log)));
    const currentResultIds = resultEntries.map((entry) => entry.key);
    const selectedVisibleResultIds = selectedResultIds.filter((id) => currentResultIds.includes(id));
    const allResultsSelected = Boolean(resultEntries.length) && selectedVisibleResultIds.length === resultEntries.length;
    const missingVisibleResultIds = resultEntries.filter((entry) => entry.result.status === "success" && entry.result.image && (!entry.result.image.dataUrl || missingResultIds.includes(entry.key))).map((entry) => entry.key);
    const previewPendingCount = resultEntries.filter((entry) => entry.result.status === "pending").length;

    const toggleAllResults = () => {
        setSelectedResultIds(allResultsSelected ? [] : currentResultIds);
    };

    const toggleResultSelected = (id: string, checked: boolean) => {
        setSelectedResultIds((value) => (checked ? Array.from(new Set([...value, id])) : value.filter((item) => item !== id)));
    };

    const markResultMissing = (id: string) => {
        setMissingResultIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    };

    const deleteResultsByIds = async (ids: string[], successText?: string) => {
        if (!ids.length) return;
        const selectedIds = new Set(ids);
        const selectedEntries = resultEntries.filter((entry) => selectedIds.has(entry.key));
        const entriesByRecord = new Map<string, typeof selectedEntries>();
        selectedEntries.forEach((entry) => entriesByRecord.set(entry.recordId, [...(entriesByRecord.get(entry.recordId) || []), entry]));
        const cleanup: Promise<unknown>[] = [];

        for (const [recordId, entries] of entriesByRecord) {
            const currentLog = getLatestLog(recordId);
            if (!currentLog) continue;
            const resultIds = new Set(entries.map((entry) => entry.resultId));
            const currentResults = getLogResults(currentLog);
            const removedResults = currentResults.filter((result) => resultIds.has(result.id));
            const nextResults = currentResults.filter((result) => !resultIds.has(result.id));
            const storageKeys = removedResults.flatMap((result) => (result.image?.storageKey ? [result.image.storageKey] : []));
            removedResults.forEach((result) => {
                deletedResultIdsRef.current.add(`${currentLog.id}:${result.id}`);
                if (!result.task) return;
                const requestKey = pendingImageTaskKey(result.task);
                if (requestKey) taskControllersRef.current.abortAndRemove(currentLog.id, result.id, requestKey);
            });
            const snapshot = snapshotFromLog(currentLog, effectiveConfig);
            const nextLog = buildLogFromResults(currentLog, snapshot, nextResults, currentLog.durationMs || 0, String(nextResults.length));
            setLogResults(currentLog.id, nextResults);
            cleanup.push(deleteStoredImages(storageKeys), deleteServerImageTaskLogsForResults(currentLog, removedResults, nextResults));
            if (!currentLog.id.startsWith("image-task-")) cleanup.push(deleteServerGenerationLogResults(`image-workbench:${currentLog.id}`, [...resultIds]));
            await saveLog(nextLog);
        }

        setSelectedResultIds((value) => value.filter((id) => !selectedIds.has(id)));
        setMissingResultIds((value) => value.filter((id) => !selectedIds.has(id)));
        const cleanupResults = await Promise.allSettled(cleanup);
        if (cleanupResults.some((result) => result.status === "rejected")) message.warning("结果已从当前记录移除，部分关联资源清理失败，请稍后重试");
        else message.success(successText || `已删除 ${selectedEntries.length} 个结果`);
    };

    const deleteSelectedResults = async () => {
        await deleteResultsByIds(selectedVisibleResultIds);
    };

    const deleteMissingResults = async () => {
        await deleteResultsByIds(missingVisibleResultIds, `已清理 ${missingVisibleResultIds.length} 个丢失图片`);
    };

    const cancelGenerationLog = async (log: GenerationLog) => {
        const currentLog = getLatestLog(log.id) || log;
        const currentResults = getLogResults(currentLog);
        const pending = currentResults.filter((result) => result.status === "pending" && result.task?.taskId);
        if (!pending.length) {
            message.info("当前图片任务正在提交或已经结束");
            return;
        }
        setCancellingLogIds((ids) => (ids.includes(currentLog.id) ? ids : [...ids, currentLog.id]));
        try {
            const outcomes = await Promise.allSettled(pending.map((result) => cancelImageGenerationTask({ id: result.task!.taskId! })));
            const outcomeByResultId = new Map(pending.map((result, index) => [result.id, outcomes[index]]));
            const nextResults = currentResults.map((result) => {
                const outcome = outcomeByResultId.get(result.id);
                if (!outcome || outcome.status === "rejected") return result;
                return {
                    ...result,
                    status: "pending" as const,
                    error: undefined,
                    canRetry: undefined,
                    taskState: outcome.value,
                };
            });
            const snapshot = snapshotFromLog(currentLog, effectiveConfig);
            const nextLog = buildLogFromResults(currentLog, snapshot, nextResults, Math.max(currentLog.durationMs || 0, Date.now() - currentLog.createdAt), String(nextResults.length));
            setLogResults(currentLog.id, nextResults);
            await saveLog(nextLog);
            if (activeLogIdRef.current === currentLog.id) setPreviewLog(nextLog);
            if (outcomes.some((outcome) => outcome.status === "rejected")) message.warning("部分图片任务取消请求失败，未成功登记的任务会继续生成");
            else message.info("已提交图片任务取消，正在确认上游状态；余额将在确认后更新");
        } finally {
            setCancellingLogIds((ids) => ids.filter((id) => id !== currentLog.id));
        }
    };

    const renameGenerationLog = async (log: GenerationLog, title: string) => {
        const nextTitle = title.trim();
        if (!nextTitle || nextTitle === log.title) return;
        const latestLog = getLatestLog(log.id) || log;
        await Promise.all([renameServerGenerationLog(imageServerLogIds(log.id)[0], nextTitle), log.creativeConversationId ? updateCreativeConversation(log.creativeConversationId, { title: nextTitle }) : Promise.resolve()]);
        if (log.creativeConversationId) {
            setAgentSessions((sessions) => sessions.map((session) => (session.creativeConversationId === log.creativeConversationId || session.id === log.creativeConversationId ? { ...session, title: nextTitle } : session)));
        }
        upsertLog({ ...latestLog, title: nextTitle });
    };

    return {
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
        agentSessionByRecordId,
        hasOlderAgentMessages,
        olderAgentMessagesLoading,
        loadOlderAgentMessages,
        importedCreatePromptRef,
        references,
        setReferences,
        results,
        resultEntries,
        setResults,
        logs,
        setLogs,
        historyLoading,
        historyLoadingMore,
        historyTotal,
        historyHasMore: historyPage * historyPageSize < historyTotal,
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
    };
}

export type ImagePageController = ReturnType<typeof useImageWorkbenchController>;

function pendingImageTaskKey(task: PendingImageTask) {
    return task.clientRequestId || task.taskId || "";
}
