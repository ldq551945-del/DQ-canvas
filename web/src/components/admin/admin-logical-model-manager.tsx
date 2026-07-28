"use client";

import { App, Button, Checkbox, Drawer, Empty, Input, InputNumber, Popconfirm, Select, Space, Switch, Tag } from "antd";
import { AlertTriangle, GitBranch, Pencil, Plus, RefreshCw, Route, Search, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useDeferredValue, useMemo, useState } from "react";

import type { LogicalModel, LogicalModelBinding, LogicalModelCapability, LogicalModelCapabilityProfile, SystemDefaultModels, SystemModelChannel } from "@/lib/auth/store";
import { capabilityLabel, deriveLogicalModelsConfig, isLogicalModelResolvable, normalizeDefaultModelsConfig, resolveLogicalModelConfig } from "@/lib/model-routing-config";
import { LabeledControl, SectionTitle } from "@/components/admin/admin-settings-controls";

type Props = {
    channels: SystemModelChannel[];
    logicalModels: LogicalModel[];
    defaultModels: SystemDefaultModels;
    onChange: (value: { logicalModels: LogicalModel[]; defaultModels: SystemDefaultModels }) => void;
};

const capabilityOptions: Array<{ label: string; value: LogicalModelCapability }> = [
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

const defaultFields: Array<{ capability: LogicalModelCapability; key: keyof SystemDefaultModels; label: string }> = [
    { capability: "text", key: "textModel", label: "默认文本模型" },
    { capability: "image", key: "imageModel", label: "默认图片模型" },
    { capability: "video", key: "videoModel", label: "默认视频模型" },
    { capability: "audio", key: "audioModel", label: "默认音频模型" },
];

export function AdminLogicalModelManager({ channels, logicalModels, defaultModels, onChange }: Props) {
    const { message } = App.useApp();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [editingId, setEditingId] = useState("");
    const [draft, setDraft] = useState<LogicalModel>(() => createLogicalModel(channels));
    const [query, setQuery] = useState("");
    const [capabilityFilter, setCapabilityFilter] = useState<LogicalModelCapability | "all">("all");
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());
    const visibleModels = useMemo(
        () => logicalModels.filter((model) => (capabilityFilter === "all" || model.capability === capabilityFilter) && (!deferredQuery || `${model.id} ${model.name}`.toLowerCase().includes(deferredQuery))),
        [capabilityFilter, deferredQuery, logicalModels],
    );
    const readyCount = defaultFields.filter(({ capability, key }) => isLogicalModelResolvable(logicalModels, channels, capability, defaultModels[key])).length;

    const openCreate = () => {
        setEditingId("");
        setDraft(createLogicalModel(channels));
        setDrawerOpen(true);
    };

    const openEdit = (model: LogicalModel) => {
        setEditingId(model.id);
        setDraft(cloneLogicalModel(model));
        setDrawerOpen(true);
    };

    const saveDraft = () => {
        const error = validateDraft(draft, logicalModels, channels, editingId);
        if (error) {
            message.error(error);
            return;
        }
        const nextModels = editingId ? logicalModels.map((model) => (model.id === editingId ? cloneLogicalModel(draft) : model)) : [...logicalModels, cloneLogicalModel(draft)];
        onChange({ logicalModels: nextModels, defaultModels: normalizeDefaultModelsConfig(defaultModels, nextModels, channels) });
        setDrawerOpen(false);
        message.success(editingId ? "逻辑模型已更新，请保存接口配置" : "逻辑模型已添加，请保存接口配置");
    };

    const removeModel = (model: LogicalModel) => {
        const nextModels = logicalModels.filter((item) => item.id !== model.id);
        onChange({ logicalModels: nextModels, defaultModels: normalizeDefaultModelsConfig(clearDefaultReference(defaultModels, model.id), nextModels, channels) });
    };

    const syncChannelModels = () => {
        const existing = new Set(logicalModels.map((model) => model.id.toLowerCase()));
        const additions = deriveLogicalModelsConfig(channels).filter((model) => !existing.has(model.id.toLowerCase()));
        if (!additions.length) {
            message.info("渠道模型已全部存在于逻辑模型目录");
            return;
        }
        const nextModels = [...logicalModels, ...additions];
        onChange({ logicalModels: nextModels, defaultModels: normalizeDefaultModelsConfig(defaultModels, nextModels, channels) });
        message.success(`已补充 ${additions.length} 个逻辑模型，请检查能力类型后保存`);
    };

    const updateDefault = (key: keyof SystemDefaultModels, modelId: string) => onChange({ logicalModels, defaultModels: { ...defaultModels, [key]: modelId } });

    return (
        <section className="border-t border-stone-200 pt-5 dark:border-stone-800">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <SectionTitle icon={<Route className="size-4" />} title="逻辑模型路由" />
                        <Tag color={readyCount === defaultFields.length ? "green" : "orange"} className="m-0">
                            默认能力 {readyCount}/{defaultFields.length} 可用
                        </Tag>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">用户与 Agent 只选择逻辑模型；后台按绑定优先级选择实际渠道和上游模型。</p>
                </div>
                <Space wrap>
                    <Button icon={<RefreshCw className="size-4" />} onClick={syncChannelModels}>
                        同步渠道模型
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                        新增逻辑模型
                    </Button>
                </Space>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-w-0">
                    <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
                        <Input allowClear value={query} prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索逻辑 ID 或名称" onChange={(event) => setQuery(event.target.value)} />
                        <Select value={capabilityFilter} options={[{ label: "全部能力", value: "all" }, ...capabilityOptions]} onChange={(value) => setCapabilityFilter(value)} />
                    </div>
                    <div className="max-h-[680px] space-y-2 overflow-y-auto pr-1">
                        {visibleModels.map((model) => {
                            const resolved = resolveLogicalModelConfig(logicalModels, channels, model.capability, model.id);
                            const isDefault = Object.values(defaultModels).some((value) => value.toLowerCase() === model.id.toLowerCase());
                            return (
                                <div
                                    key={model.id}
                                    className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800 dark:bg-stone-950"
                                    style={{ contentVisibility: "auto", containIntrinsicSize: "0 88px" }}
                                >
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100">{model.name}</span>
                                            <Tag className="m-0">{capabilityLabel(model.capability)}</Tag>
                                            <Tag color={model.enabled ? "green" : "default"} className="m-0">
                                                {model.enabled ? "启用" : "停用"}
                                            </Tag>
                                            {isDefault ? (
                                                <Tag color="blue" className="m-0">
                                                    默认
                                                </Tag>
                                            ) : null}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                                            <span>ID：{model.id}</span>
                                            <span>{model.bindings.length} 个绑定</span>
                                            <span className={resolved ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{resolved ? `${resolved.channel.name} / ${resolved.binding.upstreamModel}` : "当前无可用渠道"}</span>
                                        </div>
                                    </div>
                                    <Space className="shrink-0">
                                        <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(model)}>
                                            编辑
                                        </Button>
                                        <Popconfirm title="删除这个逻辑模型？" description={isDefault ? "对应默认模型将同时清空。" : "渠道配置不会被删除。"} okText="删除" cancelText="取消" onConfirm={() => removeModel(model)}>
                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} aria-label={`删除逻辑模型 ${model.name}`} />
                                        </Popconfirm>
                                    </Space>
                                </div>
                            );
                        })}
                        {!visibleModels.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={logicalModels.length ? "没有匹配的逻辑模型" : "还没有逻辑模型，请从渠道同步或手动新增"} /> : null}
                    </div>
                </div>

                <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                    <SectionTitle icon={<GitBranch className="size-4" />} title="默认模型" />
                    <div className="mt-4 space-y-4">
                        {defaultFields.map(({ capability, key, label }) => {
                            const options = logicalModels
                                .filter((model) => model.capability === capability && isLogicalModelResolvable(logicalModels, channels, capability, model.id))
                                .map((model) => ({ label: `${model.name} (${model.id})`, value: model.id }));
                            const selected = logicalModels.find((model) => model.id === defaultModels[key]);
                            const resolved = selected ? resolveLogicalModelConfig(logicalModels, channels, capability, selected.id) : null;
                            return (
                                <LabeledControl key={key} label={label}>
                                    <Select
                                        className="w-full"
                                        allowClear
                                        showSearch
                                        optionFilterProp="label"
                                        value={defaultModels[key] || undefined}
                                        placeholder={`选择可用${capabilityLabel(capability)}逻辑模型`}
                                        options={options}
                                        status={defaultModels[key] && !resolved ? "error" : undefined}
                                        onChange={(value) => updateDefault(key, value || "")}
                                    />
                                    <div className={`mt-1 flex items-center gap-1 text-xs ${resolved ? "text-stone-500 dark:text-stone-400" : "text-amber-600 dark:text-amber-400"}`}>
                                        {!resolved ? <AlertTriangle className="size-3.5 shrink-0" /> : null}
                                        <span>{resolved ? `实际路由：${resolved.channel.name} / ${resolved.binding.upstreamModel}` : defaultModels[key] ? "当前默认模型不可解析" : "尚未设置默认模型"}</span>
                                    </div>
                                </LabeledControl>
                            );
                        })}
                    </div>
                </div>
            </div>

            <Drawer
                title={editingId ? "编辑逻辑模型" : "新增逻辑模型"}
                size="large"
                open={drawerOpen}
                destroyOnHidden
                onClose={() => setDrawerOpen(false)}
                extra={
                    <Space>
                        <Button onClick={() => setDrawerOpen(false)}>取消</Button>
                        <Button type="primary" onClick={saveDraft}>
                            应用修改
                        </Button>
                    </Space>
                }
            >
                <div className="grid gap-4 sm:grid-cols-2">
                    <LabeledControl label="逻辑模型 ID">
                        <Input value={draft.id} disabled={Boolean(editingId)} placeholder="例如：primary-text" onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} />
                    </LabeledControl>
                    <LabeledControl label="展示名称">
                        <Input value={draft.name} placeholder="例如：默认文本模型" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                    </LabeledControl>
                    <LabeledControl label="能力类型">
                        <Select className="w-full" value={draft.capability} options={capabilityOptions} onChange={(capability) => setDraft((current) => ({ ...current, capability }))} />
                    </LabeledControl>
                    <LabeledControl label="模型状态">
                        <div className="flex h-8 items-center">
                            <Switch checkedChildren="启用" unCheckedChildren="停用" checked={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
                        </div>
                    </LabeledControl>
                </div>

                <div className="mt-6 flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-100">渠道绑定</h3>
                        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">优先级数字越小越先使用；停用或不可用时自动尝试下一绑定。</p>
                    </div>
                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setDraft((current) => ({ ...current, bindings: [...current.bindings, createBinding(channels, current.bindings.length + 1)] }))}>
                        添加绑定
                    </Button>
                </div>
                <div className="mt-3 space-y-3">
                    {draft.bindings.map((binding) => (
                        <BindingEditor
                            key={binding.id}
                            binding={binding}
                            capability={draft.capability}
                            channels={channels}
                            onChange={(patch) => setDraft((current) => ({ ...current, bindings: current.bindings.map((item) => (item.id === binding.id ? { ...item, ...patch } : item)) }))}
                            onDelete={() => setDraft((current) => ({ ...current, bindings: current.bindings.filter((item) => item.id !== binding.id) }))}
                        />
                    ))}
                    {!draft.bindings.length ? <div className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">至少添加一个渠道绑定</div> : null}
                </div>
            </Drawer>
        </section>
    );
}

function BindingEditor({
    binding,
    capability,
    channels,
    onChange,
    onDelete,
}: {
    binding: LogicalModelBinding;
    capability: LogicalModelCapability;
    channels: SystemModelChannel[];
    onChange: (patch: Partial<LogicalModelBinding>) => void;
    onDelete: () => void;
}) {
    const channel = channels.find((item) => item.id === binding.channelId);
    const channelOptions = channels.map((item) => ({ label: `${item.name}${item.enabled ? "" : "（停用）"}`, value: item.id }));
    const modelOptions = (channel?.models || []).map((model) => ({ label: model, value: model }));
    const profile = binding.capabilityProfile || {};
    const effectiveAsync = profile.supportsAsync ?? (capability === "image" || capability === "video");
    const timeoutSeconds = profile.timeoutMs ? Math.round(profile.timeoutMs / 1000) : undefined;
    const defaultTimeoutSeconds = capability === "image" ? 600 : capability === "text" ? 120 : 180;
    const updateProfile = (patch: Partial<LogicalModelCapabilityProfile>) => onChange({ capabilityProfile: { ...profile, ...patch } });
    const updateList = (field: "aspectRatios", value: string) =>
        updateProfile({
            [field]: value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
        });
    return (
        <div className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50/70 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_90px_90px_auto] sm:items-end dark:border-stone-800 dark:bg-stone-900/40">
            <LabeledControl label="渠道">
                <Select
                    className="w-full"
                    value={binding.channelId || undefined}
                    placeholder="选择渠道"
                    options={channelOptions}
                    onChange={(channelId) => {
                        const nextChannel = channels.find((item) => item.id === channelId);
                        onChange({ channelId, upstreamModel: nextChannel?.models[0] || "" });
                    }}
                />
            </LabeledControl>
            <LabeledControl label="上游模型">
                <Select className="w-full" showSearch optionFilterProp="label" value={binding.upstreamModel || undefined} placeholder="选择已拉取模型" options={modelOptions} onChange={(upstreamModel) => onChange({ upstreamModel })} />
            </LabeledControl>
            <LabeledControl label="优先级">
                <InputNumber className="w-full" min={1} max={10000} precision={0} value={binding.priority} onChange={(priority) => onChange({ priority: Number(priority) || 1 })} />
            </LabeledControl>
            <LabeledControl label="权重">
                <InputNumber className="w-full" min={1} max={10000} precision={0} value={binding.weight || 100} onChange={(weight) => onChange({ weight: Number(weight) || 100 })} />
            </LabeledControl>
            <div className="flex h-8 items-center gap-2">
                <Switch size="small" checked={binding.enabled} onChange={(enabled) => onChange({ enabled })} />
                <Button danger size="small" icon={<Trash2 className="size-3.5" />} aria-label="删除绑定" onClick={onDelete} />
            </div>
            <div className="sm:col-span-5 rounded-md border border-stone-200/80 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-950/40">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div className="text-xs font-semibold text-stone-700 dark:text-stone-200">能力档案</div>
                        <div className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">控制参考素材、参数范围、上游任务能力和资源限制。</div>
                    </div>
                    <Tag className="m-0">{capabilityLabel(capability)}</Tag>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600 dark:text-stone-300 sm:col-span-2 lg:col-span-4">
                        <Checkbox checked={profile.supportsReferenceImage === true} onChange={(event) => updateProfile({ supportsReferenceImage: event.target.checked })}>
                            参考图片
                        </Checkbox>
                        <Checkbox checked={profile.supportsReferenceVideo === true} onChange={(event) => updateProfile({ supportsReferenceVideo: event.target.checked })}>
                            参考视频
                        </Checkbox>
                        <Checkbox checked={profile.supportsReferenceAudio === true} onChange={(event) => updateProfile({ supportsReferenceAudio: event.target.checked })}>
                            参考音频
                        </Checkbox>
                        <Checkbox checked={effectiveAsync} onChange={(event) => updateProfile({ supportsAsync: event.target.checked })}>
                            异步查询
                        </Checkbox>
                        <Checkbox checked={profile.supportsCancel === true} onChange={(event) => updateProfile({ supportsCancel: event.target.checked })}>
                            上游取消
                        </Checkbox>
                        <Checkbox checked={profile.supportsWebhook === true} onChange={(event) => updateProfile({ supportsWebhook: event.target.checked })}>
                            Webhook
                        </Checkbox>
                    </div>
                    <LabeledControl label="最大参考图数量">
                        <InputNumber className="w-full" min={0} max={16} precision={0} value={profile.maxReferenceImages} onChange={(value) => updateProfile({ maxReferenceImages: Number(value) || 0 })} />
                    </LabeledControl>
                    <LabeledControl label="最大批量数量">
                        <InputNumber className="w-full" min={1} max={100} precision={0} value={profile.maxBatchSize} onChange={(value) => updateProfile({ maxBatchSize: Number(value) || 1 })} />
                    </LabeledControl>
                    <LabeledControl label="最短时长（秒）">
                        <InputNumber className="w-full" min={0} max={3600} precision={0} value={profile.minDurationSeconds} onChange={(value) => updateProfile({ minDurationSeconds: Number(value) || 0 })} />
                    </LabeledControl>
                    <LabeledControl label="最长时长（秒）">
                        <InputNumber className="w-full" min={0} max={3600} precision={0} value={profile.maxDurationSeconds} onChange={(value) => updateProfile({ maxDurationSeconds: Number(value) || 0 })} />
                    </LabeledControl>
                    <LabeledControl label="支持比例（逗号分隔）">
                        <Input value={profile.aspectRatios?.join(", ") || ""} placeholder="1:1, 16:9, 9:16" onChange={(event) => updateList("aspectRatios", event.target.value)} />
                    </LabeledControl>
                    <LabeledControl label="请求超时（秒）">
                        <InputNumber
                            className="w-full"
                            min={5}
                            max={1800}
                            precision={0}
                            value={timeoutSeconds}
                            placeholder={`默认 ${defaultTimeoutSeconds} 秒`}
                            onChange={(value) => updateProfile({ timeoutMs: value ? Number(value) * 1000 : undefined })}
                        />
                    </LabeledControl>
                    <LabeledControl label="并发上限">
                        <InputNumber className="w-full" min={1} max={1000} precision={0} value={profile.concurrencyLimit} onChange={(value) => updateProfile({ concurrencyLimit: Number(value) || 1 })} />
                    </LabeledControl>
                    <LabeledControl label="单次成本">
                        <InputNumber className="w-full" min={0} precision={4} value={profile.unitCost} onChange={(value) => updateProfile({ unitCost: Number(value) || 0 })} />
                    </LabeledControl>
                    <LabeledControl label="成本货币">
                        <Input value={profile.unitCostCurrency || ""} maxLength={12} placeholder="USD / CNY" onChange={(event) => updateProfile({ unitCostCurrency: event.target.value.trim().toUpperCase() })} />
                    </LabeledControl>
                </div>
            </div>
        </div>
    );
}

function createLogicalModel(channels: SystemModelChannel[]): LogicalModel {
    return { id: "", name: "", capability: "text", enabled: true, bindings: [createBinding(channels, 1)] };
}

function createBinding(channels: SystemModelChannel[], priority: number): LogicalModelBinding {
    const channel = channels.find((item) => item.enabled && item.models.length) || channels.find((item) => item.models.length) || channels[0];
    return { id: nanoid(), channelId: channel?.id || "", upstreamModel: channel?.models[0] || "", enabled: true, priority, weight: 100 };
}

function cloneLogicalModel(model: LogicalModel): LogicalModel {
    return { ...model, id: model.id.trim(), name: model.name.trim(), bindings: model.bindings.map((binding) => ({ ...binding })) };
}

function validateDraft(draft: LogicalModel, models: LogicalModel[], channels: SystemModelChannel[], editingId: string) {
    const id = draft.id.trim();
    if (!id) return "请填写逻辑模型 ID";
    if (!/^[a-zA-Z0-9._:/-]+$/.test(id)) return "逻辑模型 ID 只能使用字母、数字、点、斜杠、冒号、下划线或短横线";
    if (models.some((model) => model.id !== editingId && model.id.toLowerCase() === id.toLowerCase())) return "逻辑模型 ID 已存在";
    if (!draft.name.trim()) return "请填写展示名称";
    if (!draft.bindings.length) return "至少添加一个渠道绑定";
    const seen = new Set<string>();
    for (const binding of draft.bindings) {
        const channel = channels.find((item) => item.id === binding.channelId);
        if (!channel) return "请选择有效渠道";
        if (!binding.upstreamModel || !channel.models.some((model) => normalizeModelName(model) === normalizeModelName(binding.upstreamModel))) return `渠道 ${channel.name} 中不存在上游模型 ${binding.upstreamModel || "（空）"}`;
        const key = `${binding.channelId}:${normalizeModelName(binding.upstreamModel)}`;
        if (seen.has(key)) return "同一渠道和上游模型不能重复绑定";
        seen.add(key);
    }
    return "";
}

function clearDefaultReference(defaults: SystemDefaultModels, modelId: string): SystemDefaultModels {
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, value.toLowerCase() === modelId.toLowerCase() ? "" : value])) as SystemDefaultModels;
}

function normalizeModelName(value: string) {
    return value
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
}
