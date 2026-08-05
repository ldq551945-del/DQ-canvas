"use client";

import dynamic from "next/dynamic";
import { nanoid } from "nanoid";
import { useCallback, useEffect } from "react";

import { createFreshGenerationTaskContext } from "@/lib/generation-request-context";
import { resolveImageRequestSize } from "@/lib/image-size";
import { readImageMeta } from "@/lib/image-utils";
import { createAudioGenerationTask } from "@/services/api/audio";
import { createTextGenerationTask } from "@/services/api/text";
import { createServerVideoGenerationTask } from "@/services/api/video";
import type { InsertAssetPayload } from "../components/asset-picker-modal";
import { CANVAS_AGENT_PANEL_MOTION_MS } from "../components/canvas-agent-panel-motion";
import { retryCanvasAgentNode } from "../components/canvas-agent-node-retry";
import { buildNodeGenerationContext, buildNodeResponseMessages, hydrateNodeGenerationContext } from "../components/canvas-node-generation";
import { type CanvasNodeGenerationMode } from "../components/canvas-node-prompt-panel";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "../constants";
import { CanvasNodeType, isCanvasImageNodeType, type CanvasAssistantImage, type CanvasNodeData } from "../types";
import { applyCameraPrompt } from "../utils/canvas-camera";
import { fitNodeSize, nodeSizeFromRatio } from "../utils/canvas-node-size";
import { buildPanoramaPrompt } from "../utils/canvas-panorama";
import { buildPortraitTexturePrompt, normalizePortraitTextureSettings, resolvePortraitTextureRetryState } from "../utils/canvas-portrait-texture";
import { buildEmotionImageArtifacts, emotionGenerationSize } from "../utils/canvas-emotion";
import { emotionSourceIdentity, resolveEmotionEditRequestConfig, resolveEmotionFirstRetryInputs, sameEmotionSource } from "../utils/canvas-emotion-request";
import { notifyCanvasGenerationTaskCreated } from "../utils/canvas-generation-task-events";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

import { NODE_STATUS_ERROR, NODE_STATUS_IDLE, NODE_STATUS_LOADING, NODE_STATUS_SUCCESS, VIDEO_NODE_MAX_HEIGHT, VIDEO_NODE_MAX_WIDTH, createCanvasNode } from "./canvas-page-elements";
import { classifyCanvasVideoTaskFailure } from "./canvas-video-task-recovery";
import {
    buildAudioGenerationMetadata,
    buildGenerationConfig,
    buildImageGenerationMetadata,
    buildPendingMediaNodeMetadata,
    canvasNodeReferenceImage,
    findRetrySourceNode,
    generationReferenceUrls,
    getGenerationCount,
    imageMetadata,
    isGenerationCanceled,
    resolveMetadataReferences,
    sourceNodeReferenceImages,
    uploadCanvasImage,
} from "./canvas-page-utils";

import type { CanvasInteractions } from "./use-canvas-interactions";
import type { CanvasPageState } from "./use-canvas-page-state";
import type { CanvasTaskRuntime } from "./use-canvas-task-runtime";

export function useCanvasGenerationActions({ state, tasks, interactions }: { state: CanvasPageState; tasks: CanvasTaskRuntime; interactions: CanvasInteractions }) {
    const {
        message,
        projectId,
        containerRef,
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        currentProject,
        setNodes,
        setConnections,
        size,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setRunningNodeId,
        setAssetPickerOpen,
        setDialogNodeId,
        assistantCollapsed,
        setAssistantCollapsed,
        assistantMounted,
        setAssistantMounted,
        assistantClosing,
        setAssistantClosing,
        nodesRef,
        connectionsRef,
        generateNodeRef,
        agentCloseTimerRef,
    } = state;
    const { startGenerationRequest, attachGenerationTask, finishGenerationRequest, isGenerationRequestActive, completeVideoTask, startAndCompleteImageTask, completeTextTask, completeAudioTask } = tasks;
    const { screenToCanvas, applyAgentOps } = interactions;
    const deferVideoTask = useCallback(
        (nodeId: string, errorDetails?: string, delayMs = 15_000) => {
            setNodes((prev) => prev.map((item) => (item.id === nodeId && item.metadata?.videoTask ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails } } : item)));
            window.setTimeout(() => {
                setNodes((prev) => prev.map((item) => (item.id === nodeId && item.metadata?.videoTask && item.metadata.status === NODE_STATUS_LOADING ? { ...item, metadata: { ...item.metadata } } : item)));
            }, delayMs);
        },
        [setNodes],
    );

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            setRunningNodeId(nodeId);
            const runController = startGenerationRequest(nodeId, nodeId, nodeId);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const portraitTextureSnapshot = mode === "image" && sourceNode?.metadata?.portraitTexture ? normalizePortraitTextureSettings(sourceNode.metadata.portraitTexture) : undefined;
            let baseGenerationContext: Awaited<ReturnType<typeof hydrateNodeGenerationContext>>;
            try {
                baseGenerationContext = await hydrateNodeGenerationContext(
                    buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : prompt),
                );
            } catch (error) {
                const errorDetails = error instanceof Error ? error.message : "参考图片加载失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                if (finishGenerationRequest(nodeId, runController)) setRunningNodeId((current) => (current === nodeId ? null : current));
                return;
            }
            const portraitTextureBasePrompt = baseGenerationContext.prompt.trim();
            const sourcePrompt = portraitTextureSnapshot ? buildPortraitTexturePrompt(portraitTextureBasePrompt, portraitTextureSnapshot) : portraitTextureBasePrompt;
            const generationContext = { ...baseGenerationContext, prompt: sourcePrompt };
            const panoramaPrompt = sourceNode?.type === CanvasNodeType.Panorama ? buildPanoramaPrompt(sourcePrompt, generationContext.referenceImages.length > 0) : sourcePrompt;
            const effectivePrompt = applyCameraPrompt(panoramaPrompt, sourceNode?.type === CanvasNodeType.Panorama ? undefined : sourceNode?.metadata?.cameraControl);
            if (runController.signal.aborted) {
                if (finishGenerationRequest(nodeId, runController)) setRunningNodeId((current) => (current === nodeId ? null : current));
                return;
            }
            const markSourceStatus = !isCanvasImageNodeType(sourceNode?.type) && !editingTextNode;
            const statusPrompt = sourceNode?.type === CanvasNodeType.Config ? effectivePrompt : prompt;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                if (finishGenerationRequest(nodeId, runController)) setRunningNodeId((current) => (current === nodeId ? null : current));
                return;
            }
            let pendingChildIds: string[] = [];
            if (markSourceStatus) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: statusPrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

            try {
                if (mode === "image") {
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isPanoramaNode = sourceNode?.type === CanvasNodeType.Panorama;
                    const count = isPanoramaNode ? 1 : getGenerationCount(generationConfig.count);
                    const isImageNode = isCanvasImageNodeType(sourceNode?.type);
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const sourceReference = isImageNode && sourceNode?.metadata?.content ? [canvasNodeReferenceImage(sourceNode)] : [];
                    const referenceImages = sourceReference.length ? sourceReference : generationContext.referenceImages;
                    const imageGenerationConfig = {
                        ...generationConfig,
                        size: resolveImageRequestSize({
                            prompt,
                            configuredSize: generationConfig.size,
                            referenceWidth: referenceImages[0]?.width,
                            referenceHeight: referenceImages[0]?.height,
                            defaultSize: effectiveConfig.size,
                        }),
                    };
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, imageGenerationConfig, count, referenceImages);
                    const resultType = isPanoramaNode ? CanvasNodeType.Panorama : CanvasNodeType.Image;
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? resultType : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[resultType];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const gap = 96;
                    const rowGap = 36;
                    const rootId = isEmptyImageNode ? nodeId : nanoid();
                    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
                    const targetIds = count > 1 ? childIds : [rootId];
                    pendingChildIds = isEmptyImageNode ? childIds : [rootId, ...childIds];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: resultType,
                        title: effectivePrompt.slice(0, 32) || (isPanoramaNode ? "Generated Panorama" : "Generated Image"),
                        position: {
                            x: isEmptyImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + gap,
                            y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: isEmptyImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
                        height: isEmptyImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
                        metadata: {
                            prompt: effectivePrompt,
                            sourcePrompt,
                            status: NODE_STATUS_LOADING,
                            isBatchRoot: count > 1,
                            batchChildIds: count > 1 ? childIds : undefined,
                            batchUsesReferenceImages: referenceImages.length > 0,
                            ...generationMetadata,
                            ...(portraitTextureSnapshot ? { composerContent: portraitTextureBasePrompt, portraitTexture: portraitTextureSnapshot } : {}),
                            ...(isPanoramaNode ? { panoramaProjection: "equirectangular" as const, panoramaSourcePrompt: sourcePrompt } : {}),
                            ...(sourceNode?.metadata?.cameraControl && !isPanoramaNode ? { cameraControl: sourceNode.metadata.cameraControl } : {}),
                            imageBatchExpanded: count > 1 ? true : undefined,
                        },
                    };
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: resultType,
                        title: effectivePrompt.slice(0, 32) || (isPanoramaNode ? "Generated Panorama" : "Generated Image"),
                        position: {
                            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
                            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + rowGap),
                        },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: {
                            prompt: effectivePrompt,
                            sourcePrompt,
                            status: NODE_STATUS_LOADING,
                            batchRootId: count > 1 ? rootId : undefined,
                            ...generationMetadata,
                            ...(portraitTextureSnapshot ? { composerContent: portraitTextureBasePrompt, portraitTexture: portraitTextureSnapshot } : {}),
                            ...(isPanoramaNode ? { panoramaProjection: "equirectangular" as const, panoramaSourcePrompt: sourcePrompt } : {}),
                            ...(sourceNode?.metadata?.cameraControl && !isPanoramaNode ? { cameraControl: sourceNode.metadata.cameraControl } : {}),
                        },
                    }));
                    const batchConnections = [...(isEmptyImageNode ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === nodeId
                                ? isConfigNode
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, prompt: effectivePrompt, sourcePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined },
                                      }
                                    : isEmptyImageNode
                                      ? {
                                            ...node,
                                            position: rootNode.position,
                                            width: rootNode.width,
                                            height: rootNode.height,
                                            title: rootNode.title,
                                            metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                        }
                                      : isImageNode
                                        ? {
                                              ...node,
                                              metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                                          }
                                        : {
                                              ...node,
                                              type: CanvasNodeType.Text,
                                              title: prompt.slice(0, 32) || "Prompt",
                                              width: parentConfig.width,
                                              height: parentConfig.height,
                                              metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                          }
                                : node,
                        ),
                        ...(isEmptyImageNode ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    setConnections((prev) => [...prev, ...batchConnections]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const controller = runController;
                    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
                    if (count > 1) startGenerationRequest(rootId, nodeId, nodeId, controller);
                    let hasSuccess = false;
                    let hasFailure = false;
                    await Promise.all(
                        targetIds.map(async (targetId) => {
                            try {
                                await startAndCompleteImageTask(targetId, { ...imageGenerationConfig, count: "1" }, effectivePrompt, referenceImages, undefined, controller, undefined, nodeId);
                                hasSuccess = true;
                                if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error)) return false;
                                const errorDetails = error instanceof Error ? error.message : "生成失败";
                                hasFailure = true;
                                setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails, imageTask: undefined } } : node)));
                            } finally {
                                finishGenerationRequest(targetId, controller);
                            }
                            return false;
                        }),
                    );
                    if (count > 1) finishGenerationRequest(rootId, controller);
                    if (controller.signal.aborted) {
                        setNodes((prev) => prev.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
                        return;
                    }
                    if (hasFailure) message.error(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败" } }
                                : node.id === nodeId && isEmptyImageNode
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败" } }
                                  : node.id === rootId && !hasSuccess
                                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails: "全部图片生成失败" } }
                                    : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    const startFrameId = sourceNode?.metadata?.videoStartFrameNodeId;
                    const endFrameId = sourceNode?.metadata?.videoEndFrameNodeId;
                    const orderedVideoImages = [startFrameId, endFrameId]
                        .filter((id, index, values): id is string => Boolean(id) && values.indexOf(id) === index)
                        .map((id) => generationContext.referenceImages.find((image) => image.id === id))
                        .filter((image): image is (typeof generationContext.referenceImages)[number] => Boolean(image));
                    const videoImageReferences = [...orderedVideoImages, ...generationContext.referenceImages.filter((image) => !orderedVideoImages.some((selected) => selected.id === image.id))];
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const videoId = isEmptyVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyVideoNode ? sourceNode.width : spec.width,
                        height: isEmptyVideoNode ? sourceNode.height : spec.height,
                        metadata: buildPendingMediaNodeMetadata(sourceNode, isEmptyVideoNode, {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            model: generationConfig.model,
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            references: generationReferenceUrls({ ...generationContext, referenceImages: videoImageReferences }),
                            skillIds: sourceNode?.metadata?.skillIds,
                        }),
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) =>
                        isEmptyVideoNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode],
                    );
                    if (!isEmptyVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        const task = await createServerVideoGenerationTask(generationConfig, effectivePrompt, videoImageReferences, generationContext.referenceVideos, generationContext.referenceAudios, {
                            signal: controller.signal,
                            conversationId: currentProject?.creativeConversationId,
                            surface: "canvas",
                            projectId,
                            sourceNodeId: nodeId,
                            targetNodeId: videoId,
                            ...createFreshGenerationTaskContext("canvas-video", [projectId, videoId]),
                            skillIds: sourceNode?.metadata?.skillIds,
                        });
                        if (!attachGenerationTask(videoId, controller, { id: task.id, type: "video" })) return;
                        setNodes((prev) =>
                            prev.map((node) => (node.id === videoId ? { ...node, metadata: { ...node.metadata, videoTask: task, taskId: task.id, taskStatus: "running", taskStage: "生成中", taskCreatedAt: Date.now(), taskUpdatedAt: Date.now() } } : node)),
                        );
                        notifyCanvasGenerationTaskCreated(projectId);
                        await completeVideoTask(videoId, generationConfig, task, controller, effectivePrompt);
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const audioId = isEmptyAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: isEmptyAudioNode ? sourceNode.width : spec.width,
                        height: isEmptyAudioNode ? sourceNode.height : spec.height,
                        metadata: buildPendingMediaNodeMetadata(sourceNode, isEmptyAudioNode, { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) }),
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) =>
                        isEmptyAudioNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
                    );
                    if (!isEmptyAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const task = await createAudioGenerationTask(generationConfig, effectivePrompt, {
                            signal: controller.signal,
                            source: "canvas",
                            conversationId: currentProject?.creativeConversationId,
                            surface: "canvas",
                            projectId,
                            sourceNodeId: nodeId,
                            targetNodeId: audioId,
                            ...createFreshGenerationTaskContext("canvas-audio", [projectId, audioId]),
                        });
                        if (!attachGenerationTask(audioId, controller, { id: task.id, type: "audio" })) return;
                        setNodes((prev) =>
                            prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, audioTask: task, taskId: task.id, taskStatus: "running", taskStage: "生成中", taskCreatedAt: Date.now(), taskUpdatedAt: Date.now() } } : node)),
                        );
                        notifyCanvasGenerationTaskCreated(projectId);
                        await completeAudioTask(audioId, generationConfig, task, controller, effectivePrompt);
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                let streamed = "";
                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = isConfigNode ? getGenerationCount(generationConfig.count) : 1;
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const childIds = isConfigNode || editingTextNode ? Array.from({ length: textCount }, () => nanoid()) : [];
                pendingChildIds = childIds;
                if (isConfigNode || editingTextNode) {
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Text,
                        title: effectivePrompt.slice(0, 32) || "Generated Text",
                        position: {
                            x: parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
                        },
                        width: textConfig.width,
                        height: textConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14 },
                    }));
                    setNodes((prev) => [...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)), ...childNodes]);
                    setConnections((prev) => [...prev, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const controller = runController;
                const textTargetIds = childIds.length ? childIds : [nodeId];
                textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
                const answers = await Promise.all(
                    textTargetIds.map(async (targetNodeId) => {
                        try {
                            const task = await createTextGenerationTask(generationConfig, buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }), {
                                signal: controller.signal,
                                surface: "canvas",
                                projectId,
                                conversationId: currentProject?.creativeConversationId,
                                sourceNodeId: nodeId,
                                targetNodeId,
                                ...createFreshGenerationTaskContext("canvas-text", [projectId, targetNodeId]),
                            });
                            if (!attachGenerationTask(targetNodeId, controller, { id: task.id, type: "text" })) return { nodeId: targetNodeId, content: "" };
                            setNodes((prev) =>
                                prev.map((node) =>
                                    node.id === targetNodeId
                                        ? {
                                              ...node,
                                              type: CanvasNodeType.Text,
                                              metadata: {
                                                  ...node.metadata,
                                                  prompt: effectivePrompt,
                                                  status: NODE_STATUS_LOADING,
                                                  textTask: { id: task.id, model: task.model },
                                                  taskId: task.id,
                                                  taskStatus: task.status || "pending",
                                                  taskStage: "生成中",
                                                  taskCreatedAt: Date.now(),
                                                  taskUpdatedAt: Date.now(),
                                                  errorDetails: undefined,
                                              },
                                          }
                                        : node,
                                ),
                            );
                            notifyCanvasGenerationTaskCreated(projectId);
                            const answer = await completeTextTask(targetNodeId, generationConfig, task, controller, effectivePrompt);
                            streamed = answer;
                            return { nodeId: targetNodeId, content: answer };
                        } finally {
                            finishGenerationRequest(targetNodeId, controller);
                        }
                    }),
                );
                if (controller.signal.aborted) return;
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                setNodes((prev) =>
                    prev.map((node) =>
                        childIds.includes(node.id)
                            ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS, textTask: undefined } }
                            : node.id === nodeId && isConfigNode
                              ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } }
                              : node.id === nodeId && !editingTextNode
                                ? { ...node, type: CanvasNodeType.Text, title: prompt.slice(0, 32) || "Generated Text", metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS, textTask: undefined } }
                                : node,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                const videoTaskId = pendingChildIds.find((id) => nodesRef.current.find((item) => item.id === id)?.metadata?.videoTask);
                const videoFailure = mode === "video" && videoTaskId ? classifyCanvasVideoTaskFailure(error) : undefined;
                if (videoTaskId && videoFailure && videoFailure !== "upstream_failed") {
                    if (videoFailure === "needs_review") {
                        message.error(errorDetails);
                        deferVideoTask(videoTaskId, errorDetails, 30_000);
                    } else {
                        message.info("视频仍在后台生成，系统会继续查询原任务");
                        deferVideoTask(videoTaskId);
                    }
                    return;
                }
                const terminalVideoFailure = videoFailure === "upstream_failed";
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === nodeId || pendingChildIds.includes(node.id)
                            ? node.id === nodeId && !markSourceStatus
                                ? node
                                : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails, textTask: undefined, ...(terminalVideoFailure ? { videoTask: undefined } : {}) } }
                            : node,
                    ),
                );
            } finally {
                if (finishGenerationRequest(nodeId, runController)) setRunningNodeId((current) => (current === nodeId ? null : current));
            }
        },
        [
            completeAudioTask,
            completeTextTask,
            completeVideoTask,
            attachGenerationTask,
            currentProject?.creativeConversationId,
            deferVideoTask,
            effectiveConfig,
            finishGenerationRequest,
            isAiConfigReady,
            isGenerationRequestActive,
            message,
            openConfigDialog,
            projectId,
            startAndCompleteImageTask,
            startGenerationRequest,
        ],
    );
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData) => {
            if (node.metadata?.agentRunId && node.metadata.agentTaskId) {
                setRunningNodeId(node.id);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: "" } } : item)));
                try {
                    await retryCanvasAgentNode(node, applyAgentOps);
                    message.success("Agent 任务已重新生成");
                } catch (error) {
                    const errorDetails = error instanceof Error ? error.message : "Agent 任务重试失败";
                    message.error(errorDetails);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                } finally {
                    setRunningNodeId(null);
                }
                return;
            }
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = isCanvasImageNodeType(node.type) ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const retryPromptSource = node.metadata?.emotionEdit
                ? node.metadata?.prompt || sourceNode.metadata?.prompt || ""
                : sourceNode.type === CanvasNodeType.Config && sourceNode.metadata?.composerContent
                  ? sourceNode.metadata.composerContent
                  : sourceNode.metadata?.prompt || node.metadata?.prompt || "";
            const portraitTextureRetry = resolvePortraitTextureRetryState({
                resultSettings: savedImageMetadata?.portraitTexture,
                sourceSettings: sourceNode.metadata?.portraitTexture,
                resultBasePrompt: savedImageMetadata?.portraitTexture ? savedImageMetadata.composerContent : undefined,
                fallbackBasePrompt: retryPromptSource,
            });
            let context: Awaited<ReturnType<typeof hydrateNodeGenerationContext>> | null = null;
            if (!hasSavedImageMetadata) {
                try {
                    context = await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, portraitTextureRetry.basePrompt));
                } catch (error) {
                    const errorDetails = error instanceof Error ? error.message : "参考图片加载失败";
                    message.error(errorDetails);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                    return;
                }
            }
            const contextBasePrompt = context?.prompt.trim() || "";
            const portraitTexturePrompt = portraitTextureRetry.settings ? buildPortraitTexturePrompt(contextBasePrompt || portraitTextureRetry.basePrompt, portraitTextureRetry.settings) : contextBasePrompt;
            const sourcePrompt = (portraitTexturePrompt || savedImageMetadata?.sourcePrompt || sourceNode.metadata?.sourcePrompt || savedImageMetadata?.prompt || sourceNode.metadata?.prompt || node.metadata?.prompt || "").trim();
            const panoramaPrompt = node.type === CanvasNodeType.Panorama ? buildPanoramaPrompt(sourcePrompt, Boolean(savedImageMetadata?.references?.length || context?.referenceImages.length)) : sourcePrompt;
            const prompt = applyCameraPrompt(panoramaPrompt, node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Panorama ? undefined : savedImageMetadata?.cameraControl || sourceNode.metadata?.cameraControl);
            if (!prompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const emotionEdit = node.metadata?.emotionEdit;
            let retryReferenceImages: Awaited<ReturnType<typeof resolveMetadataReferences>> | ReturnType<typeof sourceNodeReferenceImages> = [];
            let emotionSource: CanvasNodeData | undefined;
            try {
                const retryInputs = await resolveEmotionFirstRetryInputs(emotionEdit, nodesRef.current, async () =>
                    hasSavedImageMetadata && savedImageMetadata ? resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [],
                );
                if (retryInputs.kind === "emotion") emotionSource = retryInputs.source;
                else retryReferenceImages = retryInputs.references;
            } catch (error) {
                const errorDetails = error instanceof Error ? error.message : "情绪编辑源图片已删除，无法重试";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                return;
            }
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
                return;
            }
            const retryImages = retryReferenceImages || [];

            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (emotionEdit) {
                    const { supportsMaskedOpenAiEdit } = resolveEmotionEditRequestConfig(generationConfig);
                    if (!supportsMaskedOpenAiEdit) throw new Error("表情编辑重试需要支持蒙版的 OpenAI Images 渠道");
                    if (!emotionSource?.metadata?.content) throw new Error("情绪编辑源图片已删除，无法重试");
                    const artifacts = await buildEmotionImageArtifacts(
                        emotionSource.metadata.content,
                        emotionEdit.faceBox,
                        emotionSource.metadata.naturalWidth || emotionEdit.sourceWidth || 0,
                        emotionSource.metadata.naturalHeight || emotionEdit.sourceHeight || 0,
                    );
                    const emotionConfig = {
                        ...generationConfig,
                        size: emotionGenerationSize(artifacts.editRegion),
                        quality: !generationConfig.quality || generationConfig.quality === "auto" ? "high" : generationConfig.quality,
                    };
                    const sourceReference = canvasNodeReferenceImage(emotionSource);
                    const nextEmotionEdit = {
                        ...emotionEdit,
                        ...emotionSourceIdentity(emotionSource),
                        editRegion: artifacts.editRegion,
                        sourceWidth: artifacts.imageWidth,
                        sourceHeight: artifacts.imageHeight,
                        providerSize: emotionConfig.size,
                    };
                    setNodes((current) =>
                        current.map((item) =>
                            item.id === node.id
                                ? {
                                      ...item,
                                      metadata: {
                                          ...item.metadata,
                                          emotionEdit: nextEmotionEdit,
                                          ...buildImageGenerationMetadata("edit", emotionConfig, 1, [sourceReference]),
                                          size: `${artifacts.imageWidth}x${artifacts.imageHeight}`,
                                      },
                                  }
                                : item,
                        ),
                    );
                    await startAndCompleteImageTask(
                        node.id,
                        emotionConfig,
                        prompt,
                        [
                            { id: `${emotionSource.id}-${emotionEdit.presetId}-edit-region`, name: "emotion-edit-region.png", type: "image/png", dataUrl: artifacts.sourceDataUrl },
                            { id: `${emotionSource.id}-${emotionEdit.presetId}-character`, name: `${emotionEdit.characterName}-face.jpg`, type: "image/jpeg", dataUrl: artifacts.characterDataUrl },
                        ],
                        { id: `${emotionSource.id}-emotion-mask`, name: "emotion-mask.png", type: "image/png", dataUrl: artifacts.maskDataUrl },
                        controller,
                        () => {
                            const currentSource = nodesRef.current.find((item) => item.id === nextEmotionEdit.sourceNodeId);
                            if (!sameEmotionSource(nextEmotionEdit, currentSource)) throw new DOMException("Emotion source changed", "AbortError");
                        },
                        nextEmotionEdit.sourceNodeId,
                    );
                    return;
                }
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    const task = await createTextGenerationTask(generationConfig, buildNodeResponseMessages({ ...context, prompt }), {
                        signal: controller.signal,
                        surface: "canvas",
                        projectId,
                        conversationId: currentProject?.creativeConversationId,
                        sourceNodeId: sourceNode.id,
                        targetNodeId: node.id,
                        ...createFreshGenerationTaskContext("canvas-text-retry", [projectId, node.id]),
                    });
                    if (!attachGenerationTask(node.id, controller, { id: task.id, type: "text" })) return;
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === node.id
                                ? {
                                      ...item,
                                      type: CanvasNodeType.Text,
                                      metadata: {
                                          ...item.metadata,
                                          prompt,
                                          status: NODE_STATUS_LOADING,
                                          textTask: { id: task.id, model: task.model },
                                          taskId: task.id,
                                          taskStatus: task.status || "pending",
                                          taskStage: "生成中",
                                          taskCreatedAt: Date.now(),
                                          taskUpdatedAt: Date.now(),
                                          errorDetails: undefined,
                                      },
                                  }
                                : item,
                        ),
                    );
                    notifyCanvasGenerationTaskCreated(projectId);
                    await completeTextTask(node.id, generationConfig, task, controller, prompt);
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const task = await createServerVideoGenerationTask(generationConfig, prompt, retryImages, context?.referenceVideos || [], context?.referenceAudios || [], {
                        signal: controller.signal,
                        conversationId: currentProject?.creativeConversationId,
                        surface: "canvas",
                        projectId,
                        sourceNodeId: sourceNode.id,
                        targetNodeId: node.id,
                        ...createFreshGenerationTaskContext("canvas-video-retry", [projectId, node.id]),
                        skillIds: sourceNode.metadata?.skillIds || node.metadata?.skillIds,
                    });
                    if (!attachGenerationTask(node.id, controller, { id: task.id, type: "video" })) return;
                    setNodes((prev) =>
                        prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, videoTask: task, taskId: task.id, taskStatus: "running", taskStage: "生成中", taskCreatedAt: Date.now(), taskUpdatedAt: Date.now() } } : item)),
                    );
                    notifyCanvasGenerationTaskCreated(projectId);
                    await completeVideoTask(node.id, generationConfig, task, controller, prompt);
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const task = await createAudioGenerationTask(generationConfig, prompt, {
                        signal: controller.signal,
                        source: "canvas",
                        conversationId: currentProject?.creativeConversationId,
                        surface: "canvas",
                        projectId,
                        sourceNodeId: sourceNode.id,
                        targetNodeId: node.id,
                        ...createFreshGenerationTaskContext("canvas-audio-retry", [projectId, node.id]),
                    });
                    if (!attachGenerationTask(node.id, controller, { id: task.id, type: "audio" })) return;
                    setNodes((prev) =>
                        prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, audioTask: task, taskId: task.id, taskStatus: "running", taskStage: "生成中", taskCreatedAt: Date.now(), taskUpdatedAt: Date.now() } } : item)),
                    );
                    notifyCanvasGenerationTaskCreated(projectId);
                    await completeAudioTask(node.id, generationConfig, task, controller, prompt);
                    return;
                }

                const generationMetadata = savedImageMetadata?.generationType
                    ? { generationType: savedImageMetadata.generationType, model: generationConfig.model, size: generationConfig.size, quality: generationConfig.quality, count: savedImageMetadata.count || 1, references: savedImageMetadata.references }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  type: node.type === CanvasNodeType.Panorama ? CanvasNodeType.Panorama : CanvasNodeType.Image,
                                  metadata: {
                                      ...item.metadata,
                                      prompt,
                                      sourcePrompt,
                                      ...generationMetadata,
                                      ...(portraitTextureRetry.settings ? { composerContent: contextBasePrompt || portraitTextureRetry.basePrompt, portraitTexture: portraitTextureRetry.settings } : {}),
                                      ...(node.type === CanvasNodeType.Panorama ? { panoramaProjection: "equirectangular" as const, panoramaSourcePrompt: sourcePrompt } : {}),
                                  },
                              }
                            : item,
                    ),
                );
                await startAndCompleteImageTask(node.id, generationConfig, prompt, retryImages, undefined, controller, undefined, sourceNode.id);
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, imageTask: undefined, textTask: undefined, videoTask: undefined, audioTask: undefined } } : item)),
                );
            } finally {
                if (finishGenerationRequest(node.id, controller)) setRunningNodeId((current) => (current === node.id ? null : current));
            }
        },
        [
            applyAgentOps,
            attachGenerationTask,
            completeAudioTask,
            completeTextTask,
            completeVideoTask,
            currentProject?.creativeConversationId,
            deferVideoTask,
            effectiveConfig,
            finishGenerationRequest,
            isAiConfigReady,
            isGenerationRequestActive,
            message,
            openConfigDialog,
            projectId,
            setNodes,
            setRunningNodeId,
            startAndCompleteImageTask,
            startGenerationRequest,
        ],
    );

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, remoteUrl: image.remoteUrl, serverUrl: image.serverUrl, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadCanvasImage(image.dataUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width],
    );

    const insertAssistantText = useCallback(
        (text: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "text") {
                insertAssistantText(payload.content);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Video,
                        title: payload.title,
                        position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 },
                        width: nextSize.width,
                        height: nextSize.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, remoteUrl: payload.remoteUrl, serverUrl: payload.serverUrl, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else if (payload.kind === "audio") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Audio,
                        title: payload.title,
                        position: { x: center.x - spec.width / 2, y: center.y - spec.height / 2 },
                        width: spec.width,
                        height: spec.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, remoteUrl: payload.remoteUrl, serverUrl: payload.serverUrl, durationMs: payload.durationMs, status: NODE_STATUS_SUCCESS },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey, remoteUrl: payload.remoteUrl, serverUrl: payload.serverUrl });
            }
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    const assistantOpen = assistantMounted && !assistantCollapsed;
    const openAgent = () => {
        if (agentCloseTimerRef.current) {
            clearTimeout(agentCloseTimerRef.current);
            agentCloseTimerRef.current = null;
        }
        setAssistantMounted(true);
        setAssistantClosing(false);
        setAssistantCollapsed(false);
    };
    const closeAgent = () => {
        if (!assistantMounted || assistantClosing) return;
        setAssistantCollapsed(true);
        setAssistantClosing(true);
        agentCloseTimerRef.current = setTimeout(() => {
            agentCloseTimerRef.current = null;
            setAssistantMounted(false);
            setAssistantClosing(false);
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    };

    return {
        handleGenerateNode,
        handleRetryNode,
        generateImageFromTextNode,
        insertAssistantImage,
        insertAssistantText,
        handleAssetInsert,
        assistantOpen,
        openAgent,
        closeAgent,
    };
}

export type CanvasGenerationActions = ReturnType<typeof useCanvasGenerationActions>;
