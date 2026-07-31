"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect } from "react";

import { isGenerationTaskNeedsReviewError } from "@/services/api/generation-task-state";
import { CanvasNodeType, isCanvasImageNodeType } from "../types";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

import { NODE_STATUS_ERROR, NODE_STATUS_LOADING } from "./canvas-page-elements";
import { buildGenerationConfig, hydrateAssistantImages, hydrateCanvasImages, isGenerationCanceled } from "./canvas-page-utils";

import type { CanvasPageState } from "./use-canvas-page-state";
import type { CanvasTaskRuntime } from "./use-canvas-task-runtime";

export function useCanvasPersistenceEffects({ state, tasks }: { state: CanvasPageState; tasks: CanvasTaskRuntime }) {
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
        loadProject,
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
        resumingAudioTaskIdsRef,
    } = state;
    const { createHistoryEntry, startGenerationRequest, finishGenerationRequest, stopGenerationByRunningId, confirmStopGeneration, completeVideoTask, completeImageTask, startAndCompleteImageTask, completeTextTask, completeAudioTask } = tasks;
    const deferReviewedTask = (nodeId: string, taskField: "imageTask" | "videoTask" | "textTask" | "audioTask", errorDetails: string) => {
        setNodes((prev) => prev.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
        window.setTimeout(() => {
            setNodes((prev) => prev.map((item) => (item.id === nodeId && item.metadata?.[taskField] && item.metadata.errorDetails === errorDetails ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING } } : item)));
        }, 30_000);
    };

    useEffect(() => {
        if (userId) void hydrate();
    }, [hydrate, userId]);

    useEffect(() => {
        if (!userId || !hydrated || hydratedUserId !== userId) return;
        let cancelled = false;
        setProjectLoaded(false);
        void loadProject(projectId)
            .then(async (project) => {
                const restoredNodes = await hydrateCanvasImages(project.nodes);
                const restoredSessions = await hydrateAssistantImages(project.chatSessions || []);
                if (cancelled) return;
                setNodes(restoredNodes);
                setConnections(project.connections);
                setChatSessions(restoredSessions);
                setActiveChatId(project.activeChatId || null);
                setBackgroundMode(project.backgroundMode);
                setShowImageInfo(project.showImageInfo || false);
                setViewport(project.viewport);
                historyRef.current = { past: [], future: [] };
                if (historyCommitTimerRef.current) {
                    clearTimeout(historyCommitTimerRef.current);
                    historyCommitTimerRef.current = null;
                }
                lastHistoryRef.current = {
                    nodes: restoredNodes,
                    connections: project.connections,
                    chatSessions: restoredSessions,
                    activeChatId: project.activeChatId || null,
                    backgroundMode: project.backgroundMode,
                    showImageInfo: project.showImageInfo || false,
                };
                setHistoryState({ canUndo: false, canRedo: false });
                setProjectLoaded(true);
            })
            .catch((error) => {
                if (cancelled) return;
                const text = error instanceof Error ? error.message : "画布项目加载失败";
                if (text.includes("不存在")) router.replace("/canvas");
                else message.error(text);
            });
        return () => {
            cancelled = true;
        };
    }, [hydrated, hydratedUserId, loadProject, message, projectId, router, userId]);

    useEffect(() => {
        if (!projectLoaded) return;
        const resumable = nodes.filter((node) => isCanvasImageNodeType(node.type) && node.metadata?.status === NODE_STATUS_LOADING && node.metadata.imageTask && !generationRequestsRef.current.has(node.id));
        resumable.forEach((node) => {
            const task = node.metadata?.imageTask;
            if (!task || resumingImageTaskIdsRef.current.has(node.id)) return;
            resumingImageTaskIdsRef.current.add(node.id);
            const controller = startGenerationRequest(node.id, node.id, node.id);
            const generationConfig = buildGenerationConfig(effectiveConfig, node, "image");
            setRunningNodeId((current) => current || node.id);
            void completeImageTask(node.id, generationConfig, task, controller, node.metadata?.prompt)
                .catch((error) => {
                    if (isGenerationCanceled(error)) return;
                    const errorDetails = error instanceof Error ? error.message : "图片生成失败";
                    message.error(errorDetails);
                    if (isGenerationTaskNeedsReviewError(error)) {
                        deferReviewedTask(node.id, "imageTask", errorDetails);
                        return;
                    }
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, imageTask: undefined } } : item)));
                })
                .finally(() => {
                    resumingImageTaskIdsRef.current.delete(node.id);
                    finishGenerationRequest(node.id, controller);
                    setRunningNodeId((current) => (current === node.id ? null : current));
                });
        });
    }, [completeImageTask, effectiveConfig, finishGenerationRequest, message, nodes, projectLoaded, startGenerationRequest]);

    useEffect(() => {
        if (!projectLoaded) return;
        const resumable = nodes.filter((node) => node.type === CanvasNodeType.Video && node.metadata?.status === NODE_STATUS_LOADING && node.metadata.videoTask && !generationRequestsRef.current.has(node.id));
        resumable.forEach((node) => {
            const task = node.metadata?.videoTask;
            if (!task || resumingVideoTaskIdsRef.current.has(node.id)) return;
            resumingVideoTaskIdsRef.current.add(node.id);
            const controller = startGenerationRequest(node.id, node.id, node.id);
            const generationConfig = buildGenerationConfig(effectiveConfig, node, "video");
            setRunningNodeId((current) => current || node.id);
            void completeVideoTask(node.id, generationConfig, task, controller, node.metadata?.prompt)
                .catch((error) => {
                    if (isGenerationCanceled(error)) return;
                    const errorDetails = error instanceof Error ? error.message : "视频生成失败";
                    message.error(errorDetails);
                    if (isGenerationTaskNeedsReviewError(error)) {
                        deferReviewedTask(node.id, "videoTask", errorDetails);
                        return;
                    }
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, videoTask: undefined } } : item)));
                })
                .finally(() => {
                    resumingVideoTaskIdsRef.current.delete(node.id);
                    finishGenerationRequest(node.id, controller);
                    setRunningNodeId((current) => (current === node.id ? null : current));
                });
        });
    }, [completeVideoTask, effectiveConfig, finishGenerationRequest, message, nodes, projectLoaded, startGenerationRequest]);

    useEffect(() => {
        if (!projectLoaded) return;
        const resumable = nodes.filter((node) => node.type === CanvasNodeType.Text && node.metadata?.status === NODE_STATUS_LOADING && node.metadata.textTask && !generationRequestsRef.current.has(node.id));
        resumable.forEach((node) => {
            const task = node.metadata?.textTask;
            if (!task || resumingTextTaskIdsRef.current.has(node.id)) return;
            resumingTextTaskIdsRef.current.add(node.id);
            const controller = startGenerationRequest(node.id, node.id, node.id);
            const generationConfig = buildGenerationConfig(effectiveConfig, node, "text");
            setRunningNodeId((current) => current || node.id);
            void completeTextTask(node.id, generationConfig, task, controller, node.metadata?.prompt)
                .catch((error) => {
                    if (isGenerationCanceled(error)) return;
                    const errorDetails = error instanceof Error ? error.message : "文本生成失败";
                    message.error(errorDetails);
                    if (isGenerationTaskNeedsReviewError(error)) {
                        deferReviewedTask(node.id, "textTask", errorDetails);
                        return;
                    }
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, textTask: undefined } } : item)));
                })
                .finally(() => {
                    resumingTextTaskIdsRef.current.delete(node.id);
                    finishGenerationRequest(node.id, controller);
                    setRunningNodeId((current) => (current === node.id ? null : current));
                });
        });
    }, [completeTextTask, effectiveConfig, finishGenerationRequest, message, nodes, projectLoaded, startGenerationRequest]);

    useEffect(() => {
        if (!projectLoaded) return;
        const resumable = nodes.filter((node) => node.type === CanvasNodeType.Audio && node.metadata?.status === NODE_STATUS_LOADING && node.metadata.audioTask && !generationRequestsRef.current.has(node.id));
        resumable.forEach((node) => {
            const task = node.metadata?.audioTask;
            if (!task || resumingAudioTaskIdsRef.current.has(node.id)) return;
            resumingAudioTaskIdsRef.current.add(node.id);
            const controller = startGenerationRequest(node.id, node.id, node.id);
            const generationConfig = buildGenerationConfig(effectiveConfig, node, "audio");
            setRunningNodeId((current) => current || node.id);
            void completeAudioTask(node.id, generationConfig, task, controller, node.metadata?.prompt)
                .catch((error) => {
                    if (isGenerationCanceled(error)) return;
                    const errorDetails = error instanceof Error ? error.message : "音频生成失败";
                    message.error(errorDetails);
                    if (isGenerationTaskNeedsReviewError(error)) {
                        deferReviewedTask(node.id, "audioTask", errorDetails);
                        return;
                    }
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, audioTask: undefined } } : item)));
                })
                .finally(() => {
                    resumingAudioTaskIdsRef.current.delete(node.id);
                    finishGenerationRequest(node.id, controller);
                    setRunningNodeId((current) => (current === node.id ? null : current));
                });
        });
    }, [completeAudioTask, effectiveConfig, finishGenerationRequest, message, nodes, projectLoaded, startGenerationRequest]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (
            previous?.nodes === next.nodes &&
            previous.connections === next.connections &&
            previous.chatSessions === next.chatSessions &&
            previous.activeChatId === next.activeChatId &&
            previous.backgroundMode === next.backgroundMode &&
            previous.showImageInfo === next.showImageInfo
        )
            return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo]);

    useEffect(
        () => () => {
            if (agentCloseTimerRef.current) clearTimeout(agentCloseTimerRef.current);
        },
        [],
    );

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, showImageInfo, updateProject]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useEffect(() => {
        if (!projectLoaded) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, updateProject, viewport]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, selectedNodeIds, viewport, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize({ width: rect.width, height: rect.height });
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                setViewport({ x: rect.width / 2, y: rect.height / 2, k: 1 });
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);
}
