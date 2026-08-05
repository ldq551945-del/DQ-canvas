"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUp, AtSign, Boxes, FileText, ImageIcon, ImagePlus, Maximize2, Music2, Sparkles, Square, Video } from "lucide-react";
import { Button, Modal } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { CreditSymbol, formatCreditAmount, requestCreditCost } from "@/constant/credits";
import { defaultConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCreativeAgentOptions } from "@/hooks/use-creative-agent-options";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasCameraControl } from "./canvas-camera-control";
import { CanvasPortraitTexturePopover } from "./canvas-portrait-texture-popover";
import { CanvasNodeType, isCanvasImageNodeType, type CanvasGenerationMode, type CanvasNodeData } from "../types";
import { buildSkillResourceReferences, canvasResourceMentionToken, type CanvasResourceReference } from "../utils/canvas-resource-references";
import { buildCanvasNodeConfig, canvasAudioConfigPatch, canvasVideoConfigPatch } from "../utils/canvas-node-config";
import { PANORAMA_IMAGE_SIZE } from "../utils/canvas-panorama";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = isCanvasImageNodeType(node.type) && Boolean(node.metadata?.content);
    const isPanorama = node.type === CanvasNodeType.Panorama;
    const savedPrompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
    const [prompt, setPrompt] = useState(savedPrompt);
    const [expanded, setExpanded] = useState(false);
    const [skillOpen, setSkillOpen] = useState(false);
    const [promptContentHeight, setPromptContentHeight] = useState(0);
    const { skills } = useCreativeAgentOptions("video", ["video"]);
    const skillReferences = useMemo(() => buildSkillResourceReferences(skills), [skills]);
    const references = mode === "video" ? [...mentionReferences, ...skillReferences] : mentionReferences;
    const connected = references.filter((item) => item.active && item.kind !== "skill");
    const referenceShelfHeight = connected.length ? 42 : 0;
    const composerMinHeight = connected.length ? 82 : 58;
    const composerHeight = Math.min(144, Math.max(composerMinHeight, Math.ceil(promptContentHeight + referenceShelfHeight)));
    const frameOptions = connected.filter((item) => item.kind === "image");
    const selectedSkillIds = useMemo(() => new Set(Array.from(prompt.matchAll(/@\[skill:([^\]]+)\]/g), (match) => match[1]).filter(Boolean)), [prompt]);
    const credits = requestCreditCost({
        apiSource: config.apiSource,
        modelPointCosts: config.modelPointCosts,
        generationPointMultipliers: config.generationPointMultipliers,
        kind: mode,
        model: config.model,
        count: mode === "image" ? config.count : 1,
        quality: config.quality,
        videoQuality: config.vquality,
        videoSeconds: config.videoSeconds,
    });

    useEffect(() => setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? ""), [node.id, node.metadata?.composerContent, node.metadata?.prompt]);
    useEffect(() => setPromptContentHeight(0), [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        onPromptChange(node.id, value);
        const skillIds = Array.from(value.matchAll(/@\[skill:([^\]]+)\]/g), (match) => match[1]).filter(Boolean);
        onConfigChange(node.id, { skillIds: skillIds.length ? Array.from(new Set(skillIds)) : undefined });
    };
    const insertReference = (reference: CanvasResourceReference) => {
        const token = canvasResourceMentionToken(reference);
        if (reference.kind === "skill" && prompt.includes(token)) {
            onConfigChange(node.id, { skillIds: Array.from(new Set([...selectedSkillIds, reference.skillId].filter((id): id is string => Boolean(id)))) });
            return;
        }
        const pendingMentionMatch = /@[^\s@,.;:!?，。；：！？、)\]}】）]*$/.exec(prompt);
        if (pendingMentionMatch) {
            const prefix = prompt.slice(0, pendingMentionMatch.index).replace(/\s*$/, "");
            updatePrompt(prefix ? `${prefix} ${token}` : token);
            return;
        }
        updatePrompt(prompt.trim() ? `${prompt.trimEnd()} ${token}` : token);
    };
    const toggleSkill = (skillId: string) => {
        const reference = skillReferences.find((item) => item.skillId === skillId);
        if (!reference) return;
        const token = canvasResourceMentionToken(reference);
        if (selectedSkillIds.has(skillId)) {
            updatePrompt(
                prompt
                    .replace(new RegExp(`(?:^|\\s)${escapeRegExp(token)}(?=\\s|$)`, "g"), "")
                    .replace(/\s{2,}/g, " ")
                    .trim(),
            );
        } else {
            insertReference(reference);
        }
    };
    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning) return;
        onGenerate(node.id, mode, text);
    };

    const renderEditor = (large = false) => (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl" style={{ background: theme.node.fill, boxShadow: `inset 0 0 0 1px ${theme.node.stroke}` }}>
            {connected.length ? (
                <div className="thin-scrollbar flex h-[42px] shrink-0 items-center gap-1.5 overflow-x-auto px-2.5 pt-1.5">
                    {connected.map((reference, index) => (
                        <button
                            key={reference.id}
                            type="button"
                            className="group relative size-[34px] shrink-0 overflow-hidden rounded-md transition hover:-translate-y-0.5 hover:brightness-110"
                            style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                            onClick={() => insertReference(reference)}
                            title={`插入 @${reference.label}`}
                            aria-label={`插入 @${reference.label}`}
                        >
                            <ReferenceThumbnail reference={reference} />
                            <span className="absolute left-0.5 top-0.5 grid size-3.5 place-items-center rounded-full bg-black/65 text-[8px] font-semibold text-white">{index + 1}</span>
                            <span className="absolute bottom-0.5 right-0.5 grid size-3.5 place-items-center rounded-full bg-black/65 text-white">
                                <AtSign className="size-2" />
                            </span>
                        </button>
                    ))}
                </div>
            ) : null}
            <CanvasResourceMentionTextarea
                value={prompt}
                references={references}
                onChange={updatePrompt}
                onSubmit={submit}
                onContentSizeChange={(height) => setPromptContentHeight((current) => (Math.abs(current - height) < 1 ? current : height))}
                containerClassName="min-h-0 flex-1"
                className={`thin-scrollbar h-full w-full resize-none overflow-y-auto border-none bg-transparent px-3 py-2 text-[13px] leading-5 outline-none ${large ? "min-h-[260px] text-[15px] leading-6" : ""}`}
                style={{ color: theme.node.text }}
                placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent, isPanorama)}
            />
        </div>
    );

    return (
        <div
            className="relative overflow-visible rounded-xl border p-2 shadow-xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: "0 12px 32px rgba(15,23,42,.14)" }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="flex min-h-7 items-center gap-1 px-1 text-[11px]">
                <span className="grid size-3.5 shrink-0 place-items-center" style={{ color: theme.node.activeStroke }}>
                    <GenerationModeIcon mode={mode} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium" style={{ color: theme.node.muted }}>
                    {modeDisplayName(mode)}创作
                </span>
                <CanvasPromptLibrary onSelect={updatePrompt} />
                <span className="ml-auto flex shrink-0 items-center gap-1">
                    {connected.length ? (
                        <span className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px]" style={{ background: theme.toolbar.itemHover, color: theme.toolbar.item }} title={`${connected.length} 个连接素材`}>
                            <Boxes className="size-3.5" />
                            {connected.length}
                        </span>
                    ) : null}
                    {mode !== "audio" ? (
                        <button
                            type="button"
                            className="grid size-7 place-items-center rounded-md transition-colors hover:brightness-95"
                            style={{ background: theme.toolbar.itemHover, color: theme.toolbar.item }}
                            onClick={() => setExpanded(true)}
                            aria-label="放大编辑"
                            title="放大编辑"
                        >
                            <Maximize2 className="size-4" />
                        </button>
                    ) : null}
                </span>
            </div>
            <div className="mt-1.5 transition-[height] duration-150" style={{ height: composerHeight }}>
                {renderEditor()}
            </div>
            {mode === "video" ? (
                <div className="relative mt-1.5 flex items-center gap-1">
                    <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[10px]" style={{ background: theme.toolbar.itemHover }} onClick={() => setSkillOpen((open) => !open)}>
                        <Sparkles className="size-3" />
                        Skill
                    </button>
                    {skillOpen ? (
                        <div
                            className="thin-scrollbar absolute bottom-9 left-0 z-[120] max-h-[min(280px,55vh)] w-64 max-w-[calc(100vw-24px)] overflow-y-auto rounded-lg border p-1 shadow-xl"
                            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
                        >
                            {skills.length ? (
                                skills.map((skill) => {
                                    const selected = selectedSkillIds.has(skill.id);
                                    return (
                                        <button
                                            key={skill.id}
                                            type="button"
                                            aria-pressed={selected}
                                            className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors hover:brightness-95"
                                            style={{ color: selected ? theme.toolbar.activeText : theme.toolbar.item, background: selected ? theme.toolbar.activeBg : "transparent" }}
                                            onClick={() => {
                                                toggleSkill(skill.id);
                                                setSkillOpen(false);
                                            }}
                                        >
                                            <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                                            <span className="min-w-0">
                                                <span className="block truncate font-medium">{skill.name}</span>
                                                <span className="block truncate opacity-60">{skill.description}</span>
                                            </span>
                                        </button>
                                    );
                                })
                            ) : (
                                <div className="px-2 py-2 text-xs opacity-60">暂无可用 Skill</div>
                            )}
                        </div>
                    ) : null}
                    {frameOptions.length ? (
                        <>
                            <select
                                aria-label="视频起始帧"
                                className="h-7 min-w-0 flex-1 rounded-full border bg-transparent px-2 text-[10px]"
                                value={node.metadata?.videoStartFrameNodeId || ""}
                                onChange={(event) => onConfigChange(node.id, { videoStartFrameNodeId: event.target.value || undefined })}
                            >
                                <option value="">起始帧</option>
                                {frameOptions.map((item) => (
                                    <option key={item.nodeId} value={item.nodeId}>
                                        {item.label}
                                    </option>
                                ))}
                            </select>
                            <select
                                aria-label="视频结束帧"
                                className="h-7 min-w-0 flex-1 rounded-full border bg-transparent px-2 text-[10px]"
                                value={node.metadata?.videoEndFrameNodeId || ""}
                                onChange={(event) => onConfigChange(node.id, { videoEndFrameNodeId: event.target.value || undefined })}
                            >
                                <option value="">结束帧</option>
                                {frameOptions.map((item) => (
                                    <option key={item.nodeId} value={item.nodeId}>
                                        {item.label}
                                    </option>
                                ))}
                            </select>
                        </>
                    ) : null}
                </div>
            ) : null}
            <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                <ModelPicker
                    className="!h-8 min-w-0 flex-1 !gap-1.5 !px-2.5 !text-[11px] [&_svg]:!size-4"
                    config={config}
                    value={config.model}
                    onChange={(model) => onConfigChange(node.id, { model })}
                    capability={mode}
                    onMissingConfig={() => openConfigDialog(true)}
                />
                {mode === "image" ? (
                    <CanvasImageSettingsPopover
                        config={config}
                        placement="topLeft"
                        buttonClassName="!h-8 !min-w-0 !flex-1 !justify-start !gap-1.5 !rounded-full !px-2.5 !text-[11px] [&_svg]:!size-4"
                        onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                        onOpenChange={onImageSettingsOpenChange}
                        fixedSizeLabel={isPanorama ? "全景 2:1" : undefined}
                    />
                ) : mode === "video" ? (
                    <CanvasVideoSettingsPopover
                        config={config}
                        buttonClassName="!h-8 !min-w-0 !flex-1 !justify-start !gap-1.5 !rounded-full !px-2.5 !text-[11px] [&_svg]:!size-4"
                        onConfigChange={(key, value) => onConfigChange(node.id, canvasVideoConfigPatch(key, value))}
                    />
                ) : mode === "audio" ? (
                    <CanvasAudioSettingsPopover
                        config={config}
                        buttonClassName="!h-8 !min-w-0 !flex-1 !justify-start !gap-1.5 !rounded-full !px-2.5 !text-[11px] [&_svg]:!size-4"
                        onConfigChange={(key, value) => onConfigChange(node.id, canvasAudioConfigPatch(key, value))}
                    />
                ) : null}
                {mode === "image" && !isPanorama ? (
                    <CanvasCameraControl
                        value={node.metadata?.cameraControl}
                        onChange={(cameraControl) => onConfigChange(node.id, { cameraControl })}
                        buttonClassName="!h-8 !min-w-0 !flex-1 !justify-start !gap-1.5 !rounded-full !px-2.5 !text-[11px] [&_svg]:!size-4"
                    />
                ) : null}
                {mode === "video" ? (
                    <CanvasCameraControl
                        value={node.metadata?.cameraControl}
                        onChange={(cameraControl) => onConfigChange(node.id, { cameraControl })}
                        buttonClassName="!h-8 !min-w-0 !flex-1 !justify-start !gap-1.5 !rounded-full !px-2.5 !text-[11px] [&_svg]:!size-4"
                    />
                ) : null}
                <span className="hidden items-center gap-0.5 text-[10px] opacity-65 sm:inline-flex">
                    <CreditSymbol />
                    {formatCreditAmount(credits)}
                </span>
                <Button
                    type="text"
                    className="!grid !size-9 !shrink-0 !place-items-center !rounded-full !p-0"
                    style={{ background: isRunning ? "rgba(239,68,68,.14)" : prompt.trim() ? theme.node.activeStroke : theme.toolbar.itemHover, color: isRunning ? "#ef4444" : prompt.trim() ? "#fff" : theme.node.muted }}
                    danger={isRunning}
                    disabled={!isRunning && !prompt.trim()}
                    onClick={() => (isRunning ? onStop(node.id) : submit())}
                    aria-label={isRunning ? "停止生成" : "生成"}
                >
                    {isRunning ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4.5" strokeWidth={2.4} />}
                </Button>
            </div>
            <Modal open={expanded} title="编辑提示词" footer={null} centered width={760} onCancel={() => setExpanded(false)} styles={{ body: { minHeight: 360, display: "flex", flexDirection: "column" } }}>
                {renderEditor(true)}
                <div className="mt-2 flex justify-end">
                    <Button
                        type="primary"
                        onClick={() => {
                            setExpanded(false);
                            submit();
                        }}
                        disabled={!prompt.trim() || isRunning}
                    >
                        <ArrowUp className="size-3" />
                        生成
                    </Button>
                </div>
            </Modal>
        </div>
    );
}

function GenerationModeIcon({ mode }: { mode: CanvasNodeGenerationMode }) {
    if (mode === "image") return <ImagePlus className="size-3" />;
    if (mode === "video") return <Video className="size-3" />;
    if (mode === "audio") return <Music2 className="size-3" />;
    return <FileText className="size-3" />;
}

function ReferenceThumbnail({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-full object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} muted preload="metadata" className="size-full bg-black object-cover" />;

    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-full place-items-center bg-black/10 text-current dark:bg-white/10">
            <Icon className="size-3.5 opacity-75" />
        </span>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    const model = node.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : globalConfig.model || defaultConfig.model);
    const config = buildCanvasNodeConfig(globalConfig, node, mode, model);
    return node.type === CanvasNodeType.Panorama ? { ...config, size: PANORAMA_IMAGE_SIZE } : config;
}

function modeDisplayName(mode: CanvasNodeGenerationMode) {
    return mode === "image" ? "图片" : mode === "video" ? "视频" : mode === "audio" ? "音频" : "文本";
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean, isPanorama: boolean) {
    if (mode === "video") return "描述要生成的视频内容，或引用首尾帧素材";
    if (mode === "audio") return "描述要生成的音频内容";
    if (isPanorama) return hasImageContent ? "描述如何调整这个全景环境" : "描述要生成的 360° 全景环境";
    if (mode === "image") return hasImageContent ? "描述要如何修改这张图" : "描述要生成的图片内容";
    return hasTextContent ? "描述要如何修改这段文本" : "描述要生成的文本内容";
}
