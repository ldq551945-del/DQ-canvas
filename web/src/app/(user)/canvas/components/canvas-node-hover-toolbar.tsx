"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { App, Dropdown, Modal, Segmented, Tooltip } from "antd";
import { Download, Ellipsis, FolderPlus, Image as ImageIcon, Info, LoaderCircle, Lock, MessageSquare, Minus, Music2, Pencil, Plus, RefreshCw, Settings2, Square, Trash2, Unlock, Upload, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { DEFAULT_BACKGROUND_REMOVAL_OPTIONS, type BackgroundRemovalOptionsV1 } from "@/lib/background-removal-options";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, isCanvasImageNodeType, type CanvasNodeData, type ViewportTransform } from "../types";
import { canRefineBackgroundNode } from "../utils/canvas-background-refine";
import { ImageToolSettingsModal } from "./canvas-image-toolbar-settings-modal";
import { BackgroundRemovalIcon, IMAGE_QUICK_TOOLS_STORAGE_KEY, MAX_IMAGE_QUICK_TOOLS, buildImageToolbarTools, defaultImageQuickToolIds, isImageQuickToolId, readImageQuickToolsConfig, type ImageQuickToolId } from "./canvas-image-toolbar-tools";

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onInfo: (node: CanvasNodeData) => void;
    onEditText: (node: CanvasNodeData) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onToggleDialog: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onAnnotate: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onEmotion: (node: CanvasNodeData) => void;
    onPortraitTexture: (node: CanvasNodeData) => void;
    onRemoveBackground: (node: CanvasNodeData, options: BackgroundRemovalOptionsV1) => void;
    onCancelBackgroundRemoval: (node: CanvasNodeData) => void;
    onRefineBackground: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onToggleLocked: (node: CanvasNodeData) => void;
    backgroundRemovalNodeIds?: Set<string>;
    backgroundRemovalStoppingNodeIds?: Set<string>;
    onDelete: (node: CanvasNodeData) => void;
};

type ToolbarTool = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    danger?: boolean;
};

const TOOLBAR_HEIGHT = 44;
const TOOLBAR_GAP = 14;
const TOOLBAR_TOP_INSET = 72;
const TOOLBAR_BOTTOM_INSET = 80;

export function resolveCanvasNodeToolbarTop(input: { nodeTop: number; nodeBottom: number; viewportHeight: number; toolbarHeight?: number }) {
    const toolbarHeight = Math.max(1, input.toolbarHeight || TOOLBAR_HEIGHT);
    const above = input.nodeTop - TOOLBAR_GAP - toolbarHeight;
    const below = input.nodeBottom + TOOLBAR_GAP;
    const maxTop = Math.max(TOOLBAR_TOP_INSET, input.viewportHeight - TOOLBAR_BOTTOM_INSET - toolbarHeight);
    if (above >= TOOLBAR_TOP_INSET) return Math.min(above, maxTop);
    if (below <= maxTop) return Math.max(TOOLBAR_TOP_INSET, below);
    return Math.min(Math.max(above, TOOLBAR_TOP_INSET), maxTop);
}

export function CanvasNodeHoverToolbar({
    node,
    viewport,
    onKeep,
    onLeave,
    onInfo,
    onEditText,
    onDecreaseFont,
    onIncreaseFont,
    onToggleDialog,
    onGenerateImage,
    onUpload,
    onDownload,
    onSaveAsset,
    onAnnotate,
    onMaskEdit,
    onEmotion,
    onPortraitTexture,
    onRemoveBackground,
    onCancelBackgroundRemoval,
    onRefineBackground,
    onCrop,
    onSplit,
    onUpscale,
    onSuperResolve,
    onAngle,
    onViewImage,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onToggleLocked,
    backgroundRemovalNodeIds,
    backgroundRemovalStoppingNodeIds,
    onDelete,
}: CanvasNodeHoverToolbarProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [quickImageToolIds, setQuickImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [draftImageToolIds, setDraftImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [backgroundRemovalOptions, setBackgroundRemovalOptions] = useState<BackgroundRemovalOptionsV1>(() => ({ ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS }));
    const [draftBackgroundRemovalOptions, setDraftBackgroundRemovalOptions] = useState<BackgroundRemovalOptionsV1>(() => ({ ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS }));
    const [showLabels, setShowLabels] = useState(false);
    const [draftShowLabels, setDraftShowLabels] = useState(false);
    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);
    const [imageToolMenuOpen, setImageToolMenuOpen] = useState(false);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const [toolbarMetrics, setToolbarMetrics] = useState({ width: 0, height: TOOLBAR_HEIGHT, viewportWidth: 0, viewportHeight: 0 });
    const { message } = App.useApp();
    const copyText = useCopyText();

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
            if (!stored) return;
            const parsed = JSON.parse(stored) as unknown;
            const config = readImageQuickToolsConfig(parsed);
            setQuickImageToolIds(config.ids);
            setBackgroundRemovalOptions(config.backgroundRemoval);
            setShowLabels(config.showLabels);
        } catch {
            window.localStorage.removeItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        setImageToolSettingsOpen(false);
        setImageToolMenuOpen(false);
    }, [node?.id]);

    useEffect(() => {
        const toolbar = toolbarRef.current;
        if (!toolbar || typeof window === "undefined") return;
        const sync = () => setToolbarMetrics({ width: toolbar.offsetWidth, height: toolbar.offsetHeight || TOOLBAR_HEIGHT, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight });
        sync();
        const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
        resizeObserver?.observe(toolbar);
        window.addEventListener("resize", sync);
        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener("resize", sync);
        };
    }, [node?.id, quickImageToolIds, imageToolSettingsOpen, imageToolMenuOpen, showLabels]);

    if (!node) return null;

    const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const nodeTop = viewport.y + node.position.y * viewport.k;
    const nodeBottom = viewport.y + (node.position.y + node.height) * viewport.k;
    const toolbarTop = resolveCanvasNodeToolbarTop({ nodeTop, nodeBottom, viewportHeight: toolbarMetrics.viewportHeight || (typeof window === "undefined" ? 0 : window.innerHeight), toolbarHeight: toolbarMetrics.height });
    const safeViewportWidth = toolbarMetrics.viewportWidth || 0;
    const safeToolbarWidth = Math.min(toolbarMetrics.width || 0, Math.max(0, safeViewportWidth - 32));
    const toolbarLeft = safeViewportWidth && safeToolbarWidth ? Math.min(Math.max(left, safeToolbarWidth / 2 + 16), safeViewportWidth - safeToolbarWidth / 2 - 16) : left;
    const isImage = isCanvasImageNodeType(node.type);
    const isPanorama = node.type === CanvasNodeType.Panorama;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const isText = node.type === CanvasNodeType.Text;
    const isConfig = node.type === CanvasNodeType.Config;
    const canOpenDialog = isText || hasImage || isVideo;
    const canRetry = node.metadata?.status === "error";
    const quickImageToolIdSet = new Set(quickImageToolIds);
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            message.warning("暂无可复制的提示词");
            return;
        }
        copyText(prompt, "提示词已复制");
    };
    const backgroundRemovalActive = Boolean(backgroundRemovalNodeIds?.has(node.id));
    const backgroundRemovalStopping = Boolean(backgroundRemovalStoppingNodeIds?.has(node.id));
    const imageTools: Array<ReturnType<typeof buildImageToolbarTools>[number] & { disabled?: boolean; danger?: boolean }> = buildImageToolbarTools(
        node,
        {
            onUpload,
            onToggleFreeResize,
            onAnnotate,
            onMaskEdit,
            onEmotion,
            onPortraitTexture,
            onRemoveBackground,
            onCrop,
            onSplit,
            onUpscale,
            onSuperResolve,
            onAngle,
            onViewImage,
            onCopyPrompt: copyImagePrompt,
            onReversePrompt,
        },
        backgroundRemovalOptions,
    ).map((tool) => {
        if (tool.id !== "removeBackground" || !backgroundRemovalActive) return tool;
        return backgroundRemovalStopping
            ? { ...tool, title: "正在终止抠图", label: "终止中", icon: <LoaderCircle className="size-4 animate-spin" />, disabled: true, danger: true }
            : { ...tool, title: "终止抠图", label: "终止", icon: <Square className="size-4 fill-current" strokeWidth={2} />, onClick: () => onCancelBackgroundRemoval(node), disabled: false, danger: true };
    });

    function openImageToolSettings() {
        if (!node) return;
        onKeep(node.id);
        setDraftImageToolIds(quickImageToolIds);
        setDraftBackgroundRemovalOptions({ ...backgroundRemovalOptions });
        setDraftShowLabels(showLabels);
        setImageToolSettingsOpen(true);
    }

    const baseToolbarTools: ToolbarTool[] = [
        { id: "info", title: "查看节点信息", label: "信息", icon: <Info className="size-4" />, onClick: () => onInfo(node) },
        { id: "delete", title: "移除节点", label: "删除", icon: <Trash2 className="size-4" />, onClick: () => onDelete(node), danger: true },
    ];
    const imageActionToolbarTools: ToolbarTool[] = imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, disabled: tool.disabled, danger: tool.danger, onClick: tool.onClick }));
    const nodeToolbarTools: ToolbarTool[] = [
        ...(canRetry ? [{ id: "retry", title: "重新生成", label: "重试", icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(hasImage || hasVideo || isText ? [{ id: "saveAsset", title: "加入我的素材", label: "存素材", icon: <FolderPlus className="size-4" />, onClick: () => onSaveAsset(node) }] : []),
        ...(hasImage || hasVideo || hasAudio ? [{ id: "download", title: hasAudio ? "下载音频" : hasVideo ? "下载视频" : "下载图片", label: "下载", icon: <Download className="size-4" />, onClick: () => onDownload(node) }] : []),
        ...(canOpenDialog ? [{ id: "edit", title: "编辑", label: "编辑", icon: <MessageSquare className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "editText", title: "编辑文本", label: "编辑文字", icon: <Pencil className="size-4" />, onClick: () => onEditText(node) }] : []),
        ...(isText ? [{ id: "generateImage", title: "用文本生图", label: "生图", icon: <ImageIcon className="size-4" />, onClick: () => onGenerateImage(node) }] : []),
        ...(isConfig ? [{ id: "config", title: "生成配置", label: "生成配置", icon: <Settings2 className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "decreaseFont", title: "减小字号", label: "缩小", icon: <Minus className="size-4" />, onClick: () => onDecreaseFont(node) }] : []),
        ...(isText ? [{ id: "increaseFont", title: "增大字号", label: "放大", icon: <Plus className="size-4" />, onClick: () => onIncreaseFont(node) }] : []),
        ...(isImage && !hasImage ? [{ id: "uploadImage", title: "上传图片", label: "上传图片", icon: <Upload className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isVideo && !hasVideo ? [{ id: "uploadVideo", title: "上传视频", label: "上传视频", icon: <Video className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isAudio && !hasAudio ? [{ id: "uploadAudio", title: "上传音频", label: "上传音频", icon: <Music2 className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(canRefineBackgroundNode(node) ? [{ id: "refineBackground", title: "手动细化抠图边缘", label: "细化边缘", icon: <BackgroundRemovalIcon />, onClick: () => onRefineBackground(node) }] : []),
        ...(hasImage && !isPanorama ? imageActionToolbarTools : []),
    ];
    const activeBackgroundRemovalTool = backgroundRemovalActive ? imageActionToolbarTools.find((tool) => tool.id === "removeBackground") : undefined;
    const toolbarTools = hasImage
        ? [...baseToolbarTools, ...nodeToolbarTools].filter((tool) => tool.id !== (backgroundRemovalActive ? "removeBackground" : "") && (tool.id === "refineBackground" || quickImageToolIdSet.has(tool.id as ImageQuickToolId)))
        : [...baseToolbarTools, ...nodeToolbarTools];
    const selectableImageToolbarTools = [...baseToolbarTools, ...nodeToolbarTools, ...imageActionToolbarTools].filter(
        (tool, index, tools): tool is ToolbarTool & { id: ImageQuickToolId } => tool.id !== "retry" && tool.id !== "refineBackground" && isImageQuickToolId(tool.id) && tools.findIndex((candidate) => candidate.id === tool.id) === index,
    );
    const temporaryImageToolbarTools = [...baseToolbarTools, ...nodeToolbarTools].filter(
        (tool): tool is ToolbarTool & { id: ImageQuickToolId } => tool.id !== "retry" && tool.id !== "refineBackground" && !(backgroundRemovalActive && tool.id === "removeBackground") && isImageQuickToolId(tool.id) && !quickImageToolIdSet.has(tool.id),
    );

    const closeImageToolSettings = () => {
        setImageToolSettingsOpen(false);
        onLeave();
    };

    const setDraftImageToolVisible = (id: ImageQuickToolId, visible: boolean) => {
        setDraftImageToolIds((current) => {
            const selected = new Set(current);
            if (visible && selected.size >= MAX_IMAGE_QUICK_TOOLS) {
                message.warning(`最多固定 ${MAX_IMAGE_QUICK_TOOLS} 个快捷工具`);
                return current;
            }
            if (visible) selected.add(id);
            else selected.delete(id);
            return selectableImageToolbarTools.filter((tool) => selected.has(tool.id)).map((tool) => tool.id);
        });
    };

    const saveImageToolSettings = () => {
        const config = { version: 3 as const, ids: draftImageToolIds.slice(0, MAX_IMAGE_QUICK_TOOLS), backgroundRemoval: { ...draftBackgroundRemovalOptions, outputMode: "transparent" as const }, showLabels: draftShowLabels };
        setQuickImageToolIds(config.ids);
        setBackgroundRemovalOptions(config.backgroundRemoval);
        setShowLabels(config.showLabels);
        window.localStorage.setItem(IMAGE_QUICK_TOOLS_STORAGE_KEY, JSON.stringify(config));
        closeImageToolSettings();
    };

    const saveBackgroundRemovalOptions = (options: BackgroundRemovalOptionsV1) => {
        setDraftBackgroundRemovalOptions({ ...options, outputMode: "transparent" });
    };

    return (
        <>
            <div
                ref={toolbarRef}
                className="absolute z-[70] flex h-11 w-max max-w-[calc(100vw-32px)] -translate-x-1/2 items-center overflow-hidden rounded-[14px] border shadow-[0_8px_28px_rgba(15,23,42,.12)]"
                style={{ left: toolbarLeft, top: toolbarTop, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => {
                    if (!imageToolSettingsOpen && !imageToolMenuOpen) onLeave();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div data-canvas-node-toolbar-scroll className="hide-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden">
                    {toolbarTools.map((tool) => (
                        <ToolbarAction key={tool.id} {...tool} showLabel={showLabels} theme={theme} />
                    ))}
                </div>
                <div data-canvas-node-toolbar-fixed className="flex shrink-0 items-center">
                    {activeBackgroundRemovalTool ? <ToolbarAction {...activeBackgroundRemovalTool} showLabel={showLabels} theme={theme} /> : null}
                    <ToolbarAction
                        id="node-lock"
                        title={node.metadata?.locked ? "解锁节点" : "锁定位置和尺寸"}
                        label={node.metadata?.locked ? "解锁" : "锁定"}
                        icon={node.metadata?.locked ? <Unlock className="size-4" strokeWidth={2.25} /> : <Lock className="size-4" strokeWidth={2.25} />}
                        active={Boolean(node.metadata?.locked)}
                        onClick={() => onToggleLocked(node)}
                        showLabel={showLabels}
                        theme={theme}
                    />
                    {hasImage ? (
                        <Dropdown
                            open={imageToolMenuOpen}
                            trigger={["click"]}
                            placement="topRight"
                            onOpenChange={setImageToolMenuOpen}
                            menu={{
                                items: [
                                    ...temporaryImageToolbarTools.map((tool) => ({
                                        key: tool.id,
                                        icon: <span className="grid size-5 min-w-5 shrink-0 place-items-center [&>*]:size-4">{tool.icon}</span>,
                                        label: tool.label,
                                        disabled: tool.disabled,
                                        danger: tool.danger,
                                        onClick: tool.onClick,
                                    })),
                                    ...(temporaryImageToolbarTools.length ? [{ type: "divider" as const }] : []),
                                    {
                                        key: "manage",
                                        icon: (
                                            <span className="grid size-5 min-w-5 shrink-0 place-items-center">
                                                <Settings2 className="size-4" />
                                            </span>
                                        ),
                                        label: "管理快捷工具",
                                        onClick: openImageToolSettings,
                                    },
                                ],
                            }}
                        >
                            <span>
                                <ToolbarAction id="more" title="更多图片工具" label="更多" icon={<Ellipsis className="size-4" />} active={imageToolSettingsOpen || imageToolMenuOpen} onClick={() => undefined} showLabel={showLabels} theme={theme} />
                            </span>
                        </Dropdown>
                    ) : null}
                </div>
            </div>
            {hasImage ? (
                <ImageToolSettingsModal
                    open={imageToolSettingsOpen}
                    tools={selectableImageToolbarTools}
                    selectedIds={draftImageToolIds}
                    showLabels={draftShowLabels}
                    backgroundRemovalOptions={draftBackgroundRemovalOptions}
                    onToggle={setDraftImageToolVisible}
                    onShowLabelsChange={setDraftShowLabels}
                    onBackgroundRemovalOptionsSave={saveBackgroundRemovalOptions}
                    onCancel={closeImageToolSettings}
                    onSave={saveImageToolSettings}
                />
            ) : null}
        </>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node && isCanvasImageNodeType(node.type) && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.batchChildIds?.length || 0 : 0;
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "title") return undefined;
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    const title = (
        <div className="flex items-center justify-between gap-4 pr-12">
            <span>节点信息</span>
            <Segmented
                size="small"
                value={view}
                onChange={(value) => setView(value as "info" | "json")}
                options={[
                    { label: "信息", value: "info" },
                    { label: "JSON", value: "json" },
                ]}
            />
        </div>
    );

    return (
        <Modal className="canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose}>
            {node ? (
                <div className="h-[48vh] min-h-60 text-sm sm:h-[56vh] sm:min-h-[360px]">
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow label="ID" value={node.id} />
                            <InfoRow
                                label="类型"
                                value={
                                    node.type === CanvasNodeType.Text
                                        ? "文本"
                                        : node.type === CanvasNodeType.Image
                                          ? "图片"
                                          : node.type === CanvasNodeType.Panorama
                                            ? "全景图"
                                            : node.type === CanvasNodeType.Drawing
                                              ? "绘图"
                                              : node.type === CanvasNodeType.Video
                                                ? "视频"
                                                : node.type === CanvasNodeType.Audio
                                                  ? "音频"
                                                  : "生成配置"
                                }
                            />
                            <InfoRow label="尺寸" value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                            <InfoRow label="位置" value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                            <InfoRow label="状态" value={node.metadata?.status || "idle"} />
                            {batchCount > 1 ? <InfoRow label="图片组" value={`${batchCount} 张`} /> : null}
                            {node.metadata?.prompt ? <InfoRow label="提示词" value={node.metadata.prompt} /> : null}
                            {imageBytes ? <InfoRow label="图片大小" value={formatBytes(imageBytes)} /> : null}
                            {node.metadata?.errorDetails ? (
                                <div className="rounded-lg border p-3 text-red-400" style={{ borderColor: theme.node.stroke }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function ToolbarAction({ title, label, icon, onClick, active = false, danger = false, disabled = false, showLabel = false, theme }: ToolbarTool & { showLabel?: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2}>
            <button
                type="button"
                className={`group relative flex h-11 shrink-0 items-center justify-center ${showLabel ? "gap-1 px-2" : "w-11"}`}
                style={{ color: danger ? "#ef4444" : theme.toolbar.item, opacity: disabled ? 0.6 : 1, "--canvas-tool-hover": theme.toolbar.itemHover } as CSSProperties}
                onClick={onClick}
                aria-label={title}
                disabled={disabled}
            >
                <span
                    className="flex size-8 items-center justify-center rounded-lg transition group-hover:bg-[var(--canvas-tool-hover)]"
                    style={{ background: active ? theme.toolbar.activeBg : undefined, color: active ? theme.toolbar.activeText : undefined }}
                >
                    {icon}
                </span>
                {showLabel ? <span className="whitespace-nowrap text-xs">{label}</span> : null}
            </button>
        </Tooltip>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}
