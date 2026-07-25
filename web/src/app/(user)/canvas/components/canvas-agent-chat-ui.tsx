"use client";

import { useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { ArrowUp, Check, CheckCircle2, Circle, CircleAlert, Crosshair, ImagePlus, LoaderCircle, Pause, RotateCcw, Wrench, X, XCircle } from "lucide-react";

import { AgentMessageActions } from "@/components/agent/agent-message-actions";
import { AgentMediaPreview } from "@/components/agent/agent-media-preview";
import { SiteLogo } from "@/components/layout/site-logo";
import { canvasThemes } from "@/lib/canvas-theme";
import { clipboardImageFiles } from "@/lib/clipboard-image-files";
import { droppedFiles, leftDropTarget, preventFileDragEvent } from "@/lib/file-drop";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { userAvatarFallback } from "@/lib/user-avatar";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import type { LocalUser } from "@/stores/use-user-store";
import { canvasAgentProgressSteps, type CanvasAgentRunStage } from "./canvas-agent-progress";

type CanvasAgentChatAttachment = { id: string; name: string; url: string };
export type CanvasAgentChatMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    attachments?: CanvasAgentChatAttachment[];
};

export function AgentChatMessage({
    item,
    theme,
    user,
    onRejectTool,
    onApproveTool,
    onLocateNode,
    onRetryTask,
    onEditMessage,
}: {
    item: CanvasAgentChatMessage;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    user: LocalUser | null;
    onRejectTool?: (id: string) => void;
    onApproveTool?: (id: string) => void;
    onLocateNode?: (nodeId: string) => void;
    onRetryTask?: (runId: string, taskId: string) => void;
    onEditMessage?: (text: string) => void;
}) {
    const isUser = item.role === "user";
    const isSystem = item.role === "system";
    const color = item.role === "error" ? "#dc2626" : item.role === "tool" ? "#2563eb" : theme.node.text;
    if (isSystem) {
        return (
            <div className="flex justify-center text-xs">
                <div className="max-w-[88%] px-3 py-1.5 text-center" style={{ color: theme.node.muted }}>
                    {item.text}
                    {item.meta ? <span className="ml-2 opacity-60">{item.meta}</span> : null}
                </div>
            </div>
        );
    }
    if (item.role === "tool") {
        if (objectField(item.detail, "status") === "pending") return <AgentPendingToolCard summary={item.text} detail={item.detail} theme={theme} onReject={() => onRejectTool?.(item.id)} onApprove={() => onApproveTool?.(item.id)} />;
        return (
            <div className="flex items-start gap-3">
                <AgentAvatar theme={theme} />
                <AgentToolCard title={item.title || "工具调用"} text={item.text} detail={item.detail} theme={theme} />
            </div>
        );
    }
    return (
        <div className={`canvas-agent-message group/message flex min-w-0 items-start gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
            {!isUser ? <AgentAvatar theme={theme} /> : null}
            <div className={`min-w-0 max-w-[82%] text-sm leading-6 ${isUser ? "text-right" : "text-left"}`} style={{ color }}>
                <div className="whitespace-pre-wrap break-words text-left">{item.text}</div>
                {!isUser && objectStringArray(item.detail, "nodeIds").length && objectField(item.detail, "taskType") !== "text" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                        {objectStringArray(item.detail, "nodeIds").map((nodeId, index, nodeIds) => (
                            <button key={nodeId} type="button" className="inline-flex items-center gap-1.5 text-xs font-medium opacity-65 transition hover:opacity-100" onClick={() => onLocateNode?.(nodeId)}>
                                <Crosshair className="size-3.5" />
                                {nodeIds.length > 1 ? `定位结果 ${index + 1}` : "定位到画布结果"}
                            </button>
                        ))}
                    </div>
                ) : null}
                {!isUser && objectField(item.detail, "runId") && objectField(item.detail, "taskId") ? (
                    <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-red-600 transition hover:opacity-70"
                        onClick={() => onRetryTask?.(String(objectField(item.detail, "runId")), String(objectField(item.detail, "taskId")))}
                    >
                        <RotateCcw className="size-3.5" />
                        只重试此任务
                    </button>
                ) : null}
                {item.attachments?.length ? <AgentMessageAttachments attachments={item.attachments} /> : null}
                {item.meta ? <div className="mt-1 text-[11px] opacity-45">{item.meta}</div> : null}
                <AgentMessageActions
                    text={item.text}
                    downloads={item.attachments?.map((attachment) => ({ type: "image", url: attachment.url, title: attachment.name }))}
                    onEdit={isUser && onEditMessage ? onEditMessage : undefined}
                    align={isUser ? "end" : "start"}
                    className="text-current"
                    style={{ color: theme.node.muted }}
                />
            </div>
            {isUser ? <AgentUserAvatar user={user} theme={theme} /> : null}
        </div>
    );
}

function AgentPendingToolCard({ summary, detail, theme, onReject, onApprove }: { summary: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onReject?: () => void; onApprove?: () => void }) {
    return (
        <div className="flex items-start gap-3">
            <AgentAvatar theme={theme} />
            <div className="min-w-0 flex-1 rounded-xl border p-4" style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text }}>
                <details>
                    <summary className="cursor-pointer list-none">
                        <div className="flex items-start gap-3">
                            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border" style={{ borderColor: "rgba(217,119,6,.24)", color: "#d97706", background: "rgba(217,119,6,.04)" }}>
                                <CircleAlert className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-5">
                                    <span>确认工具调用</span>
                                    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{ borderColor: "rgba(217,119,6,.22)", color: "#d97706", background: "rgba(217,119,6,.04)" }}>
                                        等待确认
                                    </span>
                                    {detail ? (
                                        <span className="ml-auto text-xs font-normal" style={{ color: theme.node.muted }}>
                                            详情
                                        </span>
                                    ) : null}
                                </div>
                                <div className="mt-2 text-sm leading-6" style={{ color: theme.node.text }}>
                                    {summary}
                                </div>
                            </div>
                        </div>
                    </summary>
                    {detail ? <AgentDetailBlock detail={detail} theme={theme} /> : null}
                </details>
                {onReject || onApprove ? (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                        <Button danger className="!h-9" icon={<XCircle className="size-4" />} onClick={() => onReject?.()}>
                            拒绝执行
                        </Button>
                        <Button className="!h-9" icon={<CheckCircle2 className="size-4" />} style={{ borderColor: "rgba(22,163,74,.42)", color: "#16a34a", background: "transparent" }} onClick={() => onApprove?.()}>
                            批准执行
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function AgentToolCard({ title, text, detail, theme }: { title: string; text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const state = toolCardState(title, text, detail);
    return (
        <details className="min-w-0 flex-1 rounded-xl border px-4 py-3.5 text-left" style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text }}>
            <summary className="cursor-pointer list-none">
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border" style={{ borderColor: state.softBorder, color: state.color, background: state.softBg }}>
                        {state.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-5">
                            <span className="min-w-0 truncate">{title}</span>
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{ borderColor: state.softBorder, color: state.color, background: state.softBg }}>
                                {state.label}
                            </span>
                            {detail ? (
                                <span className="ml-auto text-xs font-normal" style={{ color: theme.node.muted }}>
                                    详情
                                </span>
                            ) : null}
                        </div>
                        <div className="mt-2 text-sm leading-6" style={{ color: state.isError ? state.color : theme.node.muted }}>
                            {text}
                        </div>
                    </div>
                </div>
            </summary>
            {detail ? <AgentDetailBlock detail={detail} theme={theme} /> : null}
        </details>
    );
}

export function AgentWorkingMessage({ theme, stage }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; stage: CanvasAgentRunStage }) {
    const steps = canvasAgentProgressSteps(stage);
    return (
        <div className="flex items-start gap-3" aria-live="polite">
            <AgentAvatar theme={theme} />
            <div className="min-w-0 w-[340px] max-w-[86%] rounded-xl border p-4" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                <div className="text-sm font-semibold">{stage.text}</div>
                <div className="mt-3 space-y-2">
                    {steps.map((step) => (
                        <div key={step.key} className="flex items-center gap-2 text-xs" style={{ color: step.status === "pending" ? theme.node.muted : theme.node.text, opacity: step.status === "pending" ? 0.58 : 1 }}>
                            {step.status === "completed" ? <Check className="size-3.5 shrink-0 text-emerald-500" /> : null}
                            {step.status === "running" ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-sky-500" /> : null}
                            {step.status === "paused" ? <Pause className="size-3.5 shrink-0 text-amber-500" /> : null}
                            {step.status === "pending" ? <Circle className="size-3.5 shrink-0" /> : null}
                            <span>{step.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function AgentChatComposer({
    prompt,
    attachments = [],
    disabled,
    sending,
    placeholder,
    theme,
    onPromptChange,
    onSubmit,
    onAddFiles,
    onRemoveAttachment,
    beforeInput,
    left,
}: {
    prompt: string;
    attachments?: CanvasAgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    placeholder: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
    onRemoveAttachment?: (id: string) => void;
    beforeInput?: ReactNode;
    left?: ReactNode;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragActive, setIsDragActive] = useState(false);
    const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length);
    const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!onAddFiles || sending || !preventFileDragEvent(event)) return;
        setIsDragActive(true);
    };
    const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!onAddFiles || !preventFileDragEvent(event) || !leftDropTarget(event)) return;
        setIsDragActive(false);
    };
    const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!onAddFiles || sending || !preventFileDragEvent(event)) return;
        setIsDragActive(false);
        const images = droppedFiles(event, (file) => file.type.startsWith("image/"));
        if (!images.length) return;
        void onAddFiles(images);
    };
    return (
        <div className="px-2 pb-2 pt-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div
                className="rounded-[24px] border px-3 pb-3 pt-3 shadow-lg transition"
                style={{ background: theme.toolbar.panel, borderColor: isDragActive ? "#22d3ee" : theme.node.stroke }}
                onDragEnter={handleDragOver}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {attachments.length ? (
                    <div className="thin-scrollbar mb-2 flex gap-2 overflow-x-auto pb-1">
                        {attachments.map((item) => (
                            <div key={item.id} className="group relative size-14 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }} title={item.name}>
                                <img src={imagePreviewUrl(item.url, 256)} alt={item.name} className="size-full object-cover" />
                                {onRemoveAttachment ? (
                                    <button
                                        type="button"
                                        className="absolute right-1 top-1 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition group-hover:opacity-100"
                                        style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                                        onClick={() => onRemoveAttachment(item.id)}
                                        aria-label="移除图片"
                                    >
                                        <X className="size-3" />
                                    </button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : null}
                {beforeInput}
                <textarea
                    value={prompt}
                    onChange={(event) => onPromptChange(event.target.value)}
                    onPaste={(event) => {
                        if (!onAddFiles) return;
                        const images = clipboardImageFiles(event.clipboardData);
                        if (!images.length) return;
                        event.preventDefault();
                        void onAddFiles(images);
                    }}
                    onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey) return;
                        event.preventDefault();
                        void onSubmit();
                    }}
                    className="thin-scrollbar max-h-32 min-h-20 w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:opacity-45"
                    style={{ color: theme.node.text }}
                    placeholder={placeholder}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1">
                        {onAddFiles ? (
                            <>
                                <input
                                    ref={fileInputRef}
                                    hidden
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={(event) => {
                                        void onAddFiles(event.target.files);
                                        event.target.value = "";
                                    }}
                                />
                                <Tooltip title="上传图片">
                                    <Button type="text" shape="circle" className="!h-9 !w-9 !min-w-9" disabled={sending} style={{ color: theme.node.muted }} icon={<ImagePlus className="size-4" />} onClick={() => fileInputRef.current?.click()} />
                                </Tooltip>
                            </>
                        ) : null}
                        {left}
                    </div>
                    <Button
                        type="primary"
                        shape="circle"
                        className="!h-10 !w-10 !min-w-10"
                        disabled={!canSubmit}
                        icon={sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                        onClick={() => void onSubmit()}
                        aria-label="发送"
                    />
                </div>
            </div>
        </div>
    );
}

export function AgentPanelTabs<T extends string>({
    value,
    items,
    theme,
    right,
    onChange,
}: {
    value: T;
    items: { value: T; label: string; icon?: ReactNode; count?: number }[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    right?: ReactNode;
    onChange: (value: T) => void;
}) {
    return (
        <div className="border-b px-3" style={{ borderColor: theme.node.stroke }}>
            <div className="flex min-h-11 items-center justify-between gap-3">
                <nav className="thin-scrollbar flex min-w-0 flex-1 items-center gap-3 overflow-x-auto text-sm" role="tablist" aria-label="Agent 面板">
                    {items.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            role="tab"
                            aria-selected={value === item.value}
                            className={`inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-0.5 transition ${value === item.value ? "font-medium" : "font-normal"}`}
                            style={{ borderColor: value === item.value ? theme.node.text : "transparent", color: value === item.value ? theme.node.text : theme.node.muted }}
                            onClick={() => onChange(item.value)}
                        >
                            {item.icon}
                            {item.label}
                            {item.count ? ` ${item.count}` : ""}
                        </button>
                    ))}
                </nav>
                {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
            </div>
        </div>
    );
}

function AgentDetailBlock({ detail, theme }: { detail: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <pre className="thin-scrollbar mt-3 max-h-64 overflow-auto rounded-lg border p-3 text-[11px] leading-4" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel, color: theme.node.muted }}>
            {JSON.stringify(detail, null, 2)}
        </pre>
    );
}

function AgentAvatar({ theme }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: "VOZEB PRO", logoUrl: "/logo.svg" };
    return (
        <span className="grid size-8 shrink-0 place-items-center" role="img" aria-label={`${site.title || "VOZEB PRO"} Agent`} style={{ color: theme.node.text }}>
            <SiteLogo logoUrl={site.logoUrl} className="size-5" />
        </span>
    );
}

function AgentUserAvatar({ user, theme }: { user: LocalUser | null; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const avatarUrl = user?.avatarUrl?.trim();
    const label = user?.displayName || user?.username || "用户";
    return (
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full" role="img" aria-label={label} style={{ color: theme.node.text }}>
            {avatarUrl ? (
                <img src={avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
            ) : (
                <span className="grid size-full place-items-center text-[11px] font-semibold" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }} aria-hidden="true">
                    {userAvatarFallback(label)}
                </span>
            )}
        </span>
    );
}

function AgentMessageAttachments({ attachments }: { attachments: CanvasAgentChatAttachment[] }) {
    return (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
            {attachments.map((item) => (
                <AgentMediaPreview key={item.id} type="image" url={item.url} title={item.name} className="aspect-square rounded-lg" />
            ))}
        </div>
    );
}

function toolCardState(title: string, text: string, detail?: unknown) {
    const raw = `${title} ${text} ${normalizeText(objectField(detail, "error"))}`;
    const lower = raw.toLowerCase();
    const tool = String(objectField(detail, "name") || objectField(detail, "tool") || "");
    if (objectField(detail, "status") === "noop" || /未生效|无需|没有找到|没有.*可|已存在/.test(raw))
        return { label: "未生效", color: "#d97706", softBorder: "rgba(217,119,6,.22)", softBg: "rgba(217,119,6,.04)", icon: <CircleAlert className="size-4" />, isError: false };
    if (/拒绝|取消/.test(raw) || lower.includes("rejected")) return { label: "拒绝执行", color: "#dc2626", softBorder: "rgba(220,38,38,.20)", softBg: "rgba(220,38,38,.04)", icon: <XCircle className="size-4" />, isError: true };
    if (/失败|错误/.test(raw) || lower.includes("failed") || lower.includes("error")) return { label: "执行失败", color: "#dc2626", softBorder: "rgba(220,38,38,.20)", softBg: "rgba(220,38,38,.04)", icon: <XCircle className="size-4" />, isError: true };
    if (/完成|成功/.test(raw) || lower.includes("completed") || lower.includes("succeeded"))
        return { label: tool === "canvas_apply_ops" || /画布操作/.test(title) ? "已批准执行" : "执行完成", color: "#16a34a", softBorder: "rgba(22,163,74,.20)", softBg: "rgba(22,163,74,.04)", icon: <CheckCircle2 className="size-4" />, isError: false };
    return { label: "工具调用", color: "#2563eb", softBorder: "rgba(37,99,235,.20)", softBg: "rgba(37,99,235,.04)", icon: <Wrench className="size-4" />, isError: false };
}

function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return JSON.stringify(value, null, 2);
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function objectStringArray(value: unknown, key: string) {
    const field = objectField(value, key);
    return Array.isArray(field) ? field.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
}
