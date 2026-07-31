"use client";

import { useEffect, useMemo, useState } from "react";
import { App, Alert, Button, Checkbox, Drawer, Empty, Input, Select, Space, Switch, Tag } from "antd";
import { ArrowLeft, Check, CircleDollarSign, FlaskConical, Link2, PlugZap, RefreshCw, Save, WandSparkles } from "lucide-react";
import { nanoid } from "nanoid";

import { AdminChannelProtocolSetup } from "@/components/admin/admin-channel-protocol-setup";
import { LabeledControl } from "@/components/admin/admin-settings-controls";
import { channelHealthKinds } from "@/components/admin/admin-system-channel-editor";
import type { ChannelHealthResult } from "@/components/admin/admin-system-channel-editor";
import { createSystemChannel } from "@/components/admin/admin-dashboard-elements";
import type { LogicalModel, LogicalModelCapability, SystemChannelAuthMode, SystemChannelProtocol, SystemModelChannel } from "@/lib/auth/store";
import { applyChannelProtocol, channelConnectionReady, channelProtocolDefinition, channelProtocolOptions, channelRequiresApiKey, resolveChannelAuthMode } from "@/lib/channel-protocol-registry";
import { capabilityLabel, channelModelCapability } from "@/lib/model-routing-config";

import { channelHealthEntries, defaultModelField, removeChannelFromWorkspace, switchChannelBindingUpstream, type ChannelWorkspaceSettings } from "./admin-channel-workspace-model";

type Props = {
    open: boolean;
    initialProtocol?: SystemChannelProtocol;
    settings: ChannelWorkspaceSettings;
    fetchingModelId: string;
    testingChannelKey: string;
    healthResults: Record<string, ChannelHealthResult>;
    saving: boolean;
    onClose: () => void;
    onChange: (settings: ChannelWorkspaceSettings) => void;
    onFetchModels: (channel: SystemModelChannel) => Promise<void>;
    onTestAll: (channel: SystemModelChannel) => Promise<void>;
    onPersist: (settings: ChannelWorkspaceSettings, successText: string) => Promise<boolean>;
};

const steps = [{ title: "选择协议" }, { title: "连接上游" }, { title: "获取模型" }, { title: "验证能力" }, { title: "绑定模型" }, { title: "确认启用" }];

export function AdminChannelOnboardingDrawer({ open, initialProtocol, settings, fetchingModelId, testingChannelKey, healthResults, saving, onClose, onChange, onFetchModels, onTestAll, onPersist }: Props) {
    const { message, modal } = App.useApp();
    const [step, setStep] = useState(0);
    const [selectedProtocol, setSelectedProtocol] = useState<SystemChannelProtocol>("openai");
    const [draftId, setDraftId] = useState("");
    const [bindingDraft, setBindingDraft] = useState(switchChannelBindingUpstream);
    const [setAsDefault, setSetAsDefault] = useState(true);
    const { upstreamModel: selectedUpstreamModel, logicalId: selectedLogicalId, newLogicalId, newLogicalName } = bindingDraft;
    const channel = settings.systemChannels.find((item) => item.id === draftId);
    const validations = draftId ? channelHealthEntries(draftId, healthResults, channel?.healthResults) : [];
    const verified = validations.some(({ result }) => result.ok);
    const bound = Boolean(channel && settings.logicalModels.some((model) => model.bindings.some((binding) => binding.channelId === channel.id)));

    useEffect(() => {
        if (!open) return;
        setStep(0);
        setSelectedProtocol(initialProtocol || "openai");
        setDraftId("");
        setBindingDraft(switchChannelBindingUpstream());
        setSetAsDefault(true);
    }, [initialProtocol, open]);

    useEffect(() => {
        if (!selectedUpstreamModel && channel?.models.length) setBindingDraft(switchChannelBindingUpstream(channel.models[0]));
    }, [channel?.models, selectedUpstreamModel]);

    const protocolOptions = useMemo(() => channelProtocolOptions().filter((item) => !["auto", "compatible"].includes(item.value)), []);
    const updateChannel = (patch: Partial<SystemModelChannel>) => {
        if (!draftId) return;
        onChange({ ...settings, systemChannels: settings.systemChannels.map((item) => (item.id === draftId ? { ...item, ...patch } : item)) });
    };
    const beginChannel = () => {
        const definition = channelProtocolDefinition(selectedProtocol);
        const next = applyChannelProtocol({ ...createSystemChannel(), name: `${definition.label} 渠道`, enabled: false }, selectedProtocol);
        onChange({ ...settings, systemChannels: [...settings.systemChannels, next] });
        setDraftId(next.id);
        setStep(1);
    };
    const returnToProtocols = () => {
        if (draftId) onChange(removeChannelFromWorkspace(settings, draftId));
        setDraftId("");
        setStep(0);
    };
    const cancel = () => {
        if (!draftId) return onClose();
        modal.confirm({
            title: "退出接入向导？",
            content: "当前尚未保存的渠道草稿将被移除。",
            okText: "退出并移除",
            cancelText: "继续配置",
            okButtonProps: { danger: true },
            onOk: () => {
                onChange(removeChannelFromWorkspace(settings, draftId));
                onClose();
            },
        });
    };
    const saveDraft = async () => {
        if (!channel) return;
        const next = { ...settings, systemChannels: settings.systemChannels.map((item) => (item.id === channel.id ? { ...item, enabled: false } : item)) };
        onChange(next);
        if (await onPersist(next, "渠道草稿已保存")) onClose();
    };
    const enableChannel = async () => {
        if (!channel || !verified || !bound) return;
        const next = { ...settings, systemChannels: settings.systemChannels.map((item) => (item.id === channel.id ? { ...item, enabled: true } : item)) };
        onChange(next);
        if (await onPersist(next, "渠道已启用")) onClose();
    };
    const bindModel = () => {
        if (!channel || !selectedUpstreamModel) return message.error("请选择上游模型");
        const capability = channelModelCapability(channel, selectedUpstreamModel);
        let logicalModels = settings.logicalModels;
        let logical: LogicalModel | undefined;
        if (selectedLogicalId) logical = logicalModels.find((item) => item.id === selectedLogicalId && item.capability === capability);
        else {
            const id = newLogicalId.trim();
            if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) return message.error("逻辑模型 ID 只能包含字母、数字、点、下划线和短横线");
            if (logicalModels.some((item) => item.id.toLowerCase() === id.toLowerCase())) return message.error("逻辑模型 ID 已存在");
            logical = { id, name: newLogicalName.trim() || id, capability, enabled: true, bindings: [] };
            logicalModels = [...logicalModels, logical];
        }
        if (!logical) return message.error("请选择或创建逻辑模型");
        const exists = logical.bindings.some((binding) => binding.channelId === channel.id && binding.upstreamModel === selectedUpstreamModel);
        const nextLogical = exists
            ? logical
            : {
                  ...logical,
                  bindings: [...logical.bindings, { id: nanoid(), channelId: channel.id, upstreamModel: selectedUpstreamModel, enabled: true, priority: logical.bindings.length + 1, weight: 100 }],
              };
        logicalModels = logicalModels.map((item) => (item.id === logical!.id ? nextLogical : item));
        const defaultModels = setAsDefault ? { ...settings.defaultModels, [defaultModelField(capability)]: nextLogical.id } : settings.defaultModels;
        onChange({ ...settings, logicalModels, defaultModels });
        setBindingDraft((current) => ({ ...current, logicalId: nextLogical.id, newLogicalId: "", newLogicalName: "" }));
        message.success(exists ? "这个上游绑定已经存在" : "上游模型已绑定");
    };

    const renderStep = () => {
        if (step === 0) return <ProtocolSelection protocols={protocolOptions} selected={selectedProtocol} onSelect={setSelectedProtocol} />;
        if (!channel) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="渠道草稿不存在" />;
        if (step === 1) return <ConnectionStep channel={channel} onChange={updateChannel} />;
        if (step === 2) return <ModelStep channel={channel} fetching={fetchingModelId === channel.id} onChange={updateChannel} onFetch={() => void onFetchModels(channel)} />;
        if (step === 3) return <ValidationStep channel={channel} entries={validations} testing={testingChannelKey === `${channel.id}:all`} onTest={() => void onTestAll(channel)} />;
        if (step === 4)
            return (
                <BindingStep
                    channel={channel}
                    logicalModels={settings.logicalModels}
                    selectedUpstreamModel={selectedUpstreamModel}
                    selectedLogicalId={selectedLogicalId}
                    newLogicalId={newLogicalId}
                    newLogicalName={newLogicalName}
                    setAsDefault={setAsDefault}
                    onSelectUpstream={(value) => setBindingDraft(switchChannelBindingUpstream(value))}
                    onSelectLogical={(value) => setBindingDraft((current) => ({ ...current, logicalId: value }))}
                    onNewLogicalId={(value) => setBindingDraft((current) => ({ ...current, newLogicalId: value }))}
                    onNewLogicalName={(value) => setBindingDraft((current) => ({ ...current, newLogicalName: value }))}
                    onSetAsDefault={setSetAsDefault}
                    onBind={bindModel}
                />
            );
        return <ReviewStep channel={channel} settings={settings} validations={validations} />;
    };

    const nextDisabled = step === 1 ? !channel?.name.trim() || !channelConnectionReady(channel) : step === 2 ? !channel?.models.length : step === 4 ? !bound : false;

    return (
        <Drawer
            title="接入新渠道"
            size="min(736px, 100vw)"
            open={open}
            destroyOnHidden
            mask={{ closable: false }}
            onClose={cancel}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button onClick={step === 0 ? cancel : step === 1 ? returnToProtocols : () => setStep((current) => current - 1)} icon={step ? <ArrowLeft className="size-4" /> : undefined}>
                        {step ? "上一步" : "取消"}
                    </Button>
                    <Space wrap>
                        {step > 0 ? (
                            <Button loading={saving} icon={<Save className="size-4" />} onClick={() => void saveDraft()}>
                                保存草稿
                            </Button>
                        ) : null}
                        {step < steps.length - 1 ? (
                            <Button type="primary" disabled={nextDisabled} onClick={step === 0 ? beginChannel : () => setStep((current) => current + 1)}>
                                {step === 0 ? "开始配置" : "下一步"}
                            </Button>
                        ) : (
                            <Button type="primary" loading={saving} disabled={!verified || !bound} icon={<Check className="size-4" />} onClick={() => void enableChannel()}>
                                启用渠道
                            </Button>
                        )}
                    </Space>
                </div>
            }
        >
            <div className="mb-5 md:hidden">
                <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                        步骤 {step + 1} / {steps.length}
                    </span>
                    <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{steps[step].title}</span>
                </div>
                <div className="grid grid-cols-6 gap-1" role="progressbar" aria-label={`接入进度：${steps[step].title}`} aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step + 1}>
                    {steps.map((item, index) => (
                        <span key={item.title} className={`h-1 rounded-full ${index < step ? "bg-emerald-500 dark:bg-emerald-400" : index === step ? "bg-stone-950 dark:bg-stone-100" : "bg-stone-200 dark:bg-stone-700"}`} aria-hidden />
                    ))}
                </div>
            </div>
            <OnboardingProgress current={step} />
            {renderStep()}
        </Drawer>
    );
}

function OnboardingProgress({ current }: { current: number }) {
    return (
        <div className="mb-6 hidden md:block">
            <ol className="flex min-w-0 items-center" aria-label={`接入进度：${steps[current].title}`}>
                {steps.map((item, index) => {
                    const completed = index < current;
                    const active = index === current;
                    return (
                        <li key={item.title} className={`flex min-w-0 items-center ${index < steps.length - 1 ? "flex-1" : ""}`} aria-current={active ? "step" : undefined}>
                            <span className="flex shrink-0 items-center gap-2">
                                <span
                                    className={`inline-flex size-7 items-center justify-center rounded-full border text-xs font-semibold ${
                                        completed
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                                            : active
                                              ? "border-stone-950 bg-stone-950 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950"
                                              : "border-stone-200 bg-stone-100 text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400"
                                    }`}
                                    aria-label={completed ? `${item.title}已完成` : active ? `${item.title}进行中` : `${item.title}未开始`}
                                >
                                    {completed ? (
                                        <span className="inline-flex size-5.5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm shadow-emerald-600/20 dark:bg-emerald-400 dark:text-emerald-950">
                                            <Check className="size-3.5" aria-hidden />
                                        </span>
                                    ) : (
                                        index + 1
                                    )}
                                </span>
                                <span
                                    className={`whitespace-nowrap text-sm ${
                                        completed ? "font-semibold text-emerald-700 dark:text-emerald-300" : active ? "font-semibold text-stone-950 dark:text-stone-100" : "font-medium text-stone-400 dark:text-stone-500"
                                    }`}
                                >
                                    {item.title}
                                </span>
                            </span>
                            {index < steps.length - 1 ? <span className={`mx-2 h-px min-w-2 flex-1 ${completed ? "bg-emerald-300 dark:bg-emerald-700" : "bg-stone-300 dark:bg-stone-700"}`} aria-hidden /> : null}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}

function ProtocolSelection({ protocols, selected, onSelect }: { protocols: ReturnType<typeof channelProtocolOptions>; selected: SystemChannelProtocol; onSelect: (protocol: SystemChannelProtocol) => void }) {
    return (
        <div>
            <div className="mb-3 text-sm font-semibold text-stone-950 dark:text-stone-100">选择上游协议</div>
            <div className="grid gap-2 sm:grid-cols-2">
                {protocols.map((protocol) => {
                    const definition = channelProtocolDefinition(protocol.value);
                    const active = selected === protocol.value;
                    return (
                        <button
                            key={protocol.value}
                            type="button"
                            aria-pressed={active}
                            className={`min-w-0 rounded-md border p-3 text-left transition ${active ? "!border-stone-950 !bg-stone-50 !text-stone-950 ring-1 ring-inset ring-stone-950 dark:!border-stone-100 dark:!bg-stone-900 dark:!text-stone-100 dark:ring-stone-100" : "border-stone-200 bg-white text-stone-950 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100 dark:hover:border-stone-600 dark:hover:bg-stone-900"}`}
                            onClick={() => onSelect(protocol.value)}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold">{protocol.label}</span>
                                {active ? <Check className="size-4 shrink-0" aria-hidden /> : protocol.value === "custom" ? <WandSparkles className="size-4 shrink-0" aria-hidden /> : <PlugZap className="size-4 shrink-0" aria-hidden />}
                            </div>
                            <div className={`mt-1 text-xs leading-5 ${active ? "text-stone-600 dark:text-stone-300" : "text-stone-500 dark:text-stone-400"}`}>{protocol.description}</div>
                            <div className="mt-2 flex flex-wrap gap-1">
                                {definition.capabilities.map((capability) => (
                                    <span
                                        key={capability}
                                        className={`rounded border px-1.5 py-0.5 text-[11px] ${active ? "border-stone-400 bg-white text-stone-800 dark:border-stone-600 dark:bg-stone-950 dark:text-stone-200" : "border-stone-200 text-stone-700 dark:border-stone-700 dark:text-stone-300"}`}
                                    >
                                        {capabilityLabel(capability)}
                                    </span>
                                ))}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function ConnectionStep({ channel, onChange }: { channel: SystemModelChannel; onChange: (patch: Partial<SystemModelChannel>) => void }) {
    const custom = channel.advancedConfig?.protocol === "custom";
    const authMode = resolveChannelAuthMode(channel.advancedConfig);
    const requiresApiKey = channelRequiresApiKey(channel);
    const updateAuth = (patch: Partial<NonNullable<SystemModelChannel["advancedConfig"]>>) => onChange({ advancedConfig: { ...channel.advancedConfig!, ...patch } });
    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
                <LabeledControl label="渠道名称">
                    <Input value={channel.name} placeholder="例如：生产主渠道" onChange={(event) => onChange({ name: event.target.value })} />
                </LabeledControl>
                <LabeledControl label="Base URL">
                    <Input value={channel.baseUrl} placeholder="https://api.example.com" onChange={(event) => onChange({ baseUrl: event.target.value })} />
                </LabeledControl>
                {custom ? (
                    <LabeledControl label="鉴权方式">
                        <Select className="w-full" value={authMode} options={authModeOptions} onChange={(value: SystemChannelAuthMode) => updateAuth({ authMode: value, ...(value !== "custom-header" ? { authHeader: "", authPrefix: "" } : {}) })} />
                    </LabeledControl>
                ) : null}
                {custom && authMode === "custom-header" ? (
                    <>
                        <LabeledControl label="鉴权 Header">
                            <Input value={channel.advancedConfig?.authHeader} placeholder="例如 X-API-Key" onChange={(event) => updateAuth({ authHeader: event.target.value })} />
                        </LabeledControl>
                        <LabeledControl label="值前缀（可选）">
                            <Input value={channel.advancedConfig?.authPrefix} placeholder="例如 Token" onChange={(event) => updateAuth({ authPrefix: event.target.value })} />
                        </LabeledControl>
                    </>
                ) : null}
                {requiresApiKey ? (
                    <div className="sm:col-span-2">
                        <LabeledControl label="API Key">
                            <Input.Password value={channel.apiKey} autoComplete="off" placeholder="仅保存在服务端" onChange={(event) => onChange({ apiKey: event.target.value, clearApiKey: false })} />
                        </LabeledControl>
                    </div>
                ) : (
                    <div className="sm:col-span-2 border-y border-stone-200 py-3 text-sm text-stone-600 dark:border-stone-800 dark:text-stone-300">当前协议无需 API Key，服务端不会发送鉴权请求头。</div>
                )}
            </div>
            {custom ? <AdminChannelProtocolSetup channel={channel} protocolLocked onChange={onChange} /> : <ProtocolLockedSummary channel={channel} />}
        </div>
    );
}

const authModeOptions: Array<{ label: string; value: SystemChannelAuthMode }> = [
    { label: "无需鉴权", value: "none" },
    { label: "Bearer Token", value: "bearer" },
    { label: "X-API-Key", value: "x-api-key" },
    { label: "自定义 Header", value: "custom-header" },
];

function ProtocolLockedSummary({ channel }: { channel: SystemModelChannel }) {
    const definition = channelProtocolDefinition(channel.advancedConfig?.protocol || "auto");
    return (
        <div className="border-y border-stone-200 py-3 dark:border-stone-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{definition.label}</div>
                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">内置协议参数由注册表固定，渠道只保存地址、凭据和模型。</div>
                </div>
                <Tag className="m-0 !border-stone-300 !bg-stone-50 !text-stone-700 dark:!border-stone-700 dark:!bg-stone-900 dark:!text-stone-200">{definition.strict ? "严格协议" : "兼容协议"}</Tag>
            </div>
        </div>
    );
}

function ModelStep({ channel, fetching, onChange, onFetch }: { channel: SystemModelChannel; fetching: boolean; onChange: (patch: Partial<SystemModelChannel>) => void; onFetch: () => void }) {
    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div>
                    <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">上游模型</div>
                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">同步只会合并模型，不删除手工模型。</div>
                </div>
                <Button icon={<RefreshCw className="size-4" />} loading={fetching} onClick={onFetch}>
                    同步模型
                </Button>
            </div>
            <LabeledControl label="模型列表">
                <Select mode="tags" className="w-full" maxTagCount="responsive" value={channel.models} placeholder="同步失败时可手动输入模型 ID" onChange={(models) => onChange({ models })} />
            </LabeledControl>
            <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                {channel.models.map((model) => (
                    <div key={model} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                        <span className="min-w-0 truncate text-sm font-medium text-stone-900 dark:text-stone-100">{model}</span>
                        <Tag className="m-0">{capabilityLabel(channelModelCapability(channel, model))}</Tag>
                    </div>
                ))}
                {!channel.models.length ? <div className="py-8 text-center text-sm text-stone-500 dark:text-stone-400">尚未获得模型</div> : null}
            </div>
        </div>
    );
}

function ValidationStep({ channel, entries, testing, onTest }: { channel: SystemModelChannel; entries: ReturnType<typeof channelHealthEntries>; testing: boolean; onTest: () => void }) {
    const kinds = channelHealthKinds(channel);
    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3 dark:border-stone-800">
                <div>
                    <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">能力验证</div>
                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">检测会调用真实上游，图片、视频或音频测试可能产生费用。</div>
                </div>
                <Button type="primary" icon={<FlaskConical className="size-4" />} loading={testing} onClick={onTest}>
                    执行全部检测
                </Button>
            </div>
            <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                {kinds.map((kind) => {
                    const result = entries.find((entry) => entry.result.kind === kind)?.result;
                    return (
                        <div key={kind} className="flex items-center justify-between gap-3 py-3">
                            <div>
                                <div className="text-sm font-medium text-stone-900 dark:text-stone-100">{capabilityLabel(kind)}</div>
                                <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{result?.model || "等待检测"}</div>
                            </div>
                            <Tag color={result ? (result.ok ? "success" : "error") : "default"}>{result ? (result.ok ? "通过" : "失败") : "未检测"}</Tag>
                        </div>
                    );
                })}
            </div>
            {entries.some(({ result }) => !result.ok) ? (
                <Alert
                    className="mt-4"
                    type="warning"
                    showIcon
                    message="部分能力需要检查"
                    description={entries
                        .filter(({ result }) => !result.ok)
                        .map(({ result }) => result.error || `${capabilityLabel(result.kind)}检测失败`)
                        .join("；")}
                />
            ) : null}
        </div>
    );
}

function BindingStep({
    channel,
    logicalModels,
    selectedUpstreamModel,
    selectedLogicalId,
    newLogicalId,
    newLogicalName,
    setAsDefault,
    onSelectUpstream,
    onSelectLogical,
    onNewLogicalId,
    onNewLogicalName,
    onSetAsDefault,
    onBind,
}: {
    channel: SystemModelChannel;
    logicalModels: LogicalModel[];
    selectedUpstreamModel: string;
    selectedLogicalId: string;
    newLogicalId: string;
    newLogicalName: string;
    setAsDefault: boolean;
    onSelectUpstream: (value: string) => void;
    onSelectLogical: (value: string) => void;
    onNewLogicalId: (value: string) => void;
    onNewLogicalName: (value: string) => void;
    onSetAsDefault: (value: boolean) => void;
    onBind: () => void;
}) {
    const capability: LogicalModelCapability = selectedUpstreamModel ? channelModelCapability(channel, selectedUpstreamModel) : "text";
    const candidates = logicalModels.filter((model) => model.capability === capability);
    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
                <LabeledControl label="上游模型">
                    <Select showSearch optionFilterProp="label" className="w-full" value={selectedUpstreamModel || undefined} options={channel.models.map((model) => ({ label: model, value: model }))} onChange={onSelectUpstream} />
                </LabeledControl>
                <LabeledControl label="识别能力">
                    <Input value={capabilityLabel(capability)} disabled />
                </LabeledControl>
            </div>
            <div className="border-y border-stone-200 py-4 dark:border-stone-800">
                <LabeledControl label="绑定已有逻辑模型">
                    <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        className="w-full"
                        value={selectedLogicalId || undefined}
                        placeholder="不选择则创建新逻辑模型"
                        options={candidates.map((model) => ({ label: `${model.name} (${model.id})`, value: model.id }))}
                        onChange={(value) => onSelectLogical(value || "")}
                    />
                </LabeledControl>
                {!selectedLogicalId ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <LabeledControl label="新逻辑模型 ID">
                            <Input value={newLogicalId} placeholder="例如：video-pro" onChange={(event) => onNewLogicalId(event.target.value)} />
                        </LabeledControl>
                        <LabeledControl label="展示名称">
                            <Input value={newLogicalName} placeholder="例如：专业视频模型" onChange={(event) => onNewLogicalName(event.target.value)} />
                        </LabeledControl>
                    </div>
                ) : null}
            </div>
            <div className="flex min-h-10 items-center justify-between gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
                <span className="text-sm text-stone-700 dark:text-stone-300">设为默认{capabilityLabel(capability)}模型</span>
                <Switch checked={setAsDefault} onChange={onSetAsDefault} />
            </div>
            <Button type="primary" icon={<Link2 className="size-4" />} onClick={onBind}>
                绑定模型
            </Button>
        </div>
    );
}

function ReviewStep({ channel, settings, validations }: { channel: SystemModelChannel; settings: ChannelWorkspaceSettings; validations: ReturnType<typeof channelHealthEntries> }) {
    const bindings = settings.logicalModels.flatMap((model) => model.bindings.filter((binding) => binding.channelId === channel.id).map((binding) => ({ logical: model, binding })));
    return (
        <div className="space-y-5">
            <div className="grid gap-x-6 gap-y-4 border-y border-stone-200 py-4 sm:grid-cols-2 dark:border-stone-800">
                <ReviewValue label="渠道" value={channel.name} />
                <ReviewValue label="协议" value={channelProtocolDefinition(channel.advancedConfig?.protocol || "auto").label} />
                <ReviewValue label="Base URL" value={channel.baseUrl} />
                <ReviewValue label="上游模型" value={`${channel.models.length} 个`} />
                <ReviewValue label="能力检测" value={`${validations.filter(({ result }) => result.ok).length}/${Math.max(validations.length, 1)} 通过`} />
                <ReviewValue label="逻辑绑定" value={`${bindings.length} 个`} />
            </div>
            <div>
                <div className="mb-2 text-sm font-semibold text-stone-950 dark:text-stone-100">模型绑定</div>
                <div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                    {bindings.map(({ logical, binding }) => (
                        <div key={binding.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                            <span>{logical.name}</span>
                            <span className="min-w-0 truncate text-stone-500 dark:text-stone-400">{binding.upstreamModel}</span>
                        </div>
                    ))}
                </div>
            </div>
            {!validations.some(({ result }) => result.ok) ? <Alert type="warning" showIcon message="尚未通过能力检测" description="可以保存为停用草稿；通过至少一项真实能力检测后才能启用。" /> : null}
            <div className="flex items-start gap-2 text-xs leading-5 text-stone-500 dark:text-stone-400">
                <CircleDollarSign className="mt-0.5 size-4 shrink-0" />
                <span>用户积分仍按逻辑模型配置；上游模型名只用于真实请求。</span>
            </div>
        </div>
    );
}

function ReviewValue({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
            <div className="mt-1 break-all text-sm font-medium text-stone-950 dark:text-stone-100">{value || "未设置"}</div>
        </div>
    );
}
