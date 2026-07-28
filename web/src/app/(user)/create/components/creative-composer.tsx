"use client";

import { Button, Input, Popover, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { ArrowUp, Boxes, Check, ChevronLeft, ChevronRight, FileAudio, FileVideo, ImageIcon, Lightbulb, LoaderCircle, Orbit, Paperclip, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEventHandler, type PointerEventHandler, type RefObject, type WheelEvent } from "react";

import type { CreativeAsset } from "@/lib/creative-runtime-contract";
import { clipboardImageFiles } from "@/lib/clipboard-image-files";
import { cn } from "@/lib/utils";

type SkillOption = {
    id: string;
    name: string;
    description: string;
    action?: "generate" | "edit";
    workspaces?: Array<"image" | "video" | "canvas" | "drama">;
};
type ModelOption = { id: string; name: string; capability: "image" | "video" | "audio" };
type ModelCapability = ModelOption["capability"];
type SkillCategory = "all" | "image" | "video" | "canvas" | "drama" | "edit";

export function CreativeComposer({
    inputRef,
    value,
    busy,
    onChange,
    onSubmit,
    onCancel,
    onAttachment,
    onPasteImages,
    attachments,
    skills,
    skillsLoading,
    selectedSkill,
    models,
    selectedModels,
    smartPlanning,
    uploading,
    onRemoveAttachment,
    onSelectSkill,
    onRemoveSkill,
    onToggleModel,
    onClearModels,
    onToggleSmartPlanning,
    centered = false,
}: {
    inputRef: RefObject<TextAreaRef | null>;
    value: string;
    busy: boolean;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
    onAttachment: () => void;
    onPasteImages: (files: File[]) => void;
    attachments: CreativeAsset[];
    skills: SkillOption[];
    skillsLoading: boolean;
    selectedSkill?: SkillOption;
    models: ModelOption[];
    selectedModels: ModelOption[];
    smartPlanning: boolean;
    uploading: boolean;
    onRemoveAttachment: (id: string) => void;
    onSelectSkill: (skill: SkillOption) => void;
    onRemoveSkill: () => void;
    onToggleModel: (model: ModelOption) => void;
    onClearModels: () => void;
    onToggleSmartPlanning: () => void;
    centered?: boolean;
}) {
    const [skillPickerOpen, setSkillPickerOpen] = useState(false);
    const [skillCategory, setSkillCategory] = useState<SkillCategory>("all");
    const { scrollRef: skillCategoryScrollRef, dragScrollProps: skillCategoryDragScrollProps } = useHorizontalMouseDragScroll<HTMLDivElement>();
    const [modelPickerOpen, setModelPickerOpen] = useState(false);
    const [modelCategory, setModelCategory] = useState<ModelCapability>("image");
    const selectedModelCapability = selectedModels[0]?.capability;

    useEffect(() => {
        if (selectedModelCapability) setModelCategory(selectedModelCapability);
    }, [selectedModelCapability]);

    const skillCategories = skillCategoryOptions(skills);
    const visibleSkills = skills.filter((skill) => matchesSkillCategory(skill, skillCategory));

    return (
        <div className={cn("mx-auto w-full", centered ? "max-w-[960px]" : "max-w-[1120px] px-3 pb-3 sm:px-6 sm:pb-5")}>
            <div className="creative-composer rounded-[14px] border border-[#dde2e7] bg-white p-2 shadow-[0_14px_38px_rgba(32,36,42,0.09)] dark:border-[#30363e] dark:bg-[#181b20] dark:shadow-black/30">
                {selectedSkill || attachments.length || uploading ? (
                    <div className="flex gap-2 overflow-x-auto px-2 pb-1 pt-1">
                        {selectedSkill ? (
                            <span className="flex h-9 max-w-60 shrink-0 items-center gap-2 rounded-lg border border-[#d6dee8] bg-[#f1f4f8] px-2.5 text-xs font-medium text-[#344152] shadow-[0_2px_8px_rgba(38,49,65,0.07)] dark:border-[#3b4653] dark:bg-[#252b33] dark:text-[#edf1f5] dark:shadow-black/20">
                                <span className="grid size-5 shrink-0 place-items-center rounded-md bg-[#d3a44f]/16 text-[#95681d] dark:bg-[#e4bb70]/14 dark:text-[#e4bb70]">
                                    <Sparkles className="size-3.5" />
                                </span>
                                <span className="truncate">Skill · {selectedSkill.name}</span>
                                <button
                                    type="button"
                                    className="grid size-5 shrink-0 place-items-center rounded-md text-[#7c8795] transition hover:bg-[#dfe5ec] hover:text-[#263141] dark:text-[#aab3bf] dark:hover:bg-[#343c46] dark:hover:text-white"
                                    onClick={onRemoveSkill}
                                    aria-label={`移除 Skill ${selectedSkill.name}`}
                                    title="移除 Skill"
                                >
                                    <X className="size-3" />
                                </button>
                            </span>
                        ) : null}
                        {attachments.map((asset) => {
                            const Icon = asset.type === "image" ? ImageIcon : asset.type === "video" ? FileVideo : FileAudio;
                            return (
                                <span key={asset.id} className="flex h-9 max-w-52 shrink-0 items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                                    <Icon className="size-3.5 shrink-0" />
                                    <span className="truncate">{asset.title}</span>
                                    <button
                                        type="button"
                                        className="grid size-5 shrink-0 place-items-center rounded text-stone-400 hover:bg-stone-200 hover:text-stone-800 dark:hover:bg-stone-700 dark:hover:text-white"
                                        onClick={() => onRemoveAttachment(asset.id)}
                                        aria-label={`移除${asset.title}`}
                                    >
                                        <X className="size-3" />
                                    </button>
                                </span>
                            );
                        })}
                        {uploading ? (
                            <span className="flex h-9 shrink-0 items-center gap-2 px-2 text-xs text-stone-500 dark:text-stone-400">
                                <LoaderCircle className="size-3.5 animate-spin" /> 上传中
                            </span>
                        ) : null}
                    </div>
                ) : null}
                <Input.TextArea
                    ref={inputRef}
                    value={value}
                    maxLength={4000}
                    autoSize={{ minRows: centered ? 3 : 2, maxRows: 8 }}
                    variant="borderless"
                    className="creative-composer-input !border-0 !bg-transparent !px-3 !py-2 !text-[15px] !leading-7 !shadow-none !outline-none"
                    placeholder="描述你的想法，或添加参考素材"
                    onChange={(event) => onChange(event.target.value)}
                    onPaste={(event) => {
                        const files = clipboardImageFiles(event.clipboardData);
                        if (!files.length) return;
                        event.preventDefault();
                        onPasteImages(files);
                    }}
                    onPressEnter={(event) => {
                        if (event.shiftKey) return;
                        event.preventDefault();
                        if (!busy) onSubmit();
                    }}
                />
                <div className="flex items-center gap-2 px-1 pb-1">
                    <Tooltip title="添加素材">
                        <Button type="text" shape="circle" className="!size-9 !min-w-9" icon={<Paperclip className="size-4" />} onClick={onAttachment} loading={uploading} aria-label="添加素材" />
                    </Tooltip>
                    <Popover
                        trigger="click"
                        placement="topLeft"
                        open={skillPickerOpen}
                        onOpenChange={setSkillPickerOpen}
                        content={
                            <div className="w-[calc(100vw-56px)] max-w-[300px] py-1 sm:w-80 sm:max-w-none">
                                <p className="px-2 pb-2 text-sm font-semibold text-[#20242a] dark:text-[#f3f5f7]">选择创作 Skill</p>
                                {skillsLoading ? <p className="px-2 py-3 text-xs text-[#8b949f] dark:text-[#7f8996]">正在加载...</p> : null}
                                {!skillsLoading && !skills.length ? <p className="px-2 py-3 text-xs text-[#8b949f] dark:text-[#7f8996]">暂无可用 Skill</p> : null}
                                {skills.length ? (
                                    <div className="mb-2 grid grid-cols-[28px_minmax(0,1fr)_28px] items-center gap-1">
                                        <button
                                            type="button"
                                            className="grid size-7 place-items-center rounded-md text-[#7c8794] transition hover:bg-[#eef1f4] hover:text-[#20242a] disabled:cursor-default disabled:opacity-30 dark:text-[#929ca8] dark:hover:bg-[#292f37] dark:hover:text-white"
                                            onClick={() => skillCategoryScrollRef.current?.scrollBy({ left: -180, behavior: "smooth" })}
                                            aria-label="向左查看更多 Skill 分类"
                                        >
                                            <ChevronLeft className="size-4" />
                                        </button>
                                        <div
                                            ref={skillCategoryScrollRef}
                                            className="hide-scrollbar flex min-w-0 cursor-grab snap-x gap-1.5 overflow-x-auto overscroll-x-contain px-0.5 [touch-action:pan-x] active:cursor-grabbing"
                                            onWheel={scrollHorizontalCategories}
                                            {...skillCategoryDragScrollProps}
                                            role="tablist"
                                            aria-label="Skill 分类，可左右滑动查看更多"
                                        >
                                            {skillCategories.map((category) => (
                                                <button
                                                    key={category.id}
                                                    type="button"
                                                    role="tab"
                                                    aria-selected={skillCategory === category.id}
                                                    className={cn(
                                                        "h-8 min-w-[72px] shrink-0 snap-start whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition",
                                                        skillCategory === category.id
                                                            ? "border-[#c9d7e2] bg-[#edf3f7] text-[#315d78] dark:border-[#466175] dark:bg-[#273742] dark:text-[#a8c8dc]"
                                                            : "border-[#e0e4e8] bg-white text-[#66717e] hover:border-[#cbd2d9] hover:bg-[#f5f7f8] hover:text-[#20242a] dark:border-[#343a42] dark:bg-[#1d2127] dark:text-[#a3acb7] dark:hover:border-[#49515b] dark:hover:bg-[#292f37] dark:hover:text-white",
                                                    )}
                                                    onClick={() => setSkillCategory(category.id)}
                                                >
                                                    {category.label} · {category.count}
                                                </button>
                                            ))}
                                        </div>
                                        <button
                                            type="button"
                                            className="grid size-7 place-items-center rounded-md text-[#7c8794] transition hover:bg-[#eef1f4] hover:text-[#20242a] dark:text-[#929ca8] dark:hover:bg-[#292f37] dark:hover:text-white"
                                            onClick={() => skillCategoryScrollRef.current?.scrollBy({ left: 180, behavior: "smooth" })}
                                            aria-label="向右查看更多 Skill 分类"
                                        >
                                            <ChevronRight className="size-4" />
                                        </button>
                                    </div>
                                ) : null}
                                <div className="relative">
                                    <div className="hide-scrollbar max-h-[142px] space-y-1 overflow-y-auto overscroll-contain [scrollbar-width:none] sm:max-h-[154px] [&::-webkit-scrollbar]:hidden">
                                        {!skillsLoading && skills.length && !visibleSkills.length ? <p className="px-2 py-5 text-center text-xs text-[#8b949f] dark:text-[#7f8996]">当前分类暂无可用 Skill</p> : null}
                                        {visibleSkills.map((skill) => {
                                            const selected = selectedSkill?.id === skill.id;
                                            const visual = skillOptionVisual(skill);
                                            const Icon = visual.icon;
                                            return (
                                                <button
                                                    key={skill.id}
                                                    type="button"
                                                    className={cn(
                                                        "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition",
                                                        selected ? "bg-[#eef1f4] text-[#20242a] dark:bg-[#292f37] dark:text-white" : "text-[#4d5662] hover:bg-[#f4f6f8] dark:text-[#c2c9d1] dark:hover:bg-[#242930]",
                                                    )}
                                                    onClick={() => {
                                                        onSelectSkill(skill);
                                                        setSkillPickerOpen(false);
                                                    }}
                                                >
                                                    <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg", visual.surfaceClass)}>
                                                        <Icon className={cn("size-3.5", visual.iconClass)} />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-xs font-medium">{skill.name}</span>
                                                        <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-[#8b949f] dark:text-[#7f8996]">{skill.description}</span>
                                                    </span>
                                                    {selected ? <Check className="mt-0.5 size-4 shrink-0" /> : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        }
                    >
                        <Button type="text" shape="circle" className={cn("!size-9 !min-w-9", selectedSkill && "!bg-[#eef1f4] !text-[#20242a] dark:!bg-[#292f37] dark:!text-white")} icon={<Boxes className="size-4" />} aria-label="选择创作 Skill" />
                    </Popover>
                    <span className="min-w-0 flex-1" />
                    <Tooltip title={smartPlanning ? "智能规划：已开启" : "智能规划：已关闭"}>
                        <Button
                            type="text"
                            shape="circle"
                            className={cn(
                                "!size-9 !min-w-9 transition-colors",
                                smartPlanning
                                    ? "!bg-[#e9f1f7] !text-[#386783] hover:!bg-[#dce9f2] hover:!text-[#274f69] dark:!bg-[#6f9fbd]/16 dark:!text-[#8eb8d1] dark:hover:!bg-[#6f9fbd]/24"
                                    : "!bg-transparent !text-[#8b949f] hover:!bg-[#eef1f4] hover:!text-[#20242a] dark:!text-[#77818d] dark:hover:!bg-[#292f37] dark:hover:!text-white",
                            )}
                            icon={<Lightbulb className="size-4" />}
                            aria-label={smartPlanning ? "智能规划已开启，点击关闭" : "智能规划已关闭，点击开启"}
                            aria-pressed={smartPlanning}
                            onClick={() => {
                                onToggleSmartPlanning();
                                if (smartPlanning) setModelPickerOpen(true);
                            }}
                        />
                    </Tooltip>
                    <Popover
                        trigger="click"
                        placement="topRight"
                        open={modelPickerOpen}
                        onOpenChange={setModelPickerOpen}
                        content={
                            <div className="w-[calc(100vw-56px)] max-w-[300px] py-1 sm:w-80 sm:max-w-none">
                                <div className="flex items-center justify-between gap-3 px-2 pb-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-[#20242a] dark:text-[#f3f5f7]">生成模型</p>
                                        <p className="mt-0.5 truncate text-[11px] text-[#8b949f] dark:text-[#7f8996]">{selectedModels.length ? `已选择 ${selectedModels.length} 个模型` : "默认由智能规划自动匹配"}</p>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={smartPlanning}
                                        aria-label={smartPlanning ? "关闭自动智能规划" : "开启自动智能规划"}
                                        className={cn(
                                            "flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 text-xs font-medium transition-colors",
                                            smartPlanning ? "bg-[#edf4f9] text-[#315f7d] dark:bg-[#6f9fbd]/12 dark:text-[#8eb8d1]" : "text-[#7f8995] hover:bg-[#f2f4f6] dark:text-[#8b95a1] dark:hover:bg-[#292f37]",
                                        )}
                                        onClick={onToggleSmartPlanning}
                                    >
                                        <span>{smartPlanning ? "已开启" : "已关闭"}</span>
                                        <span
                                            className={cn(
                                                "relative h-5 w-9 rounded-full border transition-colors",
                                                smartPlanning ? "border-[#4f7f9d] bg-[#4f7f9d] dark:border-[#78a8c5] dark:bg-[#78a8c5]" : "border-[#cbd2da] bg-[#dfe3e8] dark:border-[#505966] dark:bg-[#3a414a]",
                                            )}
                                        >
                                            <span className={cn("absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform dark:bg-[#20242a]", smartPlanning && "translate-x-4")} />
                                        </span>
                                    </button>
                                </div>
                                <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#eef1f4] p-1 dark:bg-[#252a31]">
                                    {(["image", "video", "audio"] as const).map((capability) => {
                                        const label = capabilityLabel(capability);
                                        const count = models.filter((model) => model.capability === capability).length;
                                        return (
                                            <button
                                                key={capability}
                                                type="button"
                                                className={cn(
                                                    "h-8 rounded-md text-xs font-medium transition",
                                                    modelCategory === capability ? "bg-white text-[#20242a] shadow-sm dark:bg-[#343b44] dark:text-white" : "text-[#7b8591] hover:text-[#20242a] dark:text-[#8f99a5] dark:hover:text-white",
                                                )}
                                                onClick={() => setModelCategory(capability)}
                                            >
                                                {label} {count ? `· ${count}` : ""}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="hide-scrollbar mt-2 max-h-52 space-y-1 overflow-y-auto sm:max-h-64">
                                    {!models.some((model) => model.capability === modelCategory) ? <p className="px-2 py-5 text-center text-xs text-[#8b949f] dark:text-[#7f8996]">当前未配置可用的{capabilityLabel(modelCategory)}模型</p> : null}
                                    {models
                                        .filter((model) => model.capability === modelCategory)
                                        .map((model) => {
                                            const selected = selectedModels.some((item) => item.id === model.id);
                                            return (
                                                <button
                                                    key={model.id}
                                                    type="button"
                                                    className={cn(
                                                        "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition",
                                                        selected ? "bg-[#eef1f4] text-[#20242a] dark:bg-[#292f37] dark:text-white" : "text-[#4d5662] hover:bg-[#f4f6f8] dark:text-[#c2c9d1] dark:hover:bg-[#242930]",
                                                    )}
                                                    onClick={() => onToggleModel(model)}
                                                >
                                                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-white text-[#465365] shadow-sm dark:bg-[#343b44] dark:text-[#e6eaf0]">
                                                        <ModelPlatformIcon model={model} />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-xs font-medium">{model.name}</span>
                                                        <span className="mt-0.5 block text-[11px] leading-4 text-[#8b949f] dark:text-[#7f8996]">{capabilityLabel(model.capability)}模型 · 可与其他模型同时生成</span>
                                                    </span>
                                                    <span
                                                        className={cn(
                                                            "mt-0.5 grid size-4 shrink-0 place-items-center rounded border",
                                                            selected ? "border-[#20242a] bg-[#20242a] text-white dark:border-white dark:bg-white dark:text-[#20242a]" : "border-[#cbd2da] text-transparent dark:border-[#505966]",
                                                        )}
                                                    >
                                                        <Check className="size-3" />
                                                    </span>
                                                </button>
                                            );
                                        })}
                                </div>
                                {!smartPlanning && selectedModels.length ? (
                                    <button
                                        type="button"
                                        className="mt-2 w-full rounded-lg px-2 py-2 text-xs font-medium text-[#6d7784] transition hover:bg-[#f3f5f7] hover:text-[#20242a] dark:text-[#98a2ae] dark:hover:bg-[#252a31] dark:hover:text-white"
                                        onClick={onClearModels}
                                    >
                                        清除选择并恢复智能规划
                                    </button>
                                ) : null}
                            </div>
                        }
                    >
                        <Button
                            type="text"
                            shape="circle"
                            className={cn("relative !size-9 !min-w-9 !text-[#6f7b89] dark:!text-[#96a0ac]", selectedModels.length && "!bg-[#eef1f4] !text-[#20242a] dark:!bg-[#292f37] dark:!text-white")}
                            icon={<Orbit className="size-4" />}
                            aria-label="选择生成模型"
                            title={selectedModels.length ? `已选择 ${selectedModels.length} 个模型` : "选择生成模型"}
                        >
                            {selectedModels.length ? (
                                <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-[#20242a] text-[9px] font-semibold text-white dark:bg-white dark:text-[#20242a]">{selectedModels.length}</span>
                            ) : null}
                        </Button>
                    </Popover>
                    <Tooltip title={busy ? "停止生成" : "发送"}>
                        <Button
                            type="primary"
                            shape="circle"
                            className="!size-9 !min-w-9"
                            icon={busy ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
                            disabled={!busy && !value.trim()}
                            onClick={busy ? onCancel : onSubmit}
                            aria-label={busy ? "停止生成" : "发送"}
                        />
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function capabilityLabel(capability: ModelCapability) {
    return capability === "image" ? "图片" : capability === "video" ? "视频" : "音频";
}

function scrollHorizontalCategories(event: WheelEvent<HTMLDivElement>) {
    if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    event.preventDefault();
    event.currentTarget.scrollLeft += event.deltaY;
}

function useHorizontalMouseDragScroll<T extends HTMLElement>() {
    const scrollRef = useRef<T>(null);
    const dragRef = useRef({ pointerId: -1, startX: 0, startScrollLeft: 0, moved: false });
    const suppressClickRef = useRef(false);

    const onPointerDown: PointerEventHandler<T> = (event) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScrollLeft: event.currentTarget.scrollLeft, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onPointerMove: PointerEventHandler<T> = (event) => {
        const drag = dragRef.current;
        if (drag.pointerId !== event.pointerId) return;
        const distance = event.clientX - drag.startX;
        if (!drag.moved && Math.abs(distance) < 4) return;
        drag.moved = true;
        event.preventDefault();
        event.currentTarget.scrollLeft = drag.startScrollLeft - distance;
    };

    const finishDrag: PointerEventHandler<T> = (event) => {
        const drag = dragRef.current;
        if (drag.pointerId !== event.pointerId) return;
        if (drag.moved) {
            suppressClickRef.current = true;
            window.setTimeout(() => {
                suppressClickRef.current = false;
            }, 0);
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current.pointerId = -1;
    };

    const onClickCapture: MouseEventHandler<T> = (event) => {
        if (!suppressClickRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClickRef.current = false;
    };

    return {
        scrollRef,
        dragScrollProps: { onPointerDown, onPointerMove, onPointerUp: finishDrag, onPointerCancel: finishDrag, onClickCapture },
    };
}

function skillCategoryOptions(skills: SkillOption[]) {
    const categories: Array<{ id: SkillCategory; label: string }> = [
        { id: "all", label: "全部" },
        { id: "image", label: "图片" },
        { id: "video", label: "视频" },
        { id: "canvas", label: "画布" },
        { id: "drama", label: "短剧" },
        { id: "edit", label: "编辑" },
    ];
    return categories.map((category) => ({ ...category, count: skills.filter((skill) => matchesSkillCategory(skill, category.id)).length })).filter((category) => category.id === "all" || category.count > 0);
}

function matchesSkillCategory(skill: SkillOption, category: SkillCategory) {
    if (category === "all") return true;
    if (category === "edit") return skill.action === "edit";
    return skill.workspaces?.includes(category) === true;
}

function skillOptionVisual(skill: SkillOption) {
    if (skill.action === "edit") return { icon: Sparkles, surfaceClass: "bg-violet-50 dark:bg-violet-400/10", iconClass: "text-violet-600 dark:text-violet-300" };
    if (skill.workspaces?.includes("video")) return { icon: FileVideo, surfaceClass: "bg-emerald-50 dark:bg-emerald-400/10", iconClass: "text-emerald-600 dark:text-emerald-300" };
    if (skill.workspaces?.includes("image")) return { icon: ImageIcon, surfaceClass: "bg-sky-50 dark:bg-sky-400/10", iconClass: "text-sky-600 dark:text-sky-300" };
    return { icon: Boxes, surfaceClass: "bg-slate-100 dark:bg-slate-400/10", iconClass: "text-slate-600 dark:text-slate-300" };
}

function ModelPlatformIcon({ model }: { model: ModelOption }) {
    const identity = `${model.id} ${model.name}`.toLowerCase();
    if (/gemini|veo|imagen/.test(identity))
        return (
            <BrandIcon path="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
        );
    if (/seedance|doubao|bytedance/.test(identity))
        return <BrandIcon path="M19.8772 1.4685L24 2.5326v18.9426l-4.1228 1.0563V1.4685zm-13.3481 9.428l4.115 1.0641v8.9786l-4.115 1.0642v-11.107zM0 2.572l4.115 1.0642v16.7354L0 21.428V2.572zm17.4553 5.6205v11.107l-4.1228-1.0642V9.2568l4.1228-1.0642z" />;
    if (/wan|qwen|tongyi/.test(identity))
        return (
            <BrandIcon path="M3.996 4.517h5.291L8.01 6.324 4.153 7.506a1.668 1.668 0 0 0-1.165 1.601v5.786a1.668 1.668 0 0 0 1.165 1.6l3.857 1.183 1.277 1.807H3.996A3.996 3.996 0 0 1 0 15.487V8.513a3.996 3.996 0 0 1 3.996-3.996m16.008 0h-5.291l1.277 1.807 3.857 1.182c.715.227 1.17.889 1.165 1.601v5.786a1.668 1.668 0 0 1-1.165 1.6l-3.857 1.183-1.277 1.807h5.291A3.996 3.996 0 0 0 24 15.487V8.513a3.996 3.996 0 0 0-3.996-3.996m-4.007 8.345H8.002v-1.804h7.995Z" />
        );
    if (/kling|kuaishou/.test(identity))
        return (
            <BrandIcon path="M18.315 12.264c2.33 0 4.218 1.88 4.218 4.2V19.8c0 2.32-1.888 4.2-4.218 4.2h-6.202a4.218 4.218 0 0 1-4.023-2.938l-3.676 1.833a2.04 2.04 0 0 1-2.731-.903 2.015 2.015 0 0 1-.216-.907v-5.94a2.03 2.03 0 0 1 2.035-2.024 2.044 2.044 0 0 1 .919.218l3.673 1.85a4.218 4.218 0 0 1 4.02-2.925zm-.062 2.162h-6.078c-1.153 0-2.09.921-2.108 2.065v3.247c0 1.148.925 2.081 2.073 2.1h6.113c1.153 0 2.09-.922 2.109-2.065v-3.247a2.104 2.104 0 0 0-2.074-2.1zM4.18 15.72a.554.554 0 0 0-.555.542v3.734a.556.556 0 0 0 .798.496l.01-.004 3.463-1.756V17.51l-3.467-1.73a.557.557 0 0 0-.249-.06zM9.28 0a5.667 5.667 0 0 1 4.98 2.965 4.921 4.921 0 0 1 3.36-1.317c2.714 0 4.913 2.177 4.913 4.863 0 2.686-2.2 4.863-4.912 4.863a4.921 4.921 0 0 1-3.996-2.034 5.651 5.651 0 0 1-4.345 2.034c-3.131 0-5.67-2.546-5.67-5.687C3.61 2.546 6.149 0 9.28 0Zm8.34 3.926c-1.441 0-2.61 1.157-2.61 2.585s1.169 2.585 2.61 2.585c1.443 0 2.612-1.157 2.612-2.585s-1.169-2.585-2.611-2.585zM9.28 2.287a3.395 3.395 0 0 0-3.39 3.4c0 1.877 1.518 3.4 3.39 3.4a3.395 3.395 0 0 0 3.39-3.4c0-1.878-1.518-3.4-3.39-3.4z" />
        );
    return <Orbit className="size-3.5" />;
}

function BrandIcon({ path }: { path: string }) {
    return (
        <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true">
            <path d={path} />
        </svg>
    );
}
