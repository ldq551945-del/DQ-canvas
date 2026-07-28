"use client";

import { useState } from "react";
import { App, Button, Checkbox, Input, Popconfirm, Select, Switch, Tag, Tooltip } from "antd";
import { Eye, EyeOff, PlugZap, RefreshCw, Sparkles, Trash2 } from "lucide-react";

import { LabeledControl } from "@/components/admin/admin-settings-controls";
import { formatCreditAmount } from "@/constant/credits";
import { parseChannelExampleConfig } from "@/lib/channel-example-parser";
import { buildGlobalAiOpcSelection, GLOBAL_AIOPC_PRESETS, globalAiOpcPresetOptions, resolveGlobalAiOpcCatalogPresets, resolveGlobalAiOpcPresets } from "@/lib/globalaiopc-catalog";
import type { LogicalModelCapability, SystemChannelAdvancedConfig, SystemChannelModelConfig, SystemChannelProtocol, SystemModelChannel } from "@/lib/auth/store";
import { capabilityLabel, channelModelCapability } from "@/lib/model-routing-config";
import { normalizeModelId } from "@/lib/model-capability";
import { revealAdminChannelApiKey } from "@/services/api/admin-settings";

export type ChannelHealthKind = "text" | "image" | "video" | "audio";

export type ChannelHealthResult = {
    ok: boolean;
    kind: ChannelHealthKind;
    model: string;
    status: number;
    protocolKey?: SystemChannelProtocol;
    protocol?: string;
    referenceHint?: string;
    createPath?: string;
    queryPath?: string;
    requestTemplate?: string;
    resultField?: string;
    statusField?: string;
    durationRange?: string;
    referenceRule?: string;
    supportsReferenceImage?: boolean;
    supportsReferenceVideo?: boolean;
    supportsReferenceAudio?: boolean;
    pointsCost?: number;
    pointsRemaining?: number;
    taskId?: string;
    remoteUrl?: string;
    error?: string;
};

const channelProtocolOptions: Array<{ value: SystemChannelProtocol; label: string }> = [
    { value: "auto", label: "自动" },
    { value: "openai", label: "OpenAI" },
    { value: "sub2api", label: "sub2api" },
    { value: "qingyan", label: "青衍智影" },
    { value: "globalaiopc", label: "GlobalAiOpc" },
    { value: "seedance", label: "Seedance" },
    { value: "compatible", label: "通用兼容" },
];
const ALL_GLOBAL_AIOPC_PRESETS = "__all_globalaiopc_presets__";
const modelCapabilityOptions: Array<{ label: string; value: LogicalModelCapability }> = [
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

export function createDefaultChannelAdvancedConfig(): SystemChannelAdvancedConfig {
    return {
        protocol: "auto",
        textModel: "",
        imageModel: "",
        videoModel: "",
        createPath: "",
        queryPath: "",
        requestTemplate: "",
        resultField: "",
        statusField: "",
        durationRange: "",
        referenceRule: "",
        supportsReferenceImage: false,
        supportsReferenceVideo: false,
        supportsReferenceAudio: false,
    };
}

export function SystemChannelEditor({
    channel,
    fetching,
    testingKey,
    healthResults,
    onChange,
    onDelete,
    onFetchModels,
    onTestHealth,
    onTestAllHealth,
}: {
    channel: SystemModelChannel;
    fetching: boolean;
    testingKey: string;
    healthResults: Record<string, ChannelHealthResult>;
    onChange: (patch: Partial<SystemModelChannel>) => void;
    onDelete: () => void;
    onFetchModels: () => void;
    onTestHealth: (kind: ChannelHealthKind) => void;
    onTestAllHealth: () => void;
}) {
    const { message } = App.useApp();
    const [exampleText, setExampleText] = useState("");
    const [revealedApiKey, setRevealedApiKey] = useState("");
    const [apiKeyVisible, setApiKeyVisible] = useState(false);
    const [apiKeyLoading, setApiKeyLoading] = useState(false);
    const healthKinds: ChannelHealthKind[] = ["text", "image", "video", "audio"];
    const visibleHealthResults = healthKinds.map((kind) => healthResults[`${channel.id}:${kind}`]).filter((item): item is ChannelHealthResult => Boolean(item));
    const advanced = channel.advancedConfig || createDefaultChannelAdvancedConfig();
    const capabilitySummary = channelCapabilitySummary(channel);
    const selectedGlobalPresets = resolveGlobalAiOpcPresets(advanced);
    const multipleGlobalPresets = advanced.protocol === "globalaiopc" && selectedGlobalPresets.length > 1;
    const updateAdvanced = (patch: Partial<SystemChannelAdvancedConfig>) => onChange({ advancedConfig: { ...advanced, ...patch } });
    const applyGlobalAiOpcPresets = (values: string[]) => {
        const requested = values.includes(ALL_GLOBAL_AIOPC_PRESETS)
            ? (resolveGlobalAiOpcCatalogPresets(channel.baseUrl, { protocol: "auto" }).length ? resolveGlobalAiOpcCatalogPresets(channel.baseUrl, { protocol: "auto" }) : GLOBAL_AIOPC_PRESETS).map((preset) => preset.id)
            : values;
        const selection = buildGlobalAiOpcSelection(requested);
        if (!selection.presetIds.length) return updateAdvanced({ globalAiOpcPreset: undefined, globalAiOpcPresets: [] });
        const onlyPreset = selection.presetIds.length === 1;
        const preset = onlyPreset ? GLOBAL_AIOPC_PRESETS.find((item) => item.id === selection.presetIds[0]) : undefined;
        onChange({
            baseUrl: selection.baseUrl || channel.baseUrl,
            apiFormat: selection.apiFormat,
            models: selection.models,
            advancedConfig: {
                ...advanced,
                protocol: "globalaiopc",
                globalAiOpcPreset: onlyPreset ? selection.presetIds[0] : undefined,
                globalAiOpcPresets: selection.presetIds,
                textModel: selection.textModel,
                imageModel: selection.imageModel,
                videoModel: selection.videoModel,
                createPath: selection.createPath,
                queryPath: selection.queryPath,
                requestTemplate: "",
                resultField: preset?.capability === "image" ? "data[0].url / url / image_url" : preset?.capability === "video" ? "video_url / media_url / result_url / url" : "",
                statusField: preset?.capability === "text" ? "" : "status / state",
                durationRange: selection.durationRange,
                referenceRule: selection.supportsReferenceImage || selection.supportsReferenceVideo || selection.supportsReferenceAudio ? "参考素材使用可被上游访问的公网 URL；由服务器在提交前生成受控访问地址。" : "",
                supportsReferenceImage: selection.supportsReferenceImage,
                supportsReferenceVideo: selection.supportsReferenceVideo,
                supportsReferenceAudio: selection.supportsReferenceAudio,
            },
        });
    };
    const applyExampleConfig = () => {
        const parsed = parseChannelExampleConfig(exampleText, channel, advanced);
        if (!parsed) {
            message.error("请粘贴上游 cURL、请求 JSON 或返回示例");
            return;
        }
        onChange(parsed.patch);
        message.success(`已识别并填入：${parsed.summary.slice(0, 4).join("、")}`);
    };
    const hideApiKey = () => {
        setApiKeyVisible(false);
        setRevealedApiKey("");
    };
    const toggleApiKey = async () => {
        if (apiKeyVisible) {
            hideApiKey();
            return;
        }
        if (channel.apiKey) {
            setApiKeyVisible(true);
            return;
        }
        if (!channel.hasApiKey) return;

        setApiKeyLoading(true);
        try {
            setRevealedApiKey(await revealAdminChannelApiKey(channel.id));
            setApiKeyVisible(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取 API Key 失败");
        } finally {
            setApiKeyLoading(false);
        }
    };
    const clearApiKey = () => {
        hideApiKey();
        onChange({ apiKey: "", hasApiKey: false, clearApiKey: true });
    };
    const displayedApiKey = channel.apiKey || revealedApiKey;
    return (
        <div className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm shadow-stone-200/40 sm:p-4 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/20">
            <div className="flex items-start justify-between gap-2 sm:flex-col sm:gap-3 lg:flex-row lg:justify-between">
                <div className="min-w-0 flex-1 sm:flex-initial">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-stone-950 dark:text-stone-100">
                            <PlugZap className="size-4 text-stone-400" />
                            <span className="truncate">{channel.name || "未命名渠道"}</span>
                        </div>
                        <Tag color={channel.enabled ? "green" : "default"} className="m-0">
                            {channel.enabled ? "启用" : "停用"}
                        </Tag>
                        <Tag className="m-0">{channel.models.length} 个模型</Tag>
                        {capabilitySummary ? <Tag className="m-0">{capabilitySummary}</Tag> : null}
                    </div>
                    <div className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{channel.baseUrl || "未填写 Base URL"}</div>
                    <div className="mt-1 text-xs text-stone-400 dark:text-stone-500">新手只需要填写名称、Base URL 和 API Key，再点一键检测接口。</div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:w-full sm:justify-start sm:gap-2 lg:w-auto lg:justify-end">
                    <Button type="primary" size="small" aria-label="一键检测接口" title="一键检测接口" icon={<RefreshCw className="size-3.5" />} loading={testingKey === `${channel.id}:all`} onClick={onTestAllHealth}>
                        <span className="hidden sm:inline">一键检测接口</span>
                    </Button>
                    <Switch checkedChildren="启用" unCheckedChildren="停用" checked={channel.enabled} onChange={(enabled) => onChange({ enabled })} />
                    <Popconfirm title="删除这个接口渠道？" description="关联的逻辑模型绑定会同步移除；失去绑定的模型和默认值也会清理。" okText="删除" cancelText="取消" onConfirm={onDelete}>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} aria-label="删除渠道" title="删除渠道" />
                    </Popconfirm>
                </div>
            </div>
            <div className="mt-3 grid gap-3 sm:mt-4 lg:grid-cols-[180px_minmax(0,1fr)_minmax(220px,0.8fr)]">
                <LabeledControl label="渠道名称">
                    <Input value={channel.name} placeholder="青岩智影、123NHH、VOZEB PRO、自定义接口" onChange={(event) => onChange({ name: event.target.value })} />
                </LabeledControl>
                <LabeledControl label="Base URL">
                    <Input value={channel.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => onChange({ baseUrl: event.target.value })} />
                </LabeledControl>
                <LabeledControl label="API Key">
                    <div className="flex min-w-0 items-center gap-2">
                        <Input
                            type={apiKeyVisible ? "text" : "password"}
                            value={displayedApiKey}
                            placeholder={channel.hasApiKey ? "已安全保存，留空不修改" : "sk-..."}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(event) => {
                                setRevealedApiKey(event.target.value);
                                onChange({ apiKey: event.target.value, clearApiKey: false });
                            }}
                            suffix={
                                <Tooltip title={apiKeyVisible ? "隐藏 API Key" : "查看 API Key"}>
                                    <Button
                                        type="text"
                                        size="small"
                                        loading={apiKeyLoading}
                                        disabled={!displayedApiKey && !channel.hasApiKey}
                                        icon={apiKeyVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                                        aria-label={apiKeyVisible ? "隐藏 API Key" : "查看 API Key"}
                                        onClick={() => void toggleApiKey()}
                                    />
                                </Tooltip>
                            }
                        />
                        {channel.hasApiKey ? (
                            <Popconfirm title="清除已保存的 API Key？" okText="清除" cancelText="取消" onConfirm={clearApiKey}>
                                <Button size="small" danger className="shrink-0">
                                    清除
                                </Button>
                            </Popconfirm>
                        ) : null}
                    </div>
                </LabeledControl>
            </div>
            <ChannelCapabilitySummary channel={channel} results={visibleHealthResults} />
            {visibleHealthResults.length ? (
                <div className="mt-3 space-y-2 border-t border-stone-100 pt-3 dark:border-stone-800">
                    {visibleHealthResults.map((result) => (
                        <ChannelHealthResultRow key={`${result.kind}:${result.model}`} result={result} />
                    ))}
                </div>
            ) : null}
            <details className="mt-3 rounded-lg border border-stone-200 bg-stone-50/70 dark:border-stone-800 dark:bg-stone-900/40">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-stone-800 dark:text-stone-100">高级设置</summary>
                <div className="grid gap-3 border-t border-stone-200 p-3 md:grid-cols-2 dark:border-stone-800">
                    <div className="md:col-span-2 rounded-lg border border-dashed border-stone-300 bg-white/70 p-3 dark:border-stone-700 dark:bg-stone-950/50">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <div className="text-sm font-semibold text-stone-800 dark:text-stone-100">上游示例识别</div>
                                <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">粘贴文档里的 cURL、请求 JSON 或返回 JSON，系统会自动填入协议、模型、路径、模板、结果字段和参考素材规则；不会请求上游。</div>
                            </div>
                            <Button size="small" icon={<Sparkles className="size-3.5" />} onClick={applyExampleConfig}>
                                识别示例并填入
                            </Button>
                        </div>
                        <Input.TextArea
                            className="mt-3"
                            value={exampleText}
                            rows={5}
                            placeholder='例如：curl https://api.example.com/v1/images/edits ... -d {"model":"gpt-image-2","prompt":"...","image":"https://..."}'
                            onChange={(event) => setExampleText(event.target.value)}
                        />
                    </div>
                    <LabeledControl label="接口协议">
                        <Select className="w-full" value={advanced.protocol} options={channelProtocolOptions} onChange={(protocol: SystemChannelProtocol) => updateAdvanced({ protocol })} />
                    </LabeledControl>
                    {advanced.protocol === "globalaiopc" ? (
                        <LabeledControl label="GlobalAiOpc 接口范围">
                            <Select
                                allowClear
                                className="w-full"
                                mode="multiple"
                                maxTagCount={1}
                                maxTagPlaceholder={(omitted) => `另 ${omitted.length} 个接口`}
                                placeholder="选择接口范围"
                                value={selectedGlobalPresets.map((preset) => preset.id)}
                                options={[
                                    { label: "快捷选择", options: [{ value: ALL_GLOBAL_AIOPC_PRESETS, label: "当前服务全部接口" }] },
                                    { label: "文本", options: globalAiOpcPresetOptions().filter((item) => item.capability === "text") },
                                    { label: "图片", options: globalAiOpcPresetOptions().filter((item) => item.capability === "image") },
                                    { label: "视频", options: globalAiOpcPresetOptions().filter((item) => item.capability === "video") },
                                ]}
                                onChange={applyGlobalAiOpcPresets}
                            />
                        </LabeledControl>
                    ) : null}
                    <LabeledControl label="模型目录路径">
                        <Select className="w-full" mode="tags" maxTagCount="responsive" value={advanced.modelCatalogPaths || []} placeholder="默认 /v1/models；可填写多个非标准路径" onChange={(modelCatalogPaths) => updateAdvanced({ modelCatalogPaths })} />
                    </LabeledControl>
                    <LabeledControl label="模型列表">
                        <Select className="w-full" mode="tags" maxTagCount="responsive" value={channel.models} placeholder="检测会自动填，也可以手动输入模型名" onChange={(models) => onChange({ models })} />
                    </LabeledControl>
                    <LabeledControl label="文本模型">
                        <Input value={advanced.textModel} placeholder="检测后自动填" onChange={(event) => updateAdvanced({ textModel: event.target.value })} />
                    </LabeledControl>
                    <LabeledControl label="图片模型">
                        <Input value={advanced.imageModel} placeholder="检测后自动填" onChange={(event) => updateAdvanced({ imageModel: event.target.value })} />
                    </LabeledControl>
                    <LabeledControl label="视频模型">
                        <Input value={advanced.videoModel} placeholder="检测后自动填" onChange={(event) => updateAdvanced({ videoModel: event.target.value })} />
                    </LabeledControl>
                    <ModelRouteConfigEditor channel={channel} advanced={advanced} onChange={updateAdvanced} />
                    <LabeledControl label="支持时长">
                        <Input disabled={multipleGlobalPresets} value={advanced.durationRange} placeholder={multipleGlobalPresets ? "按模型自动匹配" : "例如：5、10、15 秒"} onChange={(event) => updateAdvanced({ durationRange: event.target.value })} />
                    </LabeledControl>
                    <LabeledControl label="兜底创建路径">
                        <Input disabled={multipleGlobalPresets} value={advanced.createPath} placeholder={multipleGlobalPresets ? "按模型自动路由" : "/video/generations"} onChange={(event) => updateAdvanced({ createPath: event.target.value })} />
                    </LabeledControl>
                    <LabeledControl label="兜底查询路径">
                        <Input disabled={multipleGlobalPresets} value={advanced.queryPath} placeholder={multipleGlobalPresets ? "按模型自动路由" : "/video/generations/:task_id"} onChange={(event) => updateAdvanced({ queryPath: event.target.value })} />
                    </LabeledControl>
                    <LabeledControl label="结果字段">
                        <Input value={advanced.resultField} placeholder="例如：data[0].url / content.video_url" onChange={(event) => updateAdvanced({ resultField: event.target.value })} />
                    </LabeledControl>
                    <LabeledControl label="状态字段">
                        <Input value={advanced.statusField} placeholder="例如：status / state" onChange={(event) => updateAdvanced({ statusField: event.target.value })} />
                    </LabeledControl>
                    <div className="md:col-span-2">
                        <LabeledControl label="请求字段模板">
                            <Input.TextArea value={advanced.requestTemplate} rows={3} placeholder='{"model":"{{model}}","prompt":"{{prompt}}"}' onChange={(event) => updateAdvanced({ requestTemplate: event.target.value })} />
                        </LabeledControl>
                    </div>
                    <div className="md:col-span-2">
                        <LabeledControl label="参考素材规则">
                            <Input.TextArea value={advanced.referenceRule} rows={3} placeholder="例如：参考图必须是公网 URL；单图字段 image，多图字段 images。" onChange={(event) => updateAdvanced({ referenceRule: event.target.value })} />
                        </LabeledControl>
                    </div>
                    <div className="md:col-span-2">
                        <div className="mb-1.5 text-xs font-medium text-stone-500 dark:text-stone-400">参考素材能力</div>
                        <div className="flex flex-wrap gap-4">
                            <Checkbox checked={advanced.supportsReferenceImage} onChange={(event) => updateAdvanced({ supportsReferenceImage: event.target.checked })}>
                                支持参考图
                            </Checkbox>
                            <Checkbox checked={advanced.supportsReferenceVideo} onChange={(event) => updateAdvanced({ supportsReferenceVideo: event.target.checked })}>
                                支持参考视频
                            </Checkbox>
                            <Checkbox checked={advanced.supportsReferenceAudio} onChange={(event) => updateAdvanced({ supportsReferenceAudio: event.target.checked })}>
                                支持参考音频
                            </Checkbox>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 md:col-span-2">
                        <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={fetching} onClick={onFetchModels}>
                            拉取模型
                        </Button>
                        {healthKinds.map((kind) => (
                            <Button key={kind} size="small" loading={testingKey === `${channel.id}:${kind}`} onClick={() => onTestHealth(kind)}>
                                单测{healthKindLabel(kind)}
                            </Button>
                        ))}
                    </div>
                    <div className="text-xs leading-5 text-stone-500 md:col-span-2 dark:text-stone-400">拉取会合并上游模型、官方目录和已有手工模型，不会覆盖手工配置；混合接口优先使用模型级路由，上方兜底字段只在模型没有专属配置时生效。</div>
                </div>
            </details>
        </div>
    );
}

function ModelRouteConfigEditor({ channel, advanced, onChange }: { channel: SystemModelChannel; advanced: SystemChannelAdvancedConfig; onChange: (patch: Partial<SystemChannelAdvancedConfig>) => void }) {
    const [selected, setSelected] = useState("");
    const selectedModel = channel.models.some((model) => normalizeModelId(model) === normalizeModelId(selected)) ? channel.models.find((model) => normalizeModelId(model) === normalizeModelId(selected)) || "" : channel.models[0] || "";
    const key = normalizeModelId(selectedModel);
    const stored = key ? advanced.modelConfigs?.[key] : undefined;
    const config: SystemChannelModelConfig | undefined = selectedModel ? stored || { capability: channelModelCapability(channel, selectedModel) } : undefined;
    const update = (patch: Partial<SystemChannelModelConfig>) => {
        if (!key || !config) return;
        const next = { ...config, ...patch, source: "manual" as const };
        onChange({
            modelCapabilities: { ...(advanced.modelCapabilities || {}), [key]: next.capability },
            modelConfigs: { ...(advanced.modelConfigs || {}), [key]: next },
        });
    };
    const clearRoutes = () => {
        if (!key || !config) return;
        const next = { ...(advanced.modelConfigs || {}) };
        delete next[key];
        onChange({ modelConfigs: next, modelCapabilities: { ...(advanced.modelCapabilities || {}), [key]: config.capability } });
    };

    return (
        <div className="rounded-md border border-stone-200 bg-white/70 p-3 md:col-span-2 dark:border-stone-800 dark:bg-stone-950/50">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <div className="text-xs font-semibold text-stone-800 dark:text-stone-100">模型级路由</div>
                    <div className="mt-1 text-[11px] leading-5 text-stone-500 dark:text-stone-400">同一公司接口包含多种能力时，每个模型独立保存协议与路径。</div>
                </div>
                {stored ? (
                    <Button type="text" size="small" onClick={clearRoutes}>
                        清除专属路径
                    </Button>
                ) : null}
            </div>
            {config ? (
                <>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <LabeledControl label="模型">
                            <Select className="w-full" showSearch optionFilterProp="label" value={selectedModel} options={channel.models.map((model) => ({ label: model, value: model }))} onChange={setSelected} />
                        </LabeledControl>
                        <LabeledControl label="能力">
                            <Select className="w-full" value={config.capability} options={modelCapabilityOptions} onChange={(capability) => update({ capability })} />
                        </LabeledControl>
                        <LabeledControl label="API 格式">
                            <Select
                                className="w-full"
                                allowClear
                                placeholder="沿用渠道"
                                value={config.apiFormat}
                                options={[
                                    { label: "OpenAI", value: "openai" },
                                    { label: "Gemini", value: "gemini" },
                                ]}
                                onChange={(apiFormat) => update({ apiFormat })}
                            />
                        </LabeledControl>
                        <LabeledControl label="协议">
                            <Select className="w-full" allowClear placeholder="沿用渠道" value={config.protocol} options={channelProtocolOptions} onChange={(protocol) => update({ protocol })} />
                        </LabeledControl>
                        <LabeledControl label="创建路径">
                            <Input
                                value={config.createPath || ""}
                                placeholder={config.capability === "text" ? "/chat/completions" : config.capability === "video" ? "/videos" : "/images/generations"}
                                onChange={(event) => update({ createPath: event.target.value })}
                            />
                        </LabeledControl>
                        <LabeledControl label="查询路径">
                            <Input value={config.queryPath || ""} placeholder="/videos/:task_id" onChange={(event) => update({ queryPath: event.target.value })} />
                        </LabeledControl>
                        <LabeledControl label="结果字段">
                            <Input value={config.resultField || ""} placeholder="video_url / data[0].url" onChange={(event) => update({ resultField: event.target.value })} />
                        </LabeledControl>
                        <LabeledControl label="状态字段">
                            <Input value={config.statusField || ""} placeholder="status / state" onChange={(event) => update({ statusField: event.target.value })} />
                        </LabeledControl>
                    </div>
                    <details className="mt-3 border-t border-stone-200 pt-2 dark:border-stone-800">
                        <summary className="cursor-pointer text-xs font-medium text-stone-600 dark:text-stone-300">请求模板与参考素材</summary>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                                <LabeledControl label="请求字段模板">
                                    <Input.TextArea rows={3} value={config.requestTemplate || ""} placeholder='{"model":"{{model}}","prompt":"{{prompt}}"}' onChange={(event) => update({ requestTemplate: event.target.value })} />
                                </LabeledControl>
                            </div>
                            <div className="sm:col-span-2 flex flex-wrap gap-4 text-xs text-stone-600 dark:text-stone-300">
                                <Checkbox checked={config.supportsReferenceImage === true} onChange={(event) => update({ supportsReferenceImage: event.target.checked })}>
                                    参考图片
                                </Checkbox>
                                <Checkbox checked={config.supportsReferenceVideo === true} onChange={(event) => update({ supportsReferenceVideo: event.target.checked })}>
                                    参考视频
                                </Checkbox>
                                <Checkbox checked={config.supportsReferenceAudio === true} onChange={(event) => update({ supportsReferenceAudio: event.target.checked })}>
                                    参考音频
                                </Checkbox>
                            </div>
                        </div>
                    </details>
                </>
            ) : (
                <div className="mt-3 text-xs text-stone-500 dark:text-stone-400">拉取或手动添加模型后可设置独立路由。</div>
            )}
        </div>
    );
}

function channelCapabilitySummary(channel: SystemModelChannel) {
    const counts = channel.models.reduce((result, model) => ({ ...result, [channelModelCapability(channel, model)]: result[channelModelCapability(channel, model)] + 1 }), { text: 0, image: 0, video: 0, audio: 0 } as Record<
        LogicalModelCapability,
        number
    >);
    return modelCapabilityOptions
        .filter(({ value }) => counts[value])
        .map(({ value }) => `${capabilityLabel(value)} ${counts[value]}`)
        .join(" · ");
}

function ChannelCapabilitySummary({ channel, results }: { channel: SystemModelChannel; results: ChannelHealthResult[] }) {
    const advanced = channel.advancedConfig || createDefaultChannelAdvancedConfig();
    const text = results.find((result) => result.kind === "text");
    const image = results.find((result) => result.kind === "image");
    const video = results.find((result) => result.kind === "video");
    const audio = results.find((result) => result.kind === "audio");
    const needsPublicReference = /公网|public|localhost|NEXT_PUBLIC_SITE_URL/i.test(advanced.referenceRule || video?.referenceHint || "");
    const items = [
        { label: "文本", value: healthStateText(text), tone: healthStateTone(text) },
        { label: "生图", value: healthStateText(image), tone: healthStateTone(image) },
        { label: "图生图", value: referenceImageText(image, advanced, needsPublicReference), tone: referenceImageTone(image, advanced) },
        { label: "视频", value: healthStateText(video), tone: healthStateTone(video) },
        { label: "音频", value: healthStateText(audio), tone: healthStateTone(audio) },
        { label: "图生视频", value: referenceVideoText(video, advanced, needsPublicReference), tone: referenceImageTone(video, advanced) },
        { label: "参考视频/音频", value: referenceMediaText(video, advanced), tone: advanced.supportsReferenceVideo || advanced.supportsReferenceAudio ? "green" : video?.ok ? "default" : "default" },
    ] as const;
    return (
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:gap-2 xl:grid-cols-3">
            {items.map((item) => (
                <div key={item.label} className="flex min-w-0 items-center justify-between gap-1.5 rounded-md border border-stone-200 bg-stone-50/80 px-2 py-1.5 text-[11px] sm:gap-2 sm:px-3 sm:py-2 sm:text-xs dark:border-stone-800 dark:bg-stone-900/50">
                    <span className="min-w-0 truncate font-medium text-stone-600 dark:text-stone-300">{item.label}</span>
                    <Tag color={item.tone} className="m-0 max-w-[60%] truncate !px-1 !text-[10px] sm:max-w-[70%] sm:!px-[7px] sm:!text-xs">
                        {item.value}
                    </Tag>
                </div>
            ))}
        </div>
    );
}

function healthStateText(result?: ChannelHealthResult) {
    if (!result) return "未检测";
    return result.ok ? "可用" : "需检查";
}

function healthStateTone(result?: ChannelHealthResult) {
    if (!result) return "default";
    return result.ok ? "green" : "red";
}

function referenceImageText(result: ChannelHealthResult | undefined, advanced: SystemChannelAdvancedConfig, needsPublicReference: boolean) {
    if (!result) return advanced.supportsReferenceImage ? "未实测" : "未检测";
    if (!result.ok) return "需检查";
    if (!advanced.supportsReferenceImage) return "不支持";
    return needsPublicReference ? "需要公网参考图" : "可用";
}

function referenceVideoText(result: ChannelHealthResult | undefined, advanced: SystemChannelAdvancedConfig, needsPublicReference: boolean) {
    if (!result) return advanced.supportsReferenceImage ? "未实测" : "未检测";
    if (!result.ok) return "需检查";
    if (!advanced.supportsReferenceImage) return "不支持";
    return needsPublicReference ? "需要公网参考图" : "可用";
}

function referenceImageTone(result: ChannelHealthResult | undefined, advanced: SystemChannelAdvancedConfig) {
    if (result && !result.ok) return "red";
    if (result?.ok && advanced.supportsReferenceImage) return "green";
    return "default";
}

function referenceMediaText(result: ChannelHealthResult | undefined, advanced: SystemChannelAdvancedConfig) {
    if (advanced.supportsReferenceVideo && advanced.supportsReferenceAudio) return "视频/音频可用";
    if (advanced.supportsReferenceVideo) return "参考视频可用";
    if (advanced.supportsReferenceAudio) return "参考音频可用";
    if (!result) return "未检测";
    return result.ok ? "不支持" : "需检查";
}

function ChannelHealthResultRow({ result }: { result: ChannelHealthResult }) {
    const detail = result.remoteUrl || result.taskId || result.error || "创建成功";
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
            <Tag color={result.ok ? "green" : "red"} className="m-0">
                {healthKindLabel(result.kind)}
                {result.ok ? "成功" : "失败"}
            </Tag>
            <span className="truncate">模型：{result.model}</span>
            {result.protocol ? <span className="truncate">协议：{result.protocol}</span> : null}
            <span>状态：{result.status || "-"}</span>
            <span>扣费：{typeof result.pointsCost === "number" ? formatCreditAmount(result.pointsCost) : "-"}</span>
            {result.referenceHint ? <span className="min-w-0 flex-1 basis-full truncate sm:basis-auto">参考图：{result.referenceHint}</span> : null}
            <span className="min-w-0 flex-1 truncate">
                {result.remoteUrl ? "远程地址：" : result.taskId ? "任务：" : result.error ? "原因：" : ""}
                {detail}
            </span>
        </div>
    );
}

export function healthKindLabel(kind: ChannelHealthKind) {
    return kind === "text" ? "文本" : kind === "image" ? "图片" : kind === "video" ? "视频" : "音频";
}
