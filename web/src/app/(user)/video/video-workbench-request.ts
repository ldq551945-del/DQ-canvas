import { mergeWorkbenchAgentPatch, type WorkbenchAgentParameterPatch } from "@/hooks/use-workbench-agent-run";
import { resolveImageRequestSize } from "@/lib/image-size";
import { seedanceVideoReferenceError, seedanceVideoReferenceHint } from "@/lib/seedance-video";
import { selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import { selectVideoModel } from "./video-workbench-model";
import { buildVideoConfig, type GenerationSnapshot } from "./video-workbench-records";

type BuildVideoWorkbenchRequestInput = {
    prompt: string;
    promptOverride?: string;
    userPromptOverride?: string;
    parameterPatch?: WorkbenchAgentParameterPatch;
    effectiveConfig: AiConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
};

export type VideoWorkbenchRequestResult = { snapshot: GenerationSnapshot; issue?: never } | { snapshot: null; issue: "missing-prompt" | "config-unavailable" | "invalid-reference"; message: string };

export function buildVideoWorkbenchRequest(input: BuildVideoWorkbenchRequestInput): VideoWorkbenchRequestResult {
    const text = (input.promptOverride ?? input.prompt).trim();
    if (!text) return { snapshot: null, issue: "missing-prompt", message: "????????" };

    const requestConfig = mergeWorkbenchAgentPatch(input.effectiveConfig, input.parameterPatch, "video");
    requestConfig.size = resolveImageRequestSize({
        prompt: text,
        configuredSize: input.effectiveConfig.size,
        referenceWidth: input.references[0]?.width || input.videoReferences[0]?.width,
        referenceHeight: input.references[0]?.height || input.videoReferences[0]?.height,
        plannedSize: input.parameterPatch?.size,
        defaultSize: requestConfig.size,
    });
    const requestModel = selectVideoModel(requestConfig, selectableModelsByCapability(requestConfig, "video"), input.parameterPatch?.model);
    if (!input.isAiConfigReady(requestConfig, requestModel)) return { snapshot: null, issue: "config-unavailable", message: "?????????????????" };

    const referenceError = seedanceVideoReferenceError(input.videoReferences);
    if (referenceError) return { snapshot: null, issue: "invalid-reference", message: `${referenceError}?${seedanceVideoReferenceHint}` };

    return {
        snapshot: {
            text,
            userText: (input.userPromptOverride ?? input.prompt).trim() || text,
            config: buildVideoConfig(requestConfig, requestModel),
            references: [...input.references],
            videoReferences: [...input.videoReferences],
            audioReferences: [...input.audioReferences],
        },
    };
}
