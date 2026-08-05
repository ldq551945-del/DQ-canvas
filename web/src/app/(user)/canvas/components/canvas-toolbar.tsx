import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { Button, Segmented, Switch } from "antd";
import { CircleDot, Eraser, FolderOpen, Globe2, Grid2x2, Hand, Image as ImageIcon, Info, Layers2, Moon, Music2, Palette, Pencil, Plus, Redo2, Settings2, Square, SquareDashedMousePointer, Sun, Trash2, Type, Undo2, Upload, Video } from "lucide-react";

import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

export function CanvasToolbar({
    selectedCount,
    canUndo,
    canRedo,
    agentOpen,
    backgroundMode,
    showImageInfo,
    canvasTool,
    canUngroup,
    onAddImage,
    onAddPanorama,
    onAddDrawing,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddConfig,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onDeselect,
    onBackgroundModeChange,
    onShowImageInfoChange,
    onCanvasToolChange,
    onGroup,
    onUngroup,
    onOpenMyAssets,
}: {
    selectedCount: number;
    canUndo: boolean;
    canRedo: boolean;
    agentOpen?: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    canvasTool: "move" | "box-select";
    canUngroup: boolean;
    onAddImage: () => void;
    onAddPanorama: () => void;
    onAddDrawing: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddConfig: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onDeselect: () => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onCanvasToolChange: (tool: "move" | "box-select") => void;
    onGroup: () => void;
    onUngroup: () => void;
    onOpenMyAssets: () => void;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const addPanelRef = useRef<HTMLDivElement>(null);
    const addTriggerRef = useRef<HTMLButtonElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [hovered, setHovered] = useState<string | null>(null);
    const [tipX, setTipX] = useState(0);
    const [addOpen, setAddOpen] = useState(false);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [panelX, setPanelX] = useState(0);
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)" };
    const hoverStyle = { background: theme.toolbar.itemHover, color: theme.toolbar.activeText };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const tip = hovered ? toolLabel(hovered) : "";

    useEffect(() => {
        if (!addOpen && !appearanceOpen) return;
        const closeOnOutside = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && (target.closest(".canvas-add-panel") || target.closest(".canvas-appearance-panel") || target.closest(".canvas-toolbar-dock"))) return;
            setAddOpen(false);
            setAppearanceOpen(false);
        };
        window.addEventListener("pointerdown", closeOnOutside);
        return () => window.removeEventListener("pointerdown", closeOnOutside);
    }, [addOpen, appearanceOpen]);

    useEffect(() => {
        if (!addOpen) return;

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            closeAddMenu();
        };
        window.addEventListener("keydown", closeOnEscape);
        const frame = window.requestAnimationFrame(() => addPanelRef.current?.focus());
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [addOpen]);

    const closeAddMenu = () => {
        setAddOpen(false);
        addTriggerRef.current?.focus();
    };

    return (
        <div className="canvas-toolbar-dock-wrap pointer-events-none absolute bottom-5 left-0 right-0 z-50 flex justify-center">
            {tip ? <DockTip label={tip} x={tipX} theme={theme} /> : null}
            <div
                ref={wrapRef}
                className={`canvas-toolbar-dock thin-scrollbar pointer-events-auto flex h-14 max-w-[calc(100vw-24px)] items-center gap-1 overflow-x-auto rounded-xl border px-2 shadow-lg backdrop-blur [&>*]:shrink-0 ${agentOpen ? "is-agent-open" : ""}`}
                style={dockStyle}
            >
                <ToolbarButton
                    id="tool-hand"
                    label="移动/选择"
                    active={canvasTool === "move"}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    onClick={() => (canvasTool === "move" ? onDeselect() : onCanvasToolChange("move"))}
                >
                    <Hand className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton
                    id="tool-box-select"
                    label="框选"
                    active={canvasTool === "box-select"}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    onClick={() => onCanvasToolChange(canvasTool === "box-select" ? "move" : "box-select")}
                >
                    <SquareDashedMousePointer className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-undo" label="撤销" disabled={!canUndo} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUndo}>
                    <Undo2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-redo" label="重做" disabled={!canRedo} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onRedo}>
                    <Redo2 className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton
                    id="tool-add"
                    label="添加组件"
                    active={addOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    onClick={(event) => {
                        setPanelX(getPanelX(wrapRef.current, event.currentTarget, 272));
                        setAppearanceOpen(false);
                        setAddOpen((value) => !value);
                    }}
                    buttonRef={addTriggerRef}
                    expanded={addOpen}
                    controls="canvas-add-component-menu"
                >
                    <Plus className="size-5" />
                </ToolbarButton>
                <ToolbarButton id="tool-upload" label="上传素材" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUpload}>
                    <Upload className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton id="tool-assets" label="我的素材" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onOpenMyAssets}>
                    <FolderOpen className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton
                    id="tool-style"
                    label="画布外观"
                    active={appearanceOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    onClick={(event) => {
                        setPanelX(getPanelX(wrapRef.current, event.currentTarget, 248));
                        setAddOpen(false);
                        setAppearanceOpen((value) => !value);
                    }}
                >
                    <Palette className="size-4.5" />
                </ToolbarButton>
                {selectedCount ? (
                    <>
                        <Divider theme={theme} />
                        {selectedCount > 1 ? (
                            <ToolbarButton id="tool-group" label="编组" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onGroup}>
                                <Layers2 className="size-4.5" />
                            </ToolbarButton>
                        ) : null}
                        {canUngroup ? (
                            <ToolbarButton id="tool-ungroup" label="解除编组" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUngroup}>
                                <Eraser className="size-4.5" />
                            </ToolbarButton>
                        ) : null}
                        <ToolbarButton id="tool-delete" label="删除选中" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onDelete} danger>
                            <Trash2 className="size-4.5" />
                        </ToolbarButton>
                    </>
                ) : null}
                <Divider theme={theme} />
                <ToolbarButton id="tool-clear" label="清空画布" hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onClear} danger>
                    <Eraser className="size-4.5" />
                </ToolbarButton>
            </div>

            {addOpen ? (
                <div
                    ref={addPanelRef}
                    id="canvas-add-component-menu"
                    role="menu"
                    tabIndex={-1}
                    aria-label="添加组件"
                    onKeyDown={(event) => handleAddMenuKeyDown(event, closeAddMenu)}
                    className="canvas-add-panel pointer-events-auto absolute bottom-[72px] z-30 w-[272px] max-w-[calc(100%-24px)] -translate-x-1/2 rounded-xl border p-2.5 shadow-xl backdrop-blur outline-none max-sm:bottom-[132px]"
                    style={{ left: panelX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <div className="px-1 pb-2">
                        <div className="text-sm font-semibold">添加组件</div>
                        <div className="mt-0.5 text-[11px]" style={{ color: theme.node.muted }}>
                            选择要放入画布的内容类型
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                        <AddComponentButton icon={<Type />} label="文本" theme={theme} onClick={() => runAddAction(onAddText, closeAddMenu)} />
                        <AddComponentButton icon={<ImageIcon />} label="图片" theme={theme} onClick={() => runAddAction(onAddImage, closeAddMenu)} />
                        <AddComponentButton icon={<Globe2 />} label="全景图" theme={theme} onClick={() => runAddAction(onAddPanorama, closeAddMenu)} />
                        <AddComponentButton icon={<Pencil />} label="绘图" theme={theme} onClick={() => runAddAction(onAddDrawing, closeAddMenu)} />
                        <AddComponentButton icon={<Video />} label="视频" theme={theme} onClick={() => runAddAction(onAddVideo, closeAddMenu)} />
                        <AddComponentButton icon={<Music2 />} label="音频" theme={theme} onClick={() => runAddAction(onAddAudio, closeAddMenu)} />
                        <AddComponentButton icon={<Settings2 />} label="生成配置" theme={theme} onClick={() => runAddAction(onAddConfig, closeAddMenu)} wide />
                    </div>
                </div>
            ) : null}

            {appearanceOpen ? (
                <div
                    className="canvas-appearance-panel pointer-events-auto absolute bottom-[72px] z-30 w-[248px] max-w-[calc(100%-24px)] -translate-x-1/2 rounded-xl border p-2.5 shadow-xl backdrop-blur"
                    style={{ left: panelX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <div className="px-1 pb-2 text-sm font-medium opacity-65">画布外观</div>
                    <div className="px-1 pb-1.5 text-[11px] font-medium opacity-50">主题模式</div>
                    <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: theme.toolbar.itemHover }}>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}>
                            <Sun className="size-4" />
                            浅色
                        </CanvasThemeButton>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}>
                            <Moon className="size-4" />
                            深色
                        </CanvasThemeButton>
                    </div>
                    <div className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-50">网格样式</div>
                    <Segmented
                        className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
                        value={backgroundMode}
                        onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                        options={[
                            {
                                value: "dots",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <CircleDot className="size-4" />点
                                    </span>
                                ),
                            },
                            {
                                value: "lines",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Grid2x2 className="size-4" />线
                                    </span>
                                ),
                            },
                            {
                                value: "blank",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Square className="size-4" />
                                        空白
                                    </span>
                                ),
                            },
                        ]}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
                            <Info className="size-3.5" />
                            图片信息
                        </span>
                        <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function ToolbarButton({
    id,
    label,
    active,
    hovered,
    activeStyle,
    hoverStyle,
    wrapRef,
    onTipX,
    onHover,
    onClick,
    disabled = false,
    danger = false,
    expanded,
    controls,
    buttonRef,
    children,
}: {
    id: string;
    label: string;
    active?: boolean;
    hovered: string | null;
    activeStyle?: CSSProperties;
    hoverStyle: CSSProperties;
    wrapRef: RefObject<HTMLDivElement | null>;
    onTipX: (x: number) => void;
    onHover: (id: string | null) => void;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    disabled?: boolean;
    danger?: boolean;
    expanded?: boolean;
    controls?: string;
    buttonRef?: RefObject<HTMLButtonElement | null>;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Button
            type="text"
            aria-label={label}
            className="!h-8 !w-8 !min-w-8 !p-0"
            disabled={disabled}
            ref={buttonRef}
            style={active ? activeStyle : hovered === id && !disabled ? hoverStyle : { color: danger ? "#f87171" : theme.toolbar.item, opacity: disabled ? 0.35 : 1 }}
            icon={children}
            aria-expanded={expanded}
            aria-controls={controls}
            aria-haspopup={controls ? "menu" : undefined}
            onMouseEnter={(event) => {
                onHover(id);
                onTipX(getTipX(wrapRef.current, event.currentTarget));
            }}
            onMouseLeave={() => onHover(null)}
            onClick={onClick}
        />
    );
}

function Divider({ theme }: { theme: CanvasTheme }) {
    return <div className="canvas-toolbar-divider mx-1 h-6 w-px" style={{ background: theme.toolbar.border }} />;
}

function AddComponentButton({ icon, label, theme, onClick, wide = false }: { icon: ReactNode; label: string; theme: CanvasTheme; onClick: () => void; wide?: boolean }) {
    return (
        <button
            type="button"
            role="menuitem"
            data-canvas-add-component
            className={`flex h-10 min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-xs font-medium transition-colors hover:brightness-95 ${wide ? "col-span-2" : ""}`}
            style={{ background: theme.toolbar.itemHover, color: theme.toolbar.item }}
            onClick={onClick}
        >
            <span className="grid size-6 shrink-0 place-items-center [&_svg]:size-4">{icon}</span>
            <span className="truncate">{label}</span>
        </button>
    );
}

function runAddAction(action: () => void, close: () => void) {
    action();
    close();
}

function handleAddMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, close: () => void) {
    if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
    }

    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const menuItems = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-canvas-add-component]"));
    if (!menuItems.length) return;

    event.preventDefault();
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Home") return menuItems[0]?.focus();
    if (event.key === "End") return menuItems.at(-1)?.focus();

    if (currentIndex < 0) {
        return (event.key === "ArrowUp" || event.key === "ArrowLeft" ? menuItems.at(-1) : menuItems[0])?.focus();
    }

    const nextIndex = nextCanvasAddMenuIndex(currentIndex, event.key);
    if (nextIndex != null) menuItems[nextIndex]?.focus();
}

export function nextCanvasAddMenuIndex(currentIndex: number, key: string) {
    const rows = [[0, 1], [2, 3], [4, 5], [6]];
    const rowIndex = rows.findIndex((row) => row.includes(currentIndex));
    if (rowIndex < 0) return null;
    const columnIndex = rows[rowIndex].indexOf(currentIndex);
    if (key === "ArrowDown" || key === "ArrowUp") {
        const nextRowIndex = (rowIndex + (key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        const nextRow = rows[nextRowIndex];
        return nextRow[Math.min(columnIndex, nextRow.length - 1)];
    }
    if (key === "ArrowRight" || key === "ArrowLeft") {
        const nextColumn = (columnIndex + (key === "ArrowRight" ? 1 : -1) + rows[rowIndex].length) % rows[rowIndex].length;
        return rows[rowIndex][nextColumn];
    }
    return null;
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    const activeStyle = colorTheme === "light" ? { background: "#111111", color: "#ffffff" } : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
            style={active ? activeStyle : { color: theme.toolbar.item }}
            aria-label={`切换到${targetTheme === "dark" ? "深色" : "浅色"}主题`}
            title={`切换到${targetTheme === "dark" ? "深色" : "浅色"}主题`}
        >
            {children}
        </AnimatedThemeToggler>
    );
}

function DockTip({ label, x, theme }: { label: string; x: number; theme: CanvasTheme }) {
    return (
        <span className="canvas-toolbar-dock-tip absolute bottom-[calc(100%+8px)] -translate-x-1/2 rounded-md px-2 py-1 text-xs shadow-lg" style={{ left: x, background: theme.node.text, color: theme.node.panel }}>
            {label}
        </span>
    );
}

function toolLabel(id: string) {
    if (id === "tool-hand") return "移动/选择";
    if (id === "tool-box-select") return "框选";
    if (id === "tool-undo") return "撤销";
    if (id === "tool-redo") return "重做";
    if (id === "tool-add") return "添加组件";
    if (id === "tool-upload") return "上传素材";
    if (id === "tool-assets") return "我的素材";
    if (id === "tool-style") return "画布外观";
    if (id === "tool-group") return "编组";
    if (id === "tool-ungroup") return "解除编组";
    if (id === "tool-delete") return "删除选中";
    if (id === "tool-clear") return "清空画布";
    return "";
}

function getTipX(wrap: HTMLDivElement | null, target: HTMLElement) {
    if (!wrap) return 0;
    const wrapBox = wrap.parentElement?.getBoundingClientRect() || wrap.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return box.left - wrapBox.left + box.width / 2;
}

function getPanelX(wrap: HTMLDivElement | null, target: HTMLElement, requestedWidth: number) {
    if (!wrap) return 0;
    const container = wrap.parentElement?.getBoundingClientRect() || wrap.getBoundingClientRect();
    const raw = getTipX(wrap, target);
    const panelHalf = Math.min(requestedWidth / 2, Math.max(0, (container.width - 24) / 2));
    const minimum = 12 + panelHalf;
    const maximum = Math.max(minimum, container.width - 12 - panelHalf);
    return Math.min(Math.max(raw, minimum), maximum);
}
