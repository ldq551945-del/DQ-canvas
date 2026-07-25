export function resolveImageTaskOptions(config: { quality?: unknown; size?: unknown }, defaults: { imageQuality: string; imageSize: string }) {
    return {
        quality: text(config.quality) || defaults.imageQuality,
        size: text(config.size) || defaults.imageSize,
    };
}

export function resolveImageGenerationCount(value: unknown) {
    return Math.max(1, Math.min(10, Math.floor(Number(value) || 1)));
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
