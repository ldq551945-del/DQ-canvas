"use client";

import { saveAs } from "file-saver";
import dynamic from "next/dynamic";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeBackgroundRemovalOptions, type BackgroundRemovalOptionsV1 } from "@/lib/background-removal-options";
import { generationErrorMessage } from "@/lib/generation-error";
import { getDataUrlByteSize } from "@/lib/image-utils";
import { mediaDownloadFileName } from "@/lib/media-file";
import { originalImageDownloadUrl, originalMediaDownloadUrl } from "@/lib/media-image-url";
import { BackgroundRemovalTaskTerminalError, cancelBackgroundRemovalTask, createBackgroundRemovalTask, waitForBackgroundRemovalTask, type BackgroundRemovalImage } from "@/services/api/background-removal";
import { type UploadedImage } from "@/services/image-storage";
import { defaultConfig } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import { type CanvasImageAngleParams } from "../components/canvas-node-angle-dialog";
import { type CanvasImageEmotionPayload } from "../components/canvas-node-emotion-panel";
import { type CanvasImageCropRect } from "../components/canvas-node-crop-dialog";
import { type CanvasImageMaskEditPayload } from "../components/canvas-node-mask-edit-dialog";
import { type CanvasImageSplitParams } from "../components/canvas-node-split-dialog";
import { type CanvasImageUpscaleParams } from "../components/canvas-node-upscale-dialog";
import { NODE_DEFAULT_SIZE } from "../constants";
import { CanvasNodeType, isCanvasImageNodeType, type CanvasBackgroundRemovalTask, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "../types";
import { clearCanvasBackgroundRemovalTaskMetadata } from "../utils/canvas-active-task-binding";
import { backgroundRemovalTaskSourceMatches, findReusableBackgroundRemovalNode, hashBackgroundRemovalOptions } from "../utils/canvas-background-removal";
import { BACKGROUND_REFINE_MAX_BYTES, canRefineBackgroundNode } from "../utils/canvas-background-refine";
import { notifyCanvasGenerationTaskCreated } from "../utils/canvas-generation-task-events";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "../utils/canvas-image-data";
import { fitNodeSize } from "../utils/canvas-node-size";
import { emotionGenerationSize } from "../utils/canvas-emotion";
import { emotionSourceIdentity, resolveEmotionEditRequestConfig, sameEmotionSource } from "../utils/canvas-emotion-request";
import { buildPortraitTexturePrompt, DEFAULT_PORTRAIT_TEXTURE_SETTINGS, resolvePortraitTextureSize } from "../utils/canvas-portrait-texture";
import { nodeAnchorRatioAtY } from "../utils/canvas-connection-path";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

import { IMAGE_PROMPT_REVERSE_PRESET, NODE_STATUS_ERROR, NODE_STATUS_LOADING, NODE_STATUS_SUCCESS, createCanvasNode } from "./canvas-page-elements";
import { applyNodeConfigPatch, buildAngleLabel, buildAnglePrompt, buildGenerationConfig, buildImageGenerationMetadata, canvasNodeReferenceImage, imageMetadata, isGenerationCanceled, uploadCanvasImage } from "./canvas-page-utils";
import { beginCanvasDerivedImageRequest, currentCanvasDerivedImageSource, finishCanvasDerivedImageRequest } from "./canvas-derived-image-request-guard";

import type { CanvasInteractions } from "./use-canvas-interactions";
import type { CanvasPageState } from "./use-canvas-page-state";
import type { CanvasTaskRuntime } from "./use-canvas-task-runtime";

export function useCanvasNodeMediaActions({ state, tasks, interactions }: { state: CanvasPageState; tasks: CanvasTaskRuntime; interactions: CanvasInteractions }) {
    const {
        message,
        projectId,
        params,
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        addAsset,
        nodes,
        setNodes,
        setConnections,
        size,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setConnectionTargetNodeId,
        setMouseWorld,
        setContextMenu,
        setRunningNodeId,
        setDialogNodeId,
        setEditingNodeId,
        setEditRequestNonce,
        setCropNodeId,
        setAnnotationNodeId,
        setMaskEditNodeId,
        setEmotionNodeId,
        setBackgroundRefineNodeId,
        setSplitNodeId,
        setUpscaleNodeId,
        setAngleNodeId,
        setCollapsingBatchIds,
        setOpeningBatchIds,
        projectLoaded,
        nodesRef,
        connectingPointerStartRef,
        connectionTargetNodeIdRef,
        backgroundRemovalHandledTaskIdsRef,
    } = state;
    const { startGenerationRequest, attachGenerationTask, finishGenerationRequest, startAndCompleteImageTask } = tasks;
    const { screenToCanvas, setConnecting } = interactions;
    const backgroundRemovalRequestsRef = useRef(new Set<string>());
    const backgroundRemovalControllersRef = useRef(new Map<string, AbortController>());
    const backgroundRemovalTaskIdsRef = useRef(new Map<string, string>());
    const backgroundRemovalCancellationRequestedRef = useRef(new Set<string>());
    const backgroundRemovalCancellationPromisesRef = useRef(new Map<string, Promise<void>>());
    const backgroundRemovalProjectIdRef = useRef(projectId);
    const derivedImageRequestsRef = useRef(new Map<string, symbol>());
    const derivedImageProjectIdRef = useRef(projectId);
    const [backgroundRemovalNodeIds, setBackgroundRemovalNodeIds] = useState<Set<string>>(() => new Set());
    const [backgroundRemovalStoppingNodeIds, setBackgroundRemovalStoppingNodeIds] = useState<Set<string>>(() => new Set());
    backgroundRemovalProjectIdRef.current = projectId;
    derivedImageProjectIdRef.current = projectId;

    useEffect(
        () => () => {
            backgroundRemovalControllersRef.current.forEach((controller) => controller.abort());
            backgroundRemovalControllersRef.current.clear();
            backgroundRemovalTaskIdsRef.current.clear();
            backgroundRemovalCancellationPromisesRef.current.clear();
            backgroundRemovalRequestsRef.current.clear();
            backgroundRemovalHandledTaskIdsRef.current.clear();
            derivedImageRequestsRef.current.clear();
            setBackgroundRemovalNodeIds(new Set());
            setBackgroundRemovalStoppingNodeIds(new Set());
        },
        [projectId],
    );

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent | ReactPointerEvent, nodeId: string, handleType: "source" | "target", handleId?: string, anchorRatio?: number) => {
            event.preventDefault();
            event.stopPropagation();
            if ("pointerId" in event && event.currentTarget instanceof Element) {
                event.currentTarget.setPointerCapture(event.pointerId);
            }
            const node = nodesRef.current.find((item) => item.id === nodeId);
            const isKeyboardStart = event.type === "keydown";
            connectingPointerStartRef.current = isKeyboardStart ? null : { pointerId: "pointerId" in event ? event.pointerId : undefined, clientX: event.clientX, clientY: event.clientY };
            const world = isKeyboardStart && node ? { x: node.position.x + (handleType === "source" ? node.width : 0), y: node.position.y + node.height / 2 } : screenToCanvas(event.clientX, event.clientY);
            setMouseWorld(world);
            setConnecting({ nodeId, handleType, handleId, anchorRatio: node ? (isKeyboardStart ? 0.5 : typeof anchorRatio === "number" ? anchorRatio : nodeAnchorRatioAtY(node, world.y)) : 0.5 });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId && !node.metadata?.locked ? { ...node, width, height, position: position || node.position } : node)));
    }, []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                if (node.metadata?.locked) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content } } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        const isExpanded = Boolean(nodesRef.current.find((node) => node.id === nodeId)?.metadata?.imageBatchExpanded);
        if (isExpanded) {
            setCollapsingBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setCollapsingBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 320);
        } else {
            setOpeningBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setOpeningBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 260);
        }
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                return { ...node, metadata: { ...node.metadata, imageBatchExpanded: !node.metadata?.imageBatchExpanded } };
            }),
        );
    }, []);

    const setBatchPrimary = useCallback((child: CanvasNodeData) => {
        const rootId = child.metadata?.batchRootId;
        if (!rootId || !child.metadata?.content) return;
        setNodes((prev) =>
            prev.map((node) =>
                node.id === rootId
                    ? {
                          ...node,
                          ...(node.metadata?.locked ? {} : { width: child.width, height: child.height }),
                          metadata: {
                              ...node.metadata,
                              content: child.metadata?.content,
                              storageKey: child.metadata?.storageKey,
                              remoteUrl: child.metadata?.remoteUrl,
                              serverUrl: child.metadata?.serverUrl,
                              mimeType: child.metadata?.mimeType,
                              bytes: child.metadata?.bytes,
                              primaryImageId: child.id,
                              naturalWidth: child.metadata?.naturalWidth,
                              naturalHeight: child.metadata?.naturalHeight,
                              freeResize: child.metadata?.freeResize,
                          },
                      }
                    : node,
            ),
        );
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
    }, []);

    const downloadNodeImage = useCallback((node: CanvasNodeData) => {
        if ((!isCanvasImageNodeType(node.type) && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) || !node.metadata?.content) return;
        const image = isCanvasImageNodeType(node.type);
        const url = image ? originalImageDownloadUrl(node.metadata.content) : originalMediaDownloadUrl(node.metadata.content);
        saveAs(url, mediaDownloadFileName(node.id, node.metadata.mimeType, node.metadata.storageKey || node.metadata.serverUrl || node.metadata.content));
    }, []);

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error("没有可保存的文本");
                await addAsset({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || "画布文本", coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                message.success("已加入我的素材");
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error("没有可保存的视频");
                await addAsset({
                    kind: "video",
                    title: node.metadata?.prompt?.slice(0, 24) || "画布视频",
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: {
                        url: node.metadata.content,
                        storageKey: node.metadata.storageKey,
                        remoteUrl: node.metadata.remoteUrl,
                        serverUrl: node.metadata.serverUrl,
                        width: node.width,
                        height: node.height,
                        bytes: node.metadata.bytes || 0,
                        mimeType: node.metadata.mimeType || "video/mp4",
                    },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                });
                message.success("已加入我的素材");
                return;
            }
            if (!node.metadata?.content) return message.error("没有可保存的图片");
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            await addAsset({
                kind: "image",
                title: node.metadata?.prompt?.slice(0, 24) || "画布图片",
                coverUrl: node.metadata.content,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    remoteUrl: node.metadata.remoteUrl,
                    serverUrl: node.metadata.serverUrl,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
            });
            message.success("已加入我的素材");
        },
        [addAsset, message],
    );

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (!isCanvasImageNodeType(node.type) || !node.metadata?.content) {
                message.warning("图片节点为空，无法反推提示词");
                return;
            }

            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { content: IMAGE_PROMPT_REVERSE_PRESET, prompt: IMAGE_PROMPT_REVERSE_PRESET, status: NODE_STATUS_SUCCESS, fontSize: 14 }),
                title: "反推提示词",
            };
            const configNode = {
                ...createCanvasNode(
                    CanvasNodeType.Config,
                    { x: textNode.position.x + textNode.width + gap + configSpec.width / 2, y: centerY },
                    {
                        generationMode: "text",
                        model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
                        count: 1,
                        composerContent: `参考图片：@[node:${node.id}]\n任务说明：@[node:${textNode.id}]`,
                    },
                ),
                title: "反推提示词配置",
            };

            setNodes((prev) => [...prev, textNode, configNode]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }, { id: nanoid(), fromNodeId: textNode.id, toNodeId: configNode.id }]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message],
    );

    const appendDerivedImageNode = useCallback((sourceNode: CanvasNodeData, image: UploadedImage, title: string, size: { width: number; height: number }, metadataPatch: Partial<CanvasNodeMetadata> = {}) => {
        const childId = nanoid();
        const position = metadataPatch.derivedOperation ? findAvailableDerivedPosition(sourceNode, size, nodesRef.current) : { x: sourceNode.position.x + sourceNode.width + 96, y: sourceNode.position.y };
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title,
            position,
            ...size,
            metadata: { ...imageMetadata(image), prompt: sourceNode.metadata?.prompt, ...metadataPatch },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
    }, []);

    const clearPersistedBackgroundRemovalTask = useCallback((sourceNodeId: string, taskId: string) => {
        backgroundRemovalHandledTaskIdsRef.current.add(taskId);
        setNodes((current) => current.map((item) => (item.id === sourceNodeId ? clearCanvasBackgroundRemovalTaskMetadata(item, taskId) : item)));
    }, []);

    const finishBackgroundRemovalRequest = useCallback((nodeId: string, controller: AbortController) => {
        if (backgroundRemovalControllersRef.current.get(nodeId) !== controller) return false;
        backgroundRemovalRequestsRef.current.delete(nodeId);
        backgroundRemovalControllersRef.current.delete(nodeId);
        backgroundRemovalTaskIdsRef.current.delete(nodeId);
        backgroundRemovalCancellationRequestedRef.current.delete(nodeId);
        setBackgroundRemovalNodeIds((current) => {
            const next = new Set(current);
            next.delete(nodeId);
            return next;
        });
        setBackgroundRemovalStoppingNodeIds((current) => {
            const next = new Set(current);
            next.delete(nodeId);
            return next;
        });
        return true;
    }, []);

    const confirmBackgroundRemovalCancellation = useCallback(
        (nodeId: string, taskId: string, requestProjectId: string) => {
            const existing = backgroundRemovalCancellationPromisesRef.current.get(taskId);
            if (existing) return existing;
            const pending = (async () => {
                try {
                    await cancelBackgroundRemovalTask(taskId);
                    const currentTaskId = backgroundRemovalTaskIdsRef.current.get(nodeId);
                    if (currentTaskId !== taskId) {
                        if (!currentTaskId) backgroundRemovalCancellationRequestedRef.current.delete(nodeId);
                        return;
                    }
                    clearPersistedBackgroundRemovalTask(nodeId, taskId);
                    const controller = backgroundRemovalControllersRef.current.get(nodeId);
                    if (controller && finishBackgroundRemovalRequest(nodeId, controller)) {
                        finishGenerationRequest(nodeId, controller);
                        setRunningNodeId((current) => (current === nodeId ? null : current));
                    } else {
                        backgroundRemovalTaskIdsRef.current.delete(nodeId);
                        backgroundRemovalCancellationRequestedRef.current.delete(nodeId);
                        setBackgroundRemovalNodeIds((current) => {
                            const next = new Set(current);
                            next.delete(nodeId);
                            return next;
                        });
                        setBackgroundRemovalStoppingNodeIds((current) => {
                            const next = new Set(current);
                            next.delete(nodeId);
                            return next;
                        });
                    }
                    notifyCanvasGenerationTaskCreated(requestProjectId);
                    if (backgroundRemovalProjectIdRef.current === requestProjectId) message.success({ content: "抠图任务已完全终止", key: `canvas-background-removal:${nodeId}` });
                } catch (error) {
                    if (backgroundRemovalTaskIdsRef.current.get(nodeId) === taskId) {
                        setBackgroundRemovalStoppingNodeIds((current) => {
                            const next = new Set(current);
                            next.delete(nodeId);
                            return next;
                        });
                        message.error({ content: error instanceof Error ? error.message : "终止抠图失败，请重试", key: `canvas-background-removal:${nodeId}` });
                    }
                    throw error;
                } finally {
                    backgroundRemovalCancellationPromisesRef.current.delete(taskId);
                }
            })();
            backgroundRemovalCancellationPromisesRef.current.set(taskId, pending);
            return pending;
        },
        [clearPersistedBackgroundRemovalTask, finishBackgroundRemovalRequest, finishGenerationRequest, message, setRunningNodeId],
    );

    const cancelBackgroundRemovalImageNode = useCallback(
        async (node: CanvasNodeData) => {
            if (!backgroundRemovalRequestsRef.current.has(node.id)) return;
            backgroundRemovalCancellationRequestedRef.current.add(node.id);
            setBackgroundRemovalStoppingNodeIds((current) => new Set(current).add(node.id));
            message.loading({ content: "正在完全终止抠图…", key: `canvas-background-removal:${node.id}`, duration: 0 });
            const taskId = backgroundRemovalTaskIdsRef.current.get(node.id) || node.metadata?.backgroundRemovalTask?.id;
            backgroundRemovalControllersRef.current.get(node.id)?.abort();
            if (!taskId) return;
            backgroundRemovalTaskIdsRef.current.set(node.id, taskId);
            await confirmBackgroundRemovalCancellation(node.id, taskId, projectId).catch(() => undefined);
        },
        [confirmBackgroundRemovalCancellation, message, projectId],
    );

    const applyBackgroundRemovalResult = useCallback(
        (sourceNodeId: string, task: CanvasBackgroundRemovalTask, image: BackgroundRemovalImage, selectExisting = false) => {
            const latestSource = nodesRef.current.find((item) => item.id === sourceNodeId);
            if (!latestSource || !backgroundRemovalTaskSourceMatches(latestSource, task)) {
                clearPersistedBackgroundRemovalTask(sourceNodeId, task.id);
                return "source_changed" as const;
            }

            const existingResult = findReusableBackgroundRemovalNode(nodesRef.current, {
                sourceNodeId,
                sourceStorageKey: task.sourceStorageKey,
                options: image.backgroundRemovalOptions,
                optionsHash: image.backgroundRemovalOptionsHash,
            });
            clearPersistedBackgroundRemovalTask(sourceNodeId, task.id);
            if (existingResult) {
                if (selectExisting) {
                    setSelectedNodeIds(new Set([existingResult.id]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(existingResult.id);
                }
                return "reused" as const;
            }

            const size = fitNodeSize(image.width, image.height, Math.max(220, latestSource.width), Math.max(220, latestSource.height));
            appendDerivedImageNode(latestSource, image, image.backgroundRemovalOptions.outputMode === "mask" ? "主体蒙版" : image.backgroundRemovalOptions.outputMode === "color" ? "换背景结果" : "抠图结果", size, {
                derivedOperation: "remove-background",
                sourceNodeId: latestSource.id,
                sourceStorageKey: task.sourceStorageKey,
                backgroundRemovalOptions: image.backgroundRemovalOptions,
                backgroundRemovalOptionsHash: image.backgroundRemovalOptionsHash,
            });
            return "created" as const;
        },
        [appendDerivedImageNode, clearPersistedBackgroundRemovalTask, setDialogNodeId, setSelectedConnectionId, setSelectedNodeIds],
    );

    const saveAnnotatedImageNode = useCallback(
        async (node: CanvasNodeData, dataUrl: string) => {
            if (!node.metadata?.content) return;
            const ticket = beginCanvasDerivedImageRequest(derivedImageRequestsRef.current, projectId, "annotation", node);
            if (!ticket) {
                message.info("该图片的标注正在保存中");
                return;
            }
            try {
                const image = await uploadCanvasImage(dataUrl);
                const currentSource = currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current);
                if (!currentSource) throw new Error("源图片已删除或替换，未保存标注结果");
                appendDerivedImageNode(currentSource, image, `标注 · ${currentSource.title || "图片"}`, fitNodeSize(image.width, image.height, currentSource.width, currentSource.height));
                setAnnotationNodeId(null);
                message.success("标注图片已保存为新节点");
            } catch (error) {
                const failure = error instanceof Error && error.message ? error : new Error("标注图片保存失败");
                message.error(failure.message);
                throw failure;
            } finally {
                finishCanvasDerivedImageRequest(derivedImageRequestsRef.current, ticket);
            }
        },
        [appendDerivedImageNode, message, projectId, setAnnotationNodeId],
    );

    const generatePortraitTextureNode = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning("图片节点为空，无法调节人物质感");
                return;
            }
            const ticket = beginCanvasDerivedImageRequest(derivedImageRequestsRef.current, projectId, "portrait-texture", node);
            if (!ticket) {
                message.info("该图片正在生成人物质感结果");
                return;
            }
            const generationConfig = {
                ...buildGenerationConfig(effectiveConfig, node, "image"),
                count: "1",
                size: resolvePortraitTextureSize(node.metadata.size, node.metadata.naturalWidth, node.metadata.naturalHeight, effectiveConfig.size),
            };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                finishCanvasDerivedImageRequest(derivedImageRequestsRef.current, ticket);
                return;
            }

            let childId: string | null = null;
            let controller: AbortController | null = null;
            const discardPortraitTextureChild = (discardedChildId: string) => {
                setNodes((current) => current.filter((item) => item.id !== discardedChildId));
                setConnections((current) => current.filter((connection) => connection.fromNodeId !== discardedChildId && connection.toNodeId !== discardedChildId));
                setSelectedNodeIds((current) => {
                    if (!current.has(discardedChildId)) return current;
                    const next = new Set(current);
                    next.delete(discardedChildId);
                    return next;
                });
                setDialogNodeId((current) => (current === discardedChildId ? null : current));
            };
            try {
                const source = currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current);
                if (!source) {
                    message.error("源图片已删除或替换，未创建人物质感任务");
                    return;
                }
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                childId = nanoid();
                const portraitTexture = { ...DEFAULT_PORTRAIT_TEXTURE_SETTINGS, ...source.metadata?.portraitTexture };
                const composerContent = `@[node:${source.id}]`;
                const prompt = buildPortraitTexturePrompt(composerContent, portraitTexture);
                const sourceReference = canvasNodeReferenceImage(source);
                const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [sourceReference]);
                const child: CanvasNodeData = {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: "人物质感调节",
                    position: { x: source.position.x + source.width + 96, y: source.position.y },
                    width: spec.width,
                    height: spec.height,
                    metadata: {
                        generationMode: "image",
                        prompt,
                        composerContent,
                        portraitTexture,
                        status: NODE_STATUS_LOADING,
                        ...generationMetadata,
                    },
                };
                setNodes((current) => [...current, child]);
                setConnections((current) => [...current, { id: nanoid(), fromNodeId: source.id, toNodeId: childId! }]);
                setSelectedNodeIds(new Set([childId]));
                setSelectedConnectionId(null);
                setDialogNodeId(childId);
                setRunningNodeId(childId);
                controller = startGenerationRequest(childId, source.id, childId);
                const validatePortraitTextureSource = () => {
                    const currentSource = currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current);
                    if (!currentSource || !nodesRef.current.some((item) => item.id === childId)) throw new DOMException("Portrait texture source changed", "AbortError");
                };
                validatePortraitTextureSource();
                await startAndCompleteImageTask(childId, generationConfig, prompt, [sourceReference], undefined, controller, validatePortraitTextureSource);
                const completedSource = currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current);
                if (!completedSource) {
                    discardPortraitTextureChild(childId);
                    message.error("源图片已删除或替换，已丢弃人物质感结果");
                }
            } catch (error) {
                if (childId && !currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current)) {
                    discardPortraitTextureChild(childId);
                    if (ticket.projectId === derivedImageProjectIdRef.current) message.error("源图片已删除或替换，已丢弃人物质感结果");
                    return;
                }
                if (isGenerationCanceled(error)) {
                    if (childId) discardPortraitTextureChild(childId);
                    return;
                }
                const errorDetails = generationErrorMessage(error);
                message.error(errorDetails);
                if (childId) setNodes((current) => current.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, imageTask: undefined } } : item)));
            } finally {
                if (childId && controller) finishGenerationRequest(childId, controller);
                finishCanvasDerivedImageRequest(derivedImageRequestsRef.current, ticket);
                setRunningNodeId((current) => (current === childId ? null : current));
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, projectId, startAndCompleteImageTask, startGenerationRequest],
    );

    const removeBackgroundImageNode = useCallback(
        async (node: CanvasNodeData, options: BackgroundRemovalOptionsV1) => {
            if (!node.metadata?.content) return;
            if (backgroundRemovalRequestsRef.current.has(node.id)) {
                message.info("该图片正在抠图处理中");
                return;
            }
            const sourceStorageKey = node.metadata.storageKey?.trim();
            if (!sourceStorageKey) {
                message.error("请先将图片保存到画布媒体，再进行抠图");
                return;
            }
            const requestProjectId = projectId;
            const sourceContent = node.metadata.content;
            const sourceNaturalWidth = node.metadata.naturalWidth;
            const sourceNaturalHeight = node.metadata.naturalHeight;
            const sourceBytes = node.metadata.bytes;
            const requestKey = `canvas-background-removal:${node.id}`;
            const controller = startGenerationRequest(node.id, node.id, node.id, new AbortController());
            let terminalMessageShown = false;
            let persistedTask: CanvasBackgroundRemovalTask | null = null;
            backgroundRemovalCancellationRequestedRef.current.delete(node.id);
            backgroundRemovalRequestsRef.current.add(node.id);
            backgroundRemovalControllersRef.current.set(node.id, controller);
            setBackgroundRemovalNodeIds((current) => new Set(current).add(node.id));
            setRunningNodeId(node.id);
            message.loading({ content: "正在抠图…", key: requestKey, duration: 0 });
            try {
                const requestedOptions = { ...normalizeBackgroundRemovalOptions(options), outputMode: "transparent" as const };
                if (backgroundRemovalProjectIdRef.current !== requestProjectId) return;
                const requestedOptionsHash = await hashBackgroundRemovalOptions(requestedOptions).catch(() => "");
                const existingResult = findReusableBackgroundRemovalNode(nodesRef.current, {
                    sourceNodeId: node.id,
                    sourceStorageKey,
                    options: requestedOptions,
                    optionsHash: requestedOptionsHash,
                });
                if (existingResult) {
                    setSelectedNodeIds(new Set([existingResult.id]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(existingResult.id);
                    terminalMessageShown = true;
                    message.info({ content: "已打开相同参数的抠图结果", key: requestKey });
                    return;
                }

                const task = await createBackgroundRemovalTask({
                    sourceStorageKey,
                    projectId,
                    sourceNodeId: node.id,
                    options: requestedOptions,
                    onTaskCreated: (createdTask) => {
                        if (!backgroundRemovalRequestsRef.current.has(node.id) && !backgroundRemovalCancellationRequestedRef.current.has(node.id)) return;
                        backgroundRemovalTaskIdsRef.current.set(node.id, createdTask.id);
                        notifyCanvasGenerationTaskCreated(requestProjectId);
                    },
                });
                if (!backgroundRemovalRequestsRef.current.has(node.id) && !backgroundRemovalCancellationRequestedRef.current.has(node.id)) return;
                backgroundRemovalTaskIdsRef.current.set(node.id, task.id);
                if (backgroundRemovalCancellationRequestedRef.current.has(node.id)) {
                    terminalMessageShown = true;
                    await confirmBackgroundRemovalCancellation(node.id, task.id, requestProjectId);
                    return;
                }
                if (!attachGenerationTask(node.id, controller, { id: task.id, type: "image_process" })) return;
                if ((task.sourceStorageKey && task.sourceStorageKey !== sourceStorageKey) || (task.sourceNodeId && task.sourceNodeId !== node.id)) {
                    backgroundRemovalCancellationRequestedRef.current.add(node.id);
                    setBackgroundRemovalStoppingNodeIds((current) => new Set(current).add(node.id));
                    terminalMessageShown = true;
                    await confirmBackgroundRemovalCancellation(node.id, task.id, requestProjectId);
                    return;
                }
                const taskSnapshot: CanvasBackgroundRemovalTask = {
                    id: task.id,
                    sourceNodeId: node.id,
                    sourceStorageKey,
                    sourceContent,
                    sourceNaturalWidth,
                    sourceNaturalHeight,
                    sourceBytes,
                    options: requestedOptions,
                    optionsHash: task.optionsHash || requestedOptionsHash || undefined,
                    model: task.model || requestedOptions.model,
                    progressStage: task.progressStage,
                    progress: task.progress,
                    stage: task.stage,
                };
                persistedTask = taskSnapshot;
                const sourceMatches = backgroundRemovalTaskSourceMatches(
                    nodesRef.current.find((item) => item.id === node.id),
                    taskSnapshot,
                );
                if (backgroundRemovalProjectIdRef.current !== requestProjectId) return;
                if (!sourceMatches) {
                    backgroundRemovalCancellationRequestedRef.current.add(node.id);
                    setBackgroundRemovalStoppingNodeIds((current) => new Set(current).add(node.id));
                    terminalMessageShown = true;
                    await confirmBackgroundRemovalCancellation(node.id, task.id, requestProjectId);
                    return;
                }
                setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, backgroundRemovalTask: taskSnapshot } } : item)));
                if (backgroundRemovalCancellationRequestedRef.current.has(node.id)) {
                    terminalMessageShown = true;
                    await confirmBackgroundRemovalCancellation(node.id, task.id, requestProjectId);
                    return;
                }
                const image = await waitForBackgroundRemovalTask(task.id, requestedOptions, controller.signal);
                if (backgroundRemovalCancellationRequestedRef.current.has(node.id) || controller.signal.aborted) {
                    terminalMessageShown = true;
                    await confirmBackgroundRemovalCancellation(node.id, task.id, requestProjectId);
                    return;
                }
                if (backgroundRemovalProjectIdRef.current !== requestProjectId) return;
                const outcome = applyBackgroundRemovalResult(node.id, taskSnapshot, image, true);
                if (outcome === "source_changed") {
                    if (nodesRef.current.some((item) => item.id === node.id)) {
                        terminalMessageShown = true;
                        message.warning({ content: "源图片已变化，未应用旧的抠图结果", key: requestKey });
                    }
                    return;
                }
                terminalMessageShown = true;
                message[outcome === "reused" ? "info" : "success"]({
                    content: outcome === "reused" ? "已打开相同参数的抠图结果" : image.backgroundRemovalOptions.outputMode === "mask" ? "蒙版生成完成" : image.backgroundRemovalOptions.outputMode === "color" ? "背景替换完成" : "抠图完成",
                    key: requestKey,
                });
            } catch (error) {
                if (error instanceof DOMException && error.name === "AbortError") {
                    const taskId = backgroundRemovalTaskIdsRef.current.get(node.id);
                    if (backgroundRemovalCancellationRequestedRef.current.has(node.id) && taskId) {
                        terminalMessageShown = true;
                        await confirmBackgroundRemovalCancellation(node.id, taskId, requestProjectId).catch(() => undefined);
                    }
                    return;
                }
                if (persistedTask && error instanceof BackgroundRemovalTaskTerminalError && error.status === "cancelled") {
                    backgroundRemovalCancellationRequestedRef.current.add(node.id);
                    setBackgroundRemovalStoppingNodeIds((current) => new Set(current).add(node.id));
                    terminalMessageShown = true;
                    controller.abort();
                    await confirmBackgroundRemovalCancellation(node.id, persistedTask.id, requestProjectId).catch(() => undefined);
                    return;
                }
                if (backgroundRemovalCancellationRequestedRef.current.has(node.id)) {
                    if (backgroundRemovalTaskIdsRef.current.has(node.id)) return;
                    backgroundRemovalCancellationRequestedRef.current.delete(node.id);
                    setBackgroundRemovalStoppingNodeIds((current) => {
                        const next = new Set(current);
                        next.delete(node.id);
                        return next;
                    });
                    terminalMessageShown = true;
                    message.error({ content: "任务创建结果未知，未能确认完全终止；活动任务恢复后可再次终止", key: requestKey });
                    return;
                }
                if (persistedTask && error instanceof BackgroundRemovalTaskTerminalError) clearPersistedBackgroundRemovalTask(node.id, persistedTask.id);
                terminalMessageShown = true;
                message.error({ content: error instanceof Error ? error.message : "抠图失败，请稍后重试", key: requestKey });
            } finally {
                if (!terminalMessageShown) message.destroy(requestKey);
                if (!backgroundRemovalCancellationRequestedRef.current.has(node.id) && finishBackgroundRemovalRequest(node.id, controller)) {
                    finishGenerationRequest(node.id, controller);
                    setRunningNodeId((current) => (current === node.id ? null : current));
                }
            }
        },
        [
            applyBackgroundRemovalResult,
            attachGenerationTask,
            clearPersistedBackgroundRemovalTask,
            confirmBackgroundRemovalCancellation,
            finishBackgroundRemovalRequest,
            finishGenerationRequest,
            message,
            projectId,
            setDialogNodeId,
            setRunningNodeId,
            setSelectedConnectionId,
            setSelectedNodeIds,
            startGenerationRequest,
        ],
    );

    const resumeBackgroundRemovalTask = useCallback(
        async (node: CanvasNodeData, task: CanvasBackgroundRemovalTask) => {
            if (backgroundRemovalHandledTaskIdsRef.current.has(task.id) || node.metadata?.backgroundRemovalHandledTaskId === task.id) {
                clearPersistedBackgroundRemovalTask(node.id, task.id);
                return;
            }
            if (backgroundRemovalRequestsRef.current.has(node.id)) return;
            if (!backgroundRemovalTaskSourceMatches(node, task)) {
                clearPersistedBackgroundRemovalTask(node.id, task.id);
                return;
            }
            const requestProjectId = projectId;
            const controller = new AbortController();
            backgroundRemovalCancellationRequestedRef.current.delete(node.id);
            backgroundRemovalRequestsRef.current.add(node.id);
            backgroundRemovalControllersRef.current.set(node.id, controller);
            backgroundRemovalTaskIdsRef.current.set(node.id, task.id);
            setBackgroundRemovalNodeIds((current) => new Set(current).add(node.id));
            try {
                const image = await waitForBackgroundRemovalTask(task.id, task.options, controller.signal);
                if (backgroundRemovalCancellationRequestedRef.current.has(node.id) || controller.signal.aborted) {
                    await confirmBackgroundRemovalCancellation(node.id, task.id, requestProjectId);
                    return;
                }
                if (backgroundRemovalProjectIdRef.current !== requestProjectId) return;
                applyBackgroundRemovalResult(node.id, task, image);
            } catch (error) {
                if (error instanceof DOMException && error.name === "AbortError") return;
                if (error instanceof BackgroundRemovalTaskTerminalError && error.status === "cancelled") {
                    backgroundRemovalCancellationRequestedRef.current.add(node.id);
                    setBackgroundRemovalStoppingNodeIds((current) => new Set(current).add(node.id));
                    controller.abort();
                    await confirmBackgroundRemovalCancellation(node.id, task.id, requestProjectId).catch(() => undefined);
                    return;
                }
                if (error instanceof BackgroundRemovalTaskTerminalError) clearPersistedBackgroundRemovalTask(node.id, task.id);
            } finally {
                if (!backgroundRemovalCancellationRequestedRef.current.has(node.id)) finishBackgroundRemovalRequest(node.id, controller);
            }
        },
        [applyBackgroundRemovalResult, clearPersistedBackgroundRemovalTask, confirmBackgroundRemovalCancellation, finishBackgroundRemovalRequest, projectId],
    );

    useEffect(() => {
        if (!projectLoaded) return;
        nodes.forEach((node) => {
            const task = node.metadata?.backgroundRemovalTask;
            if (!task) return;
            void resumeBackgroundRemovalTask(node, task);
        });
    }, [nodes, projectLoaded, resumeBackgroundRemovalTask]);

    const refineBackgroundImageNode = useCallback(
        async (node: CanvasNodeData, result: Blob) => {
            if (!canRefineBackgroundNode(node)) throw new Error("该节点不是可细化的抠图结果");
            if (result.type !== "image/png") throw new Error("边缘细化结果必须为 PNG 图片");
            if (result.size > BACKGROUND_REFINE_MAX_BYTES) throw new Error("细化后的 PNG 超过 30MB，请先缩小图片后重试");
            const sourceStorageKey = node.metadata?.storageKey?.trim();
            const sourceContent = node.metadata?.content;
            const requestKey = `canvas-background-refine:${node.id}`;
            message.loading({ content: "正在保存细化结果…", key: requestKey, duration: 0 });
            try {
                const image = await uploadCanvasImage(result);
                const latestSource = nodesRef.current.find((item) => item.id === node.id);
                if (!latestSource || latestSource.metadata?.content !== sourceContent || latestSource.metadata?.storageKey?.trim() !== sourceStorageKey) throw new Error("源抠图结果已变化，请重新打开细化面板");
                const refinedSize = fitNodeSize(image.width, image.height, Math.max(220, latestSource.width), Math.max(220, latestSource.height));
                appendDerivedImageNode(latestSource, image, "边缘细化结果", refinedSize, {
                    derivedOperation: "refine-background",
                    sourceNodeId: latestSource.id,
                    sourceStorageKey,
                    backgroundRemovalOptions: latestSource.metadata?.backgroundRemovalOptions,
                    backgroundRemovalOptionsHash: latestSource.metadata?.backgroundRemovalOptionsHash,
                });
                setBackgroundRefineNodeId(null);
                message.success({ content: "边缘细化完成", key: requestKey });
            } catch (error) {
                const reason = error instanceof Error ? error : new Error("边缘细化结果保存失败");
                message.error({ content: reason.message, key: requestKey });
                throw reason;
            }
        },
        [appendDerivedImageNode, message, setBackgroundRefineNodeId],
    );

    const cropImageNode = useCallback(
        async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
            if (!node.metadata?.content) return;
            const cropped = await cropDataUrl(node.metadata.content, crop);
            const image = await uploadCanvasImage(cropped);
            const width = Math.min(node.width, Math.max(220, image.width));
            appendDerivedImageNode(node, image, "Cropped Image", { width, height: width * (image.height / image.width) });
            setCropNodeId(null);
        },
        [appendDerivedImageNode],
    );

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadCanvasImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: `${node.title || "图片"} ${piece.row + 1}-${piece.column + 1}`,
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(`已切分为 ${childNodes.length} 个子节点`);
        },
        [message],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            const prompt = `只修改蒙版透明区域，其他区域保持不变。${userPrompt}`;
            const childId = nanoid();
            const source = canvasNodeReferenceImage(node);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            setMaskEditNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: userPrompt.slice(0, 32) || "局部编辑结果",
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                await startAndCompleteImageTask(childId, generationConfig, prompt, [source], { id: `${node.id}-mask`, name: "mask.png", type: "image/png", dataUrl: payload.maskDataUrl }, controller);
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = generationErrorMessage(error);
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, imageTask: undefined } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, startAndCompleteImageTask, startGenerationRequest],
    );

    const upscaleImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
            if (!node.metadata?.content) return;
            setUpscaleNodeId(null);
            const upscaled = await upscaleDataUrl(node.metadata.content, params);
            const image = await uploadCanvasImage(upscaled);
            const size = fitNodeSize(image.width, image.height);
            appendDerivedImageNode(node, image, "Upscaled Image", size);
        },
        [appendDerivedImageNode],
    );

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const ticket = beginCanvasDerivedImageRequest(derivedImageRequestsRef.current, projectId, "angle", node);
            if (!ticket) {
                message.info("该图片正在生成多视角结果");
                return;
            }
            let childId: string | null = null;
            let controller: AbortController | null = null;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                finishCanvasDerivedImageRequest(derivedImageRequestsRef.current, ticket);
                return;
            }
            const discardAngleChild = (discardedChildId: string) => {
                setNodes((prev) => prev.filter((item) => item.id !== discardedChildId));
                setConnections((prev) => prev.filter((connection) => connection.fromNodeId !== discardedChildId && connection.toNodeId !== discardedChildId));
                setSelectedNodeIds((prev) => {
                    if (!prev.has(discardedChildId)) return prev;
                    const next = new Set(prev);
                    next.delete(discardedChildId);
                    return next;
                });
                setDialogNodeId((current) => (current === discardedChildId ? null : current));
            };
            try {
                const source = currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current);
                if (!source) {
                    message.error("源图片已删除或替换，未创建多视角任务");
                    return;
                }
                childId = nanoid();
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const title = buildAngleLabel(params);
                const prompt = buildAnglePrompt(params);
                const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [canvasNodeReferenceImage(source)]);
                setAngleNodeId(null);
                setRunningNodeId(childId);
                setNodes((prev) => [
                    ...prev,
                    {
                        id: childId!,
                        type: CanvasNodeType.Image,
                        title,
                        position: { x: source.position.x + source.width + 96, y: source.position.y },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                    },
                ]);
                setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: source.id, toNodeId: childId! }]);
                setSelectedNodeIds(new Set([childId]));
                setDialogNodeId(childId);
                controller = startGenerationRequest(childId, source.id, childId);
                const currentSource = currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current);
                if (!currentSource) {
                    controller.abort();
                    discardAngleChild(childId);
                    message.error("源图片已删除或替换，未创建多视角任务");
                    return;
                }
                await startAndCompleteImageTask(childId, generationConfig, prompt, [canvasNodeReferenceImage(currentSource)], undefined, controller);
                const completedSource = currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current);
                if (!completedSource) {
                    discardAngleChild(childId);
                    message.error("源图片已删除或替换，已丢弃多视角结果");
                }
            } catch (error) {
                if (childId && !currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current)) {
                    discardAngleChild(childId);
                    message.error("源图片已删除或替换，已丢弃多视角结果");
                    return;
                }
                if (isGenerationCanceled(error)) return;
                const errorDetails = generationErrorMessage(error);
                message.error(errorDetails);
                if (childId) setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, imageTask: undefined } } : item)));
            } finally {
                if (childId && controller) finishGenerationRequest(childId, controller);
                finishCanvasDerivedImageRequest(derivedImageRequestsRef.current, ticket);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, finishGenerationRequest, isAiConfigReady, message, openConfigDialog, projectId, startAndCompleteImageTask, startGenerationRequest],
    );

    const generateEmotionNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageEmotionPayload) => {
            if (!node.metadata?.content) return false;
            const ticket = beginCanvasDerivedImageRequest(derivedImageRequestsRef.current, projectId, "emotion", node);
            if (!ticket) {
                message.info("该图片正在生成表情结果");
                return false;
            }
            const baseConfig = buildGenerationConfig(effectiveConfig, node, "image");
            const providerSize = emotionGenerationSize(payload.editRegion);
            const generationConfig = {
                ...baseConfig,
                count: "1",
                size: providerSize,
                quality: !baseConfig.quality || baseConfig.quality === "auto" ? "high" : baseConfig.quality,
            };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                finishCanvasDerivedImageRequest(derivedImageRequestsRef.current, ticket);
                return false;
            }
            const { supportsMaskedOpenAiEdit } = resolveEmotionEditRequestConfig(generationConfig);
            if (!supportsMaskedOpenAiEdit) {
                message.error("表情编辑需要支持蒙版的 OpenAI Images 渠道，当前渠道不会执行整图重绘");
                finishCanvasDerivedImageRequest(derivedImageRequestsRef.current, ticket);
                return false;
            }
            const source = currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current);
            if (!source) {
                finishCanvasDerivedImageRequest(derivedImageRequestsRef.current, ticket);
                message.error("源图片已删除或替换，未创建表情任务");
                return false;
            }
            const sourceReference = canvasNodeReferenceImage(source);
            const editReference = {
                id: `${source.id}-${payload.presetId}-edit-region`,
                name: "emotion-edit-region.png",
                type: "image/png",
                dataUrl: payload.sourceDataUrl,
            };
            const characterReference = {
                id: `${source.id}-${payload.presetId}-character`,
                name: `${payload.characterName}-face.jpg`,
                type: "image/jpeg",
                dataUrl: payload.characterDataUrl,
            };
            const childId = nanoid();
            const generationMetadata = {
                ...buildImageGenerationMetadata("edit", generationConfig, 1, [sourceReference]),
                size: `${payload.imageWidth}x${payload.imageHeight}`,
            };
            const emotionEdit: NonNullable<CanvasNodeMetadata["emotionEdit"]> = {
                sourceNodeId: source.id,
                ...emotionSourceIdentity(source),
                characterName: payload.characterName,
                presetId: payload.presetId,
                intimacy: payload.intimacy,
                arousal: payload.arousal,
                label: payload.label,
                faceBox: payload.faceBox,
                editRegion: payload.editRegion,
                sourceWidth: payload.imageWidth,
                sourceHeight: payload.imageHeight,
                providerSize,
            };
            const child: CanvasNodeData = {
                id: childId,
                type: CanvasNodeType.Image,
                title: `${payload.characterName} · ${payload.label}`,
                position: { x: source.position.x + source.width + 96, y: source.position.y },
                width: source.width,
                height: source.height,
                metadata: { prompt: payload.prompt, status: NODE_STATUS_LOADING, ...generationMetadata, emotionEdit },
            };

            setEmotionNodeId(null);
            setRunningNodeId(childId);
            setNodes((current) => [...current, child]);
            setConnections((current) => [...current, { id: nanoid(), fromNodeId: source.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, source.id, childId);
            const discardEmotionChild = () => {
                setNodes((current) => current.filter((item) => item.id !== childId));
                setConnections((current) => current.filter((connection) => connection.fromNodeId !== childId && connection.toNodeId !== childId));
                setSelectedNodeIds((current) => {
                    if (!current.has(childId)) return current;
                    const next = new Set(current);
                    next.delete(childId);
                    return next;
                });
                setDialogNodeId((current) => (current === childId ? null : current));
            };
            const validateEmotionSource = () => {
                const currentSource = currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current);
                const target = nodesRef.current.find((item) => item.id === childId);
                if (!currentSource || !target?.metadata?.emotionEdit || !sameEmotionSource(target.metadata.emotionEdit, currentSource)) throw new DOMException("Emotion source changed", "AbortError");
            };
            try {
                validateEmotionSource();
                await startAndCompleteImageTask(
                    childId,
                    generationConfig,
                    payload.prompt,
                    [editReference, characterReference],
                    { id: `${source.id}-emotion-mask`, name: "emotion-mask.png", type: "image/png", dataUrl: payload.maskDataUrl },
                    controller,
                    validateEmotionSource,
                );
                const completedSource = currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current);
                if (!completedSource || !sameEmotionSource(emotionEdit, completedSource)) {
                    discardEmotionChild();
                    message.error("源图片已删除或替换，已丢弃表情结果");
                }
            } catch (error) {
                if (!currentCanvasDerivedImageSource(derivedImageRequestsRef.current, ticket, derivedImageProjectIdRef.current, nodesRef.current)) {
                    discardEmotionChild();
                    if (ticket.projectId === derivedImageProjectIdRef.current) message.error("源图片已删除或替换，已丢弃表情结果");
                    return true;
                }
                if (isGenerationCanceled(error)) return true;
                const errorDetails = generationErrorMessage(error);
                message.error(errorDetails);
                setNodes((current) => current.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails, imageTask: undefined } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                finishCanvasDerivedImageRequest(derivedImageRequestsRef.current, ticket);
                setRunningNodeId((current) => (current === childId ? null : current));
            }
            return true;
        },
        [
            effectiveConfig,
            finishGenerationRequest,
            isAiConfigReady,
            message,
            openConfigDialog,
            projectId,
            setConnections,
            setDialogNodeId,
            setEmotionNodeId,
            setNodes,
            setRunningNodeId,
            setSelectedConnectionId,
            setSelectedNodeIds,
            startAndCompleteImageTask,
            startGenerationRequest,
        ],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);
    return {
        handleConnectStart,
        handleNodeResize,
        toggleNodeFreeResize,
        handleNodeContentChange,
        toggleBatchExpanded,
        setBatchPrimary,
        openTextEditor,
        handleNodePromptChange,
        handleConfigNodeChange,
        downloadNodeImage,
        saveNodeAsset,
        createImageReversePromptNodes,
        appendDerivedImageNode,
        saveAnnotatedImageNode,
        generatePortraitTextureNode,
        removeBackgroundImageNode,
        cancelBackgroundRemovalImageNode,
        backgroundRemovalNodeIds,
        backgroundRemovalStoppingNodeIds,
        refineBackgroundImageNode,
        cropImageNode,
        splitImageNode,
        maskEditImageNode,
        upscaleImageNode,
        generateAngleNode,
        generateEmotionNode,
        handleFontSizeChange,
    };
}

export type CanvasNodeMediaActions = ReturnType<typeof useCanvasNodeMediaActions>;

function findAvailableDerivedPosition(sourceNode: CanvasNodeData, size: { width: number; height: number }, nodes: CanvasNodeData[]) {
    const x = sourceNode.position.x + sourceNode.width + 96;
    const step = Math.max(64, size.height + 32);
    for (let index = 0; index < 48; index += 1) {
        const candidate = { x, y: sourceNode.position.y + index * step };
        const occupied = nodes.some((node) => node.id !== sourceNode.id && rectanglesOverlap(candidate, size, node.position, node, 24));
        if (!occupied) return candidate;
    }
    return { x, y: sourceNode.position.y + 48 * step };
}

function rectanglesOverlap(leftPosition: Position, leftSize: { width: number; height: number }, rightPosition: Position, rightSize: { width: number; height: number }, gap: number) {
    return leftPosition.x < rightPosition.x + rightSize.width + gap && leftPosition.x + leftSize.width + gap > rightPosition.x && leftPosition.y < rightPosition.y + rightSize.height + gap && leftPosition.y + leftSize.height + gap > rightPosition.y;
}
