"use client";

import { App } from "antd";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import { type WorkbenchAgentMessage } from "@/components/agent/workbench-agent-panel";
import { workbenchAttachmentsFromReferences } from "@/components/agent/workbench-agent-references";
import { findWorkbenchAgentSessionForRecord, removeWorkbenchAgentSessionsForRecords } from "@/components/agent/workbench-agent-session-store";
import { preloadWorkbenchResourceDialogs } from "@/components/agent/workbench-resource-dialogs";
import { requestCreditCost } from "@/constant/credits";
import { mergeWorkbenchAgentPatch, useWorkbenchAgentRun, type WorkbenchAgentParameterPatch } from "@/hooks/use-workbench-agent-run";
import { useWorkbenchAgentSessions } from "@/hooks/use-workbench-agent-sessions";
import { useWorkbenchCreativeReview } from "@/hooks/use-workbench-creative-review";
import { createFreshGenerationTaskContext } from "@/lib/generation-request-context";
import { generationLogPublicPrompt } from "@/lib/generation-log-snapshot";
import { closestImageAspectRatio, resolveImageRequestSize } from "@/lib/image-size";
import { mediaDownloadFileName } from "@/lib/media-file";
import { originalImageDownloadUrl, originalImageExtension } from "@/lib/media-image-url";
import { preloadOnIdle } from "@/lib/preload-on-idle";
import { resolveImageGenerationCount } from "@/lib/server/image-task-config";
import { imageAssetData, referenceImageFromAsset } from "@/lib/workbench-asset-reference";
import { deleteGenerationLogs as deleteServerGenerationLogs } from "@/services/api/generation-logs";
import { createImageGenerationTask, waitForImageGenerationTask } from "@/services/api/image";
import type { AgentSkillSummary } from "@/services/api/agent-skills";
import { deleteStoredImages, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { useUserStore } from "@/stores/use-user-store";
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
import { useImageReferenceInputs } from "./use-image-reference-inputs";

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
    const [smartPlanning, setSmartPlanning] = useState(true);
    const [modelPickerRequest, setModelPickerRequest] = useState(0);
    const planningDefaultKeyRef = useRef("");
    const requestModelSelection = useCallback(() => {
        setModelPickerRequest((value) => value + 1);
        message.warning("当前生图工作台未启用智能规划，请先选择图片模型");
    }, [message]);
    const resetPlanningToDefault = useCallback(
        (notify: boolean) => {
            setSelectedModelIds([]);
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
    const [logsOpen, setLogsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
    const [missingResultIds, setMissingResultIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const resultsByLogIdRef = useRef(new Map<string, GenerationResult[]>());
    const logsRef = useRef<GenerationLog[]>([]);
    const activeLogIdRef = useRef<string | null>(null);
    const taskControllersRef = useRef(new ImageTaskControllers());
    const logWriteQueuesRef = useRef(new Map<string, Promise<unknown>>());
    const deletedLogIdsRef = useRef(new Set<string>());
    const deletedResultIdsRef = useRef(new Set<string>());
    const imageConcurrencyLimitRef = useRef(4);
    const userIdRef = useRef("");
    const mountedRef = useRef(false);
    const [activeImageTasks, setActiveImageTasks] = useState(0);
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
    const previewPendingCount = results.filter((result) => result.status === "pending").length;
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
        setSelectedSkill(undefined);
        setSelectedModelIds([]);
        setSmartPlanning(true);
        if (userId) void refreshLogs(userId);
        else replaceLogs([]);
    }, [userId]);

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
        const visibleIds = new Set(results.map((result) => result.id));
        setMissingResultIds((ids) => ids.filter((id) => visibleIds.has(id)));
    }, [results]);

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

    function replaceLogs(nextLogs: GenerationLog[]) {
        const visibleLogs = nextLogs.filter((log) => !deletedLogIdsRef.current.has(log.id));
        logsRef.current = visibleLogs;
        if (mountedRef.current) setLogs(visibleLogs);
        const activeLogId = activeLogIdRef.current;
        if (activeLogId) {
            const nextActiveLog = visibleLogs.find((log) => log.id === activeLogId);
            if (nextActiveLog && mountedRef.current) setPreviewLog(nextActiveLog);
        }
        if (mountedRef.current) resumePendingLogs(visibleLogs);
    }

    function upsertLog(log: GenerationLog) {
        replaceLogs([log, ...logsRef.current.filter((item) => item.id !== log.id)].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
        if (activeLogIdRef.current === log.id && mountedRef.current) setPreviewLog(log);
    }

    const saveLog = async (log: GenerationLog) => {
        const ownedLog = withLogOwner(log, userIdRef.current);
        upsertLog(ownedLog);
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

    function patchLogResult(logId: string, resultId: string, patch: Partial<GenerationResult>, snapshot: GenerationSnapshot, durationMs: number) {
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
        persistLogResults(logId, snapshot, nextResults, durationMs);
        return nextResults;
    }

    function patchLogResultAt(logId: string, index: number, patch: Partial<GenerationResult>, snapshot: GenerationSnapshot, durationMs: number) {
        const log = getLatestLog(logId);
        if (!log) return [];
        const currentResults = getLogResults(log);
        const nextResults = updateResultAt(currentResults, index, patch);
        setLogResults(logId, nextResults);
        persistLogResults(logId, snapshot, nextResults, durationMs);
        return nextResults;
    }

    async function runQueuedImageTask<T>(logId: string, resultId: string, worker: () => Promise<T>) {
        return imageTaskQueue.run(logId, resultId, worker);
    }

    function resumePendingLogs(nextLogs: GenerationLog[]) {
        nextLogs.forEach((log) => {
            (log.imageTasks || []).forEach((pendingTask) => {
                const snapshot = snapshotFromLog(log, effectiveConfig, pendingTask.resultId);
                if (taskControllersRef.current.has(log.id, pendingTask.resultId, pendingTask.taskId)) return;
                const controller = taskControllersRef.current.create(log.id, pendingTask.resultId, pendingTask.taskId);
                void runQueuedImageTask(log.id, pendingTask.resultId, () => completeGenerationTask(log.id, pendingTask.resultId, pendingTask.index, snapshot, pendingTask, controller))
                    .catch((error) => {
                        if (controller.signal.aborted) return;
                        const durationMs = Math.max(log.durationMs || 0, Date.now() - pendingTask.startedAt);
                        patchLogResult(log.id, pendingTask.resultId, { status: "failed", error: error instanceof Error ? error.message : "生成失败", image: undefined, task: undefined }, snapshot, durationMs);
                    })
                    .finally(() => taskControllersRef.current.remove(log.id, pendingTask.resultId, pendingTask.taskId));
            });
        });
    }

    async function completeGenerationTask(logId: string, resultId: string, index: number, snapshot: GenerationSnapshot, pendingTask: PendingImageTask, controller?: AbortController) {
        const result = await waitForImageGenerationTask(snapshot.config, { id: pendingTask.taskId, kind: pendingTask.kind, model: pendingTask.model }, { signal: controller?.signal });
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
        patchLogResult(logId, resultId, { status: "success", image: nextImage, error: undefined, task: undefined }, snapshot, durationMs);
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
        const batchStartedAt = performance.now();
        const baseDurationMs = 0;
        const startedResults = [
            ...baseResults,
            ...Array.from({ length: snapshotCount }, (_, offset) => ({
                id: nanoid(),
                status: "pending" as const,
                task: undefined,
                error: undefined,
                image: undefined,
                slotIndex: baseResults.length + offset,
            })),
        ];
        const pendingLog = { ...buildLogFromResults(null, snapshot, startedResults, baseDurationMs, String(startedResults.length)), creativeConversationId: sharedConversationId };
        const logId = pendingLog.id;

        setSelectedResultIds([]);
        setMissingResultIds([]);
        setActiveAgentRecordId(logId);
        activeLogIdRef.current = logId;
        setPreviewLog(pendingLog);
        setLogResults(logId, startedResults);
        await saveLog(pendingLog);
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

        startedResults.slice(baseResults.length).forEach((result, offset) => {
            void runQueuedImageTask(logId, result.id, () => runGenerationSlot(logId, result.id, baseResults.length + offset, snapshot, batchStartedAt, baseDurationMs))
                .then((image) => {
                    if (image && mountedRef.current) message.success("图片已生成");
                })
                .catch((error) => {
                    if (mountedRef.current && !deletedResultIdsRef.current.has(`${logId}:${result.id}`)) message.error(error instanceof Error ? error.message : "生成失败");
                });
        });
        if (mountedRef.current) message.success("已加入当前用户生成队列");
        return logId;
    };

    const { agentRunning, runAgentGenerate, retryAgentMessage, cancelAgentRun, creativeReviewContext } = useWorkbenchAgentRun({
        workspace: "image",
        prompt,
        previousPrompt: lastAgentPrompt,
        models: selectableModelsByCapability(effectiveConfig, "image"),
        modelIds: selectedModelIds,
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
        const defaults = skill.defaultConfig || {};
        if (defaults.quality !== undefined) updateConfig("quality", String(defaults.quality));
        if (defaults.count !== undefined) updateConfig("count", String(defaults.count));
        if (defaults.size !== undefined) updateConfig("size", String(defaults.size));
        setSelectedSkill(skill);
    };

    const selectImageModel = (value: string) => {
        const selected = selectedModelIds.includes(value);
        const next = selected ? selectedModelIds.filter((id) => id !== value) : [...selectedModelIds, value].slice(-6);
        setSelectedModelIds(next);
        if (next.length) updateConfig("imageModel", selected ? next[0] : value);
        setSmartPlanning(next.length === 0);
    };

    const enableSmartPlanning = () => {
        setSelectedModelIds([]);
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
        const deleteIds = selectedLogIds.filter((id) => logsRef.current.some((log) => log.id === id));
        if (!deleteIds.length) {
            setDeleteConfirmOpen(false);
            return;
        }
        const deleteIdSet = new Set(deleteIds);
        const deletingActiveLog = Boolean(previewLog && deleteIdSet.has(previewLog.id));
        const imageKeys = logsRef.current.filter((log) => deleteIdSet.has(log.id)).flatMap((log) => log.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key)));
        deleteIds.forEach((id) => {
            deletedLogIdsRef.current.add(id);
            resultsByLogIdRef.current.delete(id);
        });
        replaceLogs(logsRef.current.filter((log) => !deleteIdSet.has(log.id)));
        setAgentSessions((current) => {
            const next = removeWorkbenchAgentSessionsForRecords(current, deleteIdSet).filter((session) => !deletingActiveLog || session.id !== activeAgentSessionId);
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
        const results = await Promise.allSettled([deleteStoredImages(imageKeys), deleteServerGenerationLogs(serverIds), removeStoredImageLogs(deleteIds)]);
        const failed = results.filter((result) => result.status === "rejected");
        if (failed.length) {
            message.warning("记录已移除，部分关联资源删除失败，请稍后重试");
        } else {
            message.success(`已删除 ${deleteIds.length} 条生成记录`);
        }
        await refreshLogs();
    };

    const refreshLogs = async (ownerUserId = userIdRef.current) => replaceLogs(ownerUserId ? await readStoredLogs(ownerUserId) : []);

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
        setReferences([]);
        setSelectedResultIds([]);
        if (currentLog.config.imageModel || currentLog.model) updateConfig("imageModel", currentLog.config.imageModel || currentLog.model);
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

    const runGenerationSlot = async (logId: string, resultId: string, index: number, snapshot: GenerationSnapshot, batchStartedAt: number, baseDurationMs: number, retryRequest = false) => {
        const itemStartedAt = Date.now();
        try {
            const latestTitle = getLatestLog(logId)?.title || snapshot.text.slice(0, 36) || "生图工作台";
            const conversationId = getLatestLog(logId)?.creativeConversationId;
            const task = await createImageGenerationTask(snapshot.config, snapshot.text, snapshot.references, undefined, {
                logSource: "image-workbench",
                logTitle: latestTitle,
                conversationId,
                surface: "chat",
                ...(retryRequest ? createFreshGenerationTaskContext("image-workbench-retry", [logId, resultId]) : { clientRequestId: `image-workbench:${logId}:${resultId}` }),
            });
            const pendingTask: PendingImageTask = { resultId, taskId: task.id, kind: task.kind, model: task.model, index, startedAt: itemStartedAt };
            const controller = taskControllersRef.current.create(logId, resultId, task.id);
            patchLogResult(logId, resultId, { status: "pending", task: pendingTask, error: undefined, image: undefined }, snapshot, baseDurationMs + performance.now() - batchStartedAt);
            return await completeGenerationTask(logId, resultId, index, snapshot, pendingTask, controller).finally(() => taskControllersRef.current.remove(logId, resultId, task.id));
        } catch (error) {
            patchLogResult(logId, resultId, { status: "failed", error: error instanceof Error ? error.message : "生成失败", image: undefined, task: undefined }, snapshot, baseDurationMs + performance.now() - batchStartedAt);
            throw error;
        }
    };

    const retryResult = (index: number) => {
        const currentLog = previewLog ? getLatestLog(previewLog.id) || previewLog : null;
        if (!currentLog) return;
        const currentResult = getLogResults(currentLog)[index];
        if (!currentResult) return;
        const snapshot = snapshotFromLog(currentLog, effectiveConfig, currentResult.id);
        const batchStartedAt = performance.now();
        patchLogResultAt(currentLog.id, index, { status: "pending", error: undefined, image: undefined, task: undefined }, snapshot, currentLog.durationMs || 0);
        void runQueuedImageTask(currentLog.id, currentResult.id, () => runGenerationSlot(currentLog.id, currentResult.id, index, snapshot, batchStartedAt, currentLog.durationMs || 0, true))
            .then((image) => {
                if (image) message.success("图片已重新生成");
            })
            .catch((error) => {
                if (!deletedResultIdsRef.current.has(`${currentLog.id}:${currentResult.id}`)) message.error(error instanceof Error ? error.message : "生成失败");
            });
    };

    const currentResultIds = results.map((result) => result.id);
    const selectedVisibleResultIds = selectedResultIds.filter((id) => currentResultIds.includes(id));
    const allResultsSelected = Boolean(results.length) && selectedVisibleResultIds.length === results.length;
    const missingVisibleResultIds = results.filter((result) => result.status === "success" && result.image && (!result.image.dataUrl || missingResultIds.includes(result.id))).map((result) => result.id);

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
        const currentLog = previewLog ? getLatestLog(previewLog.id) || previewLog : null;
        if (!currentLog || !ids.length) return;
        const selectedIds = new Set(ids);
        const currentResults = getLogResults(currentLog);
        const removedResults = currentResults.filter((result) => selectedIds.has(result.id));
        const nextResults = currentResults.filter((result) => !selectedIds.has(result.id));
        const storageKeys = removedResults.flatMap((result) => (result.image?.storageKey ? [result.image.storageKey] : []));
        removedResults.forEach((result) => {
            deletedResultIdsRef.current.add(`${currentLog.id}:${result.id}`);
            if (!result.task) return;
            taskControllersRef.current.abortAndRemove(currentLog.id, result.id, result.task.taskId);
        });
        const snapshot = snapshotFromLog(currentLog, effectiveConfig);
        const nextLog = buildLogFromResults(currentLog, snapshot, nextResults, currentLog.durationMs || 0, String(nextResults.length));
        setLogResults(currentLog.id, nextResults);
        setSelectedResultIds((value) => value.filter((id) => !selectedIds.has(id)));
        setMissingResultIds((value) => value.filter((id) => !selectedIds.has(id)));
        const cleanupResults = await Promise.allSettled([deleteStoredImages(storageKeys), deleteServerImageTaskLogsForResults(currentLog, removedResults, nextResults)]);
        await saveLog(nextLog);
        if (cleanupResults.some((result) => result.status === "rejected")) message.warning("结果已从当前记录移除，部分关联资源清理失败，请稍后重试");
        else message.success(successText || `已删除 ${removedResults.length} 个结果`);
    };

    const deleteSelectedResults = async () => {
        await deleteResultsByIds(selectedVisibleResultIds);
    };

    const deleteMissingResults = async () => {
        await deleteResultsByIds(missingVisibleResultIds, `已清理 ${missingVisibleResultIds.length} 个丢失图片`);
    };

    const renameGenerationLog = async (log: GenerationLog, title: string) => {
        const nextTitle = title.trim();
        if (!nextTitle || nextTitle === log.title) return;
        const latestLog = getLatestLog(log.id) || log;
        await saveLog({ ...latestLog, title: nextTitle });
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
    };
}

export type ImagePageController = ReturnType<typeof useImageWorkbenchController>;
