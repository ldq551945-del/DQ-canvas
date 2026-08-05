import { Compass, Focus, Keyboard } from "lucide-react";
import { useState } from "react";
import { Button, Modal, Tooltip } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap }: CanvasZoomControlsProps) {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)" };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    return (
        <div className="canvas-zoom-controls pointer-events-none absolute bottom-5 left-5 z-50" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="canvas-zoom-dock pointer-events-auto flex h-14 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur" style={dockStyle}>
                <Tooltip title={isMiniMapOpen ? "关闭小地图" : "打开小地图"}>
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !p-0"
                        style={isMiniMapOpen ? activeStyle : { color: theme.toolbar.item }}
                        icon={<Compass className="size-4" />}
                        onClick={onToggleMiniMap}
                        aria-label={isMiniMapOpen ? "关闭小地图" : "打开小地图"}
                    />
                </Tooltip>
                <Tooltip title="重置视图">
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={{ color: theme.toolbar.item }} icon={<Focus className="size-4" />} onClick={onReset} aria-label="重置视图" />
                </Tooltip>
                <Tooltip title="放大/缩小画布">
                    <input
                        type="range"
                        min="5"
                        max="500"
                        step="1"
                        value={Math.round(scale * 100)}
                        className="w-24"
                        style={{ accentColor: theme.node.activeStroke }}
                        onChange={(event) => onScaleChange(Number(event.target.value) / 100)}
                        aria-label="放大/缩小画布"
                    />
                </Tooltip>
                <span className="w-10 text-right text-xs tabular-nums" style={{ color: theme.node.muted }}>
                    {Math.round(scale * 100)}%
                </span>
                <Tooltip title="快捷键">
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={shortcutsOpen ? activeStyle : { color: theme.toolbar.item }} icon={<Keyboard className="size-4" />} onClick={() => setShortcutsOpen(true)} aria-label="打开画布快捷键" />
                </Tooltip>
            </div>
            <Modal title="画布快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered width={620}>
                <div className="thin-scrollbar max-h-[min(70vh,620px)] space-y-1 overflow-y-auto border-t pt-3 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["拖动空白处"]} value="平移画布" />
                    <Shortcut keys={["Space", "拖动"]} value="临时平移画布" />
                    <Shortcut keys={["鼠标中键", "拖动"]} value="平移画布" />
                    <Shortcut keys={["滚轮 / 触控板"]} value="缩放画布" />
                    <Shortcut keys={["双击空白处"]} value="打开组件创建菜单" />
                    <Shortcut keys={["Ctrl / Cmd", "拖动"]} value="框选多个节点" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加或移除节点选择" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C"]} value="复制选中节点" />
                    <Shortcut keys={["Ctrl / Cmd", "V"]} value="粘贴节点、文本或图片" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中节点或连线" />
                    <Shortcut keys={["Esc"]} value="取消选择、连线并关闭浮层" />
                    <Shortcut keys={["拖入媒体文件"]} value="上传图片、视频或音频" />
                </div>
            </Modal>
        </div>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_180px] items-center gap-4 rounded-lg px-2 py-1.5 max-sm:grid-cols-1 max-sm:gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd className="min-w-9 rounded-md border px-2 py-1 text-center text-xs font-medium leading-none" style={{ borderColor: "rgba(120,113,108,.28)", background: "rgba(120,113,108,.08)" }}>
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-xs opacity-65 max-sm:text-left">{value}</span>
        </div>
    );
}
