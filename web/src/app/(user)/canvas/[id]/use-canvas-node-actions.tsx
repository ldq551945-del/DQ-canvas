"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";

import { CanvasNodeType, type CanvasNodeData, type Position } from "../types";
import { resizeImageNodeToNaturalRatio } from "../utils/canvas-node-size";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

import { createCanvasNode } from "./canvas-page-elements";
import { getGenerationCount } from "./canvas-page-utils";
import { cloneCanvasDrawingDocument } from "../utils/canvas-drawing-storage";

import type { CanvasPageState } from "./use-canvas-page-state";

import type { CanvasInteractionCore } from "./use-canvas-interaction-core";

export function useCanvasNodeActions({ state, core }: { state: CanvasPageState; core: CanvasInteractionCore }) {
    const {
        message,
        clipboardRef,
        effectiveConfig,
        nodes,
        setNodes,
        connections,
        setConnections,
        size,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setHoveredNodeId,
        setSelectionBox,
        setContextMenu,
        setRunningNodeId,
        setClearConfirmOpen,
        setToolbarNodeId,
        setDialogNodeId,
        setEditingNodeId,
        setInfoNodeId,
        setCropNodeId,
        setAnnotationNodeId,
        setMaskEditNodeId,
        setEmotionNodeId,
        setAngleNodeId,
        setPreviewNodeId,
        setDrawingNodeId,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
    } = state;
    const { getCanvasCenter, cancelPendingConnectionCreate } = core;

    const createNode = useCallback(
        (type: CanvasNodeType, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Drawing) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter],
    );

    const deleteNodes = useCallback((ids: Set<string>) => {
        if (!ids.size) return;
        const allIds = new Set(ids);
        nodesRef.current.forEach((node) => {
            if (ids.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => allIds.add(childId));
        });
        setNodes((prev) => {
            const next = prev.filter((node) => !allIds.has(node.id));
            return next.map((node) => {
                const childIds = node.metadata?.batchChildIds?.filter((childId) => !allIds.has(childId));
                if (!node.metadata?.isBatchRoot || childIds?.length === node.metadata.batchChildIds?.length) return node;
                const primaryImageId = childIds?.includes(node.metadata.primaryImageId || "") ? node.metadata.primaryImageId : childIds?.[0];
                const primaryNode = next.find((item) => item.id === primaryImageId);
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        batchChildIds: childIds,
                        primaryImageId,
                        content: primaryNode?.metadata?.content || node.metadata.content,
                        naturalWidth: primaryNode?.metadata?.naturalWidth || node.metadata.naturalWidth,
                        naturalHeight: primaryNode?.metadata?.naturalHeight || node.metadata.naturalHeight,
                    },
                };
            });
        });
        setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
        setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
        setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
        setEditingNodeId((current) => (current && allIds.has(current) ? null : current));
        setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
        setCropNodeId((current) => (current && allIds.has(current) ? null : current));
        setAnnotationNodeId((current) => (current && allIds.has(current) ? null : current));
        setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
        setEmotionNodeId((current) => (current && allIds.has(current) ? null : current));
        setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
        setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
        setDrawingNodeId((current) => (current && allIds.has(current) ? null : current));
        setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
        setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
    }, []);

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    const groupSelectedNodes = useCallback(() => {
        const ids = selectedNodeIdsRef.current;
        if (ids.size < 2) return;
        const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => {
            const remainingMembers = new Map<string, number>();
            prev.forEach((node) => {
                const previousGroupId = node.metadata?.groupId;
                if (!previousGroupId || ids.has(node.id)) return;
                remainingMembers.set(previousGroupId, (remainingMembers.get(previousGroupId) || 0) + 1);
            });
            const staleGroupIds = new Set(
                Array.from(remainingMembers.entries())
                    .filter(([, count]) => count < 2)
                    .map(([id]) => id),
            );
            return prev.map((node) => {
                if (ids.has(node.id)) return { ...node, metadata: { ...node.metadata, groupId } };
                if (!node.metadata?.groupId || !staleGroupIds.has(node.metadata.groupId)) return node;
                const { groupId: _groupId, ...metadata } = node.metadata;
                return { ...node, metadata };
            });
        });
        message.success("已编组");
    }, [message, setNodes]);

    const ungroupSelectedNodes = useCallback(() => {
        const groupIds = new Set(
            nodesRef.current
                .filter((node) => selectedNodeIdsRef.current.has(node.id))
                .map((node) => node.metadata?.groupId)
                .filter((groupId): groupId is string => Boolean(groupId)),
        );
        if (!groupIds.size) return;
        setNodes((prev) =>
            prev.map((node) => {
                if (!node.metadata?.groupId || !groupIds.has(node.metadata.groupId)) return node;
                const { groupId: _groupId, ...metadata } = node.metadata;
                return { ...node, metadata };
            }),
        );
        message.success("已解除编组");
    }, [message, setNodes]);

    const toggleNodeLocked = useCallback(
        (nodeId: string) => {
            const target = nodesRef.current.find((node) => node.id === nodeId);
            if (!target) return;
            const locked = !target.metadata?.locked;
            setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, locked } } : node)));
            message.success(locked ? "节点已锁定位置和尺寸" : "节点已解锁");
        },
        [message, setNodes],
    );

    const handleImageDimensions = useCallback((nodeId: string, naturalWidth: number, naturalHeight: number) => {
        setNodes((prev) => {
            let changed = false;
            const next = prev.map((node) => {
                if (node.id !== nodeId || node.type !== CanvasNodeType.Image) return node;
                const resized = resizeImageNodeToNaturalRatio(node, naturalWidth, naturalHeight);
                if (resized !== node) changed = true;
                return resized;
            });
            return changed ? next : prev;
        });
    }, []);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setAnnotationNodeId(null);
        setMaskEditNodeId(null);
        setEmotionNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setDrawingNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
    }, [deselectCanvas]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;

        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next: CanvasNodeData = {
            ...source,
            id,
            title: `${source.title} Copy`,
            position: { x: source.position.x + 36, y: source.position.y + 36 },
            metadata: cloneNodeMetadata(source.metadata),
        };
        if (next.type === CanvasNodeType.Drawing && next.metadata) next.metadata.drawingId = `${id}-document`;

        setNodes((prev) => [...prev, next]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(next.type === CanvasNodeType.Drawing ? null : id);
    }, []);

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: cloneNodeMetadata(node.metadata),
            }));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
    }, []);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const pasteTimestamp = Date.now();
        const idMap = new Map(clipboard.nodes.map((node, index) => [node.id, `${node.type}-${pasteTimestamp}-${index}-${Math.random().toString(36).slice(2, 7)}`]));
        const nextNodes = clipboard.nodes.map((node) => {
            const id = idMap.get(node.id)!;
            const metadata = cloneNodeMetadata(node.metadata);
            if (metadata?.emotionEdit) metadata.emotionEdit = { ...metadata.emotionEdit, sourceNodeId: idMap.get(metadata.emotionEdit.sourceNodeId) || metadata.emotionEdit.sourceNodeId };
            if (metadata?.sourceNodeId) metadata.sourceNodeId = idMap.get(metadata.sourceNodeId) || metadata.sourceNodeId;
            if (metadata?.batchRootId) metadata.batchRootId = idMap.get(metadata.batchRootId) || metadata.batchRootId;
            if (metadata?.batchChildIds) metadata.batchChildIds = metadata.batchChildIds.map((childId) => idMap.get(childId) || childId);
            if (metadata?.primaryImageId) metadata.primaryImageId = idMap.get(metadata.primaryImageId) || metadata.primaryImageId;
            if (node.type === CanvasNodeType.Drawing && metadata) metadata.drawingId = `${id}-document`;
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
                metadata,
            };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...nextNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(nextNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(nextNodes[0] && nextNodes[0].type !== CanvasNodeType.Drawing ? nextNodes[0].id : null);
        return true;
    }, [getCanvasCenter]);
    return {
        createNode,
        deleteNodes,
        deleteConnection,
        groupSelectedNodes,
        ungroupSelectedNodes,
        toggleNodeLocked,
        handleImageDimensions,
        deselectCanvas,
        clearCanvas,
        duplicateNode,
        copySelectedNodes,
        pasteCopiedNodes,
    };
}

function cloneNodeMetadata(metadata: CanvasNodeData["metadata"]) {
    if (!metadata) return undefined;
    return {
        ...metadata,
        drawingDocument: cloneCanvasDrawingDocument(metadata.drawingDocument),
        drawingPreview: metadata.drawingPreview ? { ...metadata.drawingPreview } : undefined,
    };
}

export type CanvasNodeActions = ReturnType<typeof useCanvasNodeActions>;
