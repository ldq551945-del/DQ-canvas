"use client";

import dynamic from "next/dynamic";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect } from "react";

import { CanvasNodeType } from "../types";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

import { isHiddenBatchChild } from "./canvas-page-utils";

import type { CanvasPageState } from "./use-canvas-page-state";

import type { CanvasInteractionCore } from "./use-canvas-interaction-core";

export function useCanvasPointerInteractions({ state, core }: { state: CanvasPageState; core: CanvasInteractionCore }) {
    const {
        historyPausedRef,
        rafRef,
        nodeDraggingRef,
        dragRef,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setHoveredNodeId,
        setConnectionTargetNodeId,
        setPendingConnectionCreate,
        setMouseWorld,
        setSelectionBox,
        setContextMenu,
        setToolbarNodeId,
        setDialogNodeId,
        setIsNodeDragging,
        nodesRef,
        selectedNodeIdsRef,
        viewportRef,
        connectingParamsRef,
        connectionTargetNodeIdRef,
        selectionBoxRef,
        pendingConnectionCreateRef,
    } = state;
    const { screenToCanvas, setConnecting, connectNodes, cancelPendingConnectionCreate, getConnectionDropTarget } = core;

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            if (!event.ctrlKey && !event.metaKey) {
                setSelectionBox(null);
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent | ReactPointerEvent, nodeId: string) => {
        event.stopPropagation();
        if ("pointerId" in event && event.currentTarget instanceof Element) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setSelectedConnectionId(null);

        const currentSelected = selectedNodeIdsRef.current;
        const currentNodes = nodesRef.current;
        const nextSelected = new Set(currentSelected);

        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) {
                nextSelected.delete(nodeId);
            } else {
                nextSelected.add(nodeId);
            }
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }

        setSelectedNodeIds(nextSelected);
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (nextSelected.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
        });
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, []);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.length === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes[0]?.id;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            setNodes((prev) =>
                prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    if (!initial) return node;
                    return { ...node, position: { x: initial.x + dx, y: initial.y + dy } };
                }),
            );
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, []);

    const updateDraggedNodes = useCallback((clientX: number, clientY: number, movementThreshold: number) => {
        const dx = (clientX - dragRef.current.startX) / viewportRef.current.k;
        const dy = (clientY - dragRef.current.startY) / viewportRef.current.k;
        const initialPositions = dragRef.current.initialSelectedNodes;
        if (Math.abs(clientX - dragRef.current.startX) > movementThreshold || Math.abs(clientY - dragRef.current.startY) > movementThreshold) dragRef.current.hasMoved = true;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            setNodes((prev) =>
                prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                }),
            );
            rafRef.current = null;
        });
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            if (dragRef.current.isDraggingNode) {
                updateDraggedNodes(event.clientX, event.clientY, 3);
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectionDropTarget, screenToCanvas, updateDraggedNodes],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            if (event.pointerType !== "mouse" && dragRef.current.isDraggingNode) {
                event.preventDefault();
                updateDraggedNodes(event.clientX, event.clientY, 4);
                return;
            }

            if (event.pointerType !== "mouse" && connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                event.preventDefault();
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                return;
            }

            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .forEach((node) => {
                    const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                    if (intersects) nextSelected.add(node.id);
                });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [screenToCanvas, updateDraggedNodes],
    );

    const finishConnectionAt = useCallback(
        (clientX: number, clientY: number) => {
            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (!currentConnection) return;
            const dropTarget = getConnectionDropTarget(clientX, clientY, currentConnection);
            if (dropTarget.nodeId) {
                connectNodes(currentConnection, dropTarget.nodeId);
                setConnecting(null);
            } else if (dropTarget.isNearNode) {
                setConnecting(null);
            } else {
                const position = screenToCanvas(clientX, clientY);
                setMouseWorld(position);
                setPendingConnectionCreate({ connection: currentConnection, position });
            }
        },
        [connectNodes, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);
            finishConnectionAt(event.clientX, event.clientY);
        },
        [finishConnectionAt, finishNodeDrag],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => {
            finishNodeDrag(event.clientX, event.clientY);
            if (event.pointerType !== "mouse") {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                finishConnectionAt(event.clientX, event.clientY);
            }
        };
        const cancelNodeDrag = () => finishNodeDrag();
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishConnectionAt, finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);
    return {
        handleCanvasMouseDown,
        handleNodeMouseDown,
        finishNodeDrag,
        updateDraggedNodes,
        handleGlobalMouseMove,
        handleGlobalPointerMove,
        finishConnectionAt,
        handleGlobalMouseUp,
    };
}

export type CanvasPointerInteractions = ReturnType<typeof useCanvasPointerInteractions>;
