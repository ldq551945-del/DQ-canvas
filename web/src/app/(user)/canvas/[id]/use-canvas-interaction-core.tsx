"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo } from "react";

import { nanoid } from "nanoid";
import { buildNodeGenerationInputs, type NodeGenerationInput } from "../components/canvas-node-generation";
import { getNodeSpec } from "../constants";
import { CanvasNodeType, type CanvasConnection, type ConnectionHandle, type Position } from "../types";
import { useCanvasLocalAgentBridge } from "../use-canvas-local-agent-bridge";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "../utils/canvas-agent-ops";
import { buildCanvasResourceReferences, buildNodeMentionReferences } from "../utils/canvas-resource-references";
import { shouldReduceCanvasEffects } from "../utils/canvas-performance-mode";
import { clampAnchorRatio, nodeAnchorRatioAtY, splitCanvasConnectionAtNode } from "../utils/canvas-connection-path";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

import { CONNECTION_HANDLE_HIT_RADIUS, CONNECTION_NODE_HIT_PADDING, ConnectionDropTarget, PendingConnectionCreate, type CanvasCreatableNodeType, createCanvasNode, drawingSourceNodeForConnection } from "./canvas-page-elements";
import { beginCanvasDrawingCreate, currentCanvasDrawingCreateSource, finishCanvasDrawingCreate } from "./canvas-drawing-connection-guard";
import { getConnectionTargetAnchor, getGenerationCount, isHiddenBatchChild, normalizeConnection } from "./canvas-page-utils";

import type { CanvasPageState } from "./use-canvas-page-state";

export function useCanvasInteractionCore({ state }: { state: CanvasPageState }) {
    const {
        message,
        projectId,
        containerRef,
        toolbarHideTimerRef,
        nodeDraggingRef,
        effectiveConfig,
        currentProject,
        nodes,
        setNodes,
        connections,
        setConnections,
        viewport,
        setViewport,
        performanceMode,
        lowPerformanceDevice,
        size,
        selectedNodeIds,
        setSelectedNodeIds,
        setSelectedConnectionId,
        hoveredNodeId,
        setConnectingParams,
        setConnectionTargetNodeId,
        setPendingConnectionCreate,
        setContextMenu,
        toolbarNodeId,
        setToolbarNodeId,
        nodeImageSettingsOpen,
        dialogNodeId,
        setDialogNodeId,
        infoNodeId,
        cropNodeId,
        maskEditNodeId,
        splitNodeId,
        upscaleNodeId,
        angleNodeId,
        previewNodeId,
        collapsingBatchIds,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        connectingParamsRef,
        connectionTargetNodeIdRef,
        projectIdRef,
        drawingCreateRequestsRef,
    } = state;

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen) return;
            if (toolbarHideTimerRef.current) {
                clearTimeout(toolbarHideTimerRef.current);
                toolbarHideTimerRef.current = null;
            }
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {
        if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
        toolbarHideTimerRef.current = setTimeout(() => {
            setToolbarNodeId(null);
            toolbarHideTimerRef.current = null;
        }, 120);
    }, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string, targetHandleId?: string, targetAnchorRatio = 0.5) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            const { fromNodeId, toNodeId } = connection;
            const fromHandleId = fromNodeId === current.nodeId ? current.handleId : targetHandleId;
            const toHandleId = toNodeId === current.nodeId ? current.handleId : targetHandleId;
            const fromAnchorRatio = clampAnchorRatio(fromNodeId === current.nodeId ? current.anchorRatio : targetAnchorRatio);
            const toAnchorRatio = clampAnchorRatio(toNodeId === current.nodeId ? current.anchorRatio : targetAnchorRatio);
            const exists = connectionsRef.current.find((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId && conn.fromHandleId === fromHandleId && conn.toHandleId === toHandleId);
            if (exists) {
                // Redrawing the same logical edge updates its attachment points
                // instead of accumulating duplicate edges.
                setConnections((prev) => prev.map((item) => (item.id === exists.id ? { ...item, fromAnchorRatio, toAnchorRatio } : item)));
            } else {
                setConnections((prev) => [
                    ...prev,
                    {
                        id: `conn-${Date.now()}`,
                        fromNodeId,
                        toNodeId,
                        ...(fromHandleId ? { fromHandleId } : {}),
                        ...(toHandleId ? { toHandleId } : {}),
                        fromAnchorRatio,
                        toAnchorRatio,
                    },
                ]);
            }
            setContextMenu(null);
        },
        [message],
    );

    const createConnectedNode = useCallback(
        async (type: CanvasCreatableNodeType, pending: PendingConnectionCreate) => {
            const splitConnection = pending.splitConnectionId ? connectionsRef.current.find((item) => item.id === pending.splitConnectionId) : undefined;
            if (pending.splitConnectionId && !splitConnection) {
                message.warning("原连线已变更，请重新拖动加号插入节点");
                return;
            }
            const splitFrom = splitConnection ? nodesRef.current.find((node) => node.id === splitConnection.fromNodeId) : undefined;
            const splitTo = splitConnection ? nodesRef.current.find((node) => node.id === splitConnection.toNodeId) : undefined;
            if (splitConnection && (!splitFrom || !splitTo)) {
                message.warning("原连线的节点已不存在");
                return;
            }
            if (splitConnection && type === CanvasNodeType.Config && (!pending.allowConfig || splitFrom?.type === CanvasNodeType.Config || splitTo?.type === CanvasNodeType.Config)) {
                message.warning("配置节点不能插入到包含配置节点的连线中");
                return;
            }
            const metadata = type === CanvasNodeType.Config ? { model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count) } : undefined;
            const quickSource = pending.quick ? nodesRef.current.find((node) => node.id === pending.connection.nodeId) : undefined;
            const spec = getNodeSpec(type);
            const newNodePosition = quickSource
                ? {
                      x: pending.connection.handleType === "source" ? quickSource.position.x + quickSource.width + 96 + spec.width / 2 : quickSource.position.x - 96 - spec.width / 2,
                      y: quickSource.position.y + quickSource.height * clampAnchorRatio(pending.connection.anchorRatio),
                  }
                : pending.position;
            const newNode = createCanvasNode(type, newNodePosition, metadata);
            let connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            if (type === CanvasNodeType.Drawing) {
                const sourceNode = drawingSourceNodeForConnection(pending, nodesRef.current);
                if (!sourceNode) {
                    message.error("只有已有图片内容的输出连线可以创建绘图");
                    return;
                }
                const ticket = beginCanvasDrawingCreate(drawingCreateRequestsRef.current, projectId, sourceNode);
                if (!ticket) return;
                setPendingConnectionCreate(null);
                setConnecting(null);
                try {
                    const { createCanvasDrawingFromImage } = await import("./canvas-drawing-from-image");
                    const initialized = await createCanvasDrawingFromImage(sourceNode);
                    const currentSource = currentCanvasDrawingCreateSource(drawingCreateRequestsRef.current, ticket, projectIdRef.current, nodesRef.current);
                    if (!currentSource) return;
                    connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
                    if (!connection) return;
                    newNode.title = `${currentSource.title || "图片"} · 绘图`;
                    newNode.metadata = {
                        ...newNode.metadata,
                        drawingDocument: initialized.document,
                        drawingPreview: initialized.preview,
                    };
                } catch (error) {
                    if (projectIdRef.current === ticket.projectId && drawingCreateRequestsRef.current.get(ticket.key) === ticket.token) {
                        message.error(error instanceof Error ? `创建绘图失败：${error.message}` : "创建绘图失败");
                    }
                    return;
                } finally {
                    finishCanvasDrawingCreate(drawingCreateRequestsRef.current, ticket);
                }
            }
            setNodes((prev) => [...prev, newNode]);
            const currentAnchorRatio = clampAnchorRatio(pending.connection.anchorRatio);
            setConnections((prev) => {
                if (splitConnection) {
                    const current = prev.find((item) => item.id === splitConnection.id);
                    if (!current) return prev;
                    const split = splitCanvasConnectionAtNode(current, newNode.id);
                    return [...prev.filter((item) => item.id !== current.id), { id: nanoid(), ...split.first }, { id: nanoid(), ...split.second }];
                }
                return [
                    ...prev,
                    {
                        id: nanoid(),
                        ...connection,
                        ...(connection.fromNodeId === pending.connection.nodeId && pending.connection.handleId ? { fromHandleId: pending.connection.handleId } : {}),
                        ...(connection.toNodeId === pending.connection.nodeId && pending.connection.handleId ? { toHandleId: pending.connection.handleId } : {}),
                        fromAnchorRatio: connection.fromNodeId === pending.connection.nodeId ? currentAnchorRatio : 0.5,
                        toAnchorRatio: connection.toNodeId === pending.connection.nodeId ? currentAnchorRatio : 0.5,
                    },
                ];
            });
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Drawing) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, projectId, setConnecting],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestHandleId: string | undefined;
            let bestAnchorRatio = 0.5;
            let bestPriority = Number.POSITIVE_INFINITY;

            [...nodesRef.current]
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .reverse()
                .forEach((node) => {
                    // Nodes can expose named ports through data attributes. The
                    // default side port remains unnamed for backwards compatibility.
                    const targetHandleId = current.handleId ? (current.handleType === "source" ? "target" : "source") : undefined;
                    const anchor = getConnectionTargetAnchor(node, current, targetHandleId);
                    const dx = world.x - anchor.x;
                    const dy = world.y - anchor.y;
                    const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                    const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

                    if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                    isNearNode = true;
                    if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) return;

                    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                    if (priority < bestPriority) {
                        bestNodeId = node.id;
                        bestHandleId = node.id === current.nodeId ? undefined : targetHandleId;
                        bestAnchorRatio = nodeAnchorRatioAtY(node, world.y);
                        bestPriority = priority;
                    }
                });

            return { nodeId: bestNodeId, handleId: bestHandleId, isNearNode, anchorRatio: bestNodeId ? bestAnchorRatio : undefined };
        },
        [screenToCanvas],
    );

    const visibleNodes = useMemo(() => {
        const padding = shouldReduceCanvasEffects(performanceMode, nodes, lowPerformanceDevice) ? 96 : 280;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || size.width;
        const height = rect?.height || size.height;
        const viewLeft = -viewport.x / viewport.k - padding;
        const viewTop = -viewport.y / viewport.k - padding;
        const viewRight = viewLeft + width / viewport.k + padding * 2;
        const viewBottom = viewTop + height / viewport.k + padding * 2;

        return nodes.filter((node) => !isHiddenBatchChild(node, nodes, collapsingBatchIds) && node.position.x + node.width > viewLeft && node.position.x < viewRight && node.position.y + node.height > viewTop && node.position.y < viewBottom);
    }, [collapsingBatchIds, lowPerformanceDevice, nodes, performanceMode, size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const toolbarNode = toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const batchChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            if (node.metadata?.isBatchRoot) map.set(node.id, node.metadata.batchChildIds?.length || 0);
        });
        return map;
    }, [nodes]);
    const batchMotionById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; index: number }>();
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            const index = root?.metadata?.batchChildIds?.indexOf(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            map.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        });
        return map;
    }, [nodeById, nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        nodeIds.add(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            nodeIds.add(connection.fromNodeId);
            nodeIds.add(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections]);

    const configInputsById = useMemo(() => {
        const map = new Map<string, NodeGenerationInput[]>();
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Config) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections));
        });
        return map;
    }, [connections, nodes]);
    const resourceContextNodeId = dialogNodeId || activeNodeId;
    const canvasResourceReferences = useMemo(() => buildCanvasResourceReferences(nodes, connections, resourceContextNodeId), [connections, nodes, resourceContextNodeId]);
    const resourceReferenceByNodeId = useMemo(() => new Map(canvasResourceReferences.map((reference) => [reference.nodeId, reference])), [canvasResourceReferences]);
    const mentionReferencesByNodeId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        return map;
    }, [connections, nodes]);
    const agentSnapshot = useMemo<CanvasAgentSnapshot>(
        () => ({ projectId, title: currentProject?.title || "未命名画布", imageSize: effectiveConfig.size, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }),
        [connections, currentProject?.title, effectiveConfig.size, nodes, projectId, selectedNodeIds, viewport],
    );
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = {
                projectId,
                title: currentProject?.title || "未命名画布",
                imageSize: effectiveConfig.size,
                nodes: nodesRef.current,
                connections: connectionsRef.current,
                selectedNodeIds: Array.from(selectedNodeIdsRef.current),
                viewport: viewportRef.current,
            };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return { ...next, projectId, title: currentProject?.title || "未命名画布" };
        },
        [currentProject?.title, effectiveConfig.size, projectId],
    );
    useCanvasLocalAgentBridge({ snapshot: agentSnapshot, onApplyOps: applyAgentOps });
    return {
        screenToCanvas,
        getCanvasCenter,
        setConnecting,
        keepNodeToolbar,
        hideNodeToolbar,
        connectNodes,
        createConnectedNode,
        cancelPendingConnectionCreate,
        getConnectionDropTarget,
        visibleNodes,
        nodeById,
        toolbarNode,
        infoNode,
        cropNode,
        maskEditNode,
        splitNode,
        upscaleNode,
        angleNode,
        previewNode,
        hasMultipleSelectedNodes,
        activeNodeId,
        batchChildCountById,
        batchMotionById,
        relatedHighlight,
        configInputsById,
        resourceContextNodeId,
        canvasResourceReferences,
        resourceReferenceByNodeId,
        mentionReferencesByNodeId,
        agentSnapshot,
        applyAgentOps,
    };
}

export type CanvasInteractionCore = ReturnType<typeof useCanvasInteractionCore>;
