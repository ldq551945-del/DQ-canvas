import { describe, expect, it } from "vitest";

import type { AuthSettings, SystemModelChannel } from "@/lib/auth/store";
import { isProviderTimeoutError, isUsableAdminChannelApiKey, mergeSystemChannelSecrets, resolveAdminChannelCredentials, sanitizeProviderMessage, serializeAdminSettings } from "./admin-channel-config";

const savedChannel = { id: "saved", name: "已保存", baseUrl: "https://api.example.com/v1", apiKey: "secret-value", apiFormat: "openai", models: ["gpt-test"], enabled: true } satisfies SystemModelChannel;
const settings = { systemChannels: [savedChannel] } as AuthSettings;

describe("admin channel config", () => {
    it("serializes only API key presence for the admin client", () => {
        const result = serializeAdminSettings(settings).systemChannels[0];
        expect(result.apiKey).toBe("");
        expect(result.hasApiKey).toBe(true);
        expect(JSON.stringify(result)).not.toContain("secret-value");
    });

    it("keeps, replaces, and explicitly clears saved API keys", () => {
        const base = { ...savedChannel, apiKey: "" };
        expect(mergeSystemChannelSecrets([base], [savedChannel])[0].apiKey).toBe("secret-value");
        expect(mergeSystemChannelSecrets([{ ...base, apiKey: "new-secret" }], [savedChannel])[0].apiKey).toBe("new-secret");
        expect(mergeSystemChannelSecrets([{ ...base, clearApiKey: true }], [savedChannel])[0].apiKey).toBe("");
    });

    it("resolves saved credentials when the client sends only a channel id", () => {
        expect(resolveAdminChannelCredentials(settings, { channelId: "saved" })).toMatchObject({ baseUrl: savedChannel.baseUrl, apiKey: savedChannel.apiKey, apiFormat: "openai" });
    });

    it("never treats stored ciphertext as a usable provider credential", () => {
        const ciphertext = "vozeb-pro-secret:v1:iv.tag.payload";
        const encryptedSettings = { systemChannels: [{ ...savedChannel, apiKey: ciphertext }] } as AuthSettings;

        expect(isUsableAdminChannelApiKey(ciphertext)).toBe(false);
        expect(serializeAdminSettings(encryptedSettings).systemChannels[0]).toMatchObject({ apiKey: "", hasApiKey: false });
        expect(resolveAdminChannelCredentials(encryptedSettings, { channelId: "saved", apiKey: ciphertext }).apiKey).toBe("");
        expect(mergeSystemChannelSecrets([{ ...savedChannel, apiKey: ciphertext }], encryptedSettings.systemChannels)[0].apiKey).toBe("");
    });

    it("redacts common provider secret formats", () => {
        const message = sanitizeProviderMessage("Authorization: Bearer token-value https://x.test?api_key=secret-value token-example-123", ["token-value", "secret-value", "token-example-123"]);
        expect(message).not.toContain("token-value");
        expect(message).not.toContain("secret-value");
        expect(message).not.toContain("token-example-123");
    });

    it("recognizes abort and timeout errors", () => {
        expect(isProviderTimeoutError(new DOMException("aborted", "AbortError"))).toBe(true);
        expect(isProviderTimeoutError(new DOMException("timed out", "TimeoutError"))).toBe(true);
        expect(isProviderTimeoutError(new Error("network failed"))).toBe(false);
    });
});
