"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Pagination, Popconfirm, Segmented, Select, Space, Switch, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import Link from "next/link";
import { BillingOperations } from "@/app/admin/billing/components/billing-operations";
import { GenerationOperationsClient } from "@/app/admin/generation-operations/components/generation-operations-client";
import {
    formatAdminLogDuration,
    formatAdminLogTime,
    formatGenerationLogModel,
    GenerationLogAssetPreview,
    GenerationLogDetail,
    GenerationLogMobileCard,
    generationKindLabel,
    generationSourceLabel,
    generationStatusClass,
    generationStatusLabel,
} from "@/components/admin/admin-generation-log";
import { GenerationConcurrencyPanel, GenerationDefaultsPanel, localAgentReadiness } from "@/components/admin/admin-generation-settings";
import type { AgentReadiness } from "@/components/admin/admin-generation-settings";
import { AdminLocalMediaStorage } from "@/components/admin/admin-local-media-storage";
import { QuotaRuleTable } from "@/components/admin/admin-quota-rules";
import { AdminOverview, buildOperationsSummary } from "@/components/admin/admin-overview";
import { AdminLogicalModelManager } from "@/components/admin/admin-logical-model-manager";
import { Metric, Panel, PanelHeader } from "@/components/admin/admin-panel";
import { AdminSectionNav, adminSections } from "@/components/admin/admin-section-nav";
import type { AdminSectionKey } from "@/components/admin/admin-sections";
import { UpdateCenterPanel } from "@/components/admin/admin-update-center";
import { LabeledControl, SectionTitle, SettingInlineToggle, SettingToggle } from "@/components/admin/admin-settings-controls";
import { SiteLogoPreview, SiteSettingStatus, SiteShowcasePreview, siteSocialItems } from "@/components/admin/admin-site-preview";
import { createDefaultChannelAdvancedConfig, healthKindLabel, SystemChannelEditor } from "@/components/admin/admin-system-channel-editor";
import type { ChannelHealthKind, ChannelHealthResult } from "@/components/admin/admin-system-channel-editor";
import { formatAdminMoney, toNumberOrOne, toNumberOrZero, uniqueList } from "@/components/admin/admin-values";
import {
    ArrowRight,
    Copy,
    CreditCard,
    CircleDollarSign,
    Database,
    Download,
    ExternalLink,
    Eye,
    Gift,
    Globe2,
    Image as ImageIcon,
    KeyRound,
    Mail,
    Menu,
    PlugZap,
    Plus,
    ReceiptText,
    RefreshCw,
    Save,
    Search,
    Send,
    ShieldCheck,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    Upload,
    UserCog,
    UserRound,
    WalletCards,
} from "lucide-react";
import dayjs from "dayjs";
import { nanoid } from "nanoid";

import { formatCreditAmount } from "@/constant/credits";
import { normalizeDefaultModelsConfig } from "@/lib/model-routing-config";
import { buildGlobalAiOpcSelection, isGlobalAiOpcBaseUrl } from "@/lib/globalaiopc-catalog";
import type {
    AgentSkill,
    AuthSettings,
    CreatedCdkCode,
    PublicAnnouncement,
    PublicCdkCode,
    PublicUser,
    PublicUserSummary,
    SiteFriendLink,
    SiteShowcaseItem,
    SiteSocialKey,
    SystemChannelAdvancedConfig,
    SystemModelChannel,
    UserRole,
    UserStatus,
} from "@/lib/auth/store";
import type { GenerationAssetStats, StoredGenerationLog } from "@/lib/server/generation-log-store";
import type { AdminSetupSummary } from "@/lib/server/admin-setup-status";
import type { PaymentConfigSummary } from "@/lib/payment-config-types";
import type { AdminBillingSummary } from "@/lib/admin-billing-types";
import type { Prompt } from "@/services/api/prompts";

export type AdminDashboardProps = {
    initialUsers: PublicUser[];
    initialUserSummary: PublicUserSummary;
    initialSettings: AuthSettings;
    initialPromptCount: number;
    currentUser: PublicUser;
    initialSection?: AdminSectionKey;
    setupSummary?: AdminSetupSummary;
    headerActions?: ReactNode;
};
export type PromptFormValue = {
    title: string;
    prompt: string;
    category?: string;
    tags?: string;
    coverUrl?: string;
    preview?: string;
};

export type UserEditorValue = {
    username?: string;
    displayName: string;
    email?: string;
    password?: string;
    role: UserRole;
    status: UserStatus;
    pointsBalance: number;
};

export const PROMPT_PAGE_SIZE = 20;
export const PROMPT_SEARCH_DEBOUNCE_MS = 300;
export const CDK_PAGE_SIZE = 20;
export const GENERATION_LOG_PAGE_SIZE = 20;
import {
    settingsStatusToneClass,
    SettingsStatusTile,
    SettingsAnchorItem,
    FinanceFlowItem,
    FinanceMiniRow,
    createSystemChannel,
    suggestedChannelModels,
    buildAdvancedConfigFromHealth,
    firstOkResult,
    requestAdminModels,
    type AdminModelsResult,
    selectChannelHealthModel,
    modelNameFromOption,
    isCdkExpired,
    cdkStatusLabel,
    cdkStatusTone,
    formatCreatedCdkExport,
    downloadTextFile,
    CdkRedemptionDetail,
    splitTags,
    clampInteger,
} from "./admin-dashboard-elements";

import type { AdminDashboardState } from "./use-admin-dashboard-state";
import type { AdminDashboardDataActions } from "./use-admin-dashboard-data-actions";

export function useAdminDashboardSettingsActions({ state, data }: { state: AdminDashboardState; data: AdminDashboardDataActions }) {
    const { message, settings, setSettings, setMailTestLoading, mailTestTo, setFetchingModelId, setTestingChannelKey, setChannelHealthResults, customPointModel, setCustomPointModel } = state;
    const {} = data;

    const updateChannel = (id: string, patch: Partial<SystemModelChannel>) => {
        setSettings((current) => ({
            ...current,
            systemChannels: current.systemChannels.map((channel) => (channel.id === id ? { ...channel, ...patch, apiFormat: patch.apiFormat || channel.apiFormat, models: patch.models ? uniqueList(patch.models) : channel.models } : channel)),
        }));
    };

    const addChannel = () => {
        setSettings((current) => ({ ...current, systemChannels: [...current.systemChannels, createSystemChannel()] }));
    };

    const deleteChannel = (id: string) => {
        setSettings((current) => {
            const systemChannels = current.systemChannels.filter((channel) => channel.id !== id);
            const logicalModels = current.logicalModels.map((model) => ({ ...model, bindings: model.bindings.filter((binding) => binding.channelId !== id) })).filter((model) => model.bindings.length);
            return { ...current, systemChannels, logicalModels, defaultModels: normalizeDefaultModelsConfig(current.defaultModels, logicalModels, systemChannels) };
        });
    };

    const updateFreeDailyPoints = (value: number | null) => {
        setSettings((current) => ({ ...current, freeDailyPoints: toNumberOrZero(value) }));
    };

    const updateGenerationConcurrency = (key: keyof AuthSettings["generationConcurrency"], value: number | null) => {
        const limits = { agent: { max: 10, fallback: 2 }, image: { max: 10, fallback: 4 }, video: { max: 5, fallback: 1 }, audio: { max: 10, fallback: 2 }, text: { max: 20, fallback: 4 }, render: { max: 5, fallback: 1 } }[key];
        setSettings((current) => ({
            ...current,
            generationConcurrency: {
                ...current.generationConcurrency,
                [key]: clampInteger(value, 1, limits.max, limits.fallback),
            },
        }));
    };

    const updateGenerationDefaults = <K extends keyof AuthSettings["generationDefaults"]>(key: K, value: AuthSettings["generationDefaults"][K]) => {
        setSettings((current) => ({
            ...current,
            generationDefaults: {
                ...current.generationDefaults,
                [key]: value,
            },
        }));
    };

    const updateModelPointCost = (model: string, value: number | null) => {
        setSettings((current) => ({ ...current, modelPointCosts: { ...current.modelPointCosts, [model]: toNumberOrOne(value) } }));
    };

    const updateGenerationPointMultiplier = (group: keyof AuthSettings["generationPointMultipliers"], key: string, value: number | null) => {
        setSettings((current) => ({
            ...current,
            generationPointMultipliers: {
                ...current.generationPointMultipliers,
                [group]: {
                    ...current.generationPointMultipliers[group],
                    [key]: toNumberOrOne(value),
                },
            },
        }));
    };

    const deleteGenerationPointMultiplier = (group: keyof AuthSettings["generationPointMultipliers"], key: string) => {
        setSettings((current) => {
            const nextGroup = { ...current.generationPointMultipliers[group] };
            delete nextGroup[key];
            return {
                ...current,
                generationPointMultipliers: {
                    ...current.generationPointMultipliers,
                    [group]: nextGroup,
                },
            };
        });
    };

    const addCustomPointModel = () => {
        const model = customPointModel.trim();
        if (!model) {
            message.warning("请输入模型名称");
            return;
        }
        updateModelPointCost(model, settings.modelPointCosts[model] ?? 1);
        setCustomPointModel("");
    };

    const deleteModelPointCost = (model: string) => {
        setSettings((current) => {
            const next = { ...current.modelPointCosts };
            delete next[model];
            return { ...current, modelPointCosts: next };
        });
    };

    const updateMailSetting = (key: keyof AuthSettings["mail"], value: string | number | boolean) => {
        setSettings((current) => ({ ...current, mail: { ...current.mail, [key]: value } }));
    };

    const testMailSettings = async () => {
        setMailTestLoading(true);
        try {
            const response = await fetch("/api/admin/mail/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mail: settings.mail, to: mailTestTo }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error || "测试邮件发送失败");
            message.success("测试邮件已发送，请检查收件箱");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "测试邮件发送失败");
        } finally {
            setMailTestLoading(false);
        }
    };

    const updateSiteSetting = <K extends keyof Omit<AuthSettings["site"], "socials">>(key: K, value: AuthSettings["site"][K]) => {
        setSettings((current) => ({ ...current, site: { ...current.site, [key]: value } }));
    };

    const uploadSiteImage = (file: File | undefined, key: "logoUrl" | "iconUrl", label: string) => {
        if (!file) return;
        const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"];
        if (!allowed.includes(file.type)) {
            message.warning(`${label} 仅支持 PNG、JPG、SVG 或 ICO`);
            return;
        }
        if (file.size > 300 * 1024) {
            message.warning(`${label} 文件不能超过 300KB`);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            updateSiteSetting(key, String(reader.result || ""));
            message.success(`${label} 已读取，保存设置后生效`);
        };
        reader.onerror = () => message.error(`${label} 读取失败`);
        reader.readAsDataURL(file);
    };

    const uploadSiteLogo = (file?: File) => uploadSiteImage(file, "logoUrl", "Logo");
    const uploadSiteIcon = (file?: File) => uploadSiteImage(file, "iconUrl", "浏览器图标");

    const updateSiteSocialSetting = (key: SiteSocialKey, patch: Partial<AuthSettings["site"]["socials"][SiteSocialKey]>) => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                socials: {
                    ...current.site.socials,
                    [key]: { ...current.site.socials[key], ...patch },
                },
            },
        }));
    };

    const addFriendLink = () => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                friendLinks: [...(current.site.friendLinks || []), { id: nanoid(), label: "友情链接", url: "https://", enabled: true }],
            },
        }));
    };

    const updateFriendLink = (id: string, patch: Partial<SiteFriendLink>) => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                friendLinks: (current.site.friendLinks || []).map((link) => (link.id === id ? { ...link, ...patch } : link)),
            },
        }));
    };

    const deleteFriendLink = (id: string) => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                friendLinks: (current.site.friendLinks || []).filter((link) => link.id !== id),
            },
        }));
    };

    const addHomeShowcaseItem = () => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                homeShowcaseMode: "custom",
                homeShowcaseItems: [
                    ...(current.site.homeShowcaseItems || []),
                    {
                        id: nanoid(),
                        title: "首页展示提示词",
                        coverUrl: "",
                        prompt: "",
                        tags: ["精选提示词"],
                        category: "首页展示",
                    },
                ].slice(0, 8),
            },
        }));
    };

    const updateHomeShowcaseItem = (id: string, patch: Partial<SiteShowcaseItem>) => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                homeShowcaseItems: (current.site.homeShowcaseItems || []).map((item) => (item.id === id ? { ...item, ...patch } : item)),
            },
        }));
    };

    const deleteHomeShowcaseItem = (id: string) => {
        setSettings((current) => ({
            ...current,
            site: {
                ...current.site,
                homeShowcaseItems: (current.site.homeShowcaseItems || []).filter((item) => item.id !== id),
            },
        }));
    };

    const fetchModelsForChannel = async (channel: SystemModelChannel) => {
        if (!channel.baseUrl.trim()) {
            message.error("请先填写该渠道的 Base URL");
            return;
        }
        setFetchingModelId(channel.id);
        try {
            const result = await requestAdminModels(channel);
            updateChannel(channel.id, adminModelsChannelPatch(channel, result));
            const discovered = result.discoveredCount ?? result.models.length;
            const total = result.totalCount ?? result.models.length;
            message.success(`${channel.name || "渠道"} 本次发现 ${discovered} 个模型，合并后共 ${total} 个${result.warning ? `；${result.warning}` : ""}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "拉取模型失败");
        } finally {
            setFetchingModelId("");
        }
    };

    const fetchAllModels = async () => {
        const runnable = settings.systemChannels.filter((channel) => channel.baseUrl.trim());
        if (!runnable.length) {
            message.error("请先填写至少一个渠道的 Base URL");
            return;
        }
        setFetchingModelId("all");
        try {
            const results = await Promise.allSettled(runnable.map(async (channel) => [channel.id, await requestAdminModels(channel)] as const));
            const entries = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
            const modelMap = new Map(entries);
            if (modelMap.size) {
                setSettings((current) => ({
                    ...current,
                    systemChannels: current.systemChannels.map((channel) => {
                        const result = modelMap.get(channel.id);
                        return result ? { ...channel, ...adminModelsChannelPatch(channel, result) } : channel;
                    }),
                }));
            }
            const failedChannels = results.flatMap((result, index) => (result.status === "rejected" ? [`${runnable[index].name || "未命名渠道"}：${result.reason instanceof Error ? result.reason.message : "拉取模型失败"}`] : []));
            if (!failedChannels.length) message.success("模型列表已拉取");
            else if (modelMap.size) message.warning(`已更新可拉取的模型；${failedChannels.join("；")}`);
            else message.error(failedChannels.join("；"));
        } finally {
            setFetchingModelId("");
        }
    };

    const testChannelHealth = async (channel: SystemModelChannel, kind: ChannelHealthKind, options?: { quiet?: boolean; loadingKey?: string; keepLoading?: boolean }) => {
        if (!channel.baseUrl.trim() || (!channel.apiKey.trim() && !channel.hasApiKey)) {
            message.error("请先填写该渠道的 Base URL 和 API Key");
            return null;
        }
        const model = selectChannelHealthModel(channel, settings.defaultModels, kind);
        if (!model) {
            const result = { ok: false, kind, model: "", status: 0, error: "没有找到可检测的模型名" } satisfies ChannelHealthResult;
            if (!options?.quiet) message.error("请先为该渠道填写至少一个模型名");
            return result;
        }
        const resultKey = `${channel.id}:${kind}`;
        setTestingChannelKey(options?.loadingKey || resultKey);
        try {
            const response = await fetch("/api/admin/channel-health", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    channelId: channel.id,
                    baseUrl: channel.baseUrl,
                    apiKey: channel.apiKey,
                    apiFormat: channel.apiFormat,
                    model,
                    kind,
                    protocol: channel.advancedConfig?.protocol,
                    globalAiOpcPreset: channel.advancedConfig?.globalAiOpcPreset,
                    globalAiOpcPresets: channel.advancedConfig?.globalAiOpcPresets,
                    createPath: channel.advancedConfig?.createPath,
                }),
            });
            const payload = (await response.json()) as { result?: ChannelHealthResult; error?: string };
            if (!response.ok || !payload.result) throw new Error(payload.error || "接口测试失败");
            setChannelHealthResults((current) => ({ ...current, [resultKey]: payload.result! }));
            if (!options?.quiet) {
                if (payload.result.ok) message.success(`${channel.name || "渠道"} ${healthKindLabel(kind)}测试成功`);
                else message.warning(payload.result.error || `${healthKindLabel(kind)}测试失败`);
            }
            return payload.result;
        } catch (error) {
            const messageText = error instanceof Error ? error.message : "接口测试失败";
            setChannelHealthResults((current) => ({
                ...current,
                [resultKey]: { ok: false, kind, model, status: 0, error: messageText },
            }));
            if (!options?.quiet) message.error(messageText);
            return { ok: false, kind, model, status: 0, error: messageText } satisfies ChannelHealthResult;
        } finally {
            if (!options?.keepLoading) setTestingChannelKey("");
        }
    };

    const testAllChannelHealth = async (channel: SystemModelChannel) => {
        if (!channel.baseUrl.trim() || (!channel.apiKey.trim() && !channel.hasApiKey)) {
            message.error("请先填写该渠道的 Base URL 和 API Key");
            return;
        }
        const kinds: ChannelHealthKind[] = ["text", "image", "video", "audio"];
        const loadingKey = `${channel.id}:all`;
        setTestingChannelKey(loadingKey);
        const results: ChannelHealthResult[] = [];
        try {
            let channelForTest = channel;
            let detectedModels = channel.models;
            if (!detectedModels.length || (isGlobalAiOpcBaseUrl(channel.baseUrl) && channel.advancedConfig?.protocol !== "globalaiopc")) {
                try {
                    const catalog = await requestAdminModels(channel);
                    const patch = adminModelsChannelPatch(channel, catalog);
                    channelForTest = { ...channel, ...patch };
                    detectedModels = catalog.models;
                } catch {
                    detectedModels = [];
                }
            }
            detectedModels = uniqueList([...detectedModels, ...suggestedChannelModels(channel)]);
            channelForTest = { ...channelForTest, models: detectedModels };
            if (detectedModels.length) updateChannel(channel.id, adminModelsChannelPatch(channelForTest, { models: detectedModels, globalAiOpcPresets: channelForTest.advancedConfig?.globalAiOpcPresets }));
            for (const kind of kinds) {
                const result = await testChannelHealth(channelForTest, kind, { quiet: true, loadingKey, keepLoading: true });
                if (result) results.push(result);
            }
            const advancedConfig = buildAdvancedConfigFromHealth(channelForTest, results);
            updateChannel(channel.id, {
                models: uniqueList([...detectedModels, ...results.map((result) => result.model).filter(Boolean)]),
                advancedConfig,
            });
            const okKinds = results.filter((result) => result.ok).map((result) => healthKindLabel(result.kind));
            const failedKinds = results.filter((result) => !result.ok).map((result) => healthKindLabel(result.kind));
            const summary = `可用：${okKinds.join("、") || "无"}${failedKinds.length ? `；需检查：${failedKinds.join("、")}` : ""}`;
            if (failedKinds.length) message.warning(`${channel.name || "渠道"} 智能检测完成，${summary}`);
            else message.success(`${channel.name || "渠道"} 智能检测完成，${summary}`);
        } finally {
            setTestingChannelKey("");
        }
    };
    return {
        updateChannel,
        addChannel,
        deleteChannel,
        updateFreeDailyPoints,
        updateGenerationConcurrency,
        updateGenerationDefaults,
        updateModelPointCost,
        updateGenerationPointMultiplier,
        deleteGenerationPointMultiplier,
        addCustomPointModel,
        deleteModelPointCost,
        updateMailSetting,
        testMailSettings,
        updateSiteSetting,
        uploadSiteLogo,
        uploadSiteIcon,
        updateSiteSocialSetting,
        addFriendLink,
        updateFriendLink,
        deleteFriendLink,
        addHomeShowcaseItem,
        updateHomeShowcaseItem,
        deleteHomeShowcaseItem,
        fetchModelsForChannel,
        fetchAllModels,
        testChannelHealth,
        testAllChannelHealth,
    };
}

export type AdminDashboardSettingsActions = ReturnType<typeof useAdminDashboardSettingsActions>;

function adminModelsChannelPatch(channel: SystemModelChannel, result: AdminModelsResult): Partial<SystemModelChannel> {
    const advanced = channel.advancedConfig || createDefaultChannelAdvancedConfig();
    const models = uniqueList([...channel.models, ...result.models]);
    const modelCapabilities = { ...(advanced.modelCapabilities || {}), ...(result.modelCapabilities || {}) };
    const modelConfigs = mergeAdminModelConfigs(advanced.modelConfigs, result.modelConfigs);
    if (!result.globalAiOpcPresets?.length) {
        return {
            models,
            advancedConfig: {
                ...advanced,
                ...(result.recommendedConfig || {}),
                modelCapabilities,
                modelConfigs,
            },
        };
    }
    const selection = buildGlobalAiOpcSelection(result.globalAiOpcPresets);
    const onlyPreset = selection.presetIds.length === 1;
    return {
        models: uniqueList([...models, ...selection.models]),
        apiFormat: selection.apiFormat,
        advancedConfig: {
            ...advanced,
            protocol: "globalaiopc",
            globalAiOpcPresets: selection.presetIds,
            globalAiOpcPreset: onlyPreset ? selection.presetIds[0] : undefined,
            textModel: selection.textModel,
            imageModel: selection.imageModel,
            videoModel: selection.videoModel,
            createPath: selection.createPath,
            queryPath: selection.queryPath,
            requestTemplate: "",
            durationRange: selection.durationRange,
            referenceRule: "参考素材使用可被上游访问的公网 URL；由服务器在提交前生成受控访问地址。",
            supportsReferenceImage: selection.supportsReferenceImage,
            supportsReferenceVideo: selection.supportsReferenceVideo,
            supportsReferenceAudio: selection.supportsReferenceAudio,
            modelCapabilities,
            modelConfigs,
        },
    };
}

function mergeAdminModelConfigs(current: SystemChannelAdvancedConfig["modelConfigs"], discovered: SystemChannelAdvancedConfig["modelConfigs"]) {
    const merged = { ...(current || {}), ...(discovered || {}) };
    Object.entries(current || {}).forEach(([model, config]) => {
        if (config.source === "manual") merged[model] = config;
    });
    return merged;
}
