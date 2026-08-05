export const BACKGROUND_REMOVAL_OPTIONS_VERSION = 3 as const;
export const BACKGROUND_REMOVAL_PRESETS = ["standard", "official-fine", "hair", "hard-edge", "custom"] as const;
export const BACKGROUND_REMOVAL_OUTPUT_MODES = ["transparent", "mask", "color"] as const;
export const BACKGROUND_REMOVAL_MODELS = ["u2net", "isnet-general-use", "u2net_human_seg", "isnet-anime", "silueta"] as const;

export type BackgroundRemovalPreset = (typeof BACKGROUND_REMOVAL_PRESETS)[number];
export type BackgroundRemovalOutputMode = (typeof BACKGROUND_REMOVAL_OUTPUT_MODES)[number];
export type BackgroundRemovalModel = (typeof BACKGROUND_REMOVAL_MODELS)[number];
export type BackgroundRemovalRgba = [red: number, green: number, blue: number, alpha: number];

/** Canonical snapshot sent to the rembg 2.0.77 sidecar. */
export type BackgroundRemovalOptionsV3 = {
    version: typeof BACKGROUND_REMOVAL_OPTIONS_VERSION;
    /** Official rembg session selected for this task. */
    model: BackgroundRemovalModel;
    preset: BackgroundRemovalPreset;
    /** rembg: alpha_matting */
    alphaMatting: boolean;
    /** rembg: alpha_matting_foreground_threshold */
    foregroundThreshold: number;
    /** rembg: alpha_matting_background_threshold */
    backgroundThreshold: number;
    /** rembg: alpha_matting_erode_size */
    refineRange: number;
    /** rembg: post_process_mask */
    cleanMask: boolean;
    /** rembg: only_mask / bgcolor */
    outputMode: BackgroundRemovalOutputMode;
    /** rembg: bgcolor, used only when outputMode is color. */
    backgroundColor: BackgroundRemovalRgba;
};

/** @deprecated Import-compatible aliases; normalized snapshots are always V3. */
export type BackgroundRemovalOptionsV2 = BackgroundRemovalOptionsV3;
export type BackgroundRemovalOptionsV1 = BackgroundRemovalOptionsV3;

type BackgroundRemovalTuning = Pick<BackgroundRemovalOptionsV3, "alphaMatting" | "foregroundThreshold" | "backgroundThreshold" | "refineRange" | "cleanMask">;

export class BackgroundRemovalOptionsValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BackgroundRemovalOptionsValidationError";
    }
}

const STANDARD_TUNING = {
    alphaMatting: false,
    foregroundThreshold: 240,
    backgroundThreshold: 10,
    refineRange: 10,
    cleanMask: false,
} as const;

const DEFAULT_BACKGROUND_COLOR: BackgroundRemovalRgba = [255, 255, 255, 255];

const PRESET_TUNING: Record<BackgroundRemovalPreset, BackgroundRemovalTuning> = {
    standard: STANDARD_TUNING,
    "official-fine": { ...STANDARD_TUNING, alphaMatting: true, refineRange: 40, cleanMask: true },
    hair: { ...STANDARD_TUNING, alphaMatting: true },
    "hard-edge": { ...STANDARD_TUNING, cleanMask: true },
    custom: STANDARD_TUNING,
};

const COMMON_KEYS = ["version", "preset", "alphaMatting", "foregroundThreshold", "backgroundThreshold", "refineRange", "cleanMask"] as const;
const V1_ALLOWED_KEYS = new Set<string>([...COMMON_KEYS, "outputMask"]);
const V2_ALLOWED_KEYS = new Set<string>([...COMMON_KEYS, "outputMode", "backgroundColor"]);
const V3_ALLOWED_KEYS = new Set<string>([...V2_ALLOWED_KEYS, "model"]);

export const DEFAULT_BACKGROUND_REMOVAL_OPTIONS: BackgroundRemovalOptionsV3 = Object.freeze({
    version: BACKGROUND_REMOVAL_OPTIONS_VERSION,
    model: "silueta",
    preset: "standard",
    ...STANDARD_TUNING,
    outputMode: "transparent",
    backgroundColor: [...DEFAULT_BACKGROUND_COLOR] as BackgroundRemovalRgba,
});

/**
 * Converts API/config input to one canonical v3 parameter snapshot. Strict v1
 * and v2 snapshots remain readable and select u2net during migration.
 */
export function normalizeBackgroundRemovalOptions(input?: unknown): BackgroundRemovalOptionsV3 {
    if (input === undefined || input === null) return cloneDefaultOptions();
    if (!isRecord(input) || Array.isArray(input)) throw new BackgroundRemovalOptionsValidationError("抠图参数必须是对象");

    const version = input.version === undefined ? ("outputMask" in input ? 1 : BACKGROUND_REMOVAL_OPTIONS_VERSION) : input.version;
    if (version !== 1 && version !== 2 && version !== BACKGROUND_REMOVAL_OPTIONS_VERSION) throw new BackgroundRemovalOptionsValidationError("参数版本必须为 1、2 或 3");
    const allowedKeys = version === 1 ? V1_ALLOWED_KEYS : version === 2 ? V2_ALLOWED_KEYS : V3_ALLOWED_KEYS;
    const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length) throw new BackgroundRemovalOptionsValidationError(`包含未支持的参数：${unknownKeys.join("、")}`);

    const preset = input.preset === undefined ? "standard" : readPreset(input.preset);
    const base = PRESET_TUNING[preset];
    const tuning = {
        alphaMatting: readOptionalBoolean(input.alphaMatting, "自动细化边缘", base.alphaMatting),
        foregroundThreshold: readOptionalInteger(input.foregroundThreshold, "主体确认阈值", 0, 255, base.foregroundThreshold),
        backgroundThreshold: readOptionalInteger(input.backgroundThreshold, "背景确认阈值", 0, 255, base.backgroundThreshold),
        refineRange: readOptionalInteger(input.refineRange, "边缘细化范围", 0, 255, base.refineRange),
        cleanMask: readOptionalBoolean(input.cleanMask, "清理零碎边缘", base.cleanMask),
    };
    if (tuning.backgroundThreshold >= tuning.foregroundThreshold) throw new BackgroundRemovalOptionsValidationError("背景确认阈值必须小于主体确认阈值");

    const resolvedPreset = preset !== "custom" && sameTuning(tuning, base) ? preset : "custom";
    const model = version === BACKGROUND_REMOVAL_OPTIONS_VERSION ? readModel(input.model) : "u2net";
    const outputMode = version === 1 ? (readOptionalBoolean(input.outputMask, "输出蒙版", false) ? "mask" : "transparent") : readOutputMode(input.outputMode);
    const backgroundColor: BackgroundRemovalRgba = version === 1 ? [...DEFAULT_BACKGROUND_COLOR] : readBackgroundColor(input.backgroundColor);
    return {
        version: BACKGROUND_REMOVAL_OPTIONS_VERSION,
        model,
        preset: resolvedPreset,
        ...tuning,
        outputMode,
        backgroundColor,
    };
}

/** Stable field order used as the input for the server-side SHA-256 hash. */
export function serializeBackgroundRemovalOptions(options: BackgroundRemovalOptionsV3) {
    const normalized = normalizeBackgroundRemovalOptions(options);
    const usesAlphaMatting = normalized.alphaMatting && normalized.outputMode !== "mask";
    return JSON.stringify([
        normalized.version,
        normalized.model,
        usesAlphaMatting,
        ...(usesAlphaMatting ? [normalized.foregroundThreshold, normalized.backgroundThreshold, normalized.refineRange] : []),
        normalized.cleanMask,
        normalized.outputMode,
        ...(normalized.outputMode === "color" ? normalized.backgroundColor : []),
    ]);
}

/** Runtime helper for canvas metadata, including persisted v1 snapshots. */
export function backgroundRemovalOutputMode(options: unknown): BackgroundRemovalOutputMode {
    return normalizeBackgroundRemovalOptions(options).outputMode;
}

function cloneDefaultOptions(): BackgroundRemovalOptionsV3 {
    return { ...DEFAULT_BACKGROUND_REMOVAL_OPTIONS, backgroundColor: [...DEFAULT_BACKGROUND_REMOVAL_OPTIONS.backgroundColor] };
}

function readModel(value: unknown): BackgroundRemovalModel {
    if (value === undefined) return "silueta";
    if (typeof value === "string" && BACKGROUND_REMOVAL_MODELS.includes(value as BackgroundRemovalModel)) return value as BackgroundRemovalModel;
    throw new BackgroundRemovalOptionsValidationError("主体识别模型无效");
}

function readPreset(value: unknown): BackgroundRemovalPreset {
    if (typeof value === "string" && BACKGROUND_REMOVAL_PRESETS.includes(value as BackgroundRemovalPreset)) return value as BackgroundRemovalPreset;
    throw new BackgroundRemovalOptionsValidationError("处理方式无效");
}

function readOutputMode(value: unknown): BackgroundRemovalOutputMode {
    if (value === undefined) return "transparent";
    if (typeof value === "string" && BACKGROUND_REMOVAL_OUTPUT_MODES.includes(value as BackgroundRemovalOutputMode)) return value as BackgroundRemovalOutputMode;
    throw new BackgroundRemovalOptionsValidationError("输出方式无效");
}

function readBackgroundColor(value: unknown): BackgroundRemovalRgba {
    if (value === undefined) return [...DEFAULT_BACKGROUND_COLOR];
    if (!Array.isArray(value) || value.length !== 4) throw new BackgroundRemovalOptionsValidationError("背景颜色必须是包含 4 个通道的 RGBA 数组");
    return value.map((channel) => readOptionalInteger(channel, "背景颜色通道", 0, 255, 255)) as BackgroundRemovalRgba;
}

function readOptionalBoolean(value: unknown, label: string, fallback: boolean) {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") throw new BackgroundRemovalOptionsValidationError(`${label}必须为布尔值`);
    return value;
}

function readOptionalInteger(value: unknown, label: string, minimum: number, maximum: number, fallback: number) {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new BackgroundRemovalOptionsValidationError(`${label}必须是 ${minimum} 到 ${maximum} 之间的整数`);
    return Number(value);
}

function sameTuning(left: BackgroundRemovalTuning, right: BackgroundRemovalTuning) {
    return left.alphaMatting === right.alphaMatting && left.foregroundThreshold === right.foregroundThreshold && left.backgroundThreshold === right.backgroundThreshold && left.refineRange === right.refineRange && left.cleanMask === right.cleanMask;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object";
}
