"use client";

import { Popover } from "antd";
import { SlidersHorizontal } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { PORTRAIT_TEXTURE_GROUPS, normalizePortraitTextureSettings, type PortraitTextureSettingKey, type PortraitTextureSettings } from "../utils/canvas-portrait-texture";

type CanvasPortraitTexturePopoverProps = {
    value: unknown;
    placement?: "topLeft" | "topRight";
    onChange: (settings: PortraitTextureSettings) => void;
};

type CanvasPortalEvent = { stopPropagation: () => void };

export function stopCanvasPortalEvent(event: CanvasPortalEvent) {
    event.stopPropagation();
}

export function CanvasPortraitTexturePopover({ value, placement = "topLeft", onChange }: CanvasPortraitTexturePopoverProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const settings = normalizePortraitTextureSettings(value);

    const updateSetting = (key: PortraitTextureSettingKey, nextValue: string) => {
        onChange(normalizePortraitTextureSettings({ ...settings, [key]: nextValue }));
    };

    const content = (
        <div
            data-canvas-no-zoom
            className="w-[min(350px,calc(100vw-24px))] max-w-full p-2.5"
            style={{ color: theme.node.text }}
            onPointerDown={stopCanvasPortalEvent}
            onMouseDown={stopCanvasPortalEvent}
            onClick={stopCanvasPortalEvent}
            onDoubleClick={stopCanvasPortalEvent}
            onWheel={stopCanvasPortalEvent}
            onContextMenu={stopCanvasPortalEvent}
        >
            <div className="mb-2 flex items-center gap-1.5 border-b px-0.5 pb-2" style={{ borderColor: theme.toolbar.border }}>
                <SlidersHorizontal className="size-3.5" />
                <span className="text-xs font-semibold">人物质感调节</span>
            </div>
            <div className="space-y-1">
                {PORTRAIT_TEXTURE_GROUPS.map((group) => (
                    <div key={group.key} className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-2 py-1">
                        <span className="text-[11px]" style={{ color: theme.node.muted }}>
                            {group.label}
                        </span>
                        <div className="grid min-w-0 grid-cols-3 gap-1" role="radiogroup" aria-label={group.label}>
                            {group.options.map((option) => {
                                const selected = settings[group.key] === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        role="radio"
                                        aria-checked={selected}
                                        title={option.label}
                                        className="h-7 min-w-0 rounded-md border px-1 text-[10px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                                        style={{
                                            background: selected ? theme.toolbar.activeBg : theme.node.fill,
                                            borderColor: selected ? theme.node.activeStroke : theme.toolbar.border,
                                            color: selected ? theme.toolbar.activeText : theme.node.text,
                                            outlineColor: theme.node.activeStroke,
                                        }}
                                        onClick={() => updateSetting(group.key, option.value)}
                                    >
                                        <span className="block truncate">{option.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <Popover
            trigger="click"
            placement={placement}
            arrow={false}
            content={content}
            styles={{
                container: {
                    padding: 0,
                    overflow: "hidden",
                    background: theme.toolbar.panel,
                    border: `1px solid ${theme.toolbar.border}`,
                    borderRadius: 10,
                    boxShadow: "0 12px 32px rgba(15,23,42,.14)",
                },
            }}
        >
            <button
                type="button"
                className="flex h-7 min-w-0 items-center gap-1 rounded-md border px-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, outlineColor: theme.node.activeStroke }}
                aria-label="打开人物质感调节面板"
            >
                <SlidersHorizontal className="size-3 shrink-0" />
                <span className="truncate text-[10px] font-medium">人物质感调节</span>
            </button>
        </Popover>
    );
}
