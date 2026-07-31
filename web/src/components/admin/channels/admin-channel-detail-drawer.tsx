"use client";

import { Button, Drawer, Empty, Space, Tabs, Tag } from "antd";
import { FlaskConical, RefreshCw } from "lucide-react";

import { SystemChannelEditor, channelHealthKinds, healthKindLabel } from "@/components/admin/admin-system-channel-editor";
import type { ChannelHealthKind, ChannelHealthResult } from "@/components/admin/admin-system-channel-editor";
import type { SystemModelChannel } from "@/lib/auth/store";
import { channelRequiresApiKey } from "@/lib/channel-protocol-registry";
import { capabilityLabel, channelModelCapability } from "@/lib/model-routing-config";

import { ChannelStatusBadge } from "./admin-channel-status-badge";
import { channelBindingCount, channelCapabilityLabels, channelHealthEntries, channelProtocolLabel, channelWorkspaceStatus, type ChannelWorkspaceSettings } from "./admin-channel-workspace-model";

type Props = {
    open: boolean;
    channel?: SystemModelChannel;
    settings: ChannelWorkspaceSettings;
    fetching: boolean;
    testingKey: string;
    healthResults: Record<string, ChannelHealthResult>;
    onClose: () => void;
    onChange: (patch: Partial<SystemModelChannel>) => void;
    onDelete: () => void;
    onFetchModels: () => void;
    onTestHealth: (kind: ChannelHealthKind) => void;
    onTestAll: () => void;
};

export function AdminChannelDetailDrawer({ open, channel, settings, fetching, testingKey, healthResults, onClose, onChange, onDelete, onFetchModels, onTestHealth, onTestAll }: Props) {
    if (!channel) return null;
    const entries = channelHealthEntries(channel.id, healthResults, channel.healthResults);
    const status = channelWorkspaceStatus(channel, healthResults);
    return (
        <Drawer title={channel.name || "渠道详情"} size="large" open={open} destroyOnHidden onClose={onClose}>
            <Tabs
                items={[
                    {
                        key: "overview",
                        label: "概览",
                        children: <ChannelOverview channel={channel} settings={settings} entries={entries} status={status} onFetchModels={onFetchModels} onTestAll={onTestAll} fetching={fetching} testing={testingKey === `${channel.id}:all`} />,
                    },
                    {
                        key: "config",
                        label: "渠道配置",
                        children: (
                            <SystemChannelEditor
                                channel={channel}
                                fetching={fetching}
                                testingKey={testingKey}
                                healthResults={healthResults}
                                onChange={onChange}
                                onDelete={() => {
                                    onClose();
                                    onDelete();
                                }}
                                onFetchModels={onFetchModels}
                                onTestHealth={onTestHealth}
                                onTestAllHealth={onTestAll}
                            />
                        ),
                    },
                    { key: "models", label: `上游模型 ${channel.models.length}`, children: <ChannelModels channel={channel} /> },
                    { key: "validation", label: "能力验证", children: <ChannelValidation channel={channel} entries={entries} testingKey={testingKey} onTestHealth={onTestHealth} onTestAll={onTestAll} /> },
                ]}
            />
        </Drawer>
    );
}

function ChannelOverview({
    channel,
    settings,
    entries,
    status,
    onFetchModels,
    onTestAll,
    fetching,
    testing,
}: {
    channel: SystemModelChannel;
    settings: ChannelWorkspaceSettings;
    entries: ReturnType<typeof channelHealthEntries>;
    status: ReturnType<typeof channelWorkspaceStatus>;
    onFetchModels: () => void;
    onTestAll: () => void;
    fetching: boolean;
    testing: boolean;
}) {
    const capabilities = channelCapabilityLabels(channel);
    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
                <div className="flex flex-wrap items-center gap-2">
                    <ChannelStatusBadge status={status} />
                    <Tag>{channelProtocolLabel(channel)}</Tag>
                    {capabilities.map((capability) => (
                        <Tag key={capability}>{capability}</Tag>
                    ))}
                </div>
                <Space wrap>
                    <Button icon={<RefreshCw className="size-4" />} loading={fetching} onClick={onFetchModels}>
                        同步模型
                    </Button>
                    <Button type="primary" icon={<FlaskConical className="size-4" />} loading={testing} onClick={onTestAll}>
                        检测渠道
                    </Button>
                </Space>
            </div>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <OverviewValue label="Base URL" value={channel.baseUrl || "未配置"} />
                <OverviewValue label="凭据" value={channelRequiresApiKey(channel) ? (channel.apiKey || channel.hasApiKey ? "已安全保存" : "未配置") : "无需凭据"} />
                <OverviewValue label="协议" value={channelProtocolLabel(channel)} />
                <OverviewValue label="上游模型" value={`${channel.models.length} 个`} />
                <OverviewValue label="逻辑绑定" value={`${channelBindingCount(channel.id, settings)} 个`} />
                <OverviewValue label="本次检测" value={entries.length ? `${entries.filter(({ result }) => result.ok).length}/${entries.length} 通过` : "尚未检测"} />
            </div>
            <div>
                <div className="mb-2 text-sm font-semibold text-stone-950 dark:text-stone-100">逻辑模型绑定</div>
                <div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                    {settings.logicalModels.flatMap((model) =>
                        model.bindings
                            .filter((binding) => binding.channelId === channel.id)
                            .map((binding) => (
                                <div key={binding.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5 text-sm">
                                    <span className="font-medium text-stone-900 dark:text-stone-100">{model.name}</span>
                                    <span className="min-w-0 truncate text-stone-500 dark:text-stone-400">{binding.upstreamModel}</span>
                                </div>
                            )),
                    )}
                    {!channelBindingCount(channel.id, settings) ? <div className="py-8 text-center text-sm text-stone-500 dark:text-stone-400">尚未绑定逻辑模型</div> : null}
                </div>
            </div>
        </div>
    );
}

function ChannelModels({ channel }: { channel: SystemModelChannel }) {
    return (
        <div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {channel.models.map((model) => (
                <div key={model} className="flex min-w-0 items-center justify-between gap-3 py-3">
                    <span className="min-w-0 truncate text-sm font-medium text-stone-950 dark:text-stone-100">{model}</span>
                    <Tag className="m-0">{capabilityLabel(channelModelCapability(channel, model))}</Tag>
                </div>
            ))}
            {!channel.models.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有上游模型" /> : null}
        </div>
    );
}

function ChannelValidation({
    channel,
    entries,
    testingKey,
    onTestHealth,
    onTestAll,
}: {
    channel: SystemModelChannel;
    entries: ReturnType<typeof channelHealthEntries>;
    testingKey: string;
    onTestHealth: (kind: ChannelHealthKind) => void;
    onTestAll: () => void;
}) {
    const kinds = channelHealthKinds(channel);
    return (
        <div>
            <div className="mb-4 flex flex-wrap justify-end gap-2">
                {kinds.map((kind) => (
                    <Button key={kind} loading={testingKey === `${channel.id}:${kind}`} onClick={() => onTestHealth(kind)}>
                        检测{healthKindLabel(kind)}
                    </Button>
                ))}
                <Button type="primary" icon={<FlaskConical className="size-4" />} loading={testingKey === `${channel.id}:all`} onClick={onTestAll}>
                    全部检测
                </Button>
            </div>
            <div className="divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                {entries.map(({ key, result }) => (
                    <div key={key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <div className="text-sm font-medium text-stone-900 dark:text-stone-100">
                                {healthKindLabel(result.kind)} · {result.model || "未选择模型"}
                            </div>
                            <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{result.ok ? result.protocol || "上游响应正常" : result.error || `HTTP ${result.status}`}</div>
                        </div>
                        <Tag color={result.ok ? "success" : "error"}>{result.ok ? "通过" : "失败"}</Tag>
                    </div>
                ))}
                {!entries.length ? <div className="py-10 text-center text-sm text-stone-500 dark:text-stone-400">当前管理会话还没有检测记录</div> : null}
            </div>
        </div>
    );
}

function OverviewValue({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 border-b border-stone-100 pb-3 dark:border-stone-900">
            <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
            <div className="mt-1 break-all text-sm font-medium text-stone-950 dark:text-stone-100">{value}</div>
        </div>
    );
}
