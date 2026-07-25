"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, BookOpen, Check, Circle, CircleStop, History, LoaderCircle, Plus, Search, SlidersHorizontal, XCircle } from "lucide-react";
import { Button, Input, Popover, Tooltip } from "antd";

import { AgentMessageActions } from "@/components/agent/agent-message-actions";
import { formatAgentMessageText } from "@/components/agent/agent-message-format";
import { CreativeAgentControls, CreativeAgentSkillCard, type CreativeAgentModelOption } from "@/components/agent/creative-agent-controls";
import type { AgentSkillSummary } from "@/services/api/agent-skills";
import { cn } from "@/lib/utils";
import { workbenchAgentProgressHeading, workbenchAgentProgressSteps, type WorkbenchAgentChoice, type WorkbenchAgentMessage } from "./workbench-agent-progress";

export type { WorkbenchAgentMessage, WorkbenchAgentSession } from "./workbench-agent-progress";
export type WorkbenchSkillOption = AgentSkillSummary;

export function WorkbenchAgentHeader({ subtitle, historyContent, onNew }: { subtitle: string; historyContent: (query: string, closeHistory: () => void) => ReactNode; onNew: () => void }) {
    const [historyQuery, setHistoryQuery] = useState("");
    const [historyOpen, setHistoryOpen] = useState(false);
    const history = (
        <div className="w-[360px] max-w-[calc(100vw-32px)] p-2">
            <div className="mb-3 text-base font-semibold">生成记录</div>
            <Input prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索记录或对话内容" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} allowClear />
            <div className="thin-scrollbar mt-3 max-h-[380px] overflow-y-auto">{historyContent(historyQuery.trim(), () => setHistoryOpen(false))}</div>
        </div>
    );
    return (
        <header className="workbench-agent-header flex h-11 shrink-0 items-center justify-between border-b border-stone-200/80 pb-2 sm:h-14 sm:pb-3 dark:border-stone-800">
            <div className="flex min-w-0 items-center gap-2.5">
                <span className="workbench-agent-icon grid size-7 place-items-center rounded-md bg-stone-100 sm:size-8 sm:rounded-lg dark:bg-stone-800">
                    <Bot className="size-4" />
                </span>
                <div>
                    <h1 className="text-base font-semibold leading-5">Agent</h1>
                    <p className="text-xs text-stone-500 dark:text-stone-400">{subtitle}</p>
                </div>
            </div>
            <div className="flex gap-1">
                <Button className="workbench-agent-icon-button" type="text" shape="circle" icon={<Plus className="size-4" />} onClick={onNew} aria-label="新建对话" />
                <Popover trigger="click" placement="bottomRight" content={history} open={historyOpen} onOpenChange={setHistoryOpen}>
                    <Button className="workbench-agent-icon-button" type="text" shape="circle" icon={<History className="size-4" />} aria-label="生成记录" />
                </Popover>
            </div>
        </header>
    );
}

export function WorkbenchSkillEmptyState({ skills, onSelect }: { skills: WorkbenchSkillOption[]; onSelect: (skill: WorkbenchSkillOption) => void }) {
    return (
        <div className="flex min-h-12 flex-1 items-center justify-center overflow-hidden px-1 py-1.5 text-center sm:min-h-[180px] sm:px-4 sm:py-4">
            <div className="min-w-0 max-w-full">
                <div className="mx-auto mb-2 hidden size-8 place-items-center rounded-lg bg-stone-100 sm:mb-3 sm:grid sm:size-10 sm:rounded-xl dark:bg-stone-800">
                    <Bot className="size-4" />
                </div>
                <h2 className="text-xs font-semibold sm:text-base">告诉我你想创作什么</h2>
                <p className="mx-auto mt-1 hidden max-w-[360px] text-xs leading-5 text-stone-500 sm:block dark:text-stone-400">描述你想生成的画面，也可以添加参考素材。</p>
                <div className="mx-auto mt-2 grid w-full max-w-[320px] grid-cols-2 gap-1.5 sm:mt-4 sm:flex sm:max-w-[390px] sm:flex-wrap sm:justify-center sm:gap-2">
                    {skills.map((skill) => (
                        <button
                            key={skill.id}
                            type="button"
                            className="h-7 min-w-0 truncate whitespace-nowrap rounded-full border border-stone-200 bg-white px-2 text-[11px] text-stone-600 transition hover:border-stone-400 hover:text-stone-950 sm:h-auto sm:px-4 sm:py-2 sm:text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:text-white"
                            onClick={() => onSelect(skill)}
                        >
                            {skill.name}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function WorkbenchBackgroundTaskNotice({ count }: { count: number }) {
    if (!count) return null;
    return <div className="mx-1 mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200">有 {count} 个后台生成任务仍在运行，可在历史记录中查看进度。</div>;
}

export function WorkbenchAgentConversation({ messages, running, onChoice, onEditMessage }: { messages: WorkbenchAgentMessage[]; running: boolean; onChoice?: (choice: WorkbenchAgentChoice) => void; onEditMessage: (text: string) => void }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const hasActiveProgress = messages.some((message) => message.progress?.phase === "planning" || message.progress?.phase === "submitting");
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
        return () => window.cancelAnimationFrame(frame);
    }, [messages]);
    return (
        <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-3 sm:space-y-4 sm:py-4" aria-live="polite">
            {messages.map((message) => {
                const displayMessage = { ...message, text: formatAgentMessageText(message.text) };
                return (
                    <div key={message.id} className={`group/message flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`flex max-w-[92%] flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
                            <div
                                className={`rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${message.role === "user" ? "max-w-full bg-stone-900 text-white dark:bg-white dark:text-stone-950" : message.role === "error" ? "max-w-full bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200" : message.role === "warning" ? "max-w-full bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200" : "max-w-full bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200"}`}
                            >
                                {message.progress ? <WorkbenchAgentProgressMessage message={displayMessage} /> : <WorkbenchAgentResponseMessage message={displayMessage} onChoice={onChoice} />}
                            </div>
                            {!message.progress ? <AgentMessageActions text={displayMessage.text} onEdit={message.role === "user" ? onEditMessage : undefined} align={message.role === "user" ? "end" : "start"} /> : null}
                        </div>
                    </div>
                );
            })}
            {running && !hasActiveProgress && messages.at(-1)?.role === "user" ? (
                <div className="flex items-center gap-2 px-2 text-sm text-stone-500">
                    <LoaderCircle className="size-4 animate-spin" />
                    Agent 正在处理当前需求…
                </div>
            ) : null}
        </div>
    );
}

function WorkbenchAgentProgressMessage({ message }: { message: WorkbenchAgentMessage }) {
    const progress = message.progress!;
    const steps = workbenchAgentProgressSteps(progress);
    return (
        <div className="w-[320px] max-w-full">
            <div className="font-semibold text-current">{workbenchAgentProgressHeading(progress)}</div>
            <div className="mt-3 space-y-2">
                {steps.map((step) => (
                    <div key={step.key} className={`flex items-center gap-2 text-xs ${step.status === "pending" ? "text-stone-400 dark:text-stone-500" : "text-current"}`}>
                        {step.status === "completed" ? <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /> : null}
                        {step.status === "running" ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-sky-600 dark:text-sky-300" /> : null}
                        {step.status === "failed" ? <XCircle className="size-3.5 shrink-0 text-red-600 dark:text-red-300" /> : null}
                        {step.status === "cancelled" ? <CircleStop className="size-3.5 shrink-0 text-amber-600 dark:text-amber-300" /> : null}
                        {step.status === "pending" ? <Circle className="size-3.5 shrink-0" /> : null}
                        <span>{step.label}</span>
                    </div>
                ))}
            </div>
            <p className="mt-3 border-t border-current/10 pt-2 text-xs leading-5 opacity-80">{message.text}</p>
        </div>
    );
}

function WorkbenchAgentResponseMessage({ message, onChoice }: { message: WorkbenchAgentMessage; onChoice?: (choice: WorkbenchAgentChoice) => void }) {
    return (
        <div className="w-[340px] max-w-full">
            <p className="whitespace-pre-wrap">{message.text}</p>
            {message.choices?.length ? (
                <div className="mt-3 space-y-2 border-t border-current/10 pt-3">
                    {message.choices.map((choice, index) => (
                        <button
                            key={`${choice.label}:${index}`}
                            type="button"
                            className="block w-full rounded-xl border border-current/15 bg-white/55 px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-current/30 hover:bg-white dark:bg-black/15 dark:hover:bg-black/25"
                            onClick={() => onChoice?.(choice)}
                        >
                            <span className="block text-xs font-semibold">{index === 0 ? `推荐 · ${choice.label}` : choice.label}</span>
                            <span className="mt-0.5 block text-[11px] leading-5 opacity-65">{choice.description}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export function WorkbenchComposerFrame({
    children,
    summary,
    onAdd,
    onLibrary,
    settingsContent,
    skills,
    selectedSkill,
    onSelectSkill,
    onRemoveSkill,
    smartPlanning,
    onSmartPlanningChange,
    models,
    selectedModels,
    onToggleModel,
    onClearModels,
    modelPickerRequest,
    defaultModelCapability,
    submit,
}: {
    children: ReactNode;
    summary: string;
    onAdd: () => void;
    onLibrary: () => void;
    settingsContent: ReactNode;
    skills: WorkbenchSkillOption[];
    selectedSkill?: WorkbenchSkillOption;
    onSelectSkill: (skill: WorkbenchSkillOption) => void;
    onRemoveSkill: () => void;
    smartPlanning: boolean;
    onSmartPlanningChange: (enabled: boolean) => void;
    models: CreativeAgentModelOption[];
    selectedModels: CreativeAgentModelOption[];
    onToggleModel: (model: CreativeAgentModelOption) => void;
    onClearModels: () => void;
    modelPickerRequest?: number;
    defaultModelCapability: CreativeAgentModelOption["capability"];
    submit: ReactNode;
}) {
    const addMenu = (
        <div className="w-48 space-y-1">
            <Button type="text" block className="!justify-start" icon={<Plus className="size-4" />} onClick={onAdd}>
                上传文件
            </Button>
            <Button type="text" block className="!justify-start" icon={<BookOpen className="size-4" />} onClick={onLibrary}>
                从素材库选择
            </Button>
        </div>
    );
    return (
        <div className="workbench-composer-frame shrink-0 rounded-2xl border border-stone-200 bg-white p-2.5 shadow-[0_14px_35px_rgba(28,25,23,.1)] sm:rounded-[26px] sm:p-3 dark:border-stone-700 dark:bg-stone-900">
            <div className="thin-scrollbar flex max-h-[30vh] flex-col gap-3 overflow-y-auto">
                {selectedSkill ? <CreativeAgentSkillCard skill={selectedSkill} onRemove={onRemoveSkill} /> : null}
                {children}
            </div>
            <div className="workbench-composer-toolbar mt-2 flex min-w-0 items-center gap-1 border-t border-stone-200/80 pt-2 dark:border-stone-700">
                <Popover trigger="click" placement="topLeft" content={addMenu}>
                    <Button className="workbench-composer-icon-button !shrink-0" type="text" shape="circle" icon={<Plus className="size-5" />} aria-label="添加素材" />
                </Popover>
                <CreativeAgentControls
                    compact
                    className="min-w-0 flex-1"
                    skills={skills}
                    selectedSkill={selectedSkill}
                    models={models}
                    selectedModels={selectedModels}
                    smartPlanning={smartPlanning}
                    onSelectSkill={onSelectSkill}
                    onToggleModel={onToggleModel}
                    onClearModels={onClearModels}
                    onSmartPlanningChange={onSmartPlanningChange}
                    modelPickerRequest={modelPickerRequest}
                    defaultModelCapability={defaultModelCapability}
                    middle={
                        <Popover
                            trigger="click"
                            placement="top"
                            content={
                                <div className="w-[336px] max-w-[calc(100vw-24px)]">
                                    <div className="border-b border-stone-200 px-2 pb-2 pt-1 dark:border-stone-700">
                                        <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">生成参数</p>
                                        <p className="mt-0.5 truncate text-[11px] text-stone-500 dark:text-stone-400">当前：{summary}</p>
                                    </div>
                                    <div className="thin-scrollbar max-h-[42dvh] overflow-y-auto px-1 pt-3 sm:max-h-[52vh]">{settingsContent}</div>
                                </div>
                            }
                        >
                            <Tooltip title={`生成参数：${summary}`}>
                                <Button
                                    type="text"
                                    shape="circle"
                                    className="workbench-composer-icon-button !h-8 !w-8 !min-w-8 !shrink-0 text-stone-500 dark:text-stone-400"
                                    icon={<SlidersHorizontal className="size-4" />}
                                    aria-label={`打开生成参数，当前 ${summary}`}
                                />
                            </Tooltip>
                        </Popover>
                    }
                />
                <span className="flex shrink-0">{submit}</span>
            </div>
        </div>
    );
}
