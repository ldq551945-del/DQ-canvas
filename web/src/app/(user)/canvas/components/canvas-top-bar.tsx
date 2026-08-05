"use client";

import { useEffect, useRef, useState } from "react";
import type { MenuProps } from "antd";
import { Button, Dropdown } from "antd";
import { BookOpen, Gauge, Images, Menu, Plus, Redo2, Sparkles, Trash2, Undo2, Upload } from "lucide-react";

import { SiteLogo } from "@/components/layout/site-logo";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasMediaPerformanceMode } from "../types";

export function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onWorkbench,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onImportImage,
    onUndo,
    onRedo,
    performanceMode,
    performanceReduced,
    onPerformanceModeChange,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onWorkbench: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onImportImage: () => void;
    onUndo: () => void;
    onRedo: () => void;
    performanceMode: CanvasMediaPerformanceMode;
    performanceReduced: boolean;
    onPerformanceModeChange: (mode: CanvasMediaPerformanceMode) => void;
    agentOpen: boolean;
    compactAgentStatus?: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const menuTriggerRef = useRef<HTMLButtonElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    useEffect(() => {
        if (!menuOpen) return;
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (menuTriggerRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest(".ant-dropdown, .ant-dropdown-menu, .ant-dropdown-menu-submenu, .ant-dropdown-menu-submenu-popup")) return;
            setMenuOpen(false);
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [menuOpen]);

    return (
        <>
            <div className="canvas-topbar pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between gap-2 px-4">
                <div className="canvas-topbar-left pointer-events-auto flex min-w-0 items-center gap-3">
                    <Dropdown
                        open={menuOpen}
                        onOpenChange={setMenuOpen}
                        trigger={["click"]}
                        menu={{
                            onClick: () => setMenuOpen(false),
                            items: [
                                { key: "workbench", icon: <Sparkles className="size-4" />, label: "工作台", onClick: onWorkbench },
                                { key: "docs", icon: <BookOpen className="size-4" />, label: "使用帮助", onClick: () => window.location.assign("/help?section=canvas") },
                                { key: "projects", icon: <Images className="size-4" />, label: "我的画布", onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: "新建画布", onClick: onCreateProject },
                                {
                                    key: "performance-menu",
                                    icon: <Gauge className="size-4" />,
                                    label: "性能调节",
                                    children: performanceMenuItems(performanceMode, performanceReduced, onPerformanceModeChange),
                                },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: "删除当前画布", onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: "导入素材", onClick: onImportImage },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button ref={menuTriggerRef} type="button" className="grid size-9 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} aria-label="打开画布菜单">
                            <Menu className="size-5" />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="canvas-topbar-title flex min-w-0 items-center gap-2">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="w-[min(280px,48vw)] max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="canvas-topbar-title-button max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title="双击修改画布名称"
                            >
                                {title}
                            </button>
                        )}
                    </div>
                </div>

                <div className="canvas-topbar-actions pointer-events-auto flex min-w-0 items-center gap-1.5">
                    {compactAgentStatus ? <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} /> : null}
                    <UserStatusActions variant="canvas" />
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: performanceMenuItems(performanceMode, performanceReduced, onPerformanceModeChange),
                            selectable: true,
                            selectedKeys: [performanceMode],
                        }}
                    >
                        <Button
                            type="text"
                            data-canvas-performance-trigger
                            className="canvas-performance-action !grid !size-10 !min-w-10 !place-items-center !rounded-xl !p-0"
                            style={{
                                background: performanceReduced ? theme.toolbar.activeBg : theme.toolbar.panel,
                                border: `1px solid ${performanceReduced ? theme.node.activeStroke : theme.toolbar.border}`,
                                color: performanceReduced ? theme.toolbar.activeText : theme.toolbar.item,
                            }}
                            icon={<Gauge className="size-4.5" />}
                            aria-label={`性能模式：${performanceMode === "auto" ? "自动" : performanceMode === "quality" ? "质量优先" : "性能优先"}`}
                            title="性能调节"
                        />
                    </Dropdown>
                    <span className="canvas-topbar-divider h-6 w-px" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="canvas-agent-button !font-medium"
                        style={{
                            background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel,
                            borderColor: agentOpen ? theme.toolbar.activeBg : theme.toolbar.border,
                            borderStyle: "solid",
                            borderWidth: 1,
                            borderRadius: 14,
                            color: agentOpen ? theme.toolbar.activeText : theme.toolbar.item,
                            height: 40,
                            minHeight: 40,
                            paddingInline: 12,
                            boxShadow: colorTheme === "dark" ? "0 10px 30px rgba(0,0,0,.28)" : "0 10px 24px rgba(28,25,23,.08)",
                        }}
                        icon={
                            <span className="canvas-agent-button-icon inline-flex size-7 shrink-0 items-center justify-center">
                                <SiteLogo logoUrl="/logo.svg" className={agentOpen ? "size-7 dark:bg-stone-950" : "size-7"} />
                            </span>
                        }
                        onClick={onToggleAgent}
                        aria-label="Agent 对话"
                    >
                        Agent 对话
                    </Button>
                </div>
            </div>
        </>
    );
}

function performanceMenuItems(mode: CanvasMediaPerformanceMode, performanceReduced: boolean, onChange: (mode: CanvasMediaPerformanceMode) => void): MenuProps["items"] {
    return [
        {
            key: "auto",
            label: `自动性能${mode === "auto" && performanceReduced ? "（已启用优化）" : "（按画布规模调整）"}`,
            onClick: () => onChange("auto"),
        },
        { key: "quality", label: "画质优先", onClick: () => onChange("quality") },
        { key: "performance", label: "性能优先", onClick: () => onChange("performance") },
    ];
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const label = status.connected ? "已连接到本地 Codex" : status.enabled ? status.activity || "连接中" : "正在连接本地 Codex";
    const dotColor = status.connected ? "#22c55e" : status.enabled ? "#f59e0b" : theme.node.muted;
    return (
        <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition hover:opacity-85"
            style={{ background: theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
            onClick={onClick}
            title="打开本地 Codex 面板"
        >
            <span className="size-2 rounded-full" style={{ background: dotColor }} />
            <span className="max-w-[180px] truncate">{label}</span>
        </button>
    );
}
