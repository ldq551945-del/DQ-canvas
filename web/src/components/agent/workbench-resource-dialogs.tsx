"use client";

import dynamic from "next/dynamic";

import type { InsertAssetPayload } from "@/app/(user)/canvas/components/asset-picker-modal";

const loadPromptSelectDialog = () => import("@/components/prompts/prompt-select-dialog").then((module) => module.PromptSelectDialog);
const loadAssetPickerModal = () => import("@/app/(user)/canvas/components/asset-picker-modal").then((module) => module.AssetPickerModal);
const PromptSelectDialog = dynamic(loadPromptSelectDialog, { ssr: false, loading: () => null });
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

export function preloadWorkbenchResourceDialogs() {
    void loadPromptSelectDialog();
    void loadAssetPickerModal();
}

export function WorkbenchResourceDialogs({
    promptOpen,
    assetOpen,
    onPromptOpenChange,
    onPromptSelect,
    onAssetInsert,
    onAssetClose,
}: {
    promptOpen: boolean;
    assetOpen: boolean;
    onPromptOpenChange: (open: boolean) => void;
    onPromptSelect: (prompt: string) => void;
    onAssetInsert: (payload: InsertAssetPayload) => void;
    onAssetClose: () => void;
}) {
    return (
        <>
            {promptOpen ? <PromptSelectDialog open={promptOpen} onOpenChange={onPromptOpenChange} onSelect={onPromptSelect} /> : null}
            {assetOpen ? <AssetPickerModal open={assetOpen} defaultTab="my-assets" onInsert={onAssetInsert} onClose={onAssetClose} /> : null}
        </>
    );
}
