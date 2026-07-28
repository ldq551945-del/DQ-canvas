"use client";

import { App, Button, Image, Input, InputNumber, Popconfirm, Tag, Tooltip } from "antd";
import { Check, ChevronDown, ImagePlus, KeyRound, MapPinned, Package, Plus, SlidersHorizontal, Sparkles, Trash2, Upload, Users } from "lucide-react";
import { nanoid } from "nanoid";
import { useRef, useState } from "react";

import { compileDramaAssetReferencePrompt } from "@/lib/drama-prompt-compiler";
import type { DramaAssetReference, DramaCharacter, DramaNamedAsset, DramaProject } from "@/lib/drama-project-contract";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { createImageGenerationTask, waitForImageGenerationTask } from "@/services/api/image";
import { uploadImage } from "@/services/image-storage";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useDramaStore } from "../stores/use-drama-store";
import { SectionTitle, stableTaskUrl } from "./drama-editor-elements";
import { dramaGenerationSize } from "./drama-shot-generation-utils";

type AssetKind = "characters" | "scenes" | "props" | "clues";

const definitions: Array<{ kind: AssetKind; title: string; label: string; icon: typeof Users; profileLabels: [string, string, string, string] }> = [
    { kind: "characters", title: "角色", label: "人物", icon: Users, profileLabels: ["固定外貌", "服装与造型", "标志色", "一致性规则"] },
    { kind: "scenes", title: "场景", label: "地点", icon: MapPinned, profileLabels: ["空间结构", "陈设与材质", "环境色", "固定空间规则"] },
    { kind: "props", title: "道具", label: "道具", icon: Package, profileLabels: ["外形识别", "材质与细节", "固定色彩", "使用与一致性规则"] },
    { kind: "clues", title: "线索", label: "线索", icon: KeyRound, profileLabels: ["视觉识别", "出现形态", "提示色", "前后呼应规则"] },
];

export function DramaAssetsPanel({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const addCharacter = useDramaStore((state) => state.addCharacter);
    const addScene = useDramaStore((state) => state.addScene);
    const addProp = useDramaStore((state) => state.addProp);
    const addClue = useDramaStore((state) => state.addClue);
    const updateAsset = useDramaStore((state) => state.updateAsset);
    const removeAsset = useDramaStore((state) => state.removeAsset);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [activeKind, setActiveKind] = useState<AssetKind>("characters");
    const [uploadTargetId, setUploadTargetId] = useState("");
    const [uploadingId, setUploadingId] = useState("");
    const [generatingId, setGeneratingId] = useState("");
    const [expandedAssetIds, setExpandedAssetIds] = useState<Set<string>>(() => new Set());
    const [drafts, setDrafts] = useState<Record<AssetKind, { name: string; description: string; payoff: string }>>({
        characters: { name: "", description: "", payoff: "" },
        scenes: { name: "", description: "", payoff: "" },
        props: { name: "", description: "", payoff: "" },
        clues: { name: "", description: "", payoff: "" },
    });
    const definition = definitions.find((item) => item.kind === activeKind)!;
    const ActiveIcon = definition.icon;
    const items = project[activeKind];
    const toggleAssetExpanded = (id: string) =>
        setExpandedAssetIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const add = () => {
        const draft = drafts[activeKind];
        if (!draft.name.trim()) return message.warning(`请输入${definition.label}名称`);
        const profile = { visualIdentity: "", styling: "", colorPalette: "", consistencyRules: "" };
        const value = { name: draft.name.trim(), description: draft.description.trim(), profile, references: [], ...(activeKind === "clues" ? { payoff: draft.payoff.trim() } : {}) };
        if (activeKind === "characters") addCharacter(project.id, value);
        if (activeKind === "scenes") addScene(project.id, value);
        if (activeKind === "props") addProp(project.id, value);
        if (activeKind === "clues") addClue(project.id, { ...value, payoff: draft.payoff.trim() });
        setDrafts((state) => ({ ...state, [activeKind]: { name: "", description: "", payoff: "" } }));
    };

    const setPrimaryReference = (item: DramaNamedAsset, reference: DramaAssetReference) => {
        updateAsset(project.id, activeKind, item.id, {
            primaryReferenceId: reference.id,
            referenceImageUrl: reference.url,
            referenceStorageKey: reference.storageKey,
        });
    };

    const appendReference = (item: DramaNamedAsset, reference: DramaAssetReference) => {
        const references = [...assetReferences(item), reference].slice(-12);
        updateAsset(project.id, activeKind, item.id, {
            references,
            primaryReferenceId: reference.id,
            referenceImageUrl: reference.url,
            referenceStorageKey: reference.storageKey,
        });
    };

    const removeReference = (item: DramaNamedAsset, referenceId: string) => {
        const references = assetReferences(item).filter((reference) => reference.id !== referenceId);
        const primary = item.primaryReferenceId === referenceId ? references[0] : references.find((reference) => reference.id === item.primaryReferenceId);
        updateAsset(project.id, activeKind, item.id, {
            references,
            primaryReferenceId: primary?.id,
            referenceImageUrl: primary?.url,
            referenceStorageKey: primary?.storageKey,
        });
    };

    const uploadReference = async (file?: File) => {
        const item = items.find((candidate) => candidate.id === uploadTargetId);
        if (!file || !item) return;
        setUploadingId(item.id);
        try {
            const stored = await uploadImage(file);
            appendReference(item, { id: `reference-${nanoid()}`, url: stored.serverUrl || stored.url, storageKey: stored.storageKey, source: "upload", label: file.name, width: stored.width, height: stored.height, createdAt: new Date().toISOString() });
            message.success("参考图已上传并设为基准");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考图上传失败");
        } finally {
            setUploadingId("");
            setUploadTargetId("");
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const generateReference = async (item: DramaNamedAsset) => {
        if (activeKind === "clues") return message.info("线索参考图建议从剧情画面中截取并上传");
        setGeneratingId(item.id);
        try {
            const prompt = compileDramaAssetReferencePrompt(project, item, activeKind === "characters" ? "角色" : activeKind === "scenes" ? "场景" : "道具");
            const imageConfig = { ...config, model: config.imageModel || config.model, imageModel: config.imageModel || config.model, size: dramaGenerationSize(project, prompt), count: "1" };
            const task = await createImageGenerationTask(imageConfig, prompt, [], undefined, {
                logSource: "drama",
                logTitle: `${project.title} · ${item.name}设定图`,
                conversationId: project.creativeConversationId,
                surface: "drama",
                projectId: project.id,
                clientRequestId: `drama-reference:${project.id}:${item.id}:${nanoid()}`,
            });
            const result = await waitForImageGenerationTask(imageConfig, task);
            const url = stableTaskUrl(result.remoteUrl, result.serverUrl, result.dataUrl);
            if (!url) throw new Error("生成结果没有可持久化地址");
            appendReference(item, { id: `reference-${nanoid()}`, url, source: "generated", label: "AI 候选图", width: result.width, height: result.height, createdAt: new Date().toISOString() });
            message.success("候选图已生成并设为基准");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "候选图生成失败");
        } finally {
            setGeneratingId("");
        }
    };

    return (
        <div>
            <SectionTitle title="视觉资产" description="先固定角色、场景和关键道具，再让镜头提示词自动引用这些设定。" />
            <div className="mb-4 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-border bg-border sm:mb-6">
                {definitions.map(({ kind, title, icon: Icon }) => (
                    <button
                        key={kind}
                        type="button"
                        className={`flex min-w-0 items-center justify-center gap-1.5 px-2 py-2.5 text-xs transition sm:gap-2 sm:px-3 sm:text-sm ${activeKind === kind ? "bg-foreground font-semibold text-background shadow-sm" : "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
                        style={activeKind === kind ? { color: "var(--background)" } : undefined}
                        onClick={() => setActiveKind(kind)}
                    >
                        <Icon className="size-3.5 shrink-0 sm:size-4" style={activeKind === kind ? { color: "var(--background)" } : undefined} />
                        <span className="truncate" style={activeKind === kind ? { color: "var(--background)" } : undefined}>
                            {title}
                        </span>
                        <span className={`text-[10px] tabular-nums sm:text-xs ${activeKind === kind ? "opacity-70" : "text-muted-foreground"}`} style={activeKind === kind ? { color: "var(--background)" } : undefined}>
                            {project[kind].length}
                        </span>
                    </button>
                ))}
            </div>

            <section>
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2 font-semibold">
                        <ActiveIcon className="size-4 shrink-0" />
                        <span>{definition.title}设定</span>
                        <Tag className="!m-0">{items.length}</Tag>
                    </div>
                    <Button type="primary" size="small" icon={<Plus className="size-3.5" />} onClick={add}>
                        添加{definition.label}
                    </Button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(140px,0.7fr)_minmax(220px,1.3fr)]">
                    <Input className="!h-10" value={drafts[activeKind].name} onChange={(event) => setDrafts((state) => ({ ...state, [activeKind]: { ...state[activeKind], name: event.target.value } }))} placeholder={`${definition.label}名称`} />
                    <Input
                        className="!h-10"
                        value={drafts[activeKind].description}
                        onChange={(event) => setDrafts((state) => ({ ...state, [activeKind]: { ...state[activeKind], description: event.target.value } }))}
                        placeholder="一句话说明剧情身份或用途"
                    />
                    {activeKind === "clues" ? (
                        <Input className="!h-10 sm:col-span-2" value={drafts.clues.payoff} onChange={(event) => setDrafts((state) => ({ ...state, clues: { ...state.clues, payoff: event.target.value } }))} placeholder="线索在何时揭示或回收" />
                    ) : null}
                </div>

                <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border bg-background sm:mt-5">
                    {items.length ? (
                        items.map((item) => {
                            const references = assetReferences(item);
                            const primary = references.find((reference) => reference.id === item.primaryReferenceId) || references[0];
                            const character = activeKind === "characters" ? (item as DramaCharacter) : undefined;
                            const profile = item.profile || { visualIdentity: "", styling: "", colorPalette: "", consistencyRules: "" };
                            const expanded = expandedAssetIds.has(item.id);
                            return (
                                <article key={item.id} className="p-3 sm:p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted/45">
                                            {primary?.url ? (
                                                <Image
                                                    src={imagePreviewUrl(primary.url, 256)}
                                                    alt={`${item.name}基准图`}
                                                    rootClassName="!block !size-full"
                                                    className="!size-full !object-cover"
                                                    preview={{ mask: <span className="text-xs">查看</span>, src: imagePreviewUrl(primary.url, 1920) }}
                                                />
                                            ) : (
                                                <ImagePlus className="size-5 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <Input variant="borderless" className="!h-7 !p-0 !font-semibold" value={item.name} onChange={(event) => updateAsset(project.id, activeKind, item.id, { name: event.target.value })} />
                                            <Input.TextArea
                                                variant="borderless"
                                                className="!mt-1 !px-0 !py-0 text-sm"
                                                value={item.description}
                                                onChange={(event) => updateAsset(project.id, activeKind, item.id, { description: event.target.value })}
                                                autoSize={{ minRows: 1, maxRows: 3 }}
                                                placeholder="剧情身份或用途"
                                            />
                                        </div>
                                        <Popconfirm title={`删除${definition.label}？`} onConfirm={() => removeAsset(project.id, activeKind, item.id)} okText="删除" cancelText="取消">
                                            <Button type="text" danger shape="circle" icon={<Trash2 className="size-4" />} aria-label={`删除${definition.label}`} />
                                        </Popconfirm>
                                    </div>

                                    <div className="mt-3">
                                        <button
                                            type="button"
                                            aria-expanded={expanded}
                                            aria-controls={`asset-profile-${item.id}`}
                                            className={`grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${expanded ? "border-foreground/25 bg-muted/60" : "border-border/80 bg-background hover:border-foreground/20 hover:bg-muted/45"}`}
                                            onClick={() => toggleAssetExpanded(item.id)}
                                        >
                                            <span className="flex min-w-0 items-center gap-2.5">
                                                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-background">
                                                    <SlidersHorizontal className="size-3.5" />
                                                </span>
                                                <span className="shrink-0 text-sm font-semibold text-foreground">设定档与参考图</span>
                                                <span className="hidden truncate text-xs text-muted-foreground sm:block">{primary ? `${references.length} 张参考图 · 已设基准` : "补充外观规则与基准图"}</span>
                                            </span>
                                            <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-foreground">
                                                {expanded ? "收起" : "展开"}
                                                <ChevronDown className={`size-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
                                            </span>
                                        </button>
                                        {expanded ? (
                                            <div id={`asset-profile-${item.id}`} className="mt-2 rounded-md border border-border/75 bg-muted/15 p-3">
                                                <div className="grid gap-2 sm:grid-cols-2">
                                                    {(["visualIdentity", "styling", "colorPalette", "consistencyRules"] as const).map((key, index) => (
                                                        <Input.TextArea
                                                            key={key}
                                                            value={profile[key]}
                                                            onChange={(event) => updateAsset(project.id, activeKind, item.id, { profile: { ...profile, [key]: event.target.value } })}
                                                            autoSize={{ minRows: 1, maxRows: 3 }}
                                                            placeholder={definition.profileLabels[index]}
                                                        />
                                                    ))}
                                                    {activeKind === "clues" ? (
                                                        <Input
                                                            className="sm:col-span-2"
                                                            value={"payoff" in item ? item.payoff : ""}
                                                            onChange={(event) => updateAsset(project.id, activeKind, item.id, { payoff: event.target.value })}
                                                            placeholder="线索回收位置"
                                                        />
                                                    ) : null}
                                                </div>

                                                {character ? (
                                                    <div className="mt-3 grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-[minmax(140px,0.8fr)_110px_minmax(220px,1.2fr)]">
                                                        <Input
                                                            value={character.voiceProfile?.voice || ""}
                                                            onChange={(event) =>
                                                                updateAsset(project.id, activeKind, item.id, {
                                                                    voiceProfile: { voice: event.target.value, speed: character.voiceProfile?.speed || 1, instructions: character.voiceProfile?.instructions || "" },
                                                                })
                                                            }
                                                            placeholder="音色 ID，留空用默认"
                                                        />
                                                        <InputNumber
                                                            className="!w-full"
                                                            min={0.25}
                                                            max={4}
                                                            step={0.05}
                                                            value={character.voiceProfile?.speed || 1}
                                                            onChange={(value) =>
                                                                updateAsset(project.id, activeKind, item.id, {
                                                                    voiceProfile: { voice: character.voiceProfile?.voice || "", speed: Number(value) || 1, instructions: character.voiceProfile?.instructions || "" },
                                                                })
                                                            }
                                                            addonAfter="倍速"
                                                        />
                                                        <Input
                                                            value={character.voiceProfile?.instructions || ""}
                                                            onChange={(event) =>
                                                                updateAsset(project.id, activeKind, item.id, { voiceProfile: { voice: character.voiceProfile?.voice || "", speed: character.voiceProfile?.speed || 1, instructions: event.target.value } })
                                                            }
                                                            placeholder="语气、年龄感、情绪等配音指令"
                                                        />
                                                    </div>
                                                ) : null}

                                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                                    <Button
                                                        size="small"
                                                        icon={<Upload className="size-3.5" />}
                                                        loading={uploadingId === item.id}
                                                        onClick={() => {
                                                            setUploadTargetId(item.id);
                                                            fileInputRef.current?.click();
                                                        }}
                                                    >
                                                        上传候选
                                                    </Button>
                                                    {activeKind !== "clues" ? (
                                                        <Button size="small" icon={<Sparkles className="size-3.5" />} loading={generatingId === item.id} onClick={() => void generateReference(item)}>
                                                            生成候选
                                                        </Button>
                                                    ) : null}
                                                    {!primary ? <span className="text-xs text-muted-foreground">建议至少设置一张基准图</span> : null}
                                                </div>

                                                {references.length ? (
                                                    <Image.PreviewGroup>
                                                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
                                                            {references.map((reference) => {
                                                                const isPrimary = reference.id === primary?.id;
                                                                return (
                                                                    <div
                                                                        key={reference.id}
                                                                        className={`relative w-[112px] shrink-0 overflow-hidden rounded-lg border bg-muted shadow-sm transition-shadow hover:shadow-md ${isPrimary ? "border-foreground ring-2 ring-foreground/15" : "border-border"}`}
                                                                    >
                                                                        <Image
                                                                            src={imagePreviewUrl(reference.url, 256)}
                                                                            alt={reference.label}
                                                                            rootClassName="!block !aspect-[4/5] !w-full"
                                                                            className="!size-full !object-cover"
                                                                            preview={{ mask: <span className="text-xs">查看</span>, src: imagePreviewUrl(reference.url, 1920) }}
                                                                        />
                                                                        <div className={`flex h-8 items-stretch ${isPrimary ? "bg-foreground text-background" : "bg-background text-muted-foreground"}`}>
                                                                            <Tooltip title={isPrimary ? "当前基准图" : "设为基准图"}>
                                                                                <button
                                                                                    type="button"
                                                                                    aria-pressed={isPrimary}
                                                                                    className={`flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap px-2 text-xs font-semibold transition ${isPrimary ? "hover:bg-foreground/90" : "hover:bg-muted hover:text-foreground"}`}
                                                                                    style={isPrimary ? { color: "var(--background)" } : undefined}
                                                                                    onClick={() => setPrimaryReference(item, reference)}
                                                                                >
                                                                                    {isPrimary ? <Check className="size-3.5 shrink-0" /> : null}
                                                                                    {isPrimary ? "基准" : "设为基准"}
                                                                                </button>
                                                                            </Tooltip>
                                                                            <Popconfirm
                                                                                title="删除这张参考图？"
                                                                                description={isPrimary ? "删除后将自动使用下一张候选图作为基准。" : undefined}
                                                                                okText="删除"
                                                                                cancelText="取消"
                                                                                onConfirm={() => removeReference(item, reference.id)}
                                                                            >
                                                                                <Tooltip title="删除参考图">
                                                                                    <button
                                                                                        type="button"
                                                                                        className={`grid w-8 shrink-0 place-items-center border-l transition ${isPrimary ? "border-background/15 text-background/70 hover:bg-red-500/20 hover:text-red-100" : "border-border text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-300"}`}
                                                                                        aria-label={`删除参考图：${reference.label}`}
                                                                                    >
                                                                                        <Trash2 className="size-3.5" />
                                                                                    </button>
                                                                                </Tooltip>
                                                                            </Popconfirm>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </Image.PreviewGroup>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                </article>
                            );
                        })
                    ) : (
                        <div className="px-4 py-6 text-center text-sm text-muted-foreground">还没有{definition.title}设定</div>
                    )}
                </div>
            </section>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void uploadReference(event.target.files?.[0])} />
        </div>
    );
}

function assetReferences(item: DramaNamedAsset): DramaAssetReference[] {
    if (item.references?.length) return item.references;
    return item.referenceImageUrl
        ? [
              {
                  id: `${item.id}-reference-legacy`,
                  url: item.referenceImageUrl,
                  storageKey: item.referenceStorageKey,
                  source: "library",
                  label: "原参考图",
                  createdAt: new Date(0).toISOString(),
              },
          ]
        : [];
}
