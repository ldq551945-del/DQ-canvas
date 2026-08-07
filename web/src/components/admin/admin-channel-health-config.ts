import type { SystemChannelAdvancedConfig, SystemChannelModelConfig, SystemChannelProtocol, SystemModelChannel } from "@/lib/auth/store";
import type { ChannelHealthKind, ChannelHealthResult } from "@/lib/channel-health-result";
import { emptyAdvancedConfig, normalizeStrictProtocolModelConfig } from "@/lib/channel-protocol-registry";
import { normalizeModelId } from "@/lib/model-capability";

export function buildAdvancedConfigFromHealth(channel: SystemModelChannel, results: ChannelHealthResult[]): SystemChannelAdvancedConfig {
    const current = channel.advancedConfig || emptyAdvancedConfig();
    const text = firstOkResult(results, "text");
    const image = firstOkResult(results, "image");
    const video = firstOkResult(results, "video");
    const successfulProtocols = uniqueSuccessfulProtocols(results);
    const mixedProtocols = successfulProtocols.length > 1;
    const protocol = resolvedChannelProtocol(current.protocol, successfulProtocols, video, image, text);
    const modelCapabilities = { ...(current.modelCapabilities || {}) };
    const modelConfigs = { ...(current.modelConfigs || {}) };

    results.forEach((result) => {
        if (!result.ok || !result.model) return;
        const key = normalizeModelId(result.model);
        modelCapabilities[key] = result.kind;
        modelConfigs[key] = normalizeStrictProtocolModelConfig(healthModelConfig(result, modelConfigs[key]), result.protocolKey || protocol);
    });

    return {
        ...current,
        protocol,
        textModel: text?.model || current.textModel,
        imageModel: image?.model || current.imageModel,
        videoModel: video?.model || current.videoModel,
        createPath: mixedProtocols ? current.createPath : video?.createPath || image?.createPath || text?.createPath || current.createPath,
        editPath: mixedProtocols ? current.editPath : image?.editPath || current.editPath,
        imageToVideoPath: mixedProtocols ? current.imageToVideoPath : video?.imageToVideoPath || current.imageToVideoPath,
        queryPath: mixedProtocols ? current.queryPath : video?.queryPath || current.queryPath,
        cancelPath: mixedProtocols ? current.cancelPath : video?.cancelPath || current.cancelPath,
        cancelMethod: mixedProtocols ? current.cancelMethod : video?.cancelMethod || current.cancelMethod,
        requestTemplate: mixedProtocols ? current.requestTemplate : video?.requestTemplate || image?.requestTemplate || text?.requestTemplate || current.requestTemplate,
        resultField: mixedProtocols ? current.resultField : video?.resultField || image?.resultField || text?.resultField || current.resultField,
        statusField: mixedProtocols ? current.statusField : video?.statusField || current.statusField,
        durationRange: mixedProtocols ? current.durationRange : video?.durationRange || current.durationRange,
        referenceRule: mixedProtocols ? current.referenceRule : video?.referenceRule || video?.referenceHint || image?.referenceRule || image?.referenceHint || current.referenceRule,
        supportsReferenceImage: Boolean(video?.supportsReferenceImage || image?.supportsReferenceImage || current.supportsReferenceImage),
        supportsReferenceVideo: Boolean(video?.supportsReferenceVideo || current.supportsReferenceVideo),
        supportsReferenceAudio: Boolean(video?.supportsReferenceAudio || current.supportsReferenceAudio),
        modelCapabilities,
        modelConfigs,
    };
}

function resolvedChannelProtocol(current: SystemChannelProtocol | undefined, successfulProtocols: SystemChannelProtocol[], video?: ChannelHealthResult, image?: ChannelHealthResult, text?: ChannelHealthResult) {
    if (successfulProtocols.length > 1) return current || "auto";
    return successfulProtocols[0] || video?.protocolKey || image?.protocolKey || text?.protocolKey || current || "auto";
}

function uniqueSuccessfulProtocols(results: ChannelHealthResult[]) {
    return Array.from(new Set(results.flatMap((result) => (result.ok && result.protocolKey ? [result.protocolKey] : []))));
}

function firstOkResult(results: ChannelHealthResult[], kind: ChannelHealthKind) {
    return results.find((result) => result.kind === kind && result.ok);
}

function healthModelConfig(result: ChannelHealthResult, current?: SystemChannelModelConfig): SystemChannelModelConfig {
    return {
        ...(current || {}),
        capability: result.kind,
        source: "health",
        ...(result.protocolKey ? { protocol: result.protocolKey } : {}),
        ...(result.createPath ? { createPath: result.createPath } : {}),
        ...(result.editPath ? { editPath: result.editPath } : {}),
        ...(result.imageToVideoPath ? { imageToVideoPath: result.imageToVideoPath } : {}),
        ...(result.queryPath ? { queryPath: result.queryPath } : {}),
        ...(result.cancelPath ? { cancelPath: result.cancelPath } : {}),
        ...(result.cancelMethod ? { cancelMethod: result.cancelMethod } : {}),
        ...(result.requestTemplate ? { requestTemplate: result.requestTemplate } : {}),
        ...(result.resultField ? { resultField: result.resultField } : {}),
        ...(result.statusField ? { statusField: result.statusField } : {}),
        ...(result.durationRange ? { durationRange: result.durationRange } : {}),
        ...(result.referenceRule || result.referenceHint ? { referenceRule: result.referenceRule || result.referenceHint } : {}),
        ...(typeof result.supportsReferenceImage === "boolean" ? { supportsReferenceImage: result.supportsReferenceImage } : {}),
        ...(typeof result.supportsReferenceVideo === "boolean" ? { supportsReferenceVideo: result.supportsReferenceVideo } : {}),
        ...(typeof result.supportsReferenceAudio === "boolean" ? { supportsReferenceAudio: result.supportsReferenceAudio } : {}),
    };
}
