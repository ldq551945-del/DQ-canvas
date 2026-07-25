"use client";

import { App, Button, Drawer } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { ArrowUpRight, Clapperboard, History, MessageSquareText, Play, Plus, ScanFace, ShoppingBag, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { SiteLogo } from "@/components/layout/site-logo";
import { CREATIVE_UPLOAD_ACCEPT, CREATIVE_UPLOAD_MAX_BYTES, isCreativeUploadMimeType } from "@/lib/creative-upload";
import { useCreativeAgentModels } from "@/hooks/use-creative-agent-options";
import { listAgentSkills, type AgentSkillSummary } from "@/services/api/agent-skills";
import { usePublicSessionStore } from "@/stores/use-public-session-store";

import { CreativeComposer } from "./components/creative-composer";
import { CreativeConversationList } from "./components/creative-conversation-list";
import { CreativeMessages } from "./components/creative-messages";
import { CreateWorkbenchOverview } from "./components/create-workbench-overview";
import { createConversationHref, createConversationIdFromSearch } from "./create-conversation-navigation";
import { useCreateAgent } from "./use-create-agent";

const SKILL_VISUALS = [
    { icon: ShoppingBag, iconClass: "text-sky-600 dark:text-sky-300", surfaceClass: "bg-sky-50 dark:bg-sky-400/10" },
    { icon: ScanFace, iconClass: "text-violet-600 dark:text-violet-300", surfaceClass: "bg-violet-50 dark:bg-violet-400/10" },
    { icon: Play, iconClass: "text-emerald-600 dark:text-emerald-300", surfaceClass: "bg-emerald-50 dark:bg-emerald-400/10" },
    { icon: Clapperboard, iconClass: "text-red-500 dark:text-red-300", surfaceClass: "bg-red-50 dark:bg-red-400/10" },
] as const;

export default function CreatePage() {
    const { message } = App.useApp();
    const router = useRouter();
    const inputRef = useRef<TextAreaRef>(null);
    const attachmentInputRef = useRef<HTMLInputElement>(null);
    const initialConversationRestoredRef = useRef(false);
    const [prompt, setPrompt] = useState("");
    const [skills, setSkills] = useState<AgentSkillSummary[]>([]);
    const [skillsLoading, setSkillsLoading] = useState(true);
    const [selectedSkillId, setSelectedSkillId] = useState<string>();
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [smartPlanning, setSmartPlanning] = useState(true);
    const [historyOpen, setHistoryOpen] = useState(false);
    const publicSettings = usePublicSessionStore((state) => state.payload?.settings);
    const site = publicSettings?.site || { title: "VOZEB PRO", logoUrl: "/logo.svg" };
    const agent = useCreateAgent();
    const openAgentConversation = agent.openConversation;
    const newAgentConversation = agent.newConversation;
    const hasConversation = agent.messages.length > 0;
    const showConversation = hasConversation || agent.conversationLoading;
    const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);
    const modelOptions = useCreativeAgentModels();
    const selectedModels = modelOptions.filter((model) => selectedModelIds.includes(model.id));

    useEffect(() => {
        let active = true;
        void listAgentSkills("all")
            .then((items) => {
                if (active) setSkills(items);
            })
            .catch(() => {
                if (active) setSkills([]);
            })
            .finally(() => {
                if (active) setSkillsLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (initialConversationRestoredRef.current) return;
        initialConversationRestoredRef.current = true;
        const conversationId = createConversationIdFromSearch(window.location.search);
        if (!conversationId) return;
        void openAgentConversation(conversationId).catch((error) => {
            message.error(error instanceof Error ? error.message : "恢复对话失败");
            router.replace("/create");
        });
    }, [message, openAgentConversation, router]);

    const openConversation = (id: string) => {
        router.push(createConversationHref(id));
        void openAgentConversation(id).catch((error) => {
            message.error(error instanceof Error ? error.message : "打开对话失败");
            router.replace("/create");
        });
    };

    const newConversation = () => {
        newAgentConversation();
        router.replace("/create");
    };

    const submit = async () => {
        if (!prompt.trim()) {
            message.warning("请先描述你的创作需求");
            inputRef.current?.focus();
            return;
        }
        if (await agent.submit(prompt, { skillIds: selectedSkillId ? [selectedSkillId] : [], ...(!smartPlanning && selectedModelIds.length ? { modelIds: selectedModelIds } : {}) })) {
            setPrompt("");
            setSelectedSkillId(undefined);
        }
    };

    const uploadAttachments = async (files: File[]) => {
        const unsupported = files.find((file) => !isCreativeUploadMimeType(file.type));
        if (unsupported) return message.error(`${unsupported.name} 不是支持的图片、视频或音频格式`);
        const oversized = files.find((file) => file.size > CREATIVE_UPLOAD_MAX_BYTES);
        if (oversized) return message.error(`${oversized.name} 超过 20MB`);
        try {
            const items = await agent.uploadAttachments(files);
            if (items.length) message.success(`已上传 ${items.length} 份素材`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材上传失败");
        }
    };

    const selectSkill = (skill: AgentSkillSummary) => {
        setSelectedSkillId(skill.id);
        window.requestAnimationFrame(() => inputRef.current?.focus());
    };

    const toggleModel = (model: (typeof modelOptions)[number]) => {
        setSelectedModelIds((current) => {
            const next = current.includes(model.id) ? current.filter((id) => id !== model.id) : [...current, model.id].slice(-6);
            setSmartPlanning(next.length === 0);
            return next;
        });
        window.requestAnimationFrame(() => inputRef.current?.focus());
    };

    const composer = (
        <CreativeComposer
            inputRef={inputRef}
            value={prompt}
            busy={agent.sending}
            centered={!showConversation}
            onChange={setPrompt}
            onSubmit={() => void submit()}
            onCancel={() => void agent.cancel().catch((error) => message.error(error instanceof Error ? error.message : "停止任务失败"))}
            attachments={agent.selectedAssets}
            skills={skills}
            skillsLoading={skillsLoading}
            selectedSkill={selectedSkill}
            models={modelOptions}
            selectedModels={selectedModels}
            smartPlanning={smartPlanning}
            uploading={agent.uploading}
            onRemoveAttachment={agent.removeAttachment}
            onSelectSkill={selectSkill}
            onRemoveSkill={() => setSelectedSkillId(undefined)}
            onToggleModel={toggleModel}
            onClearModels={() => {
                setSelectedModelIds([]);
                setSmartPlanning(true);
            }}
            onToggleSmartPlanning={() => {
                setSmartPlanning((enabled) => {
                    if (!enabled) setSelectedModelIds([]);
                    return !enabled;
                });
            }}
            onAttachment={() => attachmentInputRef.current?.click()}
            onPasteImages={(files) => void uploadAttachments(files)}
        />
    );

    return (
        <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#fafbfc] text-[#20242a] dark:bg-[#111316] dark:text-[#f3f5f7]">
            <div className="absolute right-3 top-3 z-10 flex items-center gap-1 sm:right-5 sm:top-4">
                {hasConversation ? <Button type="text" shape="circle" icon={<Plus className="size-4" />} onClick={newConversation} aria-label="新建对话" title="新建对话" /> : null}
                <Button type="text" shape="circle" icon={<History className="size-4" />} onClick={() => setHistoryOpen(true)} aria-label="创作历史" title="创作历史" />
            </div>

            <section className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                {showConversation ? (
                    <CreativeMessages
                        messages={agent.messages}
                        assets={agent.assets}
                        loading={agent.conversationLoading}
                        projectLinks={agent.projectLinks}
                        projectErrors={agent.projectErrors}
                        runDetails={agent.runDetails}
                        materializingProjectId={agent.materializingProjectId}
                        onMaterializeProject={agent.materializeProject}
                        onRetryTask={(runId, taskId) => void agent.retryTask(runId, taskId).catch((error) => message.error(error instanceof Error ? error.message : "重试任务失败"))}
                        onEditMessage={(text) => {
                            setPrompt(text);
                            window.requestAnimationFrame(() => inputRef.current?.focus());
                            message.info("已回填消息，可修改后重新发送");
                        }}
                        selectedAssetIds={agent.selectedAssetIds}
                        onToggleAsset={agent.toggleAsset}
                        hasOlder={agent.hasOlderMessages}
                        olderLoading={agent.olderMessagesLoading}
                        onLoadOlder={() => void agent.loadOlderMessages()}
                    />
                ) : (
                    <div className="mx-auto flex min-h-full w-full min-w-0 max-w-[1320px] flex-col items-center px-2.5 pb-3 pt-3 sm:px-8 sm:pb-8 sm:pt-12 lg:pt-8 xl:pt-12">
                        <div className="text-center">
                            <SiteLogo logoUrl={site.logoUrl} className="mx-auto size-8" />
                            <h1 className="mt-2.5 text-[22px] font-semibold leading-tight sm:mt-6 sm:text-[30px]">今天想创作什么？</h1>
                            <p className="mt-2 text-sm text-[#8b949f] dark:text-[#7f8996]">从一个想法开始</p>
                        </div>
                        <div className="mt-3 w-full sm:mt-6">{composer}</div>
                        <div className="mt-2 flex w-full min-w-0 flex-wrap justify-center gap-1.5 sm:mt-3 sm:gap-2">
                            {skillsLoading ? <span className="px-2 py-2 text-xs text-[#9aa2ad]">正在加载创作 Skill...</span> : null}
                            {skills.map((skill, index) => {
                                const visual = skillVisual(skill, index);
                                const Icon = visual.icon;
                                return (
                                    <button
                                        key={skill.id}
                                        type="button"
                                        aria-label={`使用 ${skill.name} Skill`}
                                        title={skill.description}
                                        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#e3e7eb] bg-white px-3 text-sm font-medium text-[#343b44] transition hover:border-[#d4dae0] hover:bg-[#f7f8fa] dark:border-[#2b3037] dark:bg-[#181b20] dark:text-[#dce1e7] dark:hover:border-[#3a414a] dark:hover:bg-[#20242a]"
                                        onClick={() => selectSkill(skill)}
                                    >
                                        <span className={`grid size-7 place-items-center rounded-md ${visual.surfaceClass}`}>
                                            <Icon className={`size-4 ${visual.iconClass}`} />
                                        </span>
                                        <span>{skill.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <section className="mt-7 w-full pb-3 sm:mt-12 sm:pb-4">
                            <div className="flex items-end justify-between gap-3 border-b border-[#e8ebef] pb-3 dark:border-[#292d33]">
                                <div>
                                    <h2 className="text-sm font-semibold">继续创作</h2>
                                    <p className="mt-1 text-xs text-[#8b949f] dark:text-[#7f8996]">回到最近的会话继续完善</p>
                                </div>
                                <button type="button" className="text-xs text-[#697381] transition hover:text-[#20242a] dark:text-[#9aa3af] dark:hover:text-white" onClick={() => setHistoryOpen(true)}>
                                    全部会话 →
                                </button>
                            </div>
                            {agent.historyLoading ? <div className="py-10 text-center text-sm text-[#9aa2ad]">正在读取最近创作...</div> : null}
                            {!agent.historyLoading && agent.conversations.length ? (
                                <div className="grid gap-2 pt-2 sm:grid-cols-2 sm:gap-3 sm:pt-3 lg:grid-cols-3">
                                    {agent.conversations.slice(0, 3).map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className="group flex min-h-20 min-w-0 items-center gap-2.5 rounded-lg border border-[#e4e8ec] bg-white p-2.5 text-left transition hover:border-[#ccd3da] hover:bg-[#fdfefe] sm:min-h-24 sm:gap-3 sm:p-4 dark:border-[#2b3037] dark:bg-[#181b20] dark:hover:border-[#3b424c] dark:hover:bg-[#1d2127]"
                                            onClick={() => openConversation(item.id)}
                                        >
                                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#f1f3f5] text-[#68717c] dark:bg-[#252a31] dark:text-[#aab2bd]">
                                                <MessageSquareText className="size-4" />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-semibold">{item.title}</span>
                                                <span className="mt-1 block truncate text-xs text-[#8b949f] dark:text-[#7f8996]">{formatRecentTime(item.lastMessageAt)}</span>
                                            </span>
                                            <ArrowUpRight className="size-4 shrink-0 text-[#a7afb9] transition group-hover:text-[#4f5965] dark:group-hover:text-white" />
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                            {!agent.historyLoading && !agent.conversations.length ? <div className="flex min-h-16 items-center justify-center text-sm text-[#9aa2ad] dark:text-[#737d89]">完成第一次创作后，会话会出现在这里</div> : null}
                        </section>
                        <CreateWorkbenchOverview />
                    </div>
                )}
            </section>

            {showConversation ? composer : null}
            <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept={CREATIVE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.target.value = "";
                    void uploadAttachments(files);
                }}
            />

            <Drawer title="创作历史" placement="right" size="min(92vw, 380px)" open={historyOpen} onClose={() => setHistoryOpen(false)} styles={{ body: { padding: 0, overflow: "hidden" } }}>
                <CreativeConversationList
                    items={agent.conversations}
                    activeId={agent.conversationId}
                    loading={agent.historyLoading}
                    hasMore={agent.historyHasMore}
                    loadingMore={agent.historyLoadingMore}
                    onLoadMore={() => void agent.loadMoreConversations()}
                    onNew={() => {
                        newConversation();
                        setHistoryOpen(false);
                    }}
                    onOpen={(id) => {
                        openConversation(id);
                        setHistoryOpen(false);
                    }}
                    onRename={async (id, title) => {
                        try {
                            await agent.renameConversation(id, title);
                            message.success("标题已更新");
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : "修改标题失败");
                            throw error;
                        }
                    }}
                    onArchive={async (ids) => {
                        try {
                            await agent.archiveConversations(ids);
                            message.success(ids.length > 1 ? `已删除 ${ids.length} 条对话` : "对话已删除");
                        } catch (error) {
                            message.error(error instanceof Error ? error.message : "删除对话失败");
                            throw error;
                        }
                    }}
                />
            </Drawer>
        </main>
    );
}

function formatRecentTime(value: number) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function skillVisual(skill: AgentSkillSummary, index: number) {
    if (skill.id === "ecommerce-image") return SKILL_VISUALS[0];
    if (skill.id === "character-design") return SKILL_VISUALS[1];
    if (skill.id === "image-motion") return SKILL_VISUALS[2];
    if (skill.id === "drama-planning") return SKILL_VISUALS[3];
    return { ...SKILL_VISUALS[index % SKILL_VISUALS.length], icon: Sparkles };
}
