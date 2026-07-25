"use client";

import type { CSSProperties, ReactNode } from "react";
import { Image as ImageIcon, LoaderCircle, MessageSquare, Music2, Play, Settings2, Square, Video } from "lucide-react";
import { Button, Segmented } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { CreditSymbol, formatCreditAmount, requestCreditCost } from "@/constant/credits";
import { defaultConfig, modelMatchesCapability, modelOptionName, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasCameraControl } from "./canvas-camera-control";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "../types";
import { buildCanvasNodeConfig, canvasAudioConfigPatch, canvasVideoConfigPatch } from "../utils/canvas-node-config";

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onStop: (nodeId: string) => void;
    onComposerToggle: () => void;
};

export function CanvasConfigNodePanel({ node, isRunning, inputSummary, onConfigChange, onGenerate, onStop, onComposerToggle }: CanvasConfigNodePanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = node.metadata?.generationMode || "image";
    const config = buildNodeConfig(globalConfig, node, mode);
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const credits = requestCreditCost({
        apiSource: config.apiSource,
        modelPointCosts: config.modelPointCosts,
        generationPointMultipliers: config.generationPointMultipliers,
        kind: mode,
        model: config.model,
        count: mode === "image" ? count : 1,
        quality: config.quality,
        videoQuality: config.vquality,
        videoSeconds: config.videoSeconds,
    });
    const chipStyle = { background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text };
    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount);
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const canGenerate = hasComposerContent || (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput);

    return (
        <div className="flex h-full w-full cursor-move flex-col px-3 pb-3 pt-5 text-sm" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="shrink-0 text-sm font-semibold">生成配置</div>
                <div className="cursor-default" onMouseDown={(event) => event.stopPropagation()}>
                    <Segmented
                        size="small"
                        className="canvas-config-mode !rounded-md !p-0.5"
                        value={mode}
                        onChange={(value) => onConfigChange(node.id, { generationMode: value as CanvasGenerationMode })}
                        options={[
                            {
                                value: "image",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <ImageIcon className="size-3.5" />
                                        生图
                                    </span>
                                ),
                            },
                            {
                                value: "text",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <MessageSquare className="size-3.5" />
                                        文本
                                    </span>
                                ),
                            },
                            {
                                value: "video",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Video className="size-3.5" />
                                        视频
                                    </span>
                                ),
                            },
                            {
                                value: "audio",
                                label: (
                                    <span className="inline-flex items-center gap-1">
                                        <Music2 className="size-3.5" />
                                        音频
                                    </span>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex h-7 min-w-0 items-center divide-x overflow-hidden rounded-md border" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                    <InputCount icon={<MessageSquare className="size-3" />} label="提示词" value={inputSummary.textCount} style={chipStyle} />
                    <InputCount icon={<ImageIcon className="size-3" />} label="参考图" value={inputSummary.imageCount} style={chipStyle} />
                    <InputCount icon={<Video className="size-3" />} label="参考视频" value={inputSummary.videoCount} style={chipStyle} />
                    <InputCount icon={<Music2 className="size-3" />} label="参考音频" value={inputSummary.audioCount} style={chipStyle} />
                </div>
                <button type="button" className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px]" style={chipStyle} onMouseDown={(event) => event.stopPropagation()} onClick={onComposerToggle}>
                    <Settings2 className="size-3.5" />
                    组装提示词
                </button>
            </div>

            <div className={`mb-2 grid min-w-0 cursor-default items-center gap-2 ${mode === "image" || mode === "video" || mode === "audio" ? "grid-cols-[minmax(0,1fr)_148px]" : "grid-cols-1"}`} onMouseDown={(event) => event.stopPropagation()}>
                <ModelPicker className="canvas-compact-control h-10" config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability={mode} onMissingConfig={() => openConfigDialog(true)} fullWidth />
                {mode === "video" ? (
                    <CanvasVideoSettingsPopover
                        config={config}
                        placement="topRight"
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        onConfigChange={(key, value) => onConfigChange(node.id, canvasVideoConfigPatch(key, value))}
                    />
                ) : mode === "image" ? (
                    <CanvasImageSettingsPopover
                        config={config}
                        placement="topRight"
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                    />
                ) : mode === "audio" ? (
                    <CanvasAudioSettingsPopover
                        config={config}
                        placement="topRight"
                        buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                        onConfigChange={(key, value) => onConfigChange(node.id, canvasAudioConfigPatch(key, value))}
                    />
                ) : null}
            </div>

            {mode === "image" || mode === "video" ? (
                <div className="mb-2 cursor-default" onMouseDown={(event) => event.stopPropagation()}>
                    <CanvasCameraControl
                        value={node.metadata?.cameraControl}
                        onChange={(cameraControl) => onConfigChange(node.id, { cameraControl })}
                        placement="topRight"
                        buttonClassName="canvas-compact-control !h-9 !w-full !justify-start !rounded-lg !px-2"
                    />
                </div>
            ) : null}

            <Button
                type="primary"
                className="canvas-generate-button mt-auto !h-9 !w-full !cursor-pointer !rounded-lg"
                danger={isRunning}
                disabled={!isRunning && !canGenerate}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => (isRunning ? onStop(node.id) : onGenerate(node.id))}
            >
                <span className="inline-flex items-center gap-1.5">
                    {isRunning ? (
                        <>
                            <LoaderCircle className="size-4 animate-spin" />
                            <Square className="size-3.5 fill-current" />
                            <span>停止</span>
                        </>
                    ) : (
                        <>
                            <span className="inline-flex items-center gap-1">
                                <CreditSymbol />
                                {formatCreditAmount(credits)}
                            </span>
                            <Play className="size-4" />
                            <span>开始生成</span>
                        </>
                    )}
                </span>
            </Button>
        </div>
    );
}

function InputCount({ icon, label, value, style }: { icon: ReactNode; label: string; value: number; style: CSSProperties }) {
    return (
        <span className="inline-flex h-full min-w-0 items-center gap-1 px-1.5 text-[11px]" style={{ borderColor: style.borderColor, color: style.color }} title={`${label} ${value}`}>
            {icon}
            <span className="font-medium tabular-nums">{value}</span>
        </span>
    );
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const metadataModel = node.metadata?.model || "";
    const model = metadataModel && modelMatchesCanvasGenerationMode(metadataModel, mode) ? metadataModel : defaultModel || (mode === "audio" ? defaultConfig.audioModel : globalConfig.model || defaultConfig.model);
    return buildCanvasNodeConfig(globalConfig, node, mode, model);
}

function modelMatchesCanvasGenerationMode(model: string, mode: CanvasGenerationMode) {
    if (mode === "image" && modelOptionName(model).toLowerCase() === "auto") return true;
    return modelMatchesCapability(model, mode);
}
