"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Checkbox, Input, Tag } from "antd";
import { CheckSquare, PenLine, Plus, Trash2 } from "lucide-react";

type WorkbenchHistoryItem = { id: string; title: string };

type WorkbenchHistoryPanelProps<T extends WorkbenchHistoryItem> = {
    logs: T[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: T) => void;
    onRenameLog: (log: T, title: string) => void;
    renderDetails: (log: T) => ReactNode;
    renderPreview?: (log: T) => ReactNode;
    total?: number;
    hasMore?: boolean;
    loadingMore?: boolean;
    onLoadMore?: () => void;
    compact?: boolean;
};

export function WorkbenchHistoryPanel<T extends WorkbenchHistoryItem>({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
    onRenameLog,
    renderDetails,
    renderPreview,
    total = logs.length,
    hasMore = false,
    loadingMore = false,
    onLoadMore,
    compact = false,
}: WorkbenchHistoryPanelProps<T>) {
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            {!compact ? (
                <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold">生成记录</h2>
                    <Tag className="m-0">{total}</Tag>
                </div>
            ) : null}
            <div className="mb-4 flex flex-wrap gap-2">
                {!compact ? (
                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                        新建
                    </Button>
                ) : null}
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? "取消" : "全选"}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    删除
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <WorkbenchHistoryCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                        onRename={(title) => onRenameLog(log, title)}
                        details={renderDetails(log)}
                        preview={renderPreview?.(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-16 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 sm:min-h-36 dark:border-stone-700">暂无生成记录</div> : null}
                {hasMore && onLoadMore ? (
                    <div className="flex justify-center pt-1">
                        <Button size="small" loading={loadingMore} onClick={onLoadMore}>
                            加载更多
                        </Button>
                    </div>
                ) : null}
            </div>
        </>
    );
}

function WorkbenchHistoryCard<T extends WorkbenchHistoryItem>({
    log,
    selected,
    active,
    onSelectedChange,
    onClick,
    onRename,
    details,
    preview,
}: {
    log: T;
    selected: boolean;
    active: boolean;
    onSelectedChange: (checked: boolean) => void;
    onClick: () => void;
    onRename: (title: string) => void;
    details: ReactNode;
    preview?: ReactNode;
}) {
    const [editingTitle, setEditingTitle] = useState(false);
    const [draftTitle, setDraftTitle] = useState(log.title);

    useEffect(() => {
        if (!editingTitle) setDraftTitle(log.title);
    }, [editingTitle, log.title]);

    const commitTitle = () => {
        const nextTitle = draftTitle.trim();
        setEditingTitle(false);
        if (!nextTitle) {
            setDraftTitle(log.title);
            return;
        }
        if (nextTitle !== log.title) onRename(nextTitle);
    };

    return (
        <div
            data-testid="workbench-history-card"
            className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
            onClick={onClick}
        >
            <div className="grid min-w-0 gap-2">
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                    <Checkbox aria-label={`选择记录：${log.title}`} className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                    <div className="min-w-0">
                        {editingTitle ? (
                            <Input
                                size="small"
                                autoFocus
                                value={draftTitle}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => setDraftTitle(event.target.value)}
                                onBlur={commitTitle}
                                onPressEnter={commitTitle}
                                onKeyDown={(event) => {
                                    event.stopPropagation();
                                    if (event.key === "Escape") {
                                        setDraftTitle(log.title);
                                        setEditingTitle(false);
                                    }
                                }}
                            />
                        ) : (
                            <div className="flex min-w-0 items-center gap-1">
                                <button
                                    type="button"
                                    className="min-w-0 truncate text-left text-sm font-semibold leading-5 outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
                                    title={log.title}
                                    aria-label={`查看生成记录：${log.title}`}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onClick();
                                    }}
                                >
                                    {log.title}
                                </button>
                                <Button
                                    aria-label="编辑记录标题"
                                    type="text"
                                    size="small"
                                    className="!h-6 !w-6 !min-w-6 shrink-0 !p-0"
                                    icon={<PenLine className="size-3.5" />}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setDraftTitle(log.title);
                                        setEditingTitle(true);
                                    }}
                                />
                            </div>
                        )}
                        {preview}
                    </div>
                </div>
                {details}
            </div>
        </div>
    );
}
