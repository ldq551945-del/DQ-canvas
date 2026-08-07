import { buildGlobalAiOpcSelection } from "@/lib/globalaiopc-catalog";
import { channelModelCapability } from "@/lib/model-routing-config";
import { normalizeModelId } from "@/lib/model-capability";
import { channelProtocolDefinition, emptyAdvancedConfig, normalizeStrictProtocolModelConfig } from "@/lib/channel-protocol-registry";
import type { SystemChannelAdvancedConfig, SystemModelChannel } from "@/lib/auth/store";

export type AdminModelsResultLike = {
    models: string[];
    modelCapabilities?: SystemChannelAdvancedConfig["modelCapabilities"];
    modelConfigs?: SystemChannelAdvancedConfig["modelConfigs"];
    recommendedConfig?: Partial<SystemChannelAdvancedConfig>;
    globalAiOpcPresets?: SystemChannelAdvancedConfig["globalAiOpcPresets"];
};

export function adminModelsChannelPatch(channel: SystemModelChannel, result: AdminModelsResultLike): Partial<SystemModelChannel> {
    const advanced = channel.advancedConfig || emptyAdvancedConfig();
    const retainedModels = advanced.modelCatalogCapability ? channel.models.filter((model) => channelModelCapability(channel, model) === advanced.modelCatalogCapability) : channel.models;
    const models = uniqueList([...retainedModels, ...result.models]);
    const modelKeys = new Set(models.map(normalizeModelId));
    const modelCapabilities = filterModelRecord({ ...(advanced.modelCapabilities || {}), ...(result.modelCapabilities || {}) }, modelKeys);
    const modelConfigs = filterModelRecord(mergeAdminModelConfigs(advanced.modelConfigs, result.modelConfigs, advanced.protocol), modelKeys);
    if (!result.globalAiOpcPresets?.length) {
        return {
            models,
            advancedConfig: {
                ...advanced,
                ...(result.recommendedConfig || {}),
                modelCapabilities,
                modelConfigs,
            },
        };
    }
    const selection = buildGlobalAiOpcSelection(result.globalAiOpcPresets);
    const onlyPreset = selection.presetIds.length === 1;
    return {
        models: uniqueList([...models, ...selection.models]),
        apiFormat: selection.apiFormat,
        advancedConfig: {
            ...advanced,
            protocol: "globalaiopc",
            globalAiOpcPresets: selection.presetIds,
            globalAiOpcPreset: onlyPreset ? selection.presetIds[0] : undefined,
            textModel: selection.textModel,
            imageModel: selection.imageModel,
            videoModel: selection.videoModel,
            createPath: selection.createPath,
            queryPath: selection.queryPath,
            requestTemplate: "",
            durationRange: selection.durationRange,
            referenceRule: "参考素材使用可被上游访问的公网 URL；由服务器在提交前生成受控访问地址。",
            supportsReferenceImage: selection.supportsReferenceImage,
            supportsReferenceVideo: selection.supportsReferenceVideo,
            supportsReferenceAudio: selection.supportsReferenceAudio,
            modelCapabilities,
            modelConfigs,
        },
    };
}

function mergeAdminModelConfigs(current: SystemChannelAdvancedConfig["modelConfigs"], discovered: SystemChannelAdvancedConfig["modelConfigs"], channelProtocol: SystemChannelAdvancedConfig["protocol"]) {
    const merged = { ...(current || {}), ...(discovered || {}) };
    Object.entries(current || {}).forEach(([model, config]) => {
        const protocol = config.protocol || channelProtocol;
        if (config.source === "manual" && (protocol !== channelProtocol || !channelProtocolDefinition(protocol).strict || !merged[model])) merged[model] = config;
    });
    return Object.fromEntries(Object.entries(merged).map(([model, config]) => [model, normalizeStrictProtocolModelConfig(config, channelProtocol)]));
}

function filterModelRecord<T>(record: Record<string, T>, modelKeys: Set<string>) {
    return Object.fromEntries(Object.entries(record).filter(([model]) => modelKeys.has(normalizeModelId(model))));
}

function uniqueList(values: string[]) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
