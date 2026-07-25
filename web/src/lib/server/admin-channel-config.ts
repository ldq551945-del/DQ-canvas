import type { ApiCallFormat, AuthSettings, SystemModelChannel } from "@/lib/auth/store";
import { isEncryptedSecretValue } from "@/lib/server/secret-crypto";

type ChannelCredentialInput = {
    channelId?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    apiFormat?: unknown;
};

export function serializeAdminSettings(settings: AuthSettings): AuthSettings {
    return {
        ...settings,
        systemChannels: settings.systemChannels.map(({ clearApiKey: _clearApiKey, ...channel }) => ({
            ...channel,
            apiKey: "",
            hasApiKey: isUsableAdminChannelApiKey(channel.apiKey),
        })),
    };
}

export function mergeSystemChannelSecrets(channels: SystemModelChannel[], savedChannels: SystemModelChannel[]) {
    const savedById = new Map(savedChannels.map((channel) => [channel.id, channel]));
    return channels.map(({ hasApiKey: _hasApiKey, clearApiKey, ...channel }) => ({
        ...channel,
        apiKey: clearApiKey ? "" : usableApiKey(channel.apiKey) || usableApiKey(savedById.get(channel.id)?.apiKey),
    }));
}

export function resolveAdminChannelCredentials(settings: AuthSettings, input: ChannelCredentialInput) {
    const channelId = text(input.channelId);
    const savedChannel = settings.systemChannels.find((channel) => channel.id === channelId);
    const apiFormat: ApiCallFormat = input.apiFormat === "gemini" || input.apiFormat === "openai" ? input.apiFormat : savedChannel?.apiFormat === "gemini" ? "gemini" : "openai";
    return {
        channelId,
        savedChannel,
        baseUrl: text(input.baseUrl) || savedChannel?.baseUrl.trim() || "",
        apiKey: usableApiKey(input.apiKey) || usableApiKey(savedChannel?.apiKey),
        apiFormat,
    };
}

export function isUsableAdminChannelApiKey(value: unknown) {
    const apiKey = text(value);
    return Boolean(apiKey) && !isEncryptedSecretValue(apiKey);
}

export function sanitizeProviderMessage(value: unknown, secrets: string[] = []) {
    let message = typeof value === "string" ? value : value instanceof Error ? value.message : "";
    for (const secret of secrets.filter(Boolean)) message = message.replaceAll(secret, "[REDACTED]");
    return message
        .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
        .replace(/\bsk-[a-z0-9_-]{8,}/gi, "[REDACTED]")
        .replace(/([?&](?:api[_-]?key|key|token)=)[^&#\s]+/gi, "$1[REDACTED]")
        .slice(0, 500);
}

export function isProviderTimeoutError(error: unknown) {
    return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function usableApiKey(value: unknown) {
    const apiKey = text(value);
    return isUsableAdminChannelApiKey(apiKey) ? apiKey : "";
}
