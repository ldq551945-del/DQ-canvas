import type { LogicalModelCapability, SystemChannelModelConfig } from "@/lib/auth/store-types";

export const GROK2API_VIDEO_OPERATION = {
    capability: "video" as const,
    createPath: "/v1/videos/generations",
    imageToVideoPath: "/v1/videos/generations",
    queryPath: "/v1/videos/:task_id",
    requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","duration":"{{duration}}","aspect_ratio":"{{aspect_ratio}}","resolution":"{{resolution}}"}',
    resultField: "video.url",
    statusField: "status",
    durationRange: "1-15 seconds",
    referenceRule: "Use application/json. Put the first reference image in image.url and any remaining images in reference_images[].url.",
    supportsReferenceImage: true,
};

const GROK2API_IMAGE_MODEL_PATTERN = /^grok-imagine-image(?:$|-)/i;

export function grok2ApiCatalogModelConfig(metadata: Record<string, unknown> | undefined, capability: LogicalModelCapability): SystemChannelModelConfig | undefined {
    if (capability !== "video" || !isGrok2ApiCatalogMetadata(metadata)) return undefined;
    return {
        ...GROK2API_VIDEO_OPERATION,
        protocol: "grok2api",
        apiFormat: "openai",
    };
}

export function isGrok2ApiCatalogMetadata(metadata: Record<string, unknown> | undefined) {
    const owner = metadata?.owned_by ?? metadata?.ownedBy;
    return typeof owner === "string" && owner.trim().toLowerCase() === "grok2api";
}

export function isGrok2ApiImageModel(model: string) {
    const normalized = model.trim().split("::").at(-1)!.split("/").at(-1)!;
    return GROK2API_IMAGE_MODEL_PATTERN.test(normalized);
}

export function grok2ApiImageResolution(quality: string | undefined) {
    return quality === "high" ? "2k" : "1k";
}

export function buildGrok2ApiImageRequest(input: { model: string; prompt: string; aspectRatio: string; resolution: "1k" | "2k"; responseFormat: "url" | "b64_json"; images?: string[] }) {
    const images = Array.from(new Set((input.images || []).map((url) => url.trim()).filter(Boolean)));
    const [image, ...additionalImages] = images;
    return {
        model: input.model,
        prompt: input.prompt,
        n: 1,
        aspect_ratio: input.aspectRatio,
        resolution: input.resolution,
        response_format: input.responseFormat,
        ...(image ? { image: { url: image } } : {}),
        ...(additionalImages.length ? { images: additionalImages.map((url) => ({ url })) } : {}),
    };
}

export function buildGrok2ApiVideoRequest(input: { model: string; prompt: string; duration: number; aspectRatio: string; resolution: string; images?: string[] }) {
    const images = Array.from(new Set((input.images || []).map((url) => url.trim()).filter(Boolean)));
    const [image, ...referenceImages] = images;
    return {
        model: input.model,
        prompt: input.prompt,
        duration: input.duration,
        aspect_ratio: input.aspectRatio,
        resolution: input.resolution,
        ...(image ? { image: { url: image } } : {}),
        ...(referenceImages.length ? { reference_images: referenceImages.map((url) => ({ url })) } : {}),
    };
}
