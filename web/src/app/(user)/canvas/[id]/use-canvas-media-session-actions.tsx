"use client";

import dynamic from "next/dynamic";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { useCallback } from "react";

import { droppedFiles, preventFileDragEvent } from "@/lib/file-drop";
import { readImageMeta } from "@/lib/image-utils";
import { uploadMediaFile } from "@/services/file-storage";
import { NODE_DEFAULT_SIZE } from "../constants";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasNodeData, type Position } from "../types";
import { fitNodeSize } from "../utils/canvas-node-size";
import { PANORAMA_IMAGE_SIZE, isPanoramaRatio } from "../utils/canvas-panorama";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

const ALL_MEDIA_INPUT_ACCEPT = "image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";

import { CANVAS_DROP_NODE_OFFSET, VIDEO_NODE_MAX_HEIGHT, VIDEO_NODE_MAX_WIDTH } from "./canvas-page-elements";
import { audioMetadata, imageMetadata, isAudioFile, uploadCanvasImage, videoMetadata } from "./canvas-page-utils";

import type { CanvasInteractions } from "./use-canvas-interactions";
import type { CanvasPageState } from "./use-canvas-page-state";

import type { CanvasFileActions } from "./use-canvas-file-actions";
import type { CanvasTaskRuntime } from "./use-canvas-task-runtime";

export function useCanvasMediaSessionActions({ state, tasks, interactions, files }: { state: CanvasPageState; tasks: CanvasTaskRuntime; interactions: CanvasInteractions; files: CanvasFileActions }) {
    const {
        message,
        projectId,
        containerRef,
        imageInputRef,
        uploadTargetRef,
        renameProject,
        currentProject,
        setNodes,
        setChatSessions,
        setActiveChatId,
        size,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
        setTitleEditing,
        titleDraft,
        setTitleDraft,
        nodesRef,
    } = state;
    const { screenToCanvas } = interactions;
    const { invalidateGenerationRequest } = tasks;
    const { createImageFileNode, createVideoFileNode, createAudioFileNode } = files;

    const handleUploadRequest = useCallback(
        (nodeId?: string, position?: Position) => {
            uploadTargetRef.current = { nodeId, position };
            const target = nodeId ? nodesRef.current.find((node) => node.id === nodeId) : null;
            if (imageInputRef.current) imageInputRef.current.accept = mediaInputAcceptForNode(target ?? null);
            imageInputRef.current?.click();
        },
        [imageInputRef, nodesRef, uploadTargetRef],
    );

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            const target = uploadTargetRef.current;
            const resetPicker = () => {
                uploadTargetRef.current = null;
                event.target.value = "";
                event.currentTarget.accept = ALL_MEDIA_INPUT_ACCEPT;
            };
            if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !isAudioFile(file))) {
                resetPicker();
                return;
            }

            const replacementTarget = target?.nodeId ? nodesRef.current.find((node) => node.id === target.nodeId) : null;
            if (target?.nodeId && !replacementTarget) {
                resetPicker();
                return;
            }
            if (replacementTarget && !matchesNodeMediaType(replacementTarget.type, file)) {
                message.warning("请选择与当前节点类型一致的媒体文件");
                resetPicker();
                return;
            }

            if (replacementTarget) invalidateGenerationRequest(replacementTarget.id);

            const mediaUploadTaskReset = {
                status: "idle" as const,
                errorDetails: undefined,
                taskId: undefined,
                taskStatus: undefined,
                taskProgress: undefined,
                taskStage: undefined,
                taskCreatedAt: undefined,
                taskStartedAt: undefined,
                taskUpdatedAt: undefined,
                taskDetails: undefined,
                imageTask: undefined,
                videoTask: undefined,
                textTask: undefined,
                audioTask: undefined,
                mediaReplacing: undefined,
            };
            if (replacementTarget?.metadata?.content) {
                setNodes((current) => current.map((node) => (node.id === replacementTarget.id ? { ...node, metadata: { ...node.metadata, mediaReplacing: true, errorDetails: undefined } } : node)));
            }

            try {
                if (target?.nodeId) {
                    if (isAudioFile(file)) {
                        const audio = await uploadMediaFile(file, "audio");
                        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === target.nodeId
                                    ? {
                                          ...node,
                                          type: CanvasNodeType.Audio,
                                          title: file.name,
                                          ...(node.metadata?.locked || node.metadata?.freeResize
                                              ? {}
                                              : {
                                                    position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                                                    width: spec.width,
                                                    height: spec.height,
                                                }),
                                          metadata: { ...node.metadata, ...audioMetadata(audio), ...mediaUploadTaskReset },
                                      }
                                    : node,
                            ),
                        );
                        setSelectedNodeIds(new Set([target.nodeId]));
                        setSelectedConnectionId(null);
                        return;
                    }
                    if (file.type.startsWith("video/")) {
                        const video = await uploadMediaFile(file, "video");
                        const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === target.nodeId
                                    ? {
                                          ...node,
                                          type: CanvasNodeType.Video,
                                          title: file.name,
                                          ...(node.metadata?.locked || node.metadata?.freeResize
                                              ? {}
                                              : {
                                                    position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 },
                                                    width: nextSize.width,
                                                    height: nextSize.height,
                                                }),
                                          metadata: { ...node.metadata, ...videoMetadata(video), ...mediaUploadTaskReset },
                                      }
                                    : node,
                            ),
                        );
                        setSelectedNodeIds(new Set([target.nodeId]));
                        setSelectedConnectionId(null);
                        setDialogNodeId(target.nodeId);
                        return;
                    }
                    const isPanorama = replacementTarget?.type === CanvasNodeType.Panorama;
                    if (isPanorama) {
                        const objectUrl = URL.createObjectURL(file);
                        const dimensions = await readImageMeta(objectUrl);
                        URL.revokeObjectURL(objectUrl);
                        if (!isPanoramaRatio(dimensions.width, dimensions.height)) {
                            message.error("全景图必须接近 2:1 比例，例如 2048x1024");
                            if (replacementTarget) setNodes((current) => current.map((node) => (node.id === replacementTarget.id ? { ...node, metadata: { ...node.metadata, mediaReplacing: undefined } } : node)));
                            return;
                        }
                    }
                    const image = await uploadCanvasImage(file);
                    const imageSize = isPanorama ? NODE_DEFAULT_SIZE[CanvasNodeType.Panorama] : fitNodeSize(image.width, image.height);
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === target.nodeId
                                ? {
                                      ...node,
                                      type: isPanorama ? CanvasNodeType.Panorama : CanvasNodeType.Image,
                                      title: file.name,
                                      ...(node.metadata?.locked || node.metadata?.freeResize
                                          ? {}
                                          : {
                                                position: { x: node.position.x + node.width / 2 - imageSize.width / 2, y: node.position.y + node.height / 2 - imageSize.height / 2 },
                                                width: imageSize.width,
                                                height: imageSize.height,
                                            }),
                                      metadata: {
                                          ...node.metadata,
                                          ...imageMetadata(image),
                                          ...(isPanorama ? { size: PANORAMA_IMAGE_SIZE, panoramaProjection: "equirectangular" as const } : {}),
                                          ...mediaUploadTaskReset,
                                          isBatchRoot: undefined,
                                          batchRootId: undefined,
                                          batchChildIds: undefined,
                                          batchUsesReferenceImages: undefined,
                                      },
                                  }
                                : node,
                        ),
                    );
                    setSelectedNodeIds(new Set([target.nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(target.nodeId);
                } else {
                    const position = target?.position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                    void (isAudioFile(file) ? createAudioFileNode(file, position) : file.type.startsWith("video/") ? createVideoFileNode(file, position) : createImageFileNode(file, position));
                }
            } catch (error) {
                if (replacementTarget) setNodes((current) => current.map((node) => (node.id === replacementTarget.id ? { ...node, metadata: { ...node.metadata, mediaReplacing: undefined } } : node)));
                message.error(error instanceof Error ? error.message : "媒体替换失败");
            } finally {
                resetPicker();
            }
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, message, nodesRef, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            if (!preventFileDragEvent(event)) return;
            const files = droppedFiles(event, (item) => item.type.startsWith("image/") || item.type.startsWith("video/") || isAudioFile(item));
            if (!files.length) return;

            const pos = screenToCanvas(event.clientX, event.clientY);
            files.forEach((file, index) => {
                const nextPos = { x: pos.x + index * CANVAS_DROP_NODE_OFFSET, y: pos.y + index * CANVAS_DROP_NODE_OFFSET };
                void (isAudioFile(file) ? createAudioFileNode(file, nextPos) : file.type.startsWith("video/") ? createVideoFileNode(file, nextPos) : createImageFileNode(file, nextPos));
            });
        },
        [createAudioFileNode, createImageFileNode, createVideoFileNode, screenToCanvas],
    );

    const pasteAssistantImage = useCallback(
        async (file: File) => {
            const position = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const nodeId = await createImageFileNode(file, position, true);
            message.success("图片已添加到本轮引用");
            return nodeId;
        },
        [createImageFileNode, message, screenToCanvas, size.height, size.width],
    );

    const handleAssistantSessionsChange = useCallback((sessions: CanvasAssistantSession[], activeId: string | null) => {
        setChatSessions(sessions);
        setActiveChatId(activeId);
    }, []);

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || "未命名画布");
        setTitleEditing(true);
    }, [currentProject?.title]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);
    return {
        handleUploadRequest,
        handleImageInputChange,
        handleDrop,
        pasteAssistantImage,
        handleAssistantSessionsChange,
        startTitleEditing,
        finishTitleEditing,
        preventCanvasContextMenu,
    };
}

export type CanvasMediaSessionActions = ReturnType<typeof useCanvasMediaSessionActions>;

function mediaInputAcceptForNode(node: CanvasNodeData | null) {
    if (!node) return ALL_MEDIA_INPUT_ACCEPT;
    if (node.type === CanvasNodeType.Video) return "video/*";
    if (node.type === CanvasNodeType.Audio) return "audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";
    return "image/*";
}

function matchesNodeMediaType(type: CanvasNodeType, file: File) {
    if (type === CanvasNodeType.Video) return file.type.startsWith("video/");
    if (type === CanvasNodeType.Audio) return isAudioFile(file);
    return file.type.startsWith("image/");
}
