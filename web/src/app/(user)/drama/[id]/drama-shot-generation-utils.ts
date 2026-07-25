import type { DramaProject, DramaShot } from "../types";
import type { useEffectiveConfig } from "@/stores/use-config-store";

export function shotReferenceImages(project: DramaProject, shot: DramaShot) {
    const assetUrls = [...project.characters.filter((item) => shot.characterIds.includes(item.id)), ...project.scenes.filter((item) => item.id === shot.sceneId), ...project.props.filter((item) => shot.propIds.includes(item.id))].flatMap((item) =>
        primaryAssetReference(item) ? [referenceImage(item.id, `${item.name}.png`, primaryAssetReference(item)!)] : [],
    );
    const sourceUrls = (project.sourceAssets || []).flatMap((item) => {
        if (item.type !== "image") return [];
        const url = item.serverUrl || item.remoteUrl;
        return url ? [referenceImage(item.id, item.title, url, item.mimeType)] : [];
    });
    return [...assetUrls, ...sourceUrls].slice(0, 4);
}

export function storyboardReferenceImages(shot: DramaShot) {
    return [
        shot.storyboardImageUrl ? referenceImage(`storyboard-start-${shot.id}`, `${shot.title}-起始帧.png`, shot.storyboardImageUrl) : null,
        shot.storyboardEndImageUrl ? referenceImage(`storyboard-end-${shot.id}`, `${shot.title}-结束帧.png`, shot.storyboardEndImageUrl) : null,
    ].filter((item): item is ReturnType<typeof referenceImage> => Boolean(item));
}

function primaryAssetReference(item: DramaProject["characters"][number]) {
    return item.references?.find((reference) => reference.id === item.primaryReferenceId)?.url || item.references?.[0]?.url || item.referenceImageUrl;
}

export function referenceImage(id: string, name: string, url: string, type = "image/png") {
    return { id, name, type, dataUrl: url, url, ...(url.startsWith("/") ? { serverUrl: url } : /^https?:\/\//i.test(url) ? { remoteUrl: url } : {}) };
}

export function estimateTaskPoints(config: ReturnType<typeof useEffectiveConfig>, type: "image" | "video" | "audio", duration = 5) {
    const model = type === "image" ? config.imageModel || config.model : type === "video" ? config.videoModel || config.model : config.audioModel;
    const base = Number(config.modelPointCosts[model] || 0);
    if (type === "image") return Number((base * (config.generationPointMultipliers.imageQuality[config.quality] || 1)).toFixed(2));
    if (type === "video") {
        const quality = config.generationPointMultipliers.videoQuality[config.vquality] || 1;
        const seconds = config.generationPointMultipliers.videoSeconds[String(duration)] || config.generationPointMultipliers.videoSeconds[config.videoSeconds] || 1;
        return Number((base * quality * seconds).toFixed(2));
    }
    return Number(base.toFixed(2));
}

export function estimateEpisodePoints(config: ReturnType<typeof useEffectiveConfig>, project: DramaProject, shots: DramaShot[]) {
    const total = shots.reduce((sum, shot) => {
        const mode = shot.videoMode || project.defaultVideoMode;
        const image = mode === "storyboard" ? estimateTaskPoints(config, "image") * (shot.storyboardFrameMode === "first_last" ? 2 : 1) : 0;
        const audio = shot.audioMode === "voiceover" && (shot.subtitle || shot.dialogue || shot.narration).trim() ? estimateTaskPoints(config, "audio") : 0;
        return sum + image + estimateTaskPoints(config, "video", shot.duration) + audio;
    }, 0);
    return Number(total.toFixed(2));
}
