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
import { AdminOverview } from "@/components/admin/admin-overview";
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
import { emptyAdminGenerationOverviewSummary } from "@/lib/admin-generation-overview";
import { normalizeDefaultModelsConfig } from "@/lib/model-routing-config";
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
export const USER_PAGE_SIZE = 20;
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

export function useAdminDashboardState({ initialUsers, initialUserSummary, initialSettings, initialPromptCount, currentUser, initialSection = "overview", setupSummary, headerActions }: AdminDashboardProps) {
    const { message } = App.useApp();
    const [promptForm] = Form.useForm<PromptFormValue>();
    const [userForm] = Form.useForm<UserEditorValue>();
    const logoInputRef = useRef<HTMLInputElement>(null);
    const iconInputRef = useRef<HTMLInputElement>(null);
    const promptRequestIdRef = useRef(0);
    const userRequestIdRef = useRef(0);
    const generationLogRequestIdRef = useRef(0);
    const operationsSummaryRequestIdRef = useRef(0);
    const announcementRequestIdRef = useRef(0);
    const [users, setUsers] = useState(initialUsers);
    const [userSummary, setUserSummary] = useState(initialUserSummary);
    const [usersLoading, setUsersLoading] = useState(false);
    const [userPage, setUserPage] = useState(1);
    const [userTotal, setUserTotal] = useState(0);
    const [settings, setSettings] = useState(initialSettings);
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [promptCount, setPromptCount] = useState(initialPromptCount);
    const [promptListTotal, setPromptListTotal] = useState(initialPromptCount);
    const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
    const [settingsLoading, setSettingsLoading] = useState(false);
    const [assetStats, setAssetStats] = useState<GenerationAssetStats | null>(null);
    const [operationsSummary, setOperationsSummary] = useState(emptyAdminGenerationOverviewSummary);
    const [operationsSummaryLoading, setOperationsSummaryLoading] = useState(false);
    const [mailTestLoading, setMailTestLoading] = useState(false);
    const [mailTestTo, setMailTestTo] = useState("");
    const [fetchingModelId, setFetchingModelId] = useState("");
    const [testingChannelKey, setTestingChannelKey] = useState("");
    const [channelHealthResults, setChannelHealthResults] = useState<Record<string, ChannelHealthResult>>({});
    const [promptSaving, setPromptSaving] = useState(false);
    const [promptsLoading, setPromptsLoading] = useState(false);
    const [deletingPromptId, setDeletingPromptId] = useState("");
    const [promptSearch, setPromptSearch] = useState("");
    const [debouncedPromptSearch, setDebouncedPromptSearch] = useState("");
    const [promptPage, setPromptPage] = useState(1);
    const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
    const [bulkDeletingPrompts, setBulkDeletingPrompts] = useState(false);
    const [userSearch, setUserSearch] = useState("");
    const [debouncedUserSearch, setDebouncedUserSearch] = useState("");
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [bulkDeletingUsers, setBulkDeletingUsers] = useState(false);
    const [generationLogs, setGenerationLogs] = useState<StoredGenerationLog[]>([]);
    const [generationLogTotal, setGenerationLogTotal] = useState(0);
    const [generationLogPage, setGenerationLogPage] = useState(1);
    const [generationLogSearch, setGenerationLogSearch] = useState("");
    const [generationLogKind, setGenerationLogKind] = useState("");
    const [generationLogSource, setGenerationLogSource] = useState("");
    const [generationLogStatus, setGenerationLogStatus] = useState("");
    const [generationLogUserId, setGenerationLogUserId] = useState("");
    const [generationLogStart, setGenerationLogStart] = useState("");
    const [generationLogEnd, setGenerationLogEnd] = useState("");
    const [selectedGenerationLogIds, setSelectedGenerationLogIds] = useState<string[]>([]);
    const [generationLogsLoading, setGenerationLogsLoading] = useState(false);
    const [bulkDeletingGenerationLogs, setBulkDeletingGenerationLogs] = useState(false);
    const [viewingGenerationLog, setViewingGenerationLog] = useState<StoredGenerationLog | null>(null);
    const [paymentConfig, setPaymentConfig] = useState<PaymentConfigSummary | null>(null);
    const [billingSummary, setBillingSummary] = useState<AdminBillingSummary | null>(null);
    const [billingSummaryLoading, setBillingSummaryLoading] = useState(false);
    const [viewingCdkCode, setViewingCdkCode] = useState<PublicCdkCode | null>(null);
    const [cdkCodes, setCdkCodes] = useState<PublicCdkCode[]>([]);
    const [cdkLoading, setCdkLoading] = useState(false);
    const [cdkGenerating, setCdkGenerating] = useState(false);
    const [createdCdkCodes, setCreatedCdkCodes] = useState<CreatedCdkCode[]>([]);
    const [selectedCreatedCdkIds, setSelectedCreatedCdkIds] = useState<string[]>([]);
    const [cdkForm, setCdkForm] = useState({ count: 1, points: 10, maxRedemptions: 1, expiresInDays: null as number | null, note: "" });
    const [cdkSearch, setCdkSearch] = useState("");
    const [debouncedCdkSearch, setDebouncedCdkSearch] = useState("");
    const [cdkFilter, setCdkFilter] = useState<"all" | "redeemed" | "unused" | "expired">("all");
    const [cdkPage, setCdkPage] = useState(1);
    const [cdkTotal, setCdkTotal] = useState(0);
    const [cdkStats, setCdkStats] = useState({ total: 0, redeemed: 0, unused: 0, expired: 0 });
    const [selectedCdkIds, setSelectedCdkIds] = useState<string[]>([]);
    const [bulkDeletingCdk, setBulkDeletingCdk] = useState(false);
    const [announcements, setAnnouncements] = useState<PublicAnnouncement[]>([]);
    const [announcementPage, setAnnouncementPage] = useState(1);
    const [announcementTotal, setAnnouncementTotal] = useState(0);
    const [announcementsLoading, setAnnouncementsLoading] = useState(false);
    const [announcementSaving, setAnnouncementSaving] = useState(false);
    const [announcementModalOpen, setAnnouncementModalOpen] = useState(false);
    const [promptModalOpen, setPromptModalOpen] = useState(false);
    const [announcementDraft, setAnnouncementDraft] = useState<Partial<PublicAnnouncement>>({ title: "", content: "", enabled: true, popupHome: false, popupAfterLogin: false });
    const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
    const [creatingUser, setCreatingUser] = useState(false);
    const [activeSection, setActiveSection] = useState<AdminSectionKey>(initialSection);
    const [agentReadiness, setAgentReadiness] = useState<AgentReadiness | null>(null);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [desktopNavCollapsed, setDesktopNavCollapsed] = useState(false);
    const [customPointModel, setCustomPointModel] = useState("");
    const stats = useMemo(() => ({ total: userSummary.total, active: userSummary.active, admins: userSummary.admins, disabled: userSummary.disabled }), [userSummary]);
    const settingsSummary = useMemo(
        () => ({
            totalChannels: settings.systemChannels.length,
            enabledChannels: settings.systemChannels.filter((channel) => channel.enabled).length,
            models: uniqueList(settings.systemChannels.flatMap((channel) => channel.models)).length,
        }),
        [settings.systemChannels],
    );
    const walletSummary = useMemo(
        () => ({
            totalBalance: userSummary.totalPointsBalance,
            enabledPlans: setupSummary?.enabledPlanProducts ?? settings.entitlements.plans.filter((plan) => plan.enabled).length,
            usersWithPlan: userSummary.usersWithPlan,
        }),
        [settings.entitlements.plans, setupSummary?.enabledPlanProducts, userSummary],
    );
    const filteredUsers = users;
    const selectedUsers = useMemo(() => users.filter((user) => selectedUserIds.includes(user.id)), [selectedUserIds, users]);
    const selectedPrompts = useMemo(() => prompts.filter((prompt) => selectedPromptIds.includes(prompt.id)), [prompts, selectedPromptIds]);
    const selectedGenerationLogs = useMemo(() => generationLogs.filter((log) => selectedGenerationLogIds.includes(log.id)), [generationLogs, selectedGenerationLogIds]);
    const promptListStart = promptListTotal ? (promptPage - 1) * PROMPT_PAGE_SIZE + 1 : 0;
    const promptListEnd = Math.min(promptPage * PROMPT_PAGE_SIZE, promptListTotal);
    const selectedCreatedCdkCodes = useMemo(() => createdCdkCodes.filter((code) => selectedCreatedCdkIds.includes(code.id)), [createdCdkCodes, selectedCreatedCdkIds]);
    const createdCdkActionCodes = selectedCreatedCdkCodes.length ? selectedCreatedCdkCodes : createdCdkCodes;
    const allCreatedCdkSelected = Boolean(createdCdkCodes.length) && selectedCreatedCdkIds.length === createdCdkCodes.length;
    return {
        initialUsers,
        initialUserSummary,
        initialSettings,
        initialPromptCount,
        currentUser,
        initialSection,
        setupSummary,
        headerActions,
        message,
        promptForm,
        userForm,
        logoInputRef,
        iconInputRef,
        promptRequestIdRef,
        userRequestIdRef,
        generationLogRequestIdRef,
        operationsSummaryRequestIdRef,
        announcementRequestIdRef,
        users,
        setUsers,
        userSummary,
        setUserSummary,
        usersLoading,
        setUsersLoading,
        userPage,
        setUserPage,
        userTotal,
        setUserTotal,
        settings,
        setSettings,
        prompts,
        setPrompts,
        promptCount,
        setPromptCount,
        promptListTotal,
        setPromptListTotal,
        updatingUserId,
        setUpdatingUserId,
        settingsLoading,
        setSettingsLoading,
        assetStats,
        setAssetStats,
        operationsSummary,
        setOperationsSummary,
        operationsSummaryLoading,
        setOperationsSummaryLoading,
        mailTestLoading,
        setMailTestLoading,
        mailTestTo,
        setMailTestTo,
        fetchingModelId,
        setFetchingModelId,
        testingChannelKey,
        setTestingChannelKey,
        channelHealthResults,
        setChannelHealthResults,
        promptSaving,
        setPromptSaving,
        promptsLoading,
        setPromptsLoading,
        deletingPromptId,
        setDeletingPromptId,
        promptSearch,
        setPromptSearch,
        debouncedPromptSearch,
        setDebouncedPromptSearch,
        promptPage,
        setPromptPage,
        selectedPromptIds,
        setSelectedPromptIds,
        bulkDeletingPrompts,
        setBulkDeletingPrompts,
        userSearch,
        setUserSearch,
        debouncedUserSearch,
        setDebouncedUserSearch,
        selectedUserIds,
        setSelectedUserIds,
        bulkDeletingUsers,
        setBulkDeletingUsers,
        generationLogs,
        setGenerationLogs,
        generationLogTotal,
        setGenerationLogTotal,
        generationLogPage,
        setGenerationLogPage,
        generationLogSearch,
        setGenerationLogSearch,
        generationLogKind,
        setGenerationLogKind,
        generationLogSource,
        setGenerationLogSource,
        generationLogStatus,
        setGenerationLogStatus,
        generationLogUserId,
        setGenerationLogUserId,
        generationLogStart,
        setGenerationLogStart,
        generationLogEnd,
        setGenerationLogEnd,
        selectedGenerationLogIds,
        setSelectedGenerationLogIds,
        generationLogsLoading,
        setGenerationLogsLoading,
        bulkDeletingGenerationLogs,
        setBulkDeletingGenerationLogs,
        viewingGenerationLog,
        setViewingGenerationLog,
        paymentConfig,
        setPaymentConfig,
        billingSummary,
        setBillingSummary,
        billingSummaryLoading,
        setBillingSummaryLoading,
        viewingCdkCode,
        setViewingCdkCode,
        cdkCodes,
        setCdkCodes,
        cdkLoading,
        setCdkLoading,
        cdkGenerating,
        setCdkGenerating,
        createdCdkCodes,
        setCreatedCdkCodes,
        selectedCreatedCdkIds,
        setSelectedCreatedCdkIds,
        cdkForm,
        setCdkForm,
        cdkSearch,
        setCdkSearch,
        debouncedCdkSearch,
        setDebouncedCdkSearch,
        cdkFilter,
        setCdkFilter,
        cdkPage,
        setCdkPage,
        cdkTotal,
        setCdkTotal,
        cdkStats,
        setCdkStats,
        selectedCdkIds,
        setSelectedCdkIds,
        bulkDeletingCdk,
        setBulkDeletingCdk,
        announcements,
        setAnnouncements,
        announcementPage,
        setAnnouncementPage,
        announcementTotal,
        setAnnouncementTotal,
        announcementsLoading,
        setAnnouncementsLoading,
        announcementSaving,
        setAnnouncementSaving,
        announcementModalOpen,
        setAnnouncementModalOpen,
        promptModalOpen,
        setPromptModalOpen,
        announcementDraft,
        setAnnouncementDraft,
        editingUser,
        setEditingUser,
        creatingUser,
        setCreatingUser,
        activeSection,
        setActiveSection,
        agentReadiness,
        setAgentReadiness,
        mobileNavOpen,
        setMobileNavOpen,
        desktopNavCollapsed,
        setDesktopNavCollapsed,
        customPointModel,
        setCustomPointModel,
        stats,
        settingsSummary,
        walletSummary,
        filteredUsers,
        selectedUsers,
        selectedPrompts,
        selectedGenerationLogs,
        promptListStart,
        promptListEnd,
        selectedCreatedCdkCodes,
        createdCdkActionCodes,
        allCreatedCdkSelected,
    };
}

export type AdminDashboardState = ReturnType<typeof useAdminDashboardState>;
