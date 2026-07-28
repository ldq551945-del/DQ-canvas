import type { LogicalModelCapability } from "@/lib/auth/store-types";

export type ModelCatalogSource = "configured" | "provider" | "official";

export type ModelCatalogEntry = {
    id: string;
    capability: LogicalModelCapability;
    source: ModelCatalogSource;
};

export function inferModelCapability(model: string): LogicalModelCapability {
    const value = normalizeModelId(model);
    if (isSeedanceVideoModelName(value) || /stable[-_.\s]?video[-_.\s]?diffusion|(?:^|[-_.\s/])(video|videos|svd|i2v|t2v|img2video|text2video|sora|veo|kling|wan|hailuo|runway|luma|vidu)(?:$|[-_.\s/])/.test(value)) return "video";
    if (/(?:^|[-_.\s/])(audio|tts|speech|voice|music|sound)(?:$|[-_.\s/])|whisper|sensevoice/.test(value)) return "audio";
    if (/(?:^|[-_.\s/])(image|images|img|flux|sdxl|midjourney)(?:$|[-_.\s/])|seedream|gpt[-_.]?image|dall[-_.]?e|imagen|stable[-_.\s]?diffusion/.test(value) || isShortStableDiffusionName(value)) return "image";
    return "text";
}

export function capabilityFromHint(value: unknown): LogicalModelCapability | undefined {
    const hint = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(" ") : typeof value === "string" ? value : "";
    const normalized = hint.trim().toLowerCase();
    if (!normalized || normalized === "model") return undefined;
    if (/(?:^|[-_.\s/])(video|videos|i2v|t2v|image[-_.\s]?to[-_.\s]?video|text[-_.\s]?to[-_.\s]?video)(?:$|[-_.\s/])|\/videos?(?:\/|$)/.test(normalized)) return "video";
    if (/(?:^|[-_.\s/])(audio|tts|speech|voice|music|sound)(?:$|[-_.\s/])|\/audio(?:\/|$)/.test(normalized)) return "audio";
    if (/(?:^|[-_.\s/])(image|images|img|text[-_.\s]?to[-_.\s]?image)(?:$|[-_.\s/])|\/images?(?:\/|$)/.test(normalized)) return "image";
    if (/(?:^|[-_.\s/])(text|chat|language|llm|completion|generatecontent)(?:$|[-_.\s/])|\/chat(?:\/|$)|\/responses(?:\/|$)/.test(normalized)) return "text";
    return undefined;
}

export function normalizeModelId(value: string) {
    return String(value || "")
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
}

export function isSeedanceVideoModelName(model: string) {
    const value = normalizeModelId(model);
    return value.includes("seedance") || /^(?:sd[-_.\s]?2(?:$|[-_\s])|sd[-_.\s]?2[._-]?0(?:$|[-_.\s]))/.test(value);
}

function isShortStableDiffusionName(value: string) {
    return value === "sd" || /^sd(?:xl|[-_.\s]?\d)/.test(value);
}
