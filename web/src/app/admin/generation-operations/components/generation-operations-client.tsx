"use client";

import { App, Button, Input, Pagination, Select, Table, Tag, Tooltip } from "antd";
import type { TableColumnsType } from "antd";
import { Activity, CircleStop, Clock3, Coins, RefreshCw, RotateCcw, Route, ServerCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Panel } from "@/components/admin/admin-panel";
import { AdminUserIdentity } from "@/components/admin/admin-user-identity";
import type { AdminGenerationChannel, AdminGenerationOperationsPayload, AdminGenerationTask } from "@/lib/admin-generation-operations";

const PAGE_SIZE = 20;

export function GenerationOperationsClient() {
    const { message } = App.useApp();
    const [data, setData] = useState<AdminGenerationOperationsPayload>();
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [type, setType] = useState("");
    const [status, setStatus] = useState("");
    const [surface, setSurface] = useState("");
    const [search, setSearch] = useState("");
    const [submittedSearch, setSubmittedSearch] = useState("");
    const [actingId, setActingId] = useState("");
    const [health, setHealth] = useState<Record<string, { loading?: boolean; ok?: boolean; error?: string; status?: number }>>({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
            if (type) query.set("type", type);
            if (status) query.set("status", status);
            if (surface) query.set("surface", surface);
            if (submittedSearch) query.set("search", submittedSearch);
            const response = await fetch(`/api/admin/generation-operations?${query}`, { cache: "no-store" });
            const payload = (await response.json().catch(() => ({}))) as { data?: AdminGenerationOperationsPayload; msg?: string };
            if (!response.ok || !payload.data) throw new Error(payload.msg || "任务数据加载失败");
            setData(payload.data);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "任务数据加载失败");
        } finally {
            setLoading(false);
        }
    }, [message, page, status, submittedSearch, surface, type]);

    useEffect(() => {
        void load();
    }, [load]);

    const runAction = async (task: AdminGenerationTask, action: "cancel" | "retry") => {
        setActingId(`${task.id}:${action}`);
        try {
            const url =
                action === "retry"
                    ? `/api/agent/runs/${encodeURIComponent(task.id)}/tasks/${encodeURIComponent(task.retryTaskId || "")}/retry`
                    : task.type === "agent"
                      ? `/api/agent/runs/${encodeURIComponent(task.id)}/cancel`
                      : task.type === "render"
                        ? `/api/drama/render/${encodeURIComponent(task.id)}`
                        : `/api/${task.type}-tasks/${encodeURIComponent(task.id)}`;
            const response = await fetch(url, action === "retry" || task.type === "agent" ? { method: "POST" } : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) });
            const payload = (await response.json().catch(() => ({}))) as { msg?: string; error?: string };
            if (!response.ok) throw new Error(payload.msg || payload.error || "任务操作失败");
            message.success(action === "retry" ? "失败子任务已重新提交" : "任务已取消");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "任务操作失败");
        } finally {
            setActingId("");
        }
    };

    const testChannel = async (channel: AdminGenerationChannel) => {
        const key = channelKey(channel);
        setHealth((current) => ({ ...current, [key]: { loading: true } }));
        try {
            const response = await fetch("/api/admin/channel-health", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channelId: channel.id, model: channel.upstreamModel, kind: channel.capability }),
            });
            const payload = (await response.json().catch(() => ({}))) as { result?: { ok?: boolean; status?: number; error?: string }; error?: string };
            if (!response.ok || !payload.result) throw new Error(payload.error || "渠道探测失败");
            setHealth((current) => ({ ...current, [key]: { ok: Boolean(payload.result?.ok), status: payload.result?.status, error: payload.result?.error } }));
        } catch (error) {
            setHealth((current) => ({ ...current, [key]: { ok: false, error: error instanceof Error ? error.message : "渠道探测失败" } }));
        }
    };

    const columns = useMemo<TableColumnsType<AdminGenerationTask>>(
        () => [
            {
                title: "任务",
                dataIndex: "id",
                width: 260,
                render: (_, task) => (
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <Tag className="m-0">{taskTypeLabel(task.type)}</Tag>
                            <StatusTag status={task.status} />
                        </div>
                        <Tooltip title={task.id}>
                            <div className="mt-2 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{task.id}</div>
                        </Tooltip>
                    </div>
                ),
            },
            {
                title: "用户",
                width: 210,
                render: (_, task) => <AdminUserIdentity displayName={task.displayName} username={task.username} accountId={task.accountId} fallback="用户信息不可用" />,
            },
            {
                title: "模型 / 入口",
                width: 190,
                render: (_, task) => (
                    <div>
                        <div className="truncate text-sm">{task.model || "未记录"}</div>
                        <div className="mt-1 text-xs text-zinc-500">
                            {surfaceLabel(task.surface)}
                            {task.channelId ? ` · 渠道 ${task.channelId}` : ""}
                            {task.projectId ? ` · 项目 ${task.projectId.slice(0, 8)}` : ""}
                        </div>
                    </div>
                ),
            },
            {
                title: "请求",
                render: (_, task) => (
                    <div>
                        <div className="line-clamp-2 text-sm leading-5">{task.prompt || task.error || "无请求摘要"}</div>
                        <div className="mt-1 text-xs text-zinc-500">
                            {formatDuration(task.durationMs)} · {task.pointsCost} 积分{task.attempts && task.attempts.length > 1 ? ` · ${task.attempts.length} 次渠道尝试` : ""}
                        </div>
                    </div>
                ),
            },
            {
                title: "操作",
                width: 118,
                fixed: "right",
                render: (_, task) => (
                    <div className="flex gap-1">
                        {task.canCancel ? (
                            <Tooltip title="取消任务">
                                <Button danger type="text" shape="circle" icon={<CircleStop className="size-4" />} loading={actingId === `${task.id}:cancel`} onClick={() => void runAction(task, "cancel")} />
                            </Tooltip>
                        ) : null}
                        {task.retryTaskId ? (
                            <Tooltip title="重试失败子任务">
                                <Button type="text" shape="circle" icon={<RotateCcw className="size-4" />} loading={actingId === `${task.id}:retry`} onClick={() => void runAction(task, "retry")} />
                            </Tooltip>
                        ) : null}
                    </div>
                ),
            },
        ],
        [actingId],
    );

    const summary = data?.summary;
    return (
        <Panel>
            <section className="grid grid-cols-2 gap-px border-b border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800 sm:grid-cols-3 xl:grid-cols-5">
                <Metric icon={<Activity />} label="任务总数" value={summary?.total || 0} />
                <Metric icon={<Route />} label="执行中" value={summary?.active || 0} />
                <Metric icon={<CircleStop />} label="失败" value={summary?.failed || 0} />
                <Metric icon={<Clock3 />} label="平均耗时" value={formatDuration(summary?.averageDurationMs || 0)} />
                <Metric className="col-span-2 sm:col-span-1" icon={<Coins />} label="积分消耗" value={summary?.totalPointsCost || 0} />
            </section>

            <section className="p-3 sm:p-5">
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(130px,180px))_auto] xl:gap-3">
                    <Input.Search
                        className="col-span-2 xl:col-span-1"
                        value={search}
                        allowClear
                        placeholder="任务、用户或用户 ID、模型、会话或项目"
                        enterButton="筛选"
                        onChange={(event) => setSearch(event.target.value)}
                        onSearch={(value) => {
                            setPage(1);
                            setSubmittedSearch(value.trim());
                        }}
                    />
                    <Select
                        value={type || undefined}
                        allowClear
                        placeholder="任务类型"
                        options={["agent", "text", "image", "video", "audio", "render"].map((value) => ({ value, label: taskTypeLabel(value) }))}
                        onChange={(value) => {
                            setPage(1);
                            setType(value || "");
                        }}
                    />
                    <Select
                        value={status || undefined}
                        allowClear
                        placeholder="任务状态"
                        options={["pending", "running", "paused", "success", "error", "cancelled"].map((value) => ({ value, label: statusLabel(value) }))}
                        onChange={(value) => {
                            setPage(1);
                            setStatus(value || "");
                        }}
                    />
                    <div className="col-span-2 min-w-0 xl:col-span-1">
                        <Select
                            className="w-full"
                            value={surface || undefined}
                            allowClear
                            placeholder="创作入口"
                            options={[
                                { value: "chat", label: "创作对话" },
                                { value: "canvas", label: "Canvas" },
                                { value: "drama", label: "短剧" },
                            ]}
                            onChange={(value) => {
                                setPage(1);
                                setSurface(value || "");
                            }}
                        />
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                </div>

                <div className="mt-4 hidden overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800 md:block">
                    <Table rowKey="id" size="middle" loading={loading} columns={columns} dataSource={data?.items || []} pagination={false} scroll={{ x: 980 }} />
                </div>
                <div className="mt-4 space-y-3 md:hidden">
                    {(data?.items || []).map((task) => (
                        <TaskCard key={task.id} task={task} actingId={actingId} onAction={runAction} />
                    ))}
                    {!loading && !data?.items.length ? <div className="py-6 text-center text-sm text-zinc-500 sm:py-16">没有匹配任务</div> : null}
                </div>
                <Pagination className="mt-5 justify-end" current={page} pageSize={PAGE_SIZE} total={data?.total || 0} showSizeChanger={false} onChange={setPage} />
            </section>

            <section className="border-t border-zinc-200 p-4 dark:border-zinc-800 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
                    <ServerCog className="size-4" />
                    <h2 className="font-semibold">渠道健康</h2>
                    <span className="basis-full text-xs text-zinc-500 sm:basis-auto">显式探测会发起真实最小请求并可能产生积分消耗</span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                    {(data?.channels || []).map((channel) => {
                        const state = health[channelKey(channel)];
                        return (
                            <div key={channelKey(channel)} className="flex min-w-0 items-center gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate text-sm font-medium">{channel.name}</span>
                                        <Tag className="m-0">{taskTypeLabel(channel.capability)}</Tag>
                                        {!channel.enabled ? <Tag color="default">已停用</Tag> : null}
                                        {channel.runtimeHealth.status === "cooling" ? <Tag color="warning">冷却中</Tag> : null}
                                    </div>
                                    <div className="mt-1 truncate text-xs text-zinc-500">
                                        {channel.logicalModelName} → {channel.upstreamModel}
                                    </div>
                                    {channel.runtimeHealth.status === "cooling" ? <div className="mt-1 truncate text-xs text-amber-600 dark:text-amber-300">{channel.runtimeHealth.lastError || "连续失败，等待自动恢复"}</div> : null}
                                </div>
                                {state && !state.loading ? <Tag color={state.ok ? "success" : "error"}>{state.ok ? `正常 ${state.status || ""}` : state.error || "异常"}</Tag> : null}
                                <Button size="small" disabled={!channel.enabled} loading={state?.loading} onClick={() => void testChannel(channel)}>
                                    探测
                                </Button>
                            </div>
                        );
                    })}
                </div>
            </section>
        </Panel>
    );
}

function Metric({ icon, label, value, className = "" }: { icon: React.ReactNode; label: string; value: string | number; className?: string }) {
    return (
        <div className={`flex min-h-16 items-center gap-2 bg-white px-3 py-2 dark:bg-zinc-950 ${className}`}>
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-600 [&>svg]:size-4 dark:bg-zinc-900 dark:text-zinc-300">{icon}</span>
            <div className="min-w-0">
                <div className="text-xs text-zinc-500">{label}</div>
                <div className="mt-0.5 truncate text-base font-semibold sm:text-lg">{value}</div>
            </div>
        </div>
    );
}

function TaskCard({ task, actingId, onAction }: { task: AdminGenerationTask; actingId: string; onAction: (task: AdminGenerationTask, action: "cancel" | "retry") => Promise<void> }) {
    return (
        <article className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <Tag>{taskTypeLabel(task.type)}</Tag>
                    <StatusTag status={task.status} />
                </div>
                <div className="flex gap-1">
                    {task.canCancel ? <Button danger type="text" shape="circle" icon={<CircleStop className="size-4" />} loading={actingId === `${task.id}:cancel`} onClick={() => void onAction(task, "cancel")} /> : null}
                    {task.retryTaskId ? <Button type="text" shape="circle" icon={<RotateCcw className="size-4" />} loading={actingId === `${task.id}:retry`} onClick={() => void onAction(task, "retry")} /> : null}
                </div>
            </div>
            <div className="mt-3 font-mono text-xs text-zinc-500">{task.id}</div>
            <div className="mt-3">
                <AdminUserIdentity displayName={task.displayName} username={task.username} accountId={task.accountId} fallback="用户信息不可用" />
            </div>
            <div className="mt-2 text-sm">{task.model || "未记录模型"}</div>
            <p className="mt-2 line-clamp-3 text-sm leading-5 text-zinc-600 dark:text-zinc-300">{task.prompt || task.error || "无请求摘要"}</p>
            <div className="mt-3 text-xs text-zinc-500">
                {surfaceLabel(task.surface)} · {formatDuration(task.durationMs)} · {task.pointsCost} 积分
            </div>
        </article>
    );
}

function StatusTag({ status }: { status: string }) {
    const color = status === "success" ? "success" : status === "error" ? "error" : status === "running" ? "processing" : status === "paused" ? "warning" : "default";
    return <Tag color={color}>{statusLabel(status)}</Tag>;
}

function taskTypeLabel(value: string) {
    return ({ agent: "Agent", text: "文本", image: "图片", video: "视频", audio: "音频", render: "合成" } as Record<string, string>)[value] || value;
}
function statusLabel(value: string) {
    return ({ pending: "排队", running: "执行中", paused: "已暂停", success: "成功", error: "失败", cancelled: "已取消" } as Record<string, string>)[value] || value;
}
function surfaceLabel(value?: string) {
    return value === "canvas" ? "Canvas" : value === "drama" ? "短剧" : value === "chat" ? "创作对话" : "专业工作台";
}
function formatDuration(ms: number) {
    if (!ms) return "0 秒";
    return ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} 秒` : `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`;
}
function channelKey(channel: AdminGenerationChannel) {
    return `${channel.id}:${channel.capability}:${channel.logicalModelId}:${channel.upstreamModel}`;
}
