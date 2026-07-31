export const SEEDANCE_SPECIAL_MODELS = [
    ["sd_2.0_special_720p", "标准版 720p"],
    ["sd_2.0_special_1080p", "标准版 1080p"],
    ["sd_2.0_special_2k", "标准版 2K"],
    ["sd_2.0_special_4k", "标准版 4K"],
    ["sd_2.0_special_720p_with_video_ref", "标准版 720p + 视频参考"],
    ["sd_2.0_special_1080p_with_video_ref", "标准版 1080p + 视频参考"],
    ["sd_2.0_special_2k_with_video_ref", "标准版 2K + 视频参考"],
    ["sd_2.0_special_4k_with_video_ref", "标准版 4K + 视频参考"],
    ["sd_2.0_fast_special_720p", "快速版 720p"],
    ["sd_2.0_fast_special_720p_with_video_ref", "快速版 720p + 视频参考"],
] as const;

export const SEEDANCE_SPECIAL_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"] as const;

type SeedanceSpecialReferences = {
    images?: string[];
    videos?: string[];
    audios?: string[];
};

export function buildSeedanceSpecialRequest(input: { model: string; prompt: string; ratio: string; duration: number; generateAudio?: boolean; returnLastFrame?: boolean; seed?: number; references?: SeedanceSpecialReferences }) {
    const model = input.model.trim();
    if (!SEEDANCE_SPECIAL_MODELS.some(([id]) => id === model)) throw new Error("Seedance 2.0 特价版模型不在接口文档允许列表中");

    const prompt = input.prompt.trim();
    assertSeedanceSpecialPrompt(prompt);
    const ratio = input.ratio.trim();
    if (!SEEDANCE_SPECIAL_RATIOS.includes(ratio as (typeof SEEDANCE_SPECIAL_RATIOS)[number])) throw new Error(`Seedance 2.0 特价版不支持画幅 ${ratio || "空"}`);
    if (!Number.isInteger(input.duration) || input.duration < 4 || input.duration > 15) throw new Error("Seedance 2.0 特价版时长必须是 4-15 秒整数");

    const images = uniqueReferences(input.references?.images, 9, "参考图片");
    const videos = uniqueReferences(input.references?.videos, 3, "参考视频");
    const audios = uniqueReferences(input.references?.audios, 3, "参考音频");
    if (audios.length && !images.length && !videos.length) throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图片或参考视频");
    const videoModel = model.endsWith("_with_video_ref");
    if (videoModel && !videos.length) throw new Error("当前 Seedance 模型要求至少一个参考视频");
    if (!videoModel && videos.length) throw new Error("使用参考视频时必须选择名称以 _with_video_ref 结尾的 Seedance 模型");

    return {
        model,
        ratio,
        duration: input.duration,
        generate_audio: input.generateAudio ?? true,
        return_last_frame: input.returnLastFrame ?? false,
        seed: Number.isInteger(input.seed) ? input.seed : -1,
        content: [
            { type: "text", text: prompt },
            ...images.map((url) => ({ type: "image_url", role: "reference_image", image_url: { url } })),
            ...videos.map((url) => ({ type: "video_url", role: "reference_video", video_url: { url } })),
            ...audios.map((url) => ({ type: "audio_url", role: "reference_audio", audio_url: { url } })),
        ],
    };
}

function assertSeedanceSpecialPrompt(prompt: string) {
    if (!prompt) throw new Error("Seedance 2.0 特价版必须填写文本提示词");
    if (/\p{Script=Han}/u.test(prompt)) {
        if (Array.from(prompt).length > 500) throw new Error("Seedance 中文提示词不能超过 500 字");
        return;
    }
    if (prompt.split(/\s+/).filter(Boolean).length > 1_000) throw new Error("Seedance 英文提示词不能超过 1000 词");
}

function uniqueReferences(values: string[] | undefined, limit: number, label: string) {
    const references = Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean)));
    if (references.length > limit) throw new Error(`${label}最多 ${limit} 个`);
    references.forEach((value) => {
        if (!isSeedanceSpecialMediaReference(value)) throw new Error(`${label}只能使用公网 URL 或 assetId:// 素材，不能使用 base64`);
    });
    return references;
}

export function isSeedanceSpecialMediaReference(value: string) {
    if (/^assetId:\/\/[a-zA-Z0-9._:-]+$/i.test(value)) return true;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}
