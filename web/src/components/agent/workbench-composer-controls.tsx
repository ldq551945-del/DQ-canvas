"use client";

import { Button, Input } from "antd";
import { ArrowLeft, ArrowRight, BookOpen, Check, FolderPlus } from "lucide-react";
import type { ClipboardEvent, KeyboardEvent } from "react";

import { clipboardImageFiles } from "@/lib/clipboard-image-files";

export function WorkbenchModelMenu({ options, value, emptyText, onChange, onMissingConfig }: { options: Array<{ value: string; label: string }>; value: string; emptyText: string; onChange: (value: string) => void; onMissingConfig: () => void }) {
    return (
        <div className="workbench-model-menu space-y-1">
            {options.map((option) => (
                <button key={option.value} type="button" className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-800" onClick={() => onChange(option.value)}>
                    <span className="truncate">{option.label}</span>
                    {option.value === value ? <Check className="size-4" /> : null}
                </button>
            ))}
            {!options.length ? (
                <button type="button" className="w-full rounded-lg px-3 py-3 text-left text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" onClick={onMissingConfig}>
                    {emptyText}
                </button>
            ) : null}
        </div>
    );
}

export function WorkbenchPromptEditor({
    value,
    placeholder,
    onChange,
    onSubmit,
    onPasteFiles,
    onOpenPrompts,
    onOpenAssets,
}: {
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onPasteFiles: (files: File[]) => void;
    onOpenPrompts: () => void;
    onOpenAssets: () => void;
}) {
    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        onSubmit();
    };
    const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const files = clipboardImageFiles(event.clipboardData);
        if (!files.length) return;
        event.preventDefault();
        onPasteFiles(files);
    };
    return (
        <div className="workbench-prompt-editor order-2">
            <div className="mb-2 flex items-center justify-between gap-3">
                <span className="sr-only">提示词</span>
                <div className="flex gap-2">
                    <Button className="workbench-prompt-action" size="small" icon={<BookOpen className="size-3.5" />} onClick={onOpenPrompts}>
                        查看提示词库
                    </Button>
                    <Button className="workbench-prompt-action" size="small" icon={<FolderPlus className="size-3.5" />} onClick={onOpenAssets}>
                        查看我的素材
                    </Button>
                </div>
            </div>
            <Input.TextArea
                className="workbench-prompt-textarea"
                variant="borderless"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                autoSize={{ minRows: 3, maxRows: 6 }}
                placeholder={placeholder}
            />
        </div>
    );
}

export function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

export function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button
                size="small"
                className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !text-stone-900 !shadow-sm disabled:!text-stone-400 dark:!text-stone-900"
                icon={<ArrowLeft className="size-3" />}
                disabled={index <= 0}
                onClick={() => onMove(-1)}
            />
            <Button
                size="small"
                className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !text-stone-900 !shadow-sm disabled:!text-stone-400 dark:!text-stone-900"
                icon={<ArrowRight className="size-3" />}
                disabled={index >= total - 1}
                onClick={() => onMove(1)}
            />
        </div>
    );
}
