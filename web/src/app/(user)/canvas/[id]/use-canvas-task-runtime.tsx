"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";

import { createFreshGenerationTaskContext } from "@/lib/generation-request-context";
import { storeGeneratedAudio, waitForAudioGenerationTask } from "@/services/api/audio";
import { cancelCanvasGenerationTask } from "@/services/api/generation-tasks";
import { createImageGenerationTask, waitForImageGenerationTask, type ImageGenerationTask } from "@/services/api/image";
import { waitForTextGenerationTask, type TextGenerationTask } from "@/services/api/text";
import { storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { NODE_DEFAULT_SIZE } from "../constants";
import { CanvasNodeType, type CanvasNodeMetadata } from "../types";
import { fitNodeSize } from "../utils/canvas-node-size";
import { PANORAMA_IMAGE_SIZE } from "../utils/canvas-panorama";
import { compositeEmotionImage } from "../utils/canvas-emotion";
import { resolveEmotionSource, sameEmotionSource } from "../utils/canvas-emotion-request";
import { notifyCanvasGenerationTaskCreated } from "../utils/canvas-generation-task-events";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

import { CanvasHistoryEntry, NODE_STATUS_IDLE, NODE_STATUS_LOADING, NODE_STATUS_SUCCESS, VIDEO_NODE_MAX_HEIGHT, VIDEO_NODE_MAX_WIDTH, type CanvasGenerationRequest } from "./canvas-page-elements";
import { audioMetadata, imageMetadata, uploadGeneratedCanvasImage, videoMetadata } from "./canvas-page-utils";

import type { CanvasPageState } from "./use-canvas-page-state";

export function useCanvasTaskRuntime({ state }: { state: CanvasPageState }) {
    const {
        message,
        modal,
        params,
        router,
        projectId,
        containerRef,
        imageInputRef,
        uploadTargetRef,
        clipboardRef,
        historyRef,
        lastHistoryRef,
        historyCommitTimerRef,
        viewportSaveTimerRef,
        applyingHistoryRef,
        historyPausedRef,
        didInitialCenterRef,
        rafRef,
        toolbarHideTimerRef,
        nodeDraggingRef,
        dragRef,
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        addAsset,
        userId,
        hydrated,
        hydratedUserId,
        hydrate,
        createProject,
        updateProject,
        renameProject,
        deleteProjects,
        currentProject,
        theme,
        nodes,
        setNodes,
        connections,
        setConnections,
        chatSessions,
        setChatSessions,
        activeChatId,
        setActiveChatId,
        viewport,
        setViewport,
        size,
        setSize,
        selectedNodeIds,
        setSelectedNodeIds,
        selectedConnectionId,
        setSelectedConnectionId,
        hoveredNodeId,
        setHoveredNodeId,
        connectingParams,
        setConnectingParams,
        connectionTargetNodeId,
        setConnectionTargetNodeId,
        pendingConnectionCreate,
        setPendingConnectionCreate,
        mouseWorld,
        setMouseWorld,
        selectionBox,
        setSelectionBox,
        contextMenu,
        setContextMenu,
        runningNodeId,
        setRunningNodeId,
        isMiniMapOpen,
        setIsMiniMapOpen,
        backgroundMode,
        setBackgroundMode,
        showImageInfo,
        setShowImageInfo,
        clearConfirmOpen,
        setClearConfirmOpen,
        assetPickerOpen,
        setAssetPickerOpen,
        projectLoaded,
        setProjectLoaded,
        toolbarNodeId,
        setToolbarNodeId,
        nodeImageSettingsOpen,
        setNodeImageSettingsOpen,
        dialogNodeId,
        setDialogNodeId,
        editingNodeId,
        setEditingNodeId,
        editRequestNonce,
        setEditRequestNonce,
        infoNodeId,
        setInfoNodeId,
        cropNodeId,
        setCropNodeId,
        maskEditNodeId,
        setMaskEditNodeId,
        splitNodeId,
        setSplitNodeId,
        upscaleNodeId,
        setUpscaleNodeId,
        angleNodeId,
        setAngleNodeId,
        previewNodeId,
        setPreviewNodeId,
        assistantCollapsed,
        setAssistantCollapsed,
        assistantMounted,
        setAssistantMounted,
        assistantClosing,
        setAssistantClosing,
        titleEditing,
        setTitleEditing,
        titleDraft,
        setTitleDraft,
        historyState,
        setHistoryState,
        collapsingBatchIds,
        setCollapsingBatchIds,
        openingBatchIds,
        setOpeningBatchIds,
        isNodeDragging,
        setIsNodeDragging,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        connectingParamsRef,
        connectionTargetNodeIdRef,
        selectionBoxRef,
        agentCloseTimerRef,
        pendingConnectionCreateRef,
        generationRequestsRef,
        resumingImageTaskIdsRef,
        resumingVideoTaskIdsRef,
        resumingTextTaskIdsRef,
        resumingAudioTaskIdsRef,
    } = state;

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, controller = new AbortController()) => {
        const previous = generationRequestsRef.current.get(targetNodeId);
        if (previous?.controller !== controller) {
            previous?.controller.abort();
            if (previous?.persistedTask) void cancelCanvasGenerationTask(previous.persistedTask).catch((error) => console.warn("取消被替换的画布任务失败", { taskId: previous.persistedTask?.id, type: previous.persistedTask?.type, error }));
        }
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const attachGenerationTask = useCallback((targetNodeId: string, controller: AbortController, task: { id: string; type: string }) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (!request || request.controller !== controller || controller.signal.aborted) {
            void cancelCanvasGenerationTask(task).catch((error) => console.warn("取消孤儿画布任务失败", { taskId: task.id, type: task.type, error }));
            return false;
        }
        request.persistedTask = task;
        return true;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller !== controller) return false;
        generationRequestsRef.current.delete(targetNodeId);
        return true;
    }, []);

    const isGenerationRequestActive = useCallback((targetNodeId: string, controller: AbortController) => !controller.signal.aborted && generationRequestsRef.current.get(targetNodeId)?.controller === controller, []);

    const assertGenerationRequestActive = useCallback(
        (targetNodeId: string, controller: AbortController) => {
            if (!isGenerationRequestActive(targetNodeId, controller)) throw new DOMException("Generation request cancelled", "AbortError");
        },
        [isGenerationRequestActive],
    );

    /**
     * Invalidates all in-flight work owned by a node. Call this before
     * deleting or replacing a node's media so a late provider response cannot
     * write its old result back into the canvas.
     */
    const cancelPersistedTasks = useCallback((requests: CanvasGenerationRequest[]) => {
        const tasks = new Map<string, { id: string; type: string }>();
        requests.forEach((request) => {
            if (request.persistedTask) tasks.set(`${request.persistedTask.type}:${request.persistedTask.id}`, request.persistedTask);
        });
        tasks.forEach((task) => void cancelCanvasGenerationTask(task).catch((error) => console.warn("取消画布任务失败", { taskId: task.id, type: task.type, error })));
    }, []);

    const invalidateGenerationRequest = useCallback(
        (nodeId: string) => {
            const requests = Array.from(generationRequestsRef.current.values());
            const affected = requests.filter((request) => request.targetNodeId === nodeId || request.originNodeId === nodeId || request.runningNodeId === nodeId);
            if (!affected.length) return false;

            const controllers = new Set(affected.map((request) => request.controller));
            cancelPersistedTasks(affected);
            affected.forEach((request) => request.controller.abort());
            requests.forEach((request) => {
                if (controllers.has(request.controller)) generationRequestsRef.current.delete(request.targetNodeId);
            });
            setRunningNodeId((current) => (affected.some((request) => request.runningNodeId === current) ? null : current));
            return true;
        },
        [cancelPersistedTasks, setRunningNodeId],
    );

    const stopGenerationByRunningId = useCallback(
        (runningId: string) => {
            const affectedNodeIds = new Set<string>();
            const affectedRequests: CanvasGenerationRequest[] = [];
            generationRequestsRef.current.forEach((request) => {
                if (request.runningNodeId !== runningId) return;
                affectedRequests.push(request);
                request.controller.abort();
                generationRequestsRef.current.delete(request.targetNodeId);
                affectedNodeIds.add(request.targetNodeId);
                affectedNodeIds.add(request.originNodeId);
            });
            cancelPersistedTasks(affectedRequests);
            setRunningNodeId((current) => (current === runningId ? null : current));
            if (!affectedNodeIds.size) return;
            setNodes((prev) =>
                prev.map((node) =>
                    affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  status: NODE_STATUS_IDLE,
                                  errorDetails: undefined,
                                  taskId: undefined,
                                  taskStatus: undefined,
                                  taskProgress: undefined,
                                  taskStage: undefined,
                                  taskCreatedAt: undefined,
                                  taskStartedAt: undefined,
                                  taskUpdatedAt: undefined,
                                  taskDetails: undefined,
                                  videoTask: undefined,
                                  imageTask: undefined,
                                  textTask: undefined,
                                  audioTask: undefined,
                              },
                          }
                        : node,
                ),
            );
        },
        [cancelPersistedTasks, setNodes, setRunningNodeId],
    );

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: "停止生成？",
                content: "当前生成请求会被中断，已经生成完成的内容会保留。",
                okText: "停止",
                cancelText: "继续生成",
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId],
    );

    const completeVideoTask = useCallback(
        async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["videoTask"]>, controller: AbortController, prompt?: string) => {
            const completedTask = await waitForVideoGenerationTask(generationConfig, task, { signal: controller.signal });
            assertGenerationRequestActive(nodeId, controller);
            const video = await storeGeneratedVideo(completedTask);
            assertGenerationRequestActive(nodeId, controller);
            setNodes((prev) =>
                prev.map((node) => {
                    if (node.id !== nodeId) return node;
                    if (!isGenerationRequestActive(nodeId, controller)) return node;
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    return {
                        ...node,
                        ...(node.metadata?.locked
                            ? {}
                            : {
                                  width: videoSize.width,
                                  height: videoSize.height,
                                  position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
                              }),
                        metadata: {
                            ...node.metadata,
                            ...videoMetadata(video),
                            taskId: undefined,
                            taskStatus: undefined,
                            taskProgress: undefined,
                            taskStage: undefined,
                            taskCreatedAt: undefined,
                            taskStartedAt: undefined,
                            taskUpdatedAt: undefined,
                            taskDetails: undefined,
                            prompt: prompt || node.metadata?.prompt,
                            model: generationConfig.model,
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            videoTask: undefined,
                            errorDetails: undefined,
                        },
                    };
                }),
            );
        },
        [assertGenerationRequestActive, isGenerationRequestActive],
    );

    const completeImageTask = useCallback(
        async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["imageTask"]> | ImageGenerationTask, controller: AbortController, prompt?: string) => {
            const image = await waitForImageGenerationTask(generationConfig, task, { signal: controller.signal });
            const ensureActiveTarget = () => {
                assertGenerationRequestActive(nodeId, controller);
                const target = nodesRef.current.find((node) => node.id === nodeId);
                if (!target) throw new DOMException("Target node removed", "AbortError");
                return target;
            };
            const targetNode = ensureActiveTarget();
            const emotionEdit = targetNode?.metadata?.emotionEdit;
            let resultDataUrl = image.dataUrl;
            if (emotionEdit) {
                if (!emotionEdit.editRegion) throw new Error("情绪编辑任务缺少局部合成区域，未应用整图重绘结果");
                const sourceNode = resolveEmotionSource(emotionEdit, nodesRef.current);
                resultDataUrl = await compositeEmotionImage(sourceNode.metadata.content, image.dataUrl, emotionEdit.editRegion, emotionEdit.faceBox);
                ensureActiveTarget();
                resolveEmotionSource(emotionEdit, nodesRef.current);
            }
            const uploaded = await uploadGeneratedCanvasImage(resultDataUrl, emotionEdit ? "" : image.remoteUrl, emotionEdit ? "" : image.serverUrl);
            ensureActiveTarget();
            if (emotionEdit) resolveEmotionSource(emotionEdit, nodesRef.current);
            setNodes((prev) => {
                if (!isGenerationRequestActive(nodeId, controller)) return prev;
                const target = prev.find((node) => node.id === nodeId);
                if (
                    !target ||
                    (emotionEdit &&
                        !sameEmotionSource(
                            emotionEdit,
                            prev.find((node) => node.id === emotionEdit.sourceNodeId),
                        ))
                )
                    return prev;
                const batchRootId = target?.metadata?.batchRootId;
                return prev.map((node) => {
                    const shouldUpdateTarget = node.id === nodeId;
                    const shouldUpdateEmptyRoot = Boolean(batchRootId && node.id === batchRootId && (!node.metadata?.content || node.metadata.primaryImageId === nodeId));
                    if (!shouldUpdateTarget && !shouldUpdateEmptyRoot) return node;
                    const isPanorama = node.type === CanvasNodeType.Panorama;
                    const imageSize =
                        !node.metadata?.locked &&
                        (isPanorama ? NODE_DEFAULT_SIZE[CanvasNodeType.Panorama] : fitNodeSize(uploaded.width, uploaded.height, node.width || NODE_DEFAULT_SIZE[CanvasNodeType.Image].width, node.height || NODE_DEFAULT_SIZE[CanvasNodeType.Image].height));
                    const center = imageSize ? { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 } : null;
                    return {
                        ...node,
                        ...(imageSize && center ? { position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 }, width: imageSize.width, height: imageSize.height } : {}),
                        metadata: {
                            ...node.metadata,
                            ...imageMetadata(uploaded),
                            taskId: undefined,
                            taskStatus: undefined,
                            taskProgress: undefined,
                            taskStage: undefined,
                            taskCreatedAt: undefined,
                            taskStartedAt: undefined,
                            taskUpdatedAt: undefined,
                            taskDetails: undefined,
                            ...(isPanorama ? { size: PANORAMA_IMAGE_SIZE, panoramaProjection: "equirectangular" as const } : {}),
                            prompt: prompt || node.metadata?.prompt,
                            imageTask: undefined,
                            primaryImageId: shouldUpdateEmptyRoot ? nodeId : node.metadata?.primaryImageId,
                            errorDetails: undefined,
                        },
                    };
                });
            });
        },
        [assertGenerationRequestActive, isGenerationRequestActive],
    );

    const startAndCompleteImageTask = useCallback(
        async (nodeId: string, generationConfig: AiConfig, prompt: string, references: ReferenceImage[] = [], mask: ReferenceImage | undefined, controller: AbortController, validateBeforeSubmit?: () => void, sourceNodeId = nodeId) => {
            const task = await createImageGenerationTask(generationConfig, prompt, references, mask, {
                signal: controller.signal,
                logSource: "canvas",
                logTitle: prompt.slice(0, 36) || "画布生图",
                conversationId: currentProject?.creativeConversationId,
                surface: "canvas",
                projectId,
                sourceNodeId,
                targetNodeId: nodeId,
                ...createFreshGenerationTaskContext("canvas-image", [projectId, nodeId]),
                validateBeforeSubmit,
            });
            if (!attachGenerationTask(nodeId, controller, { id: task.id, type: "image" })) return;
            assertGenerationRequestActive(nodeId, controller);
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId && isGenerationRequestActive(nodeId, controller)
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  imageTask: { id: task.id, kind: task.kind, model: task.model },
                                  taskId: task.id,
                                  taskStatus: task.status || "pending",
                                  taskProgress: undefined,
                                  taskStage: "提交任务",
                                  taskCreatedAt: Date.now(),
                                  taskUpdatedAt: Date.now(),
                                  errorDetails: undefined,
                              },
                          }
                        : node,
                ),
            );
            notifyCanvasGenerationTaskCreated(projectId);
            await completeImageTask(nodeId, generationConfig, task, controller, prompt);
        },
        [assertGenerationRequestActive, attachGenerationTask, completeImageTask, isGenerationRequestActive, projectId],
    );

    const completeTextTask = useCallback(
        async (nodeId: string, generationConfig: AiConfig, task: TextGenerationTask, controller: AbortController, prompt?: string) => {
            const answer = await waitForTextGenerationTask(generationConfig, task, { signal: controller.signal });
            assertGenerationRequestActive(nodeId, controller);
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId && isGenerationRequestActive(nodeId, controller)
                        ? {
                              ...node,
                              type: CanvasNodeType.Text,
                              metadata: {
                                  ...node.metadata,
                                  content: answer || "没有返回内容",
                                  taskId: undefined,
                                  taskStatus: undefined,
                                  taskProgress: undefined,
                                  taskStage: undefined,
                                  taskCreatedAt: undefined,
                                  taskStartedAt: undefined,
                                  taskUpdatedAt: undefined,
                                  taskDetails: undefined,
                                  prompt: prompt || node.metadata?.prompt,
                                  status: NODE_STATUS_SUCCESS,
                                  textTask: undefined,
                                  errorDetails: undefined,
                              },
                          }
                        : node,
                ),
            );
            return answer || "没有返回内容";
        },
        [assertGenerationRequestActive, isGenerationRequestActive],
    );

    const completeAudioTask = useCallback(
        async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["audioTask"]>, controller: AbortController, prompt?: string) => {
            const completedTask = await waitForAudioGenerationTask(generationConfig, task, { signal: controller.signal });
            assertGenerationRequestActive(nodeId, controller);
            const audio = await storeGeneratedAudio(completedTask, generationConfig.audioFormat);
            assertGenerationRequestActive(nodeId, controller);
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId && isGenerationRequestActive(nodeId, controller)
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  ...audioMetadata(audio),
                                  taskId: undefined,
                                  taskStatus: undefined,
                                  taskProgress: undefined,
                                  taskStage: undefined,
                                  taskCreatedAt: undefined,
                                  taskStartedAt: undefined,
                                  taskUpdatedAt: undefined,
                                  taskDetails: undefined,
                                  prompt: prompt || node.metadata?.prompt,
                                  audioTask: undefined,
                                  errorDetails: undefined,
                              },
                          }
                        : node,
                ),
            );
        },
        [assertGenerationRequestActive, isGenerationRequestActive],
    );
    return {
        createHistoryEntry,
        startGenerationRequest,
        attachGenerationTask,
        finishGenerationRequest,
        isGenerationRequestActive,
        invalidateGenerationRequest,
        stopGenerationByRunningId,
        confirmStopGeneration,
        completeVideoTask,
        completeImageTask,
        startAndCompleteImageTask,
        completeTextTask,
        completeAudioTask,
    };
}

export type CanvasTaskRuntime = ReturnType<typeof useCanvasTaskRuntime>;
