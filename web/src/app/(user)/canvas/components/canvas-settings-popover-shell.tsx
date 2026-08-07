"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "antd";
import { Settings2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasSettingsPopoverPlacement = "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

type CanvasSettingsPopoverShellProps = {
    label: ReactNode;
    children: (theme: CanvasTheme) => ReactNode;
    buttonClassName?: string;
    defaultButtonClassName: string;
    icon?: ReactNode;
    placement?: CanvasSettingsPopoverPlacement;
    onOpenChange?: (open: boolean) => void;
};

export function CanvasSettingsPopoverShell({ label, children, buttonClassName, defaultButtonClassName, icon, placement = "topLeft", onOpenChange }: CanvasSettingsPopoverShellProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const panelId = useId().replace(/:/g, "");
    const [open, setOpen] = useState(false);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
    const closePopover = useCallback(() => {
        setOpen(false);
        onOpenChange?.(false);
        window.requestAnimationFrame(() => buttonRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    }, [onOpenChange]);
    const updateOpen = useCallback(
        (nextOpen: boolean) => {
            setOpen(nextOpen);
            onOpenChange?.(nextOpen);
        },
        [onOpenChange],
    );

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest(".ant-select-dropdown")) return;
            closePopover();
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closePopover();
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        window.addEventListener("keydown", closeOnEscape, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
            window.removeEventListener("keydown", closeOnEscape, true);
        };
    }, [closePopover, open]);

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <Button
                    size="small"
                    type="text"
                    className={buttonClassName || defaultButtonClassName}
                    style={{ background: theme.node.fill, color: theme.node.text }}
                    icon={icon || <Settings2 className="size-3.5" />}
                    onClick={() => updateOpen(!open)}
                    aria-expanded={open}
                    aria-haspopup="dialog"
                    aria-controls={open ? panelId : undefined}
                >
                    <span className="truncate">{label}</span>
                </Button>
            </span>
            {open && buttonRect
                ? createPortal(
                      <SettingsPanel id={panelId} ariaLabel={typeof label === "string" ? label : "画布设置"} buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme}>
                          {children(theme)}
                      </SettingsPanel>,
                      document.body,
                  )
                : null}
        </>
    );
}

function SettingsPanel({
    id,
    ariaLabel,
    buttonRect,
    panelRef,
    placement,
    theme,
    children,
}: {
    id: string;
    ariaLabel: string;
    buttonRect: DOMRect;
    panelRef: React.RefObject<HTMLDivElement | null>;
    placement: CanvasSettingsPopoverPlacement;
    theme: CanvasTheme;
    children: ReactNode;
}) {
    useEffect(() => {
        const focusFrame = window.requestAnimationFrame(() => panelRef.current?.focus());
        return () => window.cancelAnimationFrame(focusFrame);
    }, [panelRef]);

    const gap = 8;
    const margin = 12;
    const width = Math.min(340, window.innerWidth - margin * 2);
    const alignRight = placement.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const left = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const topSpace = buttonRect.top - gap - margin;
    const bottomSpace = window.innerHeight - buttonRect.bottom - gap - margin;
    const prefersTop = placement.startsWith("top");
    const topPlacement = prefersTop ? topSpace >= 240 || topSpace >= bottomSpace : !(bottomSpace >= 240 || bottomSpace >= topSpace);
    const maxHeight = Math.max(180, topPlacement ? topSpace : bottomSpace);
    const style = {
        position: "fixed",
        zIndex: 1200,
        width,
        left: Math.max(margin, Math.min(window.innerWidth - width - margin, left)),
        ...(topPlacement ? { bottom: window.innerHeight - buttonRect.top + gap } : { top: buttonRect.bottom + gap }),
        maxHeight,
        background: theme.toolbar.panel,
        borderRadius: 16,
        boxShadow: "0 18px 54px rgba(28, 25, 23, 0.16)",
        padding: 16,
        overflowY: "auto",
        color: theme.node.text,
    } as const;

    return (
        <div
            id={id}
            ref={panelRef}
            role="dialog"
            aria-label={ariaLabel}
            tabIndex={-1}
            className="canvas-image-settings-popover outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
            style={style}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            {children}
        </div>
    );
}
