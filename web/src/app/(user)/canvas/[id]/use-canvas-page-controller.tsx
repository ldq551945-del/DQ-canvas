"use client";

import dynamic from "next/dynamic";

const CanvasAssistantPanel = dynamic(() => import("../components/canvas-assistant-panel").then((mod) => mod.CanvasAssistantPanel), { ssr: false });
const loadAssetPickerModal = () => import("../components/asset-picker-modal").then((mod) => mod.AssetPickerModal);
const AssetPickerModal = dynamic(loadAssetPickerModal, { ssr: false, loading: () => null });

import { useCanvasGenerationActions } from "./use-canvas-generation-actions";
import { useCanvasInteractions } from "./use-canvas-interactions";
import { useCanvasMediaActions } from "./use-canvas-media-actions";
import { useCanvasPageState } from "./use-canvas-page-state";
import { useCanvasPersistenceEffects } from "./use-canvas-persistence-effects";
import { useCanvasTaskRuntime } from "./use-canvas-task-runtime";

export function useCanvasPageController() {
    const state = useCanvasPageState();
    const tasks = useCanvasTaskRuntime({ state });
    useCanvasPersistenceEffects({ state, tasks });
    const interactions = useCanvasInteractions({ state });
    const media = useCanvasMediaActions({ state, tasks, interactions });
    const generation = useCanvasGenerationActions({ state, tasks, interactions });
    return { ...state, ...tasks, ...interactions, ...media, ...generation };
}

export type CanvasPageController = ReturnType<typeof useCanvasPageController>;
