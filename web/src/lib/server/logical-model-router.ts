import type { AuthSettings, LogicalModelCapability, SystemModelChannel } from "@/lib/auth/store";
import { resolveLogicalModelCapabilityProfile } from "@/lib/model-routing-config";
import { channelSupportsModel, rawModelName } from "./generation-channel";
import { filterHealthyRuntimeCandidates } from "./channel-runtime-health";

export type ResolvedLogicalModel = {
    logicalModelId: string;
    upstreamModel: string;
    channelId: string;
    channel: SystemModelChannel;
    capabilityProfile?: ReturnType<typeof resolveLogicalModelCapabilityProfile>;
};

export function resolveLogicalModel(settings: Pick<AuthSettings, "logicalModels" | "systemChannels">, capability: LogicalModelCapability, requestedModelId: string, preferredChannelId = ""): ResolvedLogicalModel | null {
    return resolveLogicalModelCandidates(settings, capability, requestedModelId, preferredChannelId)[0] || null;
}

export function resolveLogicalModelCandidates(settings: Pick<AuthSettings, "logicalModels" | "systemChannels">, capability: LogicalModelCapability, requestedModelId: string, preferredChannelId = ""): ResolvedLogicalModel[] {
    const requested = rawModelName(requestedModelId);
    if (!requested) return [];
    if (capability !== "image" && isStableDiffusionImageModelName(requested.toLowerCase())) return [];
    const logical = settings.logicalModels.find((model) => model.enabled && model.capability === capability && model.id.toLowerCase() === requested.toLowerCase());
    if (logical) {
        const bindings = logical.bindings.filter((binding) => binding.enabled).sort((a, b) => a.priority - b.priority || (b.weight || 100) - (a.weight || 100) || a.id.localeCompare(b.id));
        const preferred = preferredChannelId ? bindings.find((binding) => binding.channelId === preferredChannelId) : undefined;
        const resolved: ResolvedLogicalModel[] = [];
        for (const binding of preferred ? [preferred, ...bindings.filter((item) => item !== preferred)] : bindings) {
            const channel = settings.systemChannels.find((item) => item.id === binding.channelId && item.enabled && item.baseUrl.trim() && item.apiKey.trim() && channelSupportsModel(item.models, binding.upstreamModel));
            if (channel) resolved.push({ logicalModelId: logical.id, upstreamModel: binding.upstreamModel, channelId: channel.id, channel, capabilityProfile: resolveLogicalModelCapabilityProfile(binding, capability, channel, binding.upstreamModel) });
        }
        return filterHealthyRuntimeCandidates(resolved, capability);
    }
    if (settings.logicalModels.length) return [];
    const ordered = preferredChannelId ? [...settings.systemChannels.filter((channel) => channel.id === preferredChannelId), ...settings.systemChannels.filter((channel) => channel.id !== preferredChannelId)] : settings.systemChannels;
    return filterHealthyRuntimeCandidates(
        ordered
            .filter((item) => item.enabled && item.baseUrl.trim() && item.apiKey.trim() && channelSupportsModel(item.models, requested))
            .map((channel) => ({ logicalModelId: requested, upstreamModel: requested, channelId: channel.id, channel, capabilityProfile: resolveLogicalModelCapabilityProfile({}, capability, channel, requested) })),
        capability,
    );
}

function isStableDiffusionImageModelName(value: string) {
    return value === "sd" || value.includes("stable diffusion") || value.includes("stable_diffusion") || /^sd(?:xl|[-_.\s]?\d)/.test(value);
}

export function resolveLogicalBillingModel(logicalModels: AuthSettings["logicalModels"], capability: LogicalModelCapability, channelId: string, upstreamModel: string) {
    return (
        logicalModels.find((logical) => logical.enabled && logical.capability === capability && logical.bindings.some((binding) => binding.enabled && binding.channelId === channelId && channelSupportsModel([binding.upstreamModel], upstreamModel)))?.id ||
        upstreamModel
    );
}
