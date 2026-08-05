"use client";

import { InputNumber, Segmented, Select, Slider, Switch, Tooltip, Typography, theme as antdTheme } from "antd";
import { CircleHelp } from "lucide-react";

import { BACKGROUND_REMOVAL_OPTIONS_VERSION, normalizeBackgroundRemovalOptions, type BackgroundRemovalModel, type BackgroundRemovalOptionsV1, type BackgroundRemovalPreset } from "@/lib/background-removal-options";

const PRESET_OPTIONS: Array<{ label: string; value: BackgroundRemovalPreset }> = [
    { label: "标准", value: "standard" },
    { label: "官方精细", value: "official-fine" },
    { label: "发丝与半透明", value: "hair" },
    { label: "清晰轮廓", value: "hard-edge" },
    { label: "自定义", value: "custom" },
];

const MODEL_OPTIONS: Array<{ label: string; value: BackgroundRemovalModel }> = [
    { label: "通用高质量（u2net）", value: "u2net" },
    { label: "高精通用（isnet-general-use）", value: "isnet-general-use" },
    { label: "人像（u2net_human_seg）", value: "u2net_human_seg" },
    { label: "动漫（isnet-anime）", value: "isnet-anime" },
    { label: "轻量快速（silueta）", value: "silueta" },
];

type NumericTuningKey = "foregroundThreshold" | "backgroundThreshold" | "refineRange";
type BooleanTuningKey = "alphaMatting" | "cleanMask";

export function applyBackgroundRemovalPreset(value: BackgroundRemovalOptionsV1, preset: BackgroundRemovalPreset): BackgroundRemovalOptionsV1 {
    if (preset === "custom") return { ...value, preset, outputMode: "transparent" };
    return normalizeBackgroundRemovalOptions({ version: BACKGROUND_REMOVAL_OPTIONS_VERSION, model: value.model, preset, outputMode: "transparent" });
}

export function updateBackgroundRemovalModel(value: BackgroundRemovalOptionsV1, model: BackgroundRemovalModel): BackgroundRemovalOptionsV1 {
    return normalizeBackgroundRemovalOptions({ ...value, model, outputMode: "transparent" });
}

export function updateBackgroundRemovalTuning(value: BackgroundRemovalOptionsV1, key: NumericTuningKey, nextValue: number): BackgroundRemovalOptionsV1;
export function updateBackgroundRemovalTuning(value: BackgroundRemovalOptionsV1, key: BooleanTuningKey, nextValue: boolean): BackgroundRemovalOptionsV1;
export function updateBackgroundRemovalTuning(value: BackgroundRemovalOptionsV1, key: NumericTuningKey | BooleanTuningKey, nextValue: number | boolean): BackgroundRemovalOptionsV1 {
    if (key === "foregroundThreshold") {
        return { ...value, preset: "custom", foregroundThreshold: clampInteger(Number(nextValue), value.backgroundThreshold + 1, 255) };
    }
    if (key === "backgroundThreshold") {
        return { ...value, preset: "custom", backgroundThreshold: clampInteger(Number(nextValue), 0, value.foregroundThreshold - 1) };
    }
    if (key === "refineRange") {
        return { ...value, preset: "custom", refineRange: clampInteger(Number(nextValue), 0, 255) };
    }
    return { ...value, preset: "custom", [key]: Boolean(nextValue) };
}

export function BackgroundRemovalSettingsPanel({ value, onChange }: { value: BackgroundRemovalOptionsV1; onChange: (value: BackgroundRemovalOptionsV1) => void }) {
    const { token } = antdTheme.useToken();
    const alphaTuningDisabled = !value.alphaMatting;

    return (
        <div className="space-y-5 pb-1">
            <section aria-labelledby="background-removal-model-label">
                <Typography.Text id="background-removal-model-label" strong>
                    主体识别模型
                </Typography.Text>
                <Select className="mt-2 w-full" aria-label="主体识别模型" options={MODEL_OPTIONS} value={value.model} onChange={(model) => onChange(updateBackgroundRemovalModel(value, model))} />
                <Typography.Text type="secondary" className="mt-1.5 block text-xs">
                    高精通用适合复杂主体；人像、动漫请选对应模型；轻量快速占用更低。
                </Typography.Text>
            </section>
            <section aria-labelledby="background-removal-preset-label">
                <Typography.Text id="background-removal-preset-label" strong>
                    处理方式
                </Typography.Text>
                <Segmented
                    block
                    className="mt-2 [&_.ant-segmented-group]:!grid [&_.ant-segmented-group]:grid-cols-2 sm:[&_.ant-segmented-group]:grid-cols-5 [&_.ant-segmented-item-label]:!flex [&_.ant-segmented-item-label]:min-h-9 [&_.ant-segmented-item-label]:items-center [&_.ant-segmented-item-label]:justify-center [&_.ant-segmented-item-label]:whitespace-normal"
                    aria-label="处理方式"
                    options={PRESET_OPTIONS}
                    value={value.preset}
                    onChange={(preset) => onChange(applyBackgroundRemovalPreset(value, preset as BackgroundRemovalPreset))}
                />
            </section>

            <section className="overflow-hidden rounded-lg border" style={{ borderColor: token.colorBorderSecondary }}>
                <SettingToggle label="自动细化边缘" tooltip="改善发丝、毛发和半透明边缘" checked={value.alphaMatting} onChange={(checked) => onChange(updateBackgroundRemovalTuning(value, "alphaMatting", checked))} />

                <div className="space-y-4 border-t px-3 py-4 sm:px-4" style={{ borderColor: token.colorBorderSecondary, background: token.colorFillQuaternary }}>
                    <NumericSetting
                        disabled={alphaTuningDisabled}
                        label="主体确认阈值"
                        value={value.foregroundThreshold}
                        min={value.backgroundThreshold + 1}
                        max={255}
                        onChange={(nextValue) => onChange(updateBackgroundRemovalTuning(value, "foregroundThreshold", nextValue))}
                    />
                    <NumericSetting
                        disabled={alphaTuningDisabled}
                        label="背景确认阈值"
                        value={value.backgroundThreshold}
                        min={0}
                        max={value.foregroundThreshold - 1}
                        onChange={(nextValue) => onChange(updateBackgroundRemovalTuning(value, "backgroundThreshold", nextValue))}
                    />
                    <NumericSetting disabled={alphaTuningDisabled} label="边缘细化范围" value={value.refineRange} min={0} max={255} onChange={(nextValue) => onChange(updateBackgroundRemovalTuning(value, "refineRange", nextValue))} />
                </div>

                <div className="border-t" style={{ borderColor: token.colorBorderSecondary }}>
                    <SettingToggle label="清理零碎边缘" tooltip="清除蒙版中的小块噪点" checked={value.cleanMask} onChange={(checked) => onChange(updateBackgroundRemovalTuning(value, "cleanMask", checked))} />
                </div>
            </section>
        </div>
    );
}

function SettingToggle({ label, tooltip, checked, disabled = false, onChange }: { label: string; tooltip?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex min-h-14 items-center justify-between gap-4 px-3 py-3 sm:px-4">
            <span className="inline-flex min-w-0 items-center gap-1.5">
                <Typography.Text>{label}</Typography.Text>
                {tooltip ? (
                    <Tooltip title={tooltip}>
                        <CircleHelp className="size-3.5 opacity-45" aria-label={`${label}说明`} />
                    </Tooltip>
                ) : null}
            </span>
            <Switch aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
        </div>
    );
}

function NumericSetting({ label, value, min, max, disabled = false, onChange }: { label: string; value: number; min: number; max: number; disabled?: boolean; onChange: (value: number) => void }) {
    return (
        <div className={`grid gap-2 transition-opacity sm:grid-cols-[minmax(0,1fr)_minmax(230px,45%)] sm:items-center sm:gap-4 ${disabled ? "opacity-50" : ""}`}>
            <Typography.Text>{label}</Typography.Text>
            <div className="flex min-w-0 items-center gap-3">
                <Slider disabled={disabled} aria-label={label} className="!mb-0 min-w-0 flex-1" min={min} max={max} value={value} onChange={onChange} />
                <InputNumber disabled={disabled} aria-label={`${label}数值`} className="w-[76px] shrink-0" min={min} max={max} precision={0} value={value} onChange={(nextValue) => nextValue !== null && onChange(nextValue)} />
            </div>
        </div>
    );
}

function clampInteger(value: number, minimum: number, maximum: number) {
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
