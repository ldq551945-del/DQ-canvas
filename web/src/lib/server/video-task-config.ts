export function resolveVideoGenerationParameters(raw: Record<string, unknown>, defaults: { imageSize: string; videoQuality: string; videoSeconds: number }) {
    return {
        ...raw,
        size: normalizeVideoAspectRatio(text(raw.size), defaults.imageSize),
        vquality: text(raw.vquality) || defaults.videoQuality,
        videoSeconds: resolveVideoDuration(raw.videoSeconds, defaults.videoSeconds),
    };
}

export function normalizeVideoAspectRatio(value: unknown, fallback = "16:9") {
    return parseAspectRatio(value) || parseAspectRatio(fallback) || "16:9";
}

export function resolveVideoDuration(value: unknown, fallback: number) {
    const number = Number(value);
    if (number === -1) return -1;
    const seconds = Number.isFinite(number) && number > 0 ? number : fallback;
    return Math.max(1, Math.min(20, Math.floor(seconds)));
}

export function withVideoReferenceFidelity(prompt: string, references: Array<{ type?: string }>) {
    const source = prompt.trim();
    const hasImage = references.some((reference) => reference.type === "image");
    const hasVideo = references.some((reference) => reference.type === "video");
    if ((!hasImage && !hasVideo) || source.includes("参考素材一致性要求：")) return source;
    const sourceLabel = hasImage && hasVideo ? "参考图和参考视频" : hasImage ? "参考图" : "参考视频";
    return `${source}\n\n参考素材一致性要求：将${sourceLabel}作为首帧、主体身份、外观和场景的主要依据。除非用户明确要求改变，否则必须保持同一人物或产品、五官与轮廓、服装与材质、颜色、背景、构图和镜头视角；只添加用户描述的动作、运镜和必要的自然变化，禁止替换主体、重新设计外观或生成无关场景。`;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function parseAspectRatio(value: unknown) {
    const match = text(value)
        .replace(/\s+/g, "")
        .match(/^(\d+)(?::|x|×)(\d+)$/i);
    if (!match) return "";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return "";
    const divisor = greatestCommonDivisor(width, height);
    return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(left: number, right: number): number {
    let a = left;
    let b = right;
    while (b) [a, b] = [b, a % b];
    return a;
}
