import type { LogicalModel, LogicalModelBinding, LogicalModelCapability, LogicalModelCapabilityProfile, SystemDefaultModels, SystemModelChannel } from "@/lib/auth/store";
import { getGlobalAiOpcPresetForModel, resolveGlobalAiOpcPreset } from "@/lib/globalaiopc-catalog";

const CAPABILITY_DEFAULT_KEYS = {
    text: "textModel",
    image: "imageModel",
    video: "videoModel",
    audio: "audioModel",
} as const satisfies Record<LogicalModelCapability, keyof SystemDefaultModels>;

export function normalizeLogicalModelsConfig(models: LogicalModel[] | undefined, channels: SystemModelChannel[]) {
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));
    const source = Array.isArray(models) ? models : deriveLogicalModelsConfig(channels);
    const seenModels = new Set<string>();

    return source.flatMap((model) => {
        const id = text(model?.id, 120);
        const modelKey = id.toLowerCase();
        if (!id || seenModels.has(modelKey)) return [];
        seenModels.add(modelKey);

        const seenBindings = new Set<string>();
        const bindings = (Array.isArray(model?.bindings) ? model.bindings : [])
            .flatMap((binding, index) => {
                const channelId = text(binding?.channelId, 120);
                const upstreamModel = text(binding?.upstreamModel, 200);
                const channel = channelById.get(channelId);
                const bindingKey = `${channelId}:${normalizeModelName(upstreamModel)}`;
                if (!channel || !upstreamModel || !channelSupportsModel(channel, upstreamModel) || seenBindings.has(bindingKey)) return [];
                seenBindings.add(bindingKey);
                const capabilityProfile = normalizeStoredCapabilityProfile(binding.capabilityProfile);
                const weight = clampWeight(binding.weight);
                return [
                    {
                        id: text(binding.id, 120) || `${channelId}:${upstreamModel}`,
                        channelId,
                        upstreamModel,
                        enabled: binding.enabled !== false,
                        priority: clampPriority(binding.priority, index + 1),
                        ...(weight !== undefined ? { weight } : {}),
                        ...(capabilityProfile ? { capabilityProfile } : {}),
                    },
                ];
            })
            .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));

        if (!bindings.length) return [];
        return [{ id, name: text(model.name, 120) || id, capability: normalizeLogicalModelCapability(model.capability, id, bindings), enabled: model.enabled !== false, bindings }];
    });
}

export function deriveLogicalModelsConfig(channels: SystemModelChannel[]): LogicalModel[] {
    const catalog = new Map<string, LogicalModel>();
    channels.forEach((channel, channelIndex) => {
        channel.models.forEach((upstreamModel) => {
            const id = rawModelName(upstreamModel);
            if (!id) return;
            const key = id.toLowerCase();
            const model = catalog.get(key) || { id, name: id, capability: inferLogicalModelCapability(id), enabled: true, bindings: [] };
            model.bindings.push({ id: `${channel.id}:${upstreamModel}`, channelId: channel.id, upstreamModel, enabled: true, priority: channelIndex + 1 });
            catalog.set(key, model);
        });
    });
    return Array.from(catalog.values());
}

export function normalizeDefaultModelsConfig(defaults: Partial<SystemDefaultModels> | undefined, logicalModels: LogicalModel[], channels: SystemModelChannel[]): SystemDefaultModels {
    return Object.fromEntries(
        (Object.entries(CAPABILITY_DEFAULT_KEYS) as Array<[LogicalModelCapability, keyof SystemDefaultModels]>).map(([capability, key]) => {
            const modelId = text(defaults?.[key], 120);
            return [key, modelId && isLogicalModelResolvable(logicalModels, channels, capability, modelId) ? modelId : ""];
        }),
    ) as SystemDefaultModels;
}

export function isLogicalModelResolvable(logicalModels: LogicalModel[], channels: SystemModelChannel[], capability: LogicalModelCapability, modelId: string) {
    return Boolean(resolveLogicalModelConfig(logicalModels, channels, capability, modelId));
}

export function resolveLogicalModelConfig(logicalModels: LogicalModel[], channels: SystemModelChannel[], capability: LogicalModelCapability, modelId: string) {
    const logical = logicalModels.find((model) => model.enabled && model.capability === capability && model.id.toLowerCase() === rawModelName(modelId).toLowerCase());
    if (!logical) return null;
    const bindings = [...logical.bindings].filter((binding) => binding.enabled).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
    for (const binding of bindings) {
        const channel = channels.find((item) => item.id === binding.channelId && item.enabled && Boolean(item.apiKey.trim() || item.hasApiKey) && item.baseUrl.trim() && channelSupportsModel(item, binding.upstreamModel));
        if (channel) return { logicalModel: logical, binding, channel };
    }
    return null;
}

export function modelRoutingValidationErrors(logicalModels: LogicalModel[], channels: SystemModelChannel[], defaults: SystemDefaultModels) {
    const errors: string[] = [];
    const modelIds = new Set<string>();
    for (const model of logicalModels) {
        const key = rawModelName(model.id).toLowerCase();
        if (!key) errors.push("逻辑模型 ID 不能为空");
        else if (modelIds.has(key)) errors.push(`逻辑模型 ID 重复：${model.id}`);
        modelIds.add(key);
        if (!model.bindings.length) errors.push(`逻辑模型 ${model.name || model.id} 至少需要一个渠道绑定`);
        const expectedCapability = normalizeLogicalModelCapability(model.capability, model.id, model.bindings || []);
        if (expectedCapability !== normalizeCapability(model.capability)) errors.push(`逻辑模型 ${model.id} 更像${capabilityLabel(expectedCapability)}模型，请调整能力类型`);
        const bindingKeys = new Set<string>();
        for (const binding of model.bindings) {
            const channel = channels.find((item) => item.id === binding.channelId);
            const bindingKey = `${binding.channelId}:${normalizeModelName(binding.upstreamModel)}`;
            if (!channel) errors.push(`逻辑模型 ${model.id} 引用了不存在的渠道`);
            else if (!channelSupportsModel(channel, binding.upstreamModel)) errors.push(`渠道 ${channel.name} 未启用上游模型 ${binding.upstreamModel}`);
            if (bindingKeys.has(bindingKey)) errors.push(`逻辑模型 ${model.id} 存在重复绑定`);
            bindingKeys.add(bindingKey);
        }
    }
    for (const [capability, key] of Object.entries(CAPABILITY_DEFAULT_KEYS) as Array<[LogicalModelCapability, keyof SystemDefaultModels]>) {
        const modelId = defaults[key];
        if (modelId && !isLogicalModelResolvable(logicalModels, channels, capability, modelId)) errors.push(`默认${capabilityLabel(capability)}模型不可解析：${modelId}`);
    }
    return Array.from(new Set(errors));
}

export function capabilityLabel(capability: LogicalModelCapability) {
    return capability === "text" ? "文本" : capability === "image" ? "图片" : capability === "video" ? "视频" : "音频";
}

export function resolveLogicalModelCapabilityProfile(binding: Pick<LogicalModelBinding, "capabilityProfile">, capability: LogicalModelCapability, channel?: Pick<SystemModelChannel, "advancedConfig">, upstreamModel = "") {
    if (!binding.capabilityProfile && !channel?.advancedConfig) return undefined;
    const stored = binding.capabilityProfile || {};
    const advanced = channel?.advancedConfig;
    const globalPreset = resolveGlobalAiOpcPreset(advanced, upstreamModel);
    return {
        supportsReferenceImage: booleanValue(stored.supportsReferenceImage, globalPreset?.supportsReferenceImage ?? advanced?.supportsReferenceImage),
        supportsReferenceVideo: booleanValue(stored.supportsReferenceVideo, globalPreset?.supportsReferenceVideo ?? advanced?.supportsReferenceVideo),
        supportsReferenceAudio: booleanValue(stored.supportsReferenceAudio, globalPreset?.supportsReferenceAudio ?? advanced?.supportsReferenceAudio),
        maxReferenceImages: positiveInteger(stored.maxReferenceImages),
        aspectRatios: normalizeAspectRatios(stored.aspectRatios),
        minDurationSeconds: positiveNumber(stored.minDurationSeconds),
        maxDurationSeconds: positiveNumber(stored.maxDurationSeconds),
        maxBatchSize: positiveInteger(stored.maxBatchSize),
        supportsAsync: booleanValue(stored.supportsAsync, capability === "video" || capability === "image"),
        supportsCancel: booleanValue(stored.supportsCancel),
        supportsWebhook: booleanValue(stored.supportsWebhook),
        timeoutMs: positiveInteger(stored.timeoutMs),
        concurrencyLimit: positiveInteger(stored.concurrencyLimit),
        unitCost: positiveNumber(stored.unitCost),
        unitCostCurrency: text(stored.unitCostCurrency, 12) || undefined,
    };
}

function channelSupportsModel(channel: Pick<SystemModelChannel, "models">, model: string) {
    const target = normalizeModelName(model);
    return Boolean(target && channel.models.some((item) => normalizeModelName(item) === target));
}

function normalizeStoredCapabilityProfile(value: unknown): LogicalModelCapabilityProfile | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const profile: LogicalModelCapabilityProfile = {
        supportsReferenceImage: optionalBoolean(input.supportsReferenceImage),
        supportsReferenceVideo: optionalBoolean(input.supportsReferenceVideo),
        supportsReferenceAudio: optionalBoolean(input.supportsReferenceAudio),
        maxReferenceImages: positiveInteger(input.maxReferenceImages),
        aspectRatios: normalizeAspectRatios(input.aspectRatios),
        minDurationSeconds: positiveNumber(input.minDurationSeconds),
        maxDurationSeconds: positiveNumber(input.maxDurationSeconds),
        maxBatchSize: positiveInteger(input.maxBatchSize),
        supportsAsync: optionalBoolean(input.supportsAsync),
        supportsCancel: optionalBoolean(input.supportsCancel),
        supportsWebhook: optionalBoolean(input.supportsWebhook),
        timeoutMs: positiveInteger(input.timeoutMs),
        concurrencyLimit: positiveInteger(input.concurrencyLimit),
        unitCost: positiveNumber(input.unitCost),
        unitCostCurrency: text(input.unitCostCurrency, 12) || undefined,
    };
    return Object.values(profile).some((item) => item !== undefined && (!Array.isArray(item) || item.length > 0)) ? profile : undefined;
}

function optionalBoolean(value: unknown) {
    return typeof value === "boolean" ? value : undefined;
}

function booleanValue(value: unknown, fallback = false) {
    return typeof value === "boolean" ? value : Boolean(fallback);
}

function positiveInteger(value: unknown) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? Math.min(number, 1000000) : undefined;
}

function positiveNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.min(number, 100000000) : undefined;
}

function normalizeAspectRatios(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    const ratios = Array.from(
        new Set(
            value
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim().slice(0, 20))
                .filter(Boolean),
        ),
    ).slice(0, 12);
    return ratios.length ? ratios : undefined;
}

function normalizeModelName(value: string) {
    return rawModelName(value).toLowerCase();
}

function rawModelName(value: string) {
    return String(value || "")
        .trim()
        .replace(/^models\//i, "");
}

function normalizeCapability(value: unknown): LogicalModelCapability {
    return value === "image" || value === "video" || value === "audio" ? value : "text";
}

function normalizeLogicalModelCapability(value: unknown, id: string, bindings: Array<{ upstreamModel: string }>): LogicalModelCapability {
    if ([id, ...bindings.map((binding) => binding.upstreamModel)].some((model) => isStableDiffusionImageModelName(rawModelName(model).toLowerCase()))) return "image";
    return normalizeCapability(value);
}

function inferLogicalModelCapability(model: string): LogicalModelCapability {
    const value = model.toLowerCase();
    const globalAiOpcPreset = getGlobalAiOpcPresetForModel(value);
    if (globalAiOpcPreset) return globalAiOpcPreset.capability;
    if (/seedance|video|sora|veo|kling|hailuo|i2v|t2v/.test(value)) return "video";
    if (/audio|tts|speech|voice|music|sound/.test(value)) return "audio";
    if (/seedream|gpt-image|image|dall-?e|imagen|flux|sdxl|stable-diffusion|midjourney/.test(value) || isStableDiffusionImageModelName(value)) return "image";
    return "text";
}

function isStableDiffusionImageModelName(value: string) {
    return value === "sd" || value.includes("stable diffusion") || value.includes("stable_diffusion") || /^sd(?:xl|[-_.\s]?\d)/.test(value);
}

function clampPriority(value: unknown, fallback: number) {
    return Math.max(1, Math.min(10000, Math.floor(Number(value) || fallback)));
}

function clampWeight(value: unknown) {
    const weight = Math.floor(Number(value));
    return Number.isFinite(weight) && weight > 0 ? Math.min(weight, 10000) : undefined;
}

function text(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
