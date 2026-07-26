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
import type { AdminDashboardSettingsActions } from "./use-admin-dashboard-settings-actions";

export function useAdminDashboardEffects({ state, data, settingsActions }: { state: AdminDashboardState; data: AdminDashboardDataActions; settingsActions: AdminDashboardSettingsActions }) {
    const {
        initialSection,
        settings,
        settingsLoading,
        promptSearch,
        debouncedPromptSearch,
        setDebouncedPromptSearch,
        promptPage,
        generationLogPage,
        generationLogSearch,
        generationLogKind,
        generationLogSource,
        generationLogStatus,
        generationLogUserId,
        generationLogStart,
        generationLogEnd,
        cdkSearch,
        debouncedCdkSearch,
        setDebouncedCdkSearch,
        cdkFilter,
        cdkPage,
        userSearch,
        debouncedUserSearch,
        setDebouncedUserSearch,
        userPage,
        setUserPage,
        activeSection,
        setActiveSection,
        setAgentReadiness,
    } = state;
    const { loadBillingSummary, loadOperationsSummary, loadGenerationAssetStats, loadPrompts, loadGenerationLogs, loadPaymentConfig, loadCdkCodes, loadAnnouncements, loadUsers } = data;
    const {} = settingsActions;

    useEffect(() => {
        if (activeSection !== "skills" || settingsLoading) return;
        void fetch("/api/admin/agent-readiness", { cache: "no-store" })
            .then((response) => (response.ok ? response.json() : null))
            .then((payload) => setAgentReadiness(payload?.data || localAgentReadiness(settings)));
    }, [activeSection, settingsLoading]);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedPromptSearch(promptSearch.trim()), PROMPT_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [promptSearch]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setUserPage(1);
            setDebouncedUserSearch(userSearch.trim());
        }, PROMPT_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [userSearch]);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedCdkSearch(cdkSearch.trim()), PROMPT_SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [cdkSearch]);

    useEffect(() => {
        setActiveSection(initialSection);
    }, [initialSection]);

    useEffect(() => {
        if (activeSection !== "prompts") return;
        void loadPrompts(promptPage, debouncedPromptSearch);
    }, [activeSection, promptPage, debouncedPromptSearch]);

    useEffect(() => {
        if (activeSection !== "users") return;
        void loadUsers(userPage, debouncedUserSearch);
    }, [activeSection, userPage, debouncedUserSearch]);

    useEffect(() => {
        if (activeSection !== "overview") return;
        void loadGenerationAssetStats();
        void loadOperationsSummary();
    }, [activeSection]);

    useEffect(() => {
        if (activeSection !== "logs") return;
        void loadGenerationLogs();
    }, [activeSection, generationLogPage, generationLogSearch, generationLogKind, generationLogSource, generationLogStatus, generationLogUserId, generationLogStart, generationLogEnd]);

    useEffect(() => {
        if (activeSection !== "cdk") return;
        void loadCdkCodes();
    }, [activeSection, cdkPage, debouncedCdkSearch, cdkFilter]);

    useEffect(() => {
        if (activeSection !== "announcements") return;
        void loadAnnouncements();
    }, [activeSection]);

    useEffect(() => {
        if (activeSection !== "payments") return;
        void loadPaymentConfig();
    }, [activeSection]);

    useEffect(() => {
        if (activeSection !== "wallet" && activeSection !== "overview") return;
        void loadBillingSummary();
    }, [activeSection]);
}
