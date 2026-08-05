"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Card, Form, Modal, Space, Switch, Tag, Tooltip, Typography, theme as antdTheme } from "antd";
import { ArrowLeft, Check, Ellipsis, Image as ImageIcon, RotateCcw, Settings2 } from "lucide-react";

import { DEFAULT_BACKGROUND_REMOVAL_OPTIONS, type BackgroundRemovalOptionsV1 } from "@/lib/background-removal-options";
import { BackgroundRemovalSettingsPanel } from "./canvas-background-removal-settings-panel";
import { MAX_IMAGE_QUICK_TOOLS, type ImageQuickToolId } from "./canvas-image-toolbar-tools";

export type ImageToolbarSettingsTool = {
    id: ImageQuickToolId;
    title: string;
    label: string;
    icon: ReactNode;
    active?: boolean;
    danger?: boolean;
};

type PreviewTool =
    | ImageToolbarSettingsTool
    | {
          id: "more";
          title: string;
          label: string;
          icon: ReactNode;
          active?: boolean;
          danger?: boolean;
      };

type PreviewScroll = {
    left: number;
    max: number;
    viewport: number;
    content: number;
};

export function ImageToolSettingsModal({
    open,
    tools,
    selectedIds,
    showLabels,
    backgroundRemovalOptions,
    onToggle,
    onShowLabelsChange,
    onBackgroundRemovalOptionsSave,
    onCancel,
    onSave,
}: {
    open: boolean;
    tools: ImageToolbarSettingsTool[];
    selectedIds: ImageQuickToolId[];
    showLabels: boolean;
    backgroundRemovalOptions: BackgroundRemovalOptionsV1;
    onToggle: (id: ImageQuickToolId, visible: boolean) => void;
    onShowLabelsChange: (visible: boolean) => void;
    onBackgroundRemovalOptionsSave: (options: BackgroundRemovalOptionsV1) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    const { token } = antdTheme.useToken();
    const previewToolbarRef = useRef<HTMLDivElement>(null);
    const scrollbarTrackRef = useRef<HTMLInputElement>(null);
    const [view, setView] = useState<"tools" | "background-removal">("tools");
    const [backgroundRemovalDraft, setBackgroundRemovalDraft] = useState<BackgroundRemovalOptionsV1>(() => ({ ...backgroundRemovalOptions }));
    const [previewScroll, setPreviewScroll] = useState<PreviewScroll>({ left: 0, max: 0, viewport: 1, content: 1 });
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selectedTools = tools.filter((tool) => selected.has(tool.id));
    const previewTools: PreviewTool[] = [...selectedTools, { id: "more", title: "配置快捷工具", label: "更多", icon: <Ellipsis className="size-4" />, active: true }];

    useEffect(() => {
        if (!open) return;
        setView("tools");
        setBackgroundRemovalDraft({ ...backgroundRemovalOptions });
    }, [open]);

    const syncPreviewScroll = useCallback(() => {
        const toolbar = previewToolbarRef.current;
        if (!toolbar) return;
        setPreviewScroll({
            left: toolbar.scrollLeft,
            max: Math.max(0, toolbar.scrollWidth - toolbar.clientWidth),
            viewport: Math.max(1, toolbar.clientWidth),
            content: Math.max(1, toolbar.scrollWidth),
        });
    }, []);

    const setPreviewScrollLeft = useCallback(
        (left: number) => {
            const toolbar = previewToolbarRef.current;
            if (!toolbar) return;
            toolbar.scrollLeft = left;
            syncPreviewScroll();
        },
        [syncPreviewScroll],
    );

    useEffect(() => {
        if (!open) return;
        const toolbar = previewToolbarRef.current;
        const sync = () => syncPreviewScroll();
        const frames: number[] = [];
        const firstFrame = window.requestAnimationFrame(() => {
            sync();
            frames.push(window.requestAnimationFrame(sync));
        });
        frames.push(firstFrame);
        const timer = window.setTimeout(sync, 120);
        const resizeObserver = typeof ResizeObserver !== "undefined" && toolbar ? new ResizeObserver(sync) : null;
        if (resizeObserver && toolbar) {
            resizeObserver.observe(toolbar);
            toolbar.childNodes.forEach((child) => {
                if (child instanceof Element) resizeObserver.observe(child);
            });
        }
        sync();
        window.addEventListener("resize", syncPreviewScroll);
        return () => {
            frames.forEach((frame) => window.cancelAnimationFrame(frame));
            window.clearTimeout(timer);
            resizeObserver?.disconnect();
            window.removeEventListener("resize", syncPreviewScroll);
        };
    }, [open, selectedIds, previewTools.length, syncPreviewScroll, view]);

    const scrollbarWidth = scrollbarTrackRef.current?.clientWidth || previewScroll.viewport;
    const scrollbarThumbWidth = previewScroll.max > 0 ? Math.min(scrollbarWidth, Math.max(64, (previewScroll.viewport / previewScroll.content) * scrollbarWidth)) : scrollbarWidth;
    const openBackgroundRemovalSettings = () => {
        setBackgroundRemovalDraft({ ...backgroundRemovalOptions });
        setView("background-removal");
    };
    const closeBackgroundRemovalSettings = () => {
        setBackgroundRemovalDraft({ ...backgroundRemovalOptions });
        setView("tools");
    };
    const saveBackgroundRemovalSettings = () => {
        onBackgroundRemovalOptionsSave(backgroundRemovalDraft);
        setView("tools");
    };

    return (
        <Modal
            className="canvas-image-toolbar-settings-modal"
            title={
                view === "tools" ? (
                    "自定义工具栏"
                ) : (
                    <div className="flex items-center gap-2">
                        <Tooltip title="返回快捷工具">
                            <Button type="text" size="small" icon={<ArrowLeft className="size-4" />} aria-label="返回快捷工具" onClick={closeBackgroundRemovalSettings} />
                        </Tooltip>
                        <span>抠图设置</span>
                    </div>
                )
            }
            open={open}
            centered
            width={760}
            onCancel={onCancel}
            destroyOnHidden
            styles={{ body: { maxHeight: "min(72vh, 720px)", overflowY: "auto" } }}
            footer={
                view === "tools" ? (
                    <div className="flex justify-end">
                        <Space>
                            <Button onClick={onCancel}>取消</Button>
                            <Button type="primary" onClick={onSave}>
                                保存
                            </Button>
                        </Space>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button icon={<RotateCcw className="size-4" />} onClick={() => setBackgroundRemovalDraft({ ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS })}>
                            恢复默认
                        </Button>
                        <Space>
                            <Button onClick={closeBackgroundRemovalSettings}>取消</Button>
                            <Button type="primary" onClick={saveBackgroundRemovalSettings}>
                                保存参数
                            </Button>
                        </Space>
                    </div>
                )
            }
        >
            {view === "tools" ? (
                <>
                    <Typography.Paragraph type="secondary" className="!mb-4">
                        选择你想在图片节点编辑栏中使用的快捷工具。
                    </Typography.Paragraph>

                    <Card
                        size="small"
                        title={
                            <Space size={6}>
                                <Settings2 className="size-4" />
                                节点预览
                            </Space>
                        }
                        className="mb-4"
                    >
                        <div className="relative flex min-h-[220px] w-full justify-center pb-7 pt-16 sm:min-h-[300px] sm:pb-9 sm:pt-20">
                            <div
                                ref={previewToolbarRef}
                                className="hide-scrollbar absolute left-2 right-2 top-3 z-10 flex h-12 items-center overflow-x-auto rounded-[18px] border px-1 text-[13px]"
                                style={{ background: token.colorBgElevated, borderColor: token.colorBorderSecondary, boxShadow: token.boxShadowSecondary, color: token.colorText }}
                                onScroll={syncPreviewScroll}
                            >
                                {previewTools.map((tool) => (
                                    <PreviewToolbarItem key={tool.id} tool={tool} showLabel={showLabels} />
                                ))}
                            </div>
                            <div
                                className="relative flex h-36 w-full max-w-[360px] flex-col items-center justify-center rounded-xl border shadow-sm sm:h-48"
                                style={{ background: token.colorBgContainer, borderColor: token.colorBorderSecondary, color: token.colorTextSecondary }}
                            >
                                <ImageIcon className="mb-2 size-8" />
                                <Typography.Text type="secondary">图片节点</Typography.Text>
                            </div>
                            <input
                                ref={scrollbarTrackRef}
                                type="range"
                                min={0}
                                max={Math.max(previewScroll.max, 1)}
                                value={Math.min(previewScroll.left, Math.max(previewScroll.max, 1))}
                                disabled={previewScroll.max <= 0}
                                className="absolute bottom-4 left-10 right-10 h-2.5 cursor-pointer appearance-none bg-transparent disabled:cursor-default [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-[var(--preview-scrollbar-thumb-width)] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[#8d9498] [&::-moz-range-track]:h-2.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[#bdc4c8] [&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[#bdc4c8] [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-[var(--preview-scrollbar-thumb-width)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#8d9498]"
                                style={{ "--preview-scrollbar-thumb-width": `${scrollbarThumbWidth}px` } as CSSProperties}
                                onInput={(event) => setPreviewScrollLeft(Number(event.currentTarget.value))}
                                onChange={(event) => setPreviewScrollLeft(Number(event.target.value))}
                            />
                        </div>
                    </Card>

                    <div className="mb-4 flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}>
                        <span className="text-sm">显示功能名</span>
                        <Switch size="small" checked={showLabels} onChange={onShowLabelsChange} aria-label="显示图片节点快捷工具名称" />
                    </div>

                    <Form layout="vertical" className="!mb-0">
                        <Form.Item
                            className="!mb-4"
                            label={
                                <Space size={8}>
                                    <span>快捷工具</span>
                                    <Tag className="m-0">
                                        {selectedTools.length}/{MAX_IMAGE_QUICK_TOOLS}
                                    </Tag>
                                </Space>
                            }
                        >
                            <div className="grid w-full gap-3 md:grid-cols-3">
                                {tools.map((tool) => (
                                    <div key={tool.id} className={`canvas-toolbar-tool-check flex min-h-9 min-w-0 items-center rounded-md px-1 text-left text-sm font-medium transition ${selected.has(tool.id) ? "is-selected" : ""}`}>
                                        <button
                                            type="button"
                                            role="checkbox"
                                            aria-checked={selected.has(tool.id)}
                                            disabled={!selected.has(tool.id) && selectedTools.length >= MAX_IMAGE_QUICK_TOOLS}
                                            className={`inline-flex min-w-0 items-center gap-2 py-2 text-left ${tool.id === "removeBackground" ? "w-fit flex-none" : "flex-1"}`}
                                            onClick={() => onToggle(tool.id, !selected.has(tool.id))}
                                        >
                                            <span className="canvas-toolbar-tool-check-box shrink-0">
                                                <Check className="size-3.5" />
                                            </span>
                                            <span className="inline-flex min-w-0 items-center gap-2">
                                                {tool.icon}
                                                <span className="truncate">{tool.label}</span>
                                            </span>
                                        </button>
                                        {tool.id === "removeBackground" ? (
                                            <button
                                                type="button"
                                                className="w-fit flex-none whitespace-nowrap py-2 pl-0 pr-1 text-xs font-normal underline-offset-2 hover:underline"
                                                style={{ color: token.colorLink }}
                                                aria-label="打开抠图自定义参数"
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={(event) => triggerBackgroundRemovalSettings(event, openBackgroundRemovalSettings)}
                                            >
                                                （自定义参数）
                                            </button>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </Form.Item>
                    </Form>
                </>
            ) : (
                <BackgroundRemovalSettingsPanel value={backgroundRemovalDraft} onChange={setBackgroundRemovalDraft} />
            )}
        </Modal>
    );
}

export function triggerBackgroundRemovalSettings(event: { stopPropagation: () => void }, openSettings: () => void) {
    event.stopPropagation();
    openSettings();
}

function PreviewToolbarItem({ tool, showLabel }: { tool: PreviewTool; showLabel: boolean }) {
    return (
        <Tooltip title={tool.title}>
            <span className="flex h-12 shrink-0 items-center gap-1 px-1.5" style={{ color: tool.danger ? "#ef4444" : undefined }}>
                <span className="flex size-9 items-center justify-center rounded-lg">{tool.icon}</span>
                {showLabel ? <span className="pr-1 text-xs">{tool.label}</span> : null}
            </span>
        </Tooltip>
    );
}
