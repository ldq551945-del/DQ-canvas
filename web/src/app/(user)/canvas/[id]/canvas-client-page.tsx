"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Button, Modal } from "antd";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { CanvasConfigComposer } from "../components/canvas-config-composer";
import { CanvasConfigNodePanel } from "../components/canvas-config-node-panel";
import { CanvasActiveTaskPanel } from "../components/canvas-active-task-panel";
import { ActiveConnectionPath, ConnectionPath } from "../components/canvas-connections";
import { CanvasNodeContextMenu } from "../components/canvas-context-menu";
import { Minimap } from "../components/canvas-mini-map";
import { CanvasNode } from "../components/canvas-node";
import { CanvasNodeAngleDialog } from "../components/canvas-node-angle-dialog";
import { CanvasNodeCropDialog } from "../components/canvas-node-crop-dialog";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "../components/canvas-node-hover-toolbar";
import { CanvasNodeMaskEditDialog } from "../components/canvas-node-mask-edit-dialog";
import { CanvasNodePromptPanel } from "../components/canvas-node-prompt-panel";
import { CanvasNodeSplitDialog } from "../components/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog } from "../components/canvas-node-upscale-dialog";
import { CanvasToolbar } from "../components/canvas-toolbar";
import { CanvasTopBar } from "../components/canvas-top-bar";
import { CanvasZoomControls } from "../components/canvas-zoom-controls";
import { DQCanvas } from "../components/dq-canvas";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "../types";
import { findBackgroundRefineOriginalNode } from "../utils/canvas-background-refine";
import { nodeAnchorY } from "../utils/canvas-connection-path";
import { shouldReduceCanvasEffects } from "../utils/canvas-performance-mode";
import { canvasActiveTaskForNode, canvasBackgroundRemovalTaskNeedsSync, canvasTaskDescriptorForNode, clearHandledCanvasBackgroundRemovalTaskMetadata } from "../utils/canvas-active-task-binding";
import { useCanvasActiveTasks } from "../components/use-canvas-active-tasks";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });
const CanvasDrawingEditorModal = dynamic(() => import("../components/canvas-drawing-editor-modal").then((mod) => mod.CanvasDrawingEditorModal), { ssr: false, loading: () => null });
const CanvasNodeBackgroundRefineDialog = dynamic(() => import("../components/canvas-node-background-refine-dialog").then((mod) => mod.CanvasNodeBackgroundRefineDialog), { ssr: false, loading: () => null });
const CanvasNodeAnnotationDialog = dynamic(() => import("../components/canvas-node-annotation-dialog").then((mod) => mod.CanvasNodeAnnotationDialog), { ssr: false, loading: () => null });
const CanvasEmotionWorkspace = dynamic(() => import("../components/canvas-emotion-workspace").then((mod) => mod.CanvasEmotionWorkspace), { ssr: false, loading: () => null });

import { CanvasRefreshShell, ConnectionCreateMenu, NodeCreateMenu, drawingSourceNodeForConnection } from "./canvas-page-elements";
import { getInputSummary, isHiddenBatchConnectionEndpoint } from "./canvas-page-utils";

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <DQCanvasPage />;
}

import { useCanvasPageController } from "./use-canvas-page-controller";

function DQCanvasPage() {
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const controller = useCanvasPageController();
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
        annotationNodeId,
        setAnnotationNodeId,
        maskEditNodeId,
        setMaskEditNodeId,
        emotionNodeId,
        setEmotionNodeId,
        backgroundRefineNodeId,
        setBackgroundRefineNodeId,
        splitNodeId,
        setSplitNodeId,
        upscaleNodeId,
        setUpscaleNodeId,
        angleNodeId,
        setAngleNodeId,
        previewNodeId,
        setPreviewNodeId,
        drawingNodeId,
        setDrawingNodeId,
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
        performanceMode,
        setPerformanceMode,
        canvasTool,
        setCanvasTool,
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
        createHistoryEntry,
        startGenerationRequest,
        finishGenerationRequest,
        stopGenerationByRunningId,
        confirmStopGeneration,
        completeVideoTask,
        completeImageTask,
        startAndCompleteImageTask,
        completeTextTask,
        completeAudioTask,
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
        createNode,
        deleteNodes,
        groupSelectedNodes,
        ungroupSelectedNodes,
        deleteConnection,
        deselectCanvas,
        clearCanvas,
        duplicateNode,
        copySelectedNodes,
        pasteCopiedNodes,
        toggleNodeLocked,
        resetViewport,
        locateCanvasNode,
        setZoomScale,
        applyHistory,
        undoCanvas,
        redoCanvas,
        createAndOpenProject,
        deleteCurrentProject,
        handleCanvasMouseDown,
        handleNodeMouseDown,
        finishNodeDrag,
        updateDraggedNodes,
        handleGlobalMouseMove,
        handleGlobalPointerMove,
        finishConnectionAt,
        handleGlobalMouseUp,
        createImageFileNode,
        createVideoFileNode,
        createAudioFileNode,
        createTextNodeFromClipboard,
        pasteSystemClipboard,
        handleConnectStart,
        handleNodeResize,
        handleImageDimensions,
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
        handleUploadRequest,
        handleImageInputChange,
        handleDrop,
        pasteAssistantImage,
        handleAssistantSessionsChange,
        startTitleEditing,
        finishTitleEditing,
        preventCanvasContextMenu,
        handleGenerateNode,
        handleRetryNode,
        generateImageFromTextNode,
        insertAssistantImage,
        insertAssistantText,
        handleAssetInsert,
        assistantOpen,
        openAgent,
        closeAgent,
    } = controller;
    const { tasks: activeGenerationTasks, recoveryTasks } = useCanvasActiveTasks(projectId, projectLoaded);
    useEffect(() => {
        if (!projectLoaded) return;
        setNodes((current) => {
            let changed = false;
            const next = current.map((node) => {
                const cleanedNode = clearHandledCanvasBackgroundRemovalTaskMetadata(node);
                if (cleanedNode !== node) changed = true;
                const task = canvasActiveTaskForNode(recoveryTasks, cleanedNode);
                if (!task) return cleanedNode;
                const taskStatus: NonNullable<CanvasNodeMetadata["taskStatus"]> = task.status === "queued" ? "pending" : task.status === "succeeded" ? "success" : task.status === "failed" ? "error" : task.status;
                const needsTaskDescriptor =
                    canvasBackgroundRemovalTaskNeedsSync(task, cleanedNode) ||
                    (task.type !== "image_process" && cleanedNode.metadata?.status === "loading" && !cleanedNode.metadata?.imageTask && !cleanedNode.metadata?.videoTask && !cleanedNode.metadata?.textTask && !cleanedNode.metadata?.audioTask);
                const descriptor = needsTaskDescriptor ? canvasTaskDescriptorForNode(task, cleanedNode) : {};
                const metadata = { ...cleanedNode.metadata, taskId: task.id, taskStatus, taskProgress: task.progress, taskStage: task.stage, taskUpdatedAt: task.updatedAt, ...descriptor };
                if (
                    metadata.taskProgress === cleanedNode.metadata?.taskProgress &&
                    metadata.taskStage === cleanedNode.metadata?.taskStage &&
                    metadata.taskId === cleanedNode.metadata?.taskId &&
                    metadata.taskStatus === cleanedNode.metadata?.taskStatus &&
                    metadata.taskUpdatedAt === cleanedNode.metadata?.taskUpdatedAt &&
                    metadata.backgroundRemovalTask === cleanedNode.metadata?.backgroundRemovalTask
                )
                    return cleanedNode;
                changed = true;
                return { ...cleanedNode, metadata };
            });
            return changed ? next : current;
        });
    }, [projectLoaded, recoveryTasks, setNodes]);
    if (!projectLoaded) return <CanvasRefreshShell />;
    const drawingNode = drawingNodeId ? nodes.find((node) => node.id === drawingNodeId) || null : null;
    const annotationNode = annotationNodeId ? nodes.find((node) => node.id === annotationNodeId) || null : null;
    const emotionNode = emotionNodeId ? nodes.find((node) => node.id === emotionNodeId) || null : null;
    const backgroundRefineNode = backgroundRefineNodeId ? nodes.find((node) => node.id === backgroundRefineNodeId) || null : null;
    const backgroundRefineOriginalNode = findBackgroundRefineOriginalNode(nodes, backgroundRefineNode);
    const canUngroup = nodes.some((node) => selectedNodeIds.has(node.id) && Boolean(node.metadata?.groupId));
    const performanceReduced = shouldReduceCanvasEffects(performanceMode, nodes);
    const connectionSource = connectingParams ? nodeById.get(connectingParams.nodeId) : undefined;
    const connectionOrigin = connectionSource && connectingParams ? { x: connectionSource.position.x + (connectingParams.handleType === "source" ? connectionSource.width : 0), y: nodeAnchorY(connectionSource, connectingParams.anchorRatio) } : undefined;
    const connectionSourceFeedbackVisible = !connectionOrigin || Math.hypot((mouseWorld.x - connectionOrigin.x) * viewport.k, (mouseWorld.y - connectionOrigin.y) * viewport.k) <= 44;
    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.backdrop, color: theme.node.text }}>
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProject?.title || "未命名画布"}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onWorkbench={() => router.push("/create")}
                    onProjects={() => router.push("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    performanceMode={performanceMode}
                    performanceReduced={performanceReduced}
                    onPerformanceModeChange={setPerformanceMode}
                    agentOpen={assistantOpen}
                    onToggleAgent={() => (assistantOpen ? closeAgent() : openAgent())}
                />

                <CanvasActiveTaskPanel tasks={activeGenerationTasks} />

                <DQCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    backgroundMode={backgroundMode}
                    performanceMode={performanceMode}
                    canvasTool={canvasTool}
                    nodes={nodes}
                    onViewportChange={(next) => {
                        setViewport(next);
                        setContextMenu(null);
                        setNodeCreatePosition(null);
                    }}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDeselect={() => {
                        setNodeCreatePosition(null);
                        deselectCanvas();
                    }}
                    onCanvasDoubleClick={(event) => {
                        setContextMenu(null);
                        setNodeCreatePosition(screenToCanvas(event.clientX, event.clientY));
                    }}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <CanvasGroupOutlines nodes={nodes} selectedNodeIds={selectedNodeIds} selectedConnectionId={selectedConnectionId} stroke={theme.node.stroke} activeStroke={theme.node.activeStroke} activeFill={theme.canvas.selectionFill} />
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        {connections
                            .filter((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                return Boolean(from && to && !isHiddenBatchConnectionEndpoint(from, nodes) && !isHiddenBatchConnectionEndpoint(to, nodes));
                            })
                            .map((connection) => {
                                const from = nodeById.get(connection.fromNodeId);
                                const to = nodeById.get(connection.toNodeId);
                                if (!from || !to) return null;

                                return (
                                    <ConnectionPath
                                        key={connection.id}
                                        connection={connection}
                                        from={from}
                                        to={to}
                                        active={selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id)}
                                        onSelect={() => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu(null);
                                        }}
                                        onContextMenu={(event) => {
                                            setSelectedConnectionId(connection.id);
                                            setSelectedNodeIds(new Set());
                                            setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: connection.id });
                                        }}
                                    />
                                );
                            })}
                        {connectingParams ? <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined} /> : null}
                    </svg>

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnectionSource={connectingParams?.nodeId === node.id}
                            connectionSourceFeedbackVisible={connectionSourceFeedbackVisible}
                            connectingHandleType={connectingParams?.handleType}
                            isConnecting={Boolean(connectingParams)}
                            isNodeDragging={isNodeDragging}
                            isMultiSelecting={selectedNodeIds.size > 1}
                            reduceMediaPreview={performanceReduced}
                            editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                            showPanel={dialogNodeId === node.id && !selectionBox}
                            batchCount={batchChildCountById.get(node.id) || 0}
                            batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                            batchClosing={Boolean(node.metadata?.batchRootId && collapsingBatchIds.has(node.metadata.batchRootId))}
                            batchOpening={openingBatchIds.has(node.id)}
                            batchRecovering={collapsingBatchIds.has(node.id)}
                            batchMotion={batchMotionById.get(node.id)}
                            showImageInfo={showImageInfo}
                            resourceLabel={resourceReferenceByNodeId.get(node.id)}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || []}
                            renderPanel={(panelNode) =>
                                panelNode.type === CanvasNodeType.Config ? (
                                    <CanvasConfigComposer
                                        value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                                        inputs={configInputsById.get(panelNode.id) || []}
                                        onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                                        onClose={() => setDialogNodeId(null)}
                                    />
                                ) : (
                                    <CanvasNodePromptPanel
                                        node={panelNode}
                                        isRunning={runningNodeId === panelNode.id}
                                        mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || []}
                                        onPromptChange={handleNodePromptChange}
                                        onConfigChange={handleConfigNodeChange}
                                        onGenerate={handleGenerateNode}
                                        onStop={confirmStopGeneration}
                                        onImageSettingsOpenChange={(open) => {
                                            setNodeImageSettingsOpen(open);
                                            if (open) setToolbarNodeId(null);
                                        }}
                                    />
                                )
                            }
                            renderNodeContent={(contentNode) => (
                                <CanvasConfigNodePanel
                                    node={contentNode}
                                    isRunning={runningNodeId === contentNode.id}
                                    inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                                    onConfigChange={handleConfigNodeChange}
                                    onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                                    onStop={confirmStopGeneration}
                                    onGenerate={(nodeId) => {
                                        const target = nodesRef.current.find((item) => item.id === nodeId);
                                        void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                                    }}
                                />
                            )}
                            onMouseDown={handleNodeMouseDown}
                            onHoverStart={(nodeId) => {
                                if (nodeDraggingRef.current) return;
                                setHoveredNodeId(nodeId);
                                keepNodeToolbar(nodeId);
                            }}
                            onHoverEnd={(nodeId) => {
                                setHoveredNodeId((current) => (current === nodeId ? null : current));
                                hideNodeToolbar();
                            }}
                            onConnectStart={handleConnectStart}
                            onResize={handleNodeResize}
                            onImageDimensions={handleImageDimensions}
                            onEditDrawing={(node) => setDrawingNodeId(node.id)}
                            onContentChange={handleNodeContentChange}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onRetry={(node) => void handleRetryNode(node)}
                            onGenerateImage={generateImageFromTextNode}
                            onViewImage={(node) => setPreviewNodeId(node.id)}
                            onReplaceMedia={(node) => handleUploadRequest(node.id)}
                            onKeyboardSelect={(nodeId, additive) => {
                                setSelectedNodeIds((current) => {
                                    const next = additive ? new Set(current) : new Set<string>();
                                    if (additive && next.has(nodeId)) next.delete(nodeId);
                                    else next.add(nodeId);
                                    return next;
                                });
                                setSelectedConnectionId(null);
                            }}
                            onContextMenu={(event, id) => {
                                event.preventDefault();
                                event.stopPropagation();
                                dragRef.current.hasMoved = true;
                                dragRef.current.isDraggingNode = false;
                                nodeDraggingRef.current = false;
                                setIsNodeDragging(false);
                                setDialogNodeId(null);
                                setEditingNodeId(null);
                                setToolbarNodeId(null);
                                setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id });
                            }}
                        />
                    ))}

                    {selectionBox ? (
                        <div
                            className="pointer-events-none absolute z-[100] border"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                                borderColor: theme.canvas.selectionStroke,
                                background: theme.canvas.selectionFill,
                            }}
                        />
                    ) : null}
                    {pendingConnectionCreate ? (
                        <ConnectionCreateMenu
                            pending={pendingConnectionCreate}
                            allowDrawing={Boolean(drawingSourceNodeForConnection(pendingConnectionCreate, nodes))}
                            viewport={viewport}
                            viewportSize={size}
                            onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)}
                            onClose={cancelPendingConnectionCreate}
                        />
                    ) : null}
                    {nodeCreatePosition ? (
                        <NodeCreateMenu
                            position={nodeCreatePosition}
                            onCreate={(type) => {
                                createNode(type, nodeCreatePosition);
                                setNodeCreatePosition(null);
                            }}
                            onClose={() => setNodeCreatePosition(null)}
                        />
                    ) : null}
                </DQCanvas>

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen ? null : toolbarNode}
                    viewport={viewport}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onEditText={openTextEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onAnnotate={(node) => setAnnotationNodeId(node.id)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onEmotion={(node) => setEmotionNodeId(node.id)}
                    onPortraitTexture={(node) => void generatePortraitTextureNode(node)}
                    onRemoveBackground={(node, options) => void removeBackgroundImageNode(node, options)}
                    onCancelBackgroundRemoval={(node) => void cancelBackgroundRemovalImageNode(node)}
                    onRefineBackground={(node) => setBackgroundRefineNodeId(node.id)}
                    backgroundRemovalNodeIds={backgroundRemovalNodeIds}
                    backgroundRemovalStoppingNodeIds={backgroundRemovalStoppingNodeIds}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setUpscaleNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onToggleLocked={(node) => toggleNodeLocked(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    agentOpen={assistantOpen}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddPanorama={() => createNode(CanvasNodeType.Panorama)}
                    onAddDrawing={() => createNode(CanvasNodeType.Drawing)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onGroup={groupSelectedNodes}
                    canUngroup={canUngroup}
                    onUngroup={ungroupSelectedNodes}
                    onClear={() => setClearConfirmOpen(true)}
                    onDeselect={deselectCanvas}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                    canvasTool={canvasTool}
                    onCanvasToolChange={setCanvasTool}
                    onOpenMyAssets={() => {
                        setAssetPickerOpen(true);
                    }}
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        onClose={() => setContextMenu(null)}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                const selectedIds = selectedNodeIdsRef.current;
                                deleteNodes(selectedIds.has(contextMenu.nodeId) ? new Set(selectedIds) : new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                {annotationNode?.metadata?.content ? (
                    <CanvasNodeAnnotationDialog
                        image={{ url: annotationNode.metadata.content, storageKey: annotationNode.metadata.storageKey }}
                        open={Boolean(annotationNode)}
                        onClose={() => setAnnotationNodeId(null)}
                        onConfirm={(dataUrl) => saveAnnotatedImageNode(annotationNode, dataUrl)}
                    />
                ) : null}

                {emotionNode?.metadata?.content ? (
                    <CanvasEmotionWorkspace node={emotionNode} viewport={viewport} containerRef={containerRef} onClose={() => setEmotionNodeId(null)} onConfirm={(payload) => generateEmotionNode(emotionNode, payload)} />
                ) : null}

                {maskEditNode?.metadata?.content ? (
                    <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} />
                ) : null}

                {backgroundRefineNode?.metadata?.content ? (
                    <CanvasNodeBackgroundRefineDialog
                        dataUrl={backgroundRefineNode.metadata.content}
                        bytes={backgroundRefineNode.metadata.bytes}
                        originalDataUrl={backgroundRefineOriginalNode?.metadata?.content}
                        originalBytes={backgroundRefineOriginalNode?.metadata?.bytes}
                        originalWidth={backgroundRefineOriginalNode?.metadata?.naturalWidth}
                        originalHeight={backgroundRefineOriginalNode?.metadata?.naturalHeight}
                        open={Boolean(backgroundRefineNode)}
                        onClose={() => setBackgroundRefineNodeId(null)}
                        onConfirm={(image) => refineBackgroundImageNode(backgroundRefineNode, image)}
                    />
                ) : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode?.metadata?.content ? (
                    <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open={Boolean(upscaleNode)} onClose={() => setUpscaleNodeId(null)} onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)} />
                ) : null}

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => generateAngleNode(angleNode!, params)} /> : null}

                <Modal
                    title="图片详情"
                    open={Boolean(previewNode?.metadata?.content)}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewNode?.metadata?.content ? <img src={imagePreviewUrl(previewNode.metadata.content, 1920)} alt={previewNode.title || "图片"} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} /> : null}
                </Modal>

                <Modal
                    title="清空画布？"
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>取消</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                清空
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
                </Modal>

                {assetPickerOpen ? <AssetPickerModal open={assetPickerOpen} onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} /> : null}
                <CanvasDrawingEditorModal
                    open={Boolean(drawingNode)}
                    node={drawingNode}
                    onClose={() => setDrawingNodeId(null)}
                    onSaved={(nodeId, summary) => {
                        setNodes((current) => current.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, drawingDocument: summary.document, drawingPreview: summary.preview } } : item)));
                    }}
                />
            </section>
            {assistantMounted ? (
                <CanvasAssistantPanel
                    conversationId={currentProject?.creativeConversationId}
                    nodes={nodes}
                    selectedNodeIds={selectedNodeIds}
                    snapshot={agentSnapshot}
                    sessions={chatSessions}
                    activeSessionId={activeChatId}
                    onSelectNodeIds={setSelectedNodeIds}
                    onSessionsChange={handleAssistantSessionsChange}
                    onConversationChange={(conversationId) => updateProject(projectId, { creativeConversationId: conversationId })}
                    onApplyOps={applyAgentOps}
                    onLocateNode={locateCanvasNode}
                    onPasteImage={pasteAssistantImage}
                    closing={assistantClosing}
                    onCollapse={closeAgent}
                />
            ) : null}
        </main>
    );
}

function CanvasGroupOutlines({
    nodes,
    selectedNodeIds,
    selectedConnectionId,
    stroke,
    activeStroke,
    activeFill,
}: {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    selectedConnectionId: string | null;
    stroke: string;
    activeStroke: string;
    activeFill: string;
}) {
    if (selectedConnectionId) return null;

    const groups = new Map<string, CanvasNodeData[]>();
    nodes.forEach((node) => {
        const groupId = node.metadata?.groupId;
        if (!groupId) return;
        const members = groups.get(groupId) || [];
        members.push(node);
        groups.set(groupId, members);
    });

    return (
        <>
            {Array.from(groups.entries()).flatMap(([groupId, members]) => {
                if (members.length < 2) return [];
                const padding = 22;
                const left = Math.min(...members.map((node) => node.position.x)) - padding;
                const top = Math.min(...members.map((node) => node.position.y)) - padding;
                const right = Math.max(...members.map((node) => node.position.x + node.width)) + padding;
                const bottom = Math.max(...members.map((node) => node.position.y + node.height)) + padding;
                const active = members.some((node) => selectedNodeIds.has(node.id));

                return (
                    <div
                        key={groupId}
                        aria-label={`编组，${members.length} 个节点`}
                        className="pointer-events-none absolute rounded-xl border border-dashed"
                        style={{ left, top, width: right - left, height: bottom - top, zIndex: 0, borderColor: active ? activeStroke : stroke, background: active ? activeFill : "transparent" }}
                    />
                );
            })}
        </>
    );
}
