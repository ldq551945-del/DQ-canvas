"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";

import { createFreshGenerationTaskContext } from "@/lib/generation-request-context";
import { recordGenerationLog } from "@/services/api/generation-logs";
import { createImageGenerationTask, waitForImageGenerationTask, type ImageGenerationTask } from "@/services/api/image";
import { waitForTextGenerationTask, type TextGenerationTask } from "@/services/api/text";
import { storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { NODE_DEFAULT_SIZE } from "../constants";
import { CanvasNodeType, type CanvasNodeMetadata } from "../types";
import { fitNodeSize } from "../utils/canvas-node-size";
import { PANORAMA_IMAGE_SIZE } from "../utils/canvas-panorama";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

import { CanvasHistoryEntry, NODE_STATUS_IDLE, NODE_STATUS_LOADING, NODE_STATUS_SUCCESS, VIDEO_NODE_MAX_HEIGHT, VIDEO_NODE_MAX_WIDTH } from "./canvas-page-elements";
import { imageMetadata, uploadGeneratedCanvasImage, videoMetadata } from "./canvas-page-utils";

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
        autoOpenedAgentRef,
        pendingConnectionCreateRef,
        generationRequestsRef,
        resumingImageTaskIdsRef,
        resumingVideoTaskIdsRef,
        resumingTextTaskIdsRef,
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
        if (previous?.controller !== controller) previous?.controller.abort();
        generationRequestsRef.current.set(targetNodeId, { targetNodeId, originNodeId, runningNodeId: runningId, controller });
        return controller;
    }, []);

    const finishGenerationRequest = useCallback((targetNodeId: string, controller: AbortController) => {
        const request = generationRequestsRef.current.get(targetNodeId);
        if (request?.controller === controller) generationRequestsRef.current.delete(targetNodeId);
    }, []);

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const affectedNodeIds = new Set<string>();
        generationRequestsRef.current.forEach((request) => {
            if (request.runningNodeId !== runningId) return;
            request.controller.abort();
            generationRequestsRef.current.delete(request.targetNodeId);
            affectedNodeIds.add(request.targetNodeId);
            affectedNodeIds.add(request.originNodeId);
        });
        setRunningNodeId((current) => (current === runningId ? null : current));
        if (!affectedNodeIds.size) return;
        setNodes((prev) =>
            prev.map((node) =>
                affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined, videoTask: undefined, imageTask: undefined, textTask: undefined } }
                    : node,
            ),
        );
    }, []);

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

    const completeVideoTask = useCallback(async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["videoTask"]>, controller: AbortController, prompt?: string) => {
        const video = await storeGeneratedVideo(await waitForVideoGenerationTask(generationConfig, task, { signal: controller.signal }));
        const finalPrompt = prompt || "";
        const loggedAssetPromise = recordGenerationLog({
            id: `canvas-video:${task.id || nodeId}`,
            taskId: task.id,
            kind: "video",
            source: "canvas",
            status: "success",
            title: finalPrompt.slice(0, 36) || "画布视频",
            prompt: finalPrompt,
            model: modelOptionName(generationConfig.model || generationConfig.videoModel),
            summary: "画布视频生成完成",
            durationMs: video.durationMs,
            count: 1,
            successCount: 1,
            failCount: 0,
            assets:
                video.serverUrl || (video.url && !video.url.startsWith("blob:") ? video.url : "") || video.remoteUrl || ""
                    ? [
                          {
                              type: "video",
                              url: video.serverUrl || video.url || video.remoteUrl || "",
                              remoteUrl: video.remoteUrl,
                              serverUrl: video.serverUrl,
                              mimeType: video.mimeType,
                              width: video.width,
                              height: video.height,
                              bytes: video.bytes,
                          },
                      ]
                    : [],
            completedAt: Date.now(),
        })
            .then((log) => log.assets[0])
            .catch(() => undefined);
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                return {
                    ...node,
                    width: videoSize.width,
                    height: videoSize.height,
                    position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
                    metadata: {
                        ...node.metadata,
                        ...videoMetadata(video),
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
        void loggedAssetPromise.then((asset) => {
            if (!asset?.serverUrl && !asset?.remoteUrl) return;
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  remoteUrl: asset.remoteUrl || node.metadata?.remoteUrl,
                                  serverUrl: asset.serverUrl || node.metadata?.serverUrl,
                              },
                          }
                        : node,
                ),
            );
        });
    }, []);

    const completeImageTask = useCallback(async (nodeId: string, generationConfig: AiConfig, task: NonNullable<CanvasNodeMetadata["imageTask"]> | ImageGenerationTask, controller: AbortController, prompt?: string) => {
        const image = await waitForImageGenerationTask(generationConfig, task, { signal: controller.signal });
        const uploaded = await uploadGeneratedCanvasImage(image.dataUrl, image.remoteUrl, image.serverUrl);
        setNodes((prev) => {
            const target = prev.find((node) => node.id === nodeId);
            const batchRootId = target?.metadata?.batchRootId;
            return prev.map((node) => {
                const shouldUpdateTarget = node.id === nodeId;
                const shouldUpdateEmptyRoot = Boolean(batchRootId && node.id === batchRootId && (!node.metadata?.content || node.metadata.primaryImageId === nodeId));
                if (!shouldUpdateTarget && !shouldUpdateEmptyRoot) return node;
                const isPanorama = node.type === CanvasNodeType.Panorama;
                const imageSize = isPanorama
                    ? NODE_DEFAULT_SIZE[CanvasNodeType.Panorama]
                    : fitNodeSize(uploaded.width, uploaded.height, node.width || NODE_DEFAULT_SIZE[CanvasNodeType.Image].width, node.height || NODE_DEFAULT_SIZE[CanvasNodeType.Image].height);
                const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                return {
                    ...node,
                    position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                    width: imageSize.width,
                    height: imageSize.height,
                    metadata: {
                        ...node.metadata,
                        ...imageMetadata(uploaded),
                        ...(isPanorama ? { size: PANORAMA_IMAGE_SIZE, panoramaProjection: "equirectangular" as const } : {}),
                        prompt: prompt || node.metadata?.prompt,
                        imageTask: undefined,
                        primaryImageId: shouldUpdateEmptyRoot ? nodeId : node.metadata?.primaryImageId,
                        errorDetails: undefined,
                    },
                };
            });
        });
    }, []);

    const startAndCompleteImageTask = useCallback(
        async (nodeId: string, generationConfig: AiConfig, prompt: string, references: ReferenceImage[] = [], mask: ReferenceImage | undefined, controller: AbortController) => {
            const task = await createImageGenerationTask(generationConfig, prompt, references, mask, {
                signal: controller.signal,
                logSource: "canvas",
                logTitle: prompt.slice(0, 36) || "画布生图",
                conversationId: currentProject?.creativeConversationId,
                surface: "canvas",
                projectId,
                ...createFreshGenerationTaskContext("canvas-image", [projectId, nodeId]),
            });
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  imageTask: { id: task.id, kind: task.kind, model: task.model },
                                  errorDetails: undefined,
                              },
                          }
                        : node,
                ),
            );
            await completeImageTask(nodeId, generationConfig, task, controller, prompt);
        },
        [completeImageTask],
    );

    const completeTextTask = useCallback(async (nodeId: string, generationConfig: AiConfig, task: TextGenerationTask, controller: AbortController, prompt?: string) => {
        const answer = await waitForTextGenerationTask(generationConfig, task, { signal: controller.signal });
        setNodes((prev) =>
            prev.map((node) =>
                node.id === nodeId
                    ? {
                          ...node,
                          type: CanvasNodeType.Text,
                          metadata: {
                              ...node.metadata,
                              content: answer || "没有返回内容",
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
    }, []);
    return {
        createHistoryEntry,
        startGenerationRequest,
        finishGenerationRequest,
        stopGenerationByRunningId,
        confirmStopGeneration,
        completeVideoTask,
        completeImageTask,
        startAndCompleteImageTask,
        completeTextTask,
    };
}

export type CanvasTaskRuntime = ReturnType<typeof useCanvasTaskRuntime>;
