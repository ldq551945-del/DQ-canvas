"use client";

import { resetPublicSession } from "@/stores/use-public-session-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";

export async function resetClientSessionState() {
    useUserStore.getState().clearSession();
    resetPublicSession();
    useAssetStore.getState().reset();
    const [{ useCanvasStore }, { useDramaStore }] = await Promise.all([import("@/app/(user)/canvas/stores/use-canvas-store"), import("@/app/(user)/drama/stores/use-drama-store")]);
    useCanvasStore.getState().reset();
    useDramaStore.getState().reset();
}
