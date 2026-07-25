"use client";

import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasSettingsPopoverShell, type CanvasSettingsPopoverPlacement } from "./canvas-settings-popover-shell";

type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    placement?: CanvasSettingsPopoverPlacement;
    fixedSizeLabel?: string;
};

export function CanvasImageSettingsPopover({ config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft", fixedSizeLabel }: CanvasImageSettingsPopoverProps) {
    const quality = config.quality || "auto";
    const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";

    return (
        <CanvasSettingsPopoverShell
            label={`${imageQualityLabel(quality)} · ${fixedSizeLabel || imageSizeLabel(activeSize)} · ${count} 张`}
            buttonClassName={buttonClassName}
            defaultButtonClassName="!h-8 !max-w-[180px] !justify-start !rounded-full !px-2.5"
            placement={placement}
            onOpenChange={onOpenChange}
        >
            {(theme) => <ImageSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} className="space-y-4" showSizeControls={!fixedSizeLabel} />}
        </CanvasSettingsPopoverShell>
    );
}
