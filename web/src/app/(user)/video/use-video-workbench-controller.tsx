"use client";

import { App } from "antd";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";
import { type WorkbenchAgentMessage } from "@/components/agent/workbench-agent-panel";
import { findWorkbenchAgentSessionForRecord, removeWorkbenchAgentSessionsForRecords } from "@/components/agent/workbench-agent-session-store";
import { preloadWorkbenchResourceDialogs } from "@/components/agent/workbench-resource-dialogs";
import { requestCreditCost } from "@/constant/credits";
import { mergeWorkbenchAgentPatch, useWorkbenchAgentRun, type WorkbenchAgentParameterPatch } from "@/hooks/use-workbench-agent-run";
import { useWorkbenchAgentSessions } from "@/hooks/use-workbench-agent-sessions";
import { useWorkbenchCreativeReview } from "@/hooks/use-workbench-creative-review";
import { preloadOnIdle } from "@/lib/preload-on-idle";
import { SEEDANCE_REFERENCE_LIMITS, seedanceVideoReferenceError, seedanceVideoReferenceHint } from "@/lib/seedance-video";
import { referenceImageFromAsset, referenceVideoFromAsset, videoAssetData } from "@/lib/workbench-asset-reference";
import { deleteGenerationLogs as deleteServerGenerationLogs } from "@/services/api/generation-logs";
import type { AgentSkillSummary } from "@/services/api/agent-skills";
import { createServerVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo } from "@/services/api/video";
import { deleteStoredMedia } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import {
    buildLogFromVideoResults,
    buildVideoConfig,
    delay,
    normalizeLogConfig,
    normalizeResolution,
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

import { selectVideoModel } from "./video-workbench-panels";
import { useVideoReferenceInputs } from "./use-video-reference-inputs";

export function useVideoWorkbenchController() {
    const searchParams = useSearchParams();
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const startingVideoTasksRef = useRef(0);
    const queuedVideoLogsRef = useRef<Array<{ log: GenerationLog; configOverride?: AiConfig }>>([]);
    const queuedVideoLogIdsRef = useRef<Set<string>>(new Set());
    const videoConcurrencyLimitRef = useRef(1);
    const activeLogIdRef = useRef<string | null>(null);
    const logsRef = useRef<GenerationLog[]>([]);
    const deletedResultLogIdsRef = useRef(new Set<string>());
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const userId = useUserStore((state) => state.user?.id || "");
    const publicSessionReady = usePublicSessionStore((state) => state.ready);
    const defaultSmartPlanning = usePublicSessionStore((state) => state.payload?.settings?.generationDefaults?.workbenchSmartPlanning?.video) !== false;
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
    } = useWorkbenchAgentSessions("video", userId);
    const [selectedSkill, setSelectedSkill] = useState<AgentSkillSummary>();
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [smartPlanning, setSmartPlanning] = useState(true);
    const [modelPickerRequest, setModelPickerRequest] = useState(0);
    const planningDefaultKeyRef = useRef("");
    const requestModelSelection = useCallback(() => {
        setModelPickerRequest((value) => value + 1);
        message.warning("当前视频工作台未启用智能规划，请先选择视频模型");
    }, [message]);
    const resetPlanningToDefault = useCallback(
        (notify: boolean) => {
            setSelectedModelIds([]);
            setSmartPlanning(defaultSmartPlanning);
            if (!defaultSmartPlanning && notify) requestModelSelection();
        },
        [defaultSmartPlanning, requestModelSelection],
    );
    const importedPromptRef = useRef("");
    useEffect(() => {
        const source = searchParams.get("source");
        const importedPrompt = source === "drama" || source === "create" ? searchParams.get("prompt")?.trim() || "" : "";
        const size = searchParams.get("size");
        if (source === "drama" && (size === "9:16" || size === "16:9") && effectiveConfig.size !== size) updateConfig("size", size);
        const importKey = `${userId}:${importedPrompt}`;
        if (!agentSessionsHydrated || !importedPrompt || importedPromptRef.current === importKey) return;
        importedPromptRef.current = importKey;
        setPrompt(importedPrompt);
    }, [agentSessionsHydrated, effectiveConfig.size, searchParams, setPrompt, updateConfig, userId]);
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [audioReferences, setAudioReferences] = useState<ReferenceAudio[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [activeVideoCount, setActiveVideoCount] = useState(0);
    const [logsOpen, setLogsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [referenceDragTarget, setReferenceDragTarget] = useState<ReferenceDropTarget | null>(null);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const userIdRef = useRef("");

    const videoModelOptions = selectableModelsByCapability(effectiveConfig, "video");
    const model = selectVideoModel(effectiveConfig, videoModelOptions);
    const pointsCost = requestCreditCost({
        apiSource: effectiveConfig.apiSource,
        modelPointCosts: effectiveConfig.modelPointCosts,
        generationPointMultipliers: effectiveConfig.generationPointMultipliers,
        kind: "video",
        model,
        videoQuality: effectiveConfig.vquality,
        videoSeconds: effectiveConfig.videoSeconds,
    });
    const canGenerate = Boolean(prompt.trim());
    const videoConcurrencyLimit = Math.max(1, Math.min(5, Math.floor(Number(effectiveConfig.generationConcurrency?.video) || 1)));
    const previewPendingCount = results.filter((result) => result.status === "pending").length;

    useEffect(() => {
        userIdRef.current = userId;
        activeLogIdsRef.current.clear();
        queuedVideoLogsRef.current = [];
        queuedVideoLogIdsRef.current.clear();
        deletedResultLogIdsRef.current.clear();
        activeLogIdRef.current = null;
        setPreviewLog(null);
        setResults([]);
        setSelectedLogIds([]);
        setSelectedResultIds([]);
        setSelectedSkill(undefined);
        setSelectedModelIds([]);
        setSmartPlanning(true);
        syncActiveVideoCount();
        if (userId) void refreshLogs(userId);
        else {
            logsRef.current = [];
            setLogs([]);
        }
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
        videoConcurrencyLimitRef.current = videoConcurrencyLimit;
        startQueuedVideoLogs();
    }, [videoConcurrencyLimit]);
    const { addReferences, addReferencesFromClipboard, handleReferenceDragOver, handleReferenceDragLeave, handleReferenceDrop, referenceDropZoneClass, referenceFileAccepted } = useVideoReferenceInputs({
        references,
        videoReferences,
        audioReferences,
        referenceDragTarget,
        setReferences,
        setVideoReferences,
        setAudioReferences,
        setReferenceDragTarget,
        notice: message,
    });

    function currentVideoTaskCount() {
        return activeLogIdsRef.current.size + startingVideoTasksRef.current;
    }

    function syncActiveVideoCount() {
        const count = currentVideoTaskCount();
        setActiveVideoCount(count);
    }

    function beginStartingVideoTask() {
        startingVideoTasksRef.current += 1;
        syncActiveVideoCount();
    }

    function finishStartingVideoTask() {
        startingVideoTasksRef.current = Math.max(0, startingVideoTasksRef.current - 1);
        syncActiveVideoCount();
    }

    function enqueueVideoLog(log: GenerationLog, configOverride?: AiConfig) {
        if (!log.task || activeLogIdsRef.current.has(log.id) || queuedVideoLogIdsRef.current.has(log.id) || deletedResultLogIdsRef.current.has(log.id)) return;
        queuedVideoLogIdsRef.current.add(log.id);
        queuedVideoLogsRef.current.push({ log, configOverride });
    }

    function removeQueuedVideoLog(logId: string) {
        queuedVideoLogIdsRef.current.delete(logId);
        queuedVideoLogsRef.current = queuedVideoLogsRef.current.filter((item) => item.log.id !== logId);
    }

    function startQueuedVideoLogs() {
        while (currentVideoTaskCount() < videoConcurrencyLimitRef.current && queuedVideoLogsRef.current.length) {
            const item = queuedVideoLogsRef.current.shift();
            if (!item) return;
            queuedVideoLogIdsRef.current.delete(item.log.id);
            if (deletedResultLogIdsRef.current.has(item.log.id)) continue;
            void pollGenerationLog(item.log, item.configOverride);
        }
        syncActiveVideoCount();
    }

    function scheduleVideoLog(log: GenerationLog, configOverride?: AiConfig) {
        if (!log.task || activeLogIdsRef.current.has(log.id) || deletedResultLogIdsRef.current.has(log.id)) return;
        if (currentVideoTaskCount() >= videoConcurrencyLimitRef.current) {
            enqueueVideoLog(log, configOverride);
            syncActiveVideoCount();
            return;
        }
        void pollGenerationLog(log, configOverride);
    }

    const generate = async ({
        throwOnFailure = false,
        keepFailedResult = true,
        promptOverride,
        signal,
        parameterPatch,
        conversationId,
    }: {
        throwOnFailure?: boolean;
        keepFailedResult?: boolean;
        promptOverride?: string;
        signal?: AbortSignal;
        parameterPatch?: WorkbenchAgentParameterPatch;
        conversationId?: string;
    } = {}) => {
        const snapshot = buildRequestSnapshot(promptOverride, parameterPatch);
        if (!snapshot) return;
        let sharedConversationId = conversationId || activeCreativeConversationId;
        try {
            sharedConversationId ||= await ensureCreativeConversation();
        } catch (error) {
            if (signal) throw error;
            message.error(error instanceof Error ? error.message : "创作会话创建失败");
            return;
        }
        if (currentVideoTaskCount() >= videoConcurrencyLimitRef.current) {
            message.warning("当前用户视频生成已达到并发上限，请稍后再试");
            return;
        }
        const existingLog = previewLog ? getLatestLog(previewLog.id) || previewLog : null;
        const baseResults = existingLog ? resultsFromLog(existingLog).filter((result) => result.status !== "pending") : [];
        const pendingResultId = nanoid();
        const startedResults = [...baseResults, { id: pendingResultId, status: "pending" as const }];
        beginStartingVideoTask();
        setSelectedResultIds([]);
        setResults(startedResults);
        const batchStartedAt = performance.now();
        try {
            const task = await createServerVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, snapshot.videoReferences, snapshot.audioReferences, {
                signal,
                conversationId: sharedConversationId,
                surface: "chat",
                source: "video-workbench",
                clientRequestId: `video-workbench:${sharedConversationId}:${pendingResultId}`,
            });
            const log = { ...buildLogFromVideoResults(existingLog, snapshot, startedResults, existingLog?.durationMs || 0, undefined, { task, taskResultId: pendingResultId }), creativeConversationId: sharedConversationId };
            setActiveAgentRecordId(log.id);
            activeLogIdRef.current = log.id;
            setPreviewLog(log);
            await saveLog(log, { refresh: false });
            finishStartingVideoTask();
            scheduleVideoLog(log, snapshot.config);
            return log.id;
        } catch (error) {
            finishStartingVideoTask();
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            if (signal?.aborted || !keepFailedResult) {
                setResults(baseResults);
                setPreviewLog(existingLog);
                activeLogIdRef.current = existingLog?.id || null;
                setActiveAgentRecordId(existingLog?.id);
                startQueuedVideoLogs();
                if (throwOnFailure) throw error instanceof Error ? error : new Error(errorMessage);
                return;
            }
            const failedResults = startedResults.map((result) => (result.id === pendingResultId ? { id: pendingResultId, status: "failed" as const, error: errorMessage } : result));
            const failedLog = { ...buildLogFromVideoResults(existingLog, snapshot, failedResults, (existingLog?.durationMs || 0) + performance.now() - batchStartedAt, errorMessage), creativeConversationId: sharedConversationId };
            setActiveAgentRecordId(failedLog.id);
            activeLogIdRef.current = failedLog.id;
            setPreviewLog(failedLog);
            setResults(failedResults);
            await saveLog(failedLog);
            message.error(errorMessage);
            startQueuedVideoLogs();
            if (throwOnFailure) throw new Error(errorMessage);
        }
    };

    const { agentRunning, runAgentGenerate, cancelAgentRun, creativeReviewContext } = useWorkbenchAgentRun({
        workspace: "video",
        prompt,
        previousPrompt: lastAgentPrompt,
        models: videoModelOptions,
        modelIds: selectedModelIds,
        skillIds: selectedSkill ? [selectedSkill.id] : [],
        smartPlanning,
        currentConfig: { videoModel: model, size: effectiveConfig.size, vquality: effectiveConfig.vquality, videoSeconds: effectiveConfig.videoSeconds },
        hasReferences: references.length + videoReferences.length + audioReferences.length > 0,
        referenceTypes: [...(references.length ? (["image"] as const) : []), ...(videoReferences.length ? (["video"] as const) : []), ...(audioReferences.length ? (["audio"] as const) : [])],
        conversationId: activeCreativeConversationId,
        ensureCreativeConversation,
        setPrompt,
        setLastAgentPrompt,
        setAgentMessages,
        applyParameterPatch: (patch) => {
            if (patch.size) updateConfig("size", String(patch.size));
            if (patch.videoSeconds) updateConfig("videoSeconds", String(patch.videoSeconds));
            if (patch.vquality) updateConfig("vquality", String(patch.vquality));
            if (patch.model) {
                const patchedModel = selectVideoModel(effectiveConfig, videoModelOptions, patch.model);
                if (patchedModel) updateConfig("videoModel", patchedModel);
            }
        },
        submitGeneration: ({ promptOverride, signal, parameterPatch, conversationId }) => generate({ throwOnFailure: true, keepFailedResult: false, promptOverride, signal, parameterPatch, conversationId }),
        onManualModelRequired: requestModelSelection,
    });
    useWorkbenchCreativeReview({
        workspace: "video",
        recordId: previewLog?.id,
        completed: previewLog?.status === "成功" && !results.some((result) => result.status === "pending"),
        reviewContext: creativeReviewContext,
        assets: [],
    });

    const buildRequestSnapshot = (promptOverride?: string, parameterPatch?: WorkbenchAgentParameterPatch) => {
        const text = (promptOverride ?? prompt).trim();
        if (!text) {
            message.error("请输入视频提示词");
            return null;
        }
        const requestConfig = mergeWorkbenchAgentPatch(effectiveConfig, parameterPatch, "video");
        const requestModel = selectVideoModel(requestConfig, selectableModelsByCapability(requestConfig, "video"), parameterPatch?.model);
        if (!isAiConfigReady(requestConfig, requestModel)) {
            message.warning("请联系管理员在后台配置可用视频模型");
            openConfigDialog(true);
            return null;
        }
        const videoReferenceError = seedanceVideoReferenceError(videoReferences);
        if (videoReferenceError) {
            message.error(`${videoReferenceError}。${seedanceVideoReferenceHint}`);
            return null;
        }
        return { text, config: buildVideoConfig(requestConfig, requestModel), references: [...references], videoReferences: [...videoReferences], audioReferences: [...audioReferences] };
    };

    const retryResult = async () => {
        const currentLog = previewLog ? getLatestLog(previewLog.id) || previewLog : null;
        if (!currentLog) {
            message.error("找不到原任务记录，无法重试");
            return;
        }
        if (currentVideoTaskCount() >= videoConcurrencyLimitRef.current) {
            message.warning("当前用户视频生成已达到并发上限，请稍后再试");
            return;
        }

        const retryConfigSource = { ...effectiveConfig, ...currentLog.config };
        const retryModel = selectVideoModel(retryConfigSource, selectableModelsByCapability(retryConfigSource, "video"), currentLog.config.videoModel || currentLog.model || model);
        if (!isAiConfigReady(retryConfigSource, retryModel)) {
            message.warning("请联系管理员在后台配置可用视频模型");
            openConfigDialog(true);
            return;
        }
        const retryConfig = buildVideoConfig(retryConfigSource, retryModel);
        const retryStartedAt = Date.now();
        const pendingLog: GenerationLog = {
            ...currentLog,
            createdAt: retryStartedAt,
            time: new Date(retryStartedAt).toLocaleString("zh-CN", { hour12: false }),
            config: normalizeLogConfig({ ...currentLog, config: retryConfig }),
            size: retryConfig.size,
            resolution: normalizeResolution(retryConfig.vquality),
            seconds: retryConfig.videoSeconds,
            status: "生成中",
            task: undefined,
            video: undefined,
            error: undefined,
            durationMs: 0,
            resultDeleted: false,
        };

        beginStartingVideoTask();
        deletedResultLogIdsRef.current.delete(currentLog.id);
        removeQueuedVideoLog(currentLog.id);
        activeLogIdRef.current = currentLog.id;
        setPreviewLog(pendingLog);
        setResults([{ id: currentLog.id, status: "pending" }]);
        setSelectedResultIds([]);

        try {
            const retryReferences = currentLog.references || [];
            const retryVideoReferences = currentLog.videoReferences || [];
            const retryAudioReferences = currentLog.audioReferences || [];
            const task = await createServerVideoGenerationTask(retryConfig, currentLog.prompt, retryReferences, retryVideoReferences, retryAudioReferences, {
                conversationId: currentLog.creativeConversationId,
                surface: "chat",
                source: "video-workbench",
                attemptNo: 1,
                clientRequestId: `video-workbench-retry:${currentLog.id}:${retryStartedAt}`,
            });
            const nextLog = { ...pendingLog, task };
            await saveLog(nextLog, { refresh: false });
            finishStartingVideoTask();
            scheduleVideoLog(nextLog, retryConfig);
        } catch (error) {
            finishStartingVideoTask();
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            const failedLog: GenerationLog = { ...pendingLog, status: "失败", task: undefined, error: errorMessage, durationMs: Date.now() - retryStartedAt };
            setPreviewLog(failedLog);
            setResults([{ id: currentLog.id, status: "failed", error: errorMessage }]);
            await saveLog(failedLog);
            message.error(errorMessage);
            startQueuedVideoLogs();
        }
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveResultToAssets = async (video: GeneratedVideo) => {
        await addAsset({
            kind: "video",
            title: "生成视频",
            coverUrl: "",
            tags: [],
            source: "视频创作台",
            data: videoAssetData(video, video),
            metadata: { source: "video-page", prompt },
        });
        message.success("已加入我的素材");
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, referenceImageFromAsset(payload, stored, nanoid())].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        } else if (payload.kind === "video") {
            setVideoReferences((value) => [...value, referenceVideoFromAsset(payload, nanoid())].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        }
        setAssetPickerOpen(false);
    };

    const selectSkill = (skill: AgentSkillSummary) => {
        const defaults = skill.defaultConfig || {};
        if (defaults.size !== undefined) updateConfig("size", String(defaults.size));
        if (defaults.videoSeconds !== undefined) updateConfig("videoSeconds", String(defaults.videoSeconds));
        if (defaults.vquality !== undefined) updateConfig("vquality", String(defaults.vquality));
        setSelectedSkill(skill);
    };

    const selectVideoModelOption = (value: string) => {
        setSelectedModelIds((current) => {
            const next = current.includes(value) ? current.filter((id) => id !== value) : [...current, value].slice(-6);
            if (next.length) updateConfig("videoModel", current.includes(value) ? next[0] : value);
            setSmartPlanning(next.length === 0);
            return next;
        });
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
        setReferences([]);
        setVideoReferences([]);
        setAudioReferences([]);
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
        const mediaKeys = logs
            .filter((log) => deleteIdSet.has(log.id))
            .map((log) => log.video?.storageKey)
            .filter((key): key is string => Boolean(key));
        deleteIds.forEach((id) => {
            deletedResultLogIdsRef.current.add(id);
            removeQueuedVideoLog(id);
            activeLogIdsRef.current.delete(id);
        });
        syncActiveVideoCount();
        startQueuedVideoLogs();
        logsRef.current = logsRef.current.filter((log) => !deleteIdSet.has(log.id));
        setLogs(logsRef.current);
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
            setVideoReferences([]);
            setAudioReferences([]);
            activeLogIdRef.current = null;
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
        const results = await Promise.allSettled([deleteStoredMedia(mediaKeys), deleteServerGenerationLogs(deleteIds.map((id) => `video-workbench:${id}`)), removeStoredVideoLogs(deleteIds)]);
        const failed = results.filter((result) => result.status === "rejected");
        if (failed.length) {
            message.warning("记录已移除，部分关联资源删除失败，请稍后重试");
        } else {
            message.success(`已删除 ${deleteIds.length} 条生成记录`);
        }
        await refreshLogs();
    };

    const saveLog = async (log: GenerationLog, options?: { refresh?: boolean }) => {
        const ownedLog = withLogOwner(log, userIdRef.current);
        const nextLogs = [ownedLog, ...logsRef.current.filter((item) => item.id !== ownedLog.id)].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        logsRef.current = nextLogs;
        setLogs(nextLogs);
        if (activeLogIdRef.current === ownedLog.id) setPreviewLog(ownedLog);
        await saveStoredVideoLog(ownedLog);
        if (options?.refresh !== false) await refreshLogs();
    };

    const refreshLogs = async (ownerUserId = userIdRef.current) => {
        const nextLogs = ownerUserId ? await readStoredLogs(ownerUserId) : [];
        const visibleLogs = nextLogs.filter((log) => !deletedResultLogIdsRef.current.has(log.id));
        logsRef.current = visibleLogs;
        setLogs(visibleLogs);
        const activeLog = activeLogIdRef.current ? visibleLogs.find((log) => log.id === activeLogIdRef.current) : null;
        if (activeLog) setPreviewLog(activeLog);
        resumePendingLogs(visibleLogs);
        return visibleLogs;
    };

    const getLatestLog = (logId: string) => logsRef.current.find((log) => log.id === logId) || null;

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (log.status === "生成中" && log.task) scheduleVideoLog(log);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig) => {
        if (!log.task || activeLogIdsRef.current.has(log.id)) return;
        if (currentVideoTaskCount() >= videoConcurrencyLimitRef.current) {
            enqueueVideoLog(log, configOverride);
            syncActiveVideoCount();
            return;
        }
        activeLogIdsRef.current.add(log.id);
        syncActiveVideoCount();
        if (!activeLogIdRef.current) activeLogIdRef.current = log.id;
        if (activeLogIdRef.current === log.id) {
            setPreviewLog(log);
            setResults((value) => (value.length ? value : resultsFromLog(log)));
        }
        const taskConfigSource = { ...effectiveConfig, ...log.config };
        const taskConfig = buildVideoConfig(taskConfigSource, selectVideoModel(taskConfigSource, selectableModelsByCapability(taskConfigSource, "video"), log.task.model || log.model));
        const resultId = log.taskResultId || log.id;
        const snapshot = snapshotFromLog(log, taskConfig);
        try {
            for (let attempt = 0; attempt < 120; attempt += 1) {
                if (deletedResultLogIdsRef.current.has(log.id)) return;
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task);
                if (state.status === "completed") {
                    if (deletedResultLogIdsRef.current.has(log.id)) return;
                    const stored = await storeGeneratedVideo(state.result);
                    if (deletedResultLogIdsRef.current.has(log.id)) {
                        await deleteStoredMedia([stored.storageKey]);
                        return;
                    }
                    const nextVideo: GeneratedVideo = {
                        id: nanoid(),
                        url: stored.url,
                        remoteUrl: stored.remoteUrl,
                        serverUrl: stored.serverUrl,
                        storageKey: stored.storageKey,
                        durationMs: Date.now() - (log.taskStartedAt || log.createdAt),
                        width: stored.width || 1280,
                        height: stored.height || 720,
                        bytes: stored.bytes,
                        mimeType: stored.mimeType,
                    };
                    const latestLog = getLatestLog(log.id) || log;
                    const nextResults = replaceResult(resultsFromLog(latestLog), resultId, { id: nextVideo.id, status: "success", video: nextVideo });
                    const nextLog = buildLogFromVideoResults(latestLog, snapshot, nextResults, (latestLog.durationMs || 0) + nextVideo.durationMs);
                    if (activeLogIdRef.current === log.id) setResults(nextResults);
                    await saveLog(nextLog);
                    message.success("视频已生成");
                    return;
                }
                if (state.status === "failed") throw new Error(state.error);
                if (attempt === 119) throw new Error("视频生成超时，请稍后重试");
                await delay(log.task.provider === "seedance" ? 5000 : 2500);
            }
        } catch (error) {
            if (deletedResultLogIdsRef.current.has(log.id)) return;
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            const latestLog = getLatestLog(log.id) || log;
            const nextResults = replaceResult(resultsFromLog(latestLog), resultId, { id: resultId, status: "failed", error: errorMessage });
            const nextLog = buildLogFromVideoResults(latestLog, snapshot, nextResults, (latestLog.durationMs || 0) + Date.now() - (log.taskStartedAt || log.createdAt), errorMessage);
            if (activeLogIdRef.current === log.id) setResults(nextResults);
            await saveLog(nextLog);
            message.error(errorMessage);
        } finally {
            activeLogIdsRef.current.delete(log.id);
            syncActiveVideoCount();
            startQueuedVideoLogs();
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        activeLogIdRef.current = log.id;
        setPreviewLog(log);
        setLogsOpen(false);
        setSelectedResultIds([]);
        const session = findWorkbenchAgentSessionForRecord(agentSessions, log.id, log.prompt);
        const fallbackMessages: WorkbenchAgentMessage[] = [
            { id: `history-${log.id}-user`, role: "user", text: log.prompt },
            {
                id: `history-${log.id}-assistant`,
                role: log.status === "失败" ? "error" : "assistant",
                text: log.status === "失败" ? log.error || "该任务生成失败。" : log.status === "生成中" ? "该任务仍在生成中。" : "已打开这条历史生成记录，可以继续修改或重新生成。",
            },
        ];
        setActiveAgentRecordId(log.id);
        setActiveAgentSessionId(session?.id || `log-${log.id}`);
        setActiveCreativeConversationId(session?.creativeConversationId || log.creativeConversationId);
        setAgentMessages(session?.messages || fallbackMessages);
        setPrompt(session?.prompt || "");
        setLastAgentPrompt(session?.lastPrompt || log.prompt);
        setSelectedSkill(undefined);
        resetPlanningToDefault(false);
        setReferences(log.references || []);
        setVideoReferences(log.videoReferences || []);
        setAudioReferences(log.audioReferences || []);
        const historyModel = selectVideoModel(effectiveConfig, videoModelOptions, log.config.videoModel || log.model);
        if (historyModel) updateConfig("videoModel", historyModel);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        setResults(resultsFromLog(log));
    };

    const currentResultIds = results.map((result) => result.id);
    const selectedVisibleResultIds = selectedResultIds.filter((id) => currentResultIds.includes(id));
    const allResultsSelected = Boolean(results.length) && selectedVisibleResultIds.length === results.length;

    const toggleAllResults = () => {
        setSelectedResultIds(allResultsSelected ? [] : currentResultIds);
    };

    const toggleResultSelected = (id: string, checked: boolean) => {
        setSelectedResultIds((value) => (checked ? Array.from(new Set([...value, id])) : value.filter((item) => item !== id)));
    };

    const deleteSelectedResults = async () => {
        const currentLog = previewLog ? getLatestLog(previewLog.id) || previewLog : null;
        if (!currentLog || !selectedVisibleResultIds.length) return;
        const selectedIds = new Set(selectedVisibleResultIds);
        const removedResults = results.filter((result) => selectedIds.has(result.id));
        const nextResults = results.filter((result) => !selectedIds.has(result.id));
        const mediaKeys = removedResults.flatMap((result) => (result.video?.storageKey ? [result.video.storageKey] : []));
        deletedResultLogIdsRef.current.add(currentLog.id);
        removeQueuedVideoLog(currentLog.id);
        activeLogIdsRef.current.delete(currentLog.id);
        const keptVideos = nextResults.flatMap((result) => (result.status === "success" && result.video ? [result.video] : []));
        const keptVideo = keptVideos[keptVideos.length - 1];
        const failedResult = nextResults.find((result) => result.status === "failed");
        const pendingResult = nextResults.find((result) => result.status === "pending");
        const nextLog: GenerationLog = {
            ...currentLog,
            status: pendingResult ? "生成中" : keptVideo ? "成功" : failedResult ? "失败" : currentLog.status === "生成中" ? "失败" : currentLog.status,
            task: pendingResult ? currentLog.task : undefined,
            taskResultId: pendingResult ? currentLog.taskResultId : undefined,
            video: keptVideo,
            videos: keptVideos,
            failures: nextResults.flatMap((result) => (result.status === "failed" ? [{ resultId: result.id, error: result.error || "未知错误" }] : [])),
            error: failedResult?.error,
            resultDeleted: !nextResults.length,
        };
        setResults(nextResults);
        setSelectedResultIds([]);
        setPreviewLog(nextLog);
        syncActiveVideoCount();
        startQueuedVideoLogs();
        await Promise.all([deleteStoredMedia(mediaKeys), saveLog(nextLog)]);
        message.success(`已删除 ${removedResults.length} 个结果`);
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
    };
}

export type VideoPageController = ReturnType<typeof useVideoWorkbenchController>;
