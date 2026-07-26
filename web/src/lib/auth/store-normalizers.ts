import { createHash, randomBytes, randomUUID } from "node:crypto";

import { decryptSecretValue, encryptSecretValue, isEncryptedSecretValue } from "@/lib/server/secret-crypto";
import { ECOMMERCE_IMAGE_SKILL } from "@/lib/server/agent-skills/ecommerce-image";
import { YANAI_BEAUTY_SKILL } from "@/lib/server/agent-skills/yanai-beauty";
import { DEFAULT_CREATIVE_SHORTCUT_SKILLS } from "@/lib/server/agent-skills/creative-shortcuts";
import { deriveLogicalModelsConfig, normalizeDefaultModelsConfig, normalizeLogicalModelsConfig } from "@/lib/model-routing-config";
import { isGlobalAiOpcPreset } from "@/lib/globalaiopc-catalog";
import { resolveConfiguredModelPointCost } from "@/lib/model-point-cost";
import {
    type UserRole,
    type UserStatus,
    type ApiCallFormat,
    type SystemChannelProtocol,
    type SystemChannelAdvancedConfig,
    type LegacyUserQuota,
    type ModelPointCosts,
    type PointUsageKind,
    type SystemModelChannel,
    type LogicalModelCapability,
    type LogicalModelCapabilityProfile,
    type LogicalModelBinding,
    type LogicalModel,
    type SystemDefaultModels,
    type AgentSkill,
    type GenerationConcurrencySettings,
    type GenerationDefaultSettings,
    type GenerationPointMultipliers,
    type EntitlementPlanLimits,
    type EntitlementPlan,
    type EntitlementSettings,
    type CdkStatus,
    type PublicCdkRedemption,
    type PublicCdkCode,
    type CreatedCdkCode,
    type StoredCdkRedemption,
    type StoredCdkCode,
    type PublicAnnouncement,
    type SiteSettings,
    type SiteShowcaseMode,
    type SiteShowcaseItem,
    type SiteFriendLink,
    type SiteSocialKey,
    type SiteSocialSettings,
    DEFAULT_SITE_SOCIALS,
    DEFAULT_SITE_FRIEND_LINKS,
    type MailSettings,
    type PublicUser,
    type StoredUser,
    type StoredSession,
    type PublicPointRecord,
    type StoredPointRecord,
    type StoredDailyPlanPointWallet,
    type StoredQuotaUsage,
    type EmailCodePurpose,
    type StoredEmailCode,
    type AuthSettings,
    type AuthDatabase,
} from "./store-types";
import {
    AuthInputError,
    EmailCodeAttemptError,
    QuotaExceededError,
    isAuthInputError,
    isQuotaExceededError,
    SESSION_MAX_AGE_SECONDS,
    EMAIL_CODE_MAX_AGE_MS,
    EMAIL_CODE_RESEND_COOLDOWN_MS,
    DEFAULT_USER_POINTS,
    DEFAULT_SITE_SETTINGS,
    DEFAULT_MAIL_SETTINGS,
    DEFAULT_GENERATION_POINT_MULTIPLIERS,
    DEFAULT_ENTITLEMENT_LIMITS,
    DEFAULT_ENTITLEMENT_PLAN_ID,
    DEFAULT_ENTITLEMENT_SETTINGS,
    DEFAULT_SETTINGS,
    AUTH_DATA_FILE,
    USERNAME_PATTERN,
} from "./store-foundation";

export function normalizeDb(db: Partial<AuthDatabase>): AuthDatabase {
    const settings = normalizeSettings(decryptAuthSettingsSecrets({ ...DEFAULT_SETTINGS, ...(db.settings || {}) } as AuthSettings));
    return pruneExpiredSessions({
        version: 1,
        users: Array.isArray(db.users)
            ? db.users.map((user) => {
                  const legacyUser = user as Partial<StoredUser> & { quota?: Partial<LegacyUserQuota> };
                  return {
                      ...user,
                      planId: resolvePlanById(settings.entitlements, user.planId).id,
                      pointsBalance: normalizePoints(legacyUser.pointsBalance, legacyQuotaToPoints(legacyUser.quota, resolveInitialUserPoints({ settings } as AuthDatabase, resolvePlanById(settings.entitlements, user.planId)))),
                  } as StoredUser;
              })
            : [],
        sessions: Array.isArray(db.sessions) ? db.sessions : [],
        quotaUsage: Array.isArray(db.quotaUsage) ? db.quotaUsage.map(normalizeQuotaUsage).filter((usage) => usage.userId) : [],
        pointRecords: Array.isArray((db as Partial<AuthDatabase>).pointRecords) ? ((db as Partial<AuthDatabase>).pointRecords || []).map(normalizePointRecord).filter((item) => item.userId) : [],
        dailyPlanPointWallets: Array.isArray(db.dailyPlanPointWallets) ? db.dailyPlanPointWallets.map(normalizeDailyPlanPointWallet).filter((item) => item.userId && item.date) : [],
        emailCodes: Array.isArray(db.emailCodes) ? db.emailCodes.map(normalizeEmailCode).filter((item) => item.email) : [],
        cdkCodes: Array.isArray(db.cdkCodes) ? db.cdkCodes.map(normalizeCdkCodeRecord).filter((item) => item.codeHash) : [],
        announcements: Array.isArray(db.announcements)
            ? db.announcements
                  .map(normalizeAnnouncement)
                  .filter((item) => item.title && item.content)
                  .slice(0, 200)
            : [],
        settings,
    });
}

export function emptyDb(): AuthDatabase {
    return { version: 1, users: [], sessions: [], quotaUsage: [], pointRecords: [], dailyPlanPointWallets: [], emailCodes: [], cdkCodes: [], announcements: [], settings: DEFAULT_SETTINGS };
}

export function encryptAuthDbSecretsForStorage(db: AuthDatabase): AuthDatabase {
    const normalized = normalizeDb(db);
    return { ...normalized, settings: encryptAuthSettingsSecrets(normalized.settings) };
}

export function decryptAuthSettingsSecrets(settings: AuthSettings): AuthSettings {
    return {
        ...settings,
        mail: { ...settings.mail, password: decryptSecretValue(settings.mail?.password || "") },
        systemChannels: Array.isArray(settings.systemChannels)
            ? settings.systemChannels.map((channel) => ({
                  ...channel,
                  apiKey: decryptSecretValue(channel.apiKey || ""),
              }))
            : [],
    };
}

export function encryptAuthSettingsSecrets(settings: AuthSettings): AuthSettings {
    return {
        ...settings,
        mail: { ...settings.mail, password: encryptSecretValue(settings.mail.password) },
        systemChannels: settings.systemChannels.map((channel) => ({
            ...channel,
            apiKey: encryptSecretValue(channel.apiKey),
        })),
    };
}

export function pruneExpiredSessions(db: AuthDatabase) {
    const now = Date.now();
    db.sessions = db.sessions.filter((session) => Date.parse(session.expiresAt) > now);
    const minQuotaUsageDate = new Date(now - 1000 * 60 * 60 * 24 * 45).toISOString().slice(0, 10);
    db.quotaUsage = db.quotaUsage.filter((usage) => usage.date >= minQuotaUsageDate);
    db.pointRecords = (db.pointRecords || []).slice(-10000);
    db.emailCodes = (db.emailCodes || []).filter((item) => !item.consumedAt && Date.parse(item.expiresAt) > now);
    db.cdkCodes = db.cdkCodes || [];
    db.announcements = (db.announcements || []).slice(0, 200);
    return db;
}

export function resolveInitialUserPoints(db: Pick<AuthDatabase, "settings">, plan = resolveDefaultPlan(db.settings.entitlements)) {
    void db;
    void plan;
    return 0;
}

export function resolveDefaultPlan(settings: EntitlementSettings) {
    return resolvePlanById(settings, settings.defaultPlanId);
}

export function resolveUserPlan(db: Pick<AuthDatabase, "settings">, user: StoredUser) {
    return resolvePlanById(db.settings.entitlements, user.planId);
}

export function resolvePlanById(settings: EntitlementSettings, planId: unknown) {
    const id = normalizePlanId(planId);
    return settings.plans.find((plan) => plan.enabled && plan.id === id) || settings.plans.find((plan) => plan.enabled && plan.id === settings.defaultPlanId) || settings.plans.find((plan) => plan.enabled) || DEFAULT_ENTITLEMENT_SETTINGS.plans[0];
}

export function assertEntitlementUsageAllowed(db: AuthDatabase, user: StoredUser, usageKind: PointUsageKind, units: number, cost: number) {
    if (!db.settings.entitlements.enabled) return;
    const plan = resolveUserPlan(db, user);
    const usage = findQuotaUsage(db, user.id, usageKind, currentQuotaDate());
    assertDailyLimit(plan.limits.dailyPointSpend, usage.pointsSpent + cost, "今日积分消费额度");
    assertDailyLimit(resolveDailyUsageLimit(plan.limits, usageKind), usage.units + units, dailyUsageLimitLabel(usageKind));
}

export function recordQuotaUsage(db: AuthDatabase, userId: string, usageKind: PointUsageKind, unitsDelta: number, pointsDelta: number, updatedAt: string) {
    if (!db.settings.entitlements.enabled) return;
    const usage = findQuotaUsage(db, userId, usageKind, currentQuotaDate());
    usage.units = normalizePointAmount(usage.units + unitsDelta, 0);
    usage.pointsSpent = normalizePointAmount(usage.pointsSpent + pointsDelta, 0);
    usage.updatedAt = updatedAt;
}

export function findQuotaUsage(db: AuthDatabase, userId: string, usageKind: PointUsageKind, date: string) {
    const item = db.quotaUsage.find((usage) => usage.userId === userId && usage.usageKind === usageKind && usage.date === date);
    if (item) return item;
    const next: StoredQuotaUsage = { userId, usageKind, date, pointsSpent: 0, units: 0, updatedAt: new Date().toISOString() };
    db.quotaUsage.push(next);
    return next;
}

export function assertDailyLimit(limit: number, nextValue: number, label: string) {
    if (limit <= 0) return;
    if (nextValue > limit) throw new QuotaExceededError(`${label}不足，今日额度 ${limit}，本次后将达到 ${Number(nextValue.toFixed(2))}`);
}

export function resolveDailyUsageLimit(limits: EntitlementPlanLimits, usageKind: PointUsageKind) {
    if (usageKind === "image") return limits.dailyImages;
    if (usageKind === "video") return limits.dailyVideos;
    if (usageKind === "audio") return limits.dailyAudio;
    if (usageKind === "text") return limits.dailyText;
    return limits.dailyApiCalls;
}

export function dailyUsageLimitLabel(usageKind: PointUsageKind) {
    if (usageKind === "image") return "今日图片生成次数";
    if (usageKind === "video") return "今日视频生成次数";
    if (usageKind === "audio") return "今日音频生成次数";
    if (usageKind === "text") return "今日文本调用次数";
    return "今日 API 调用次数";
}

export function countActiveAdmins(db: AuthDatabase, excludingUserId?: string) {
    return db.users.filter((user) => user.id !== excludingUserId && user.role === "admin" && user.status === "active").length;
}

export function normalizeUsername(value: string) {
    return value.trim();
}

export function normalizeEmail(value: unknown) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeDisplayName(value: string) {
    return value.trim().slice(0, 40);
}

export function normalizeSettings(settings: AuthSettings): AuthSettings {
    const systemChannels = Array.isArray(settings.systemChannels) ? settings.systemChannels.map(normalizeSystemChannel).filter((channel) => channel.name || channel.baseUrl || channel.models.length) : [];
    const logicalModels = normalizeLogicalModels(settings.logicalModels, systemChannels);
    return {
        site: normalizeSiteSettings(settings.site),
        registrationEnabled: Boolean(settings.registrationEnabled),
        emailRegistrationEnabled: Boolean(settings.emailRegistrationEnabled),
        freeDailyPointsEnabled: settings.freeDailyPointsEnabled !== false,
        freeDailyPoints: normalizePoints(settings.freeDailyPoints, 0),
        mail: normalizeMailSettings(settings.mail),
        allowUserApiConfig: false,
        modelPointCosts: normalizeModelPointCosts(settings.modelPointCosts),
        generationPointMultipliers: normalizeGenerationPointMultipliers(settings.generationPointMultipliers),
        entitlements: normalizeEntitlementSettings(settings.entitlements),
        generationConcurrency: normalizeGenerationConcurrency(settings.generationConcurrency),
        generationDefaults: normalizeGenerationDefaults(settings.generationDefaults),
        systemChannels,
        logicalModels,
        defaultModels: normalizeDefaultModelsConfig(settings.defaultModels, logicalModels, systemChannels),
        agentSkills: normalizeAgentSkills(settings.agentSkills),
    };
}

export function normalizeLogicalModels(models: LogicalModel[] | undefined, channels: SystemModelChannel[]): LogicalModel[] {
    return normalizeLogicalModelsConfig(models, channels);
}

export function deriveLogicalModels(channels: SystemModelChannel[]): LogicalModel[] {
    return deriveLogicalModelsConfig(channels);
}

export function normalizeAgentSkill(skill: AgentSkill): AgentSkill {
    if (skill.id === ECOMMERCE_IMAGE_SKILL.id && !skill.sourceUrl) return { ...ECOMMERCE_IMAGE_SKILL, keywords: [...ECOMMERCE_IMAGE_SKILL.keywords], workspaces: [...ECOMMERCE_IMAGE_SKILL.workspaces], enabled: skill.enabled !== false };
    return {
        id: String(skill.id || randomUUID()),
        name: String(skill.name || "")
            .trim()
            .slice(0, 60),
        description: String(skill.description || "")
            .trim()
            .slice(0, 240),
        instructions: String(skill.instructions || "")
            .trim()
            .slice(0, 8000),
        enabled: skill.enabled !== false,
        keywords: Array.isArray(skill.keywords)
            ? skill.keywords
                  .map(String)
                  .map((item) => item.trim())
                  .filter(Boolean)
                  .slice(0, 30)
            : [],
        workspaces: Array.isArray(skill.workspaces) ? skill.workspaces.filter((item): item is "image" | "video" | "canvas" | "drama" => ["image", "video", "canvas", "drama"].includes(item)) : ["image"],
        action: skill.action === "edit" ? "edit" : "generate",
        requiresReference: Boolean(skill.requiresReference),
        defaultConfig: skill.defaultConfig && typeof skill.defaultConfig === "object" ? skill.defaultConfig : {},
        sourceUrl:
            String(skill.sourceUrl || "")
                .trim()
                .slice(0, 500) || undefined,
        sourceVersion:
            String(skill.sourceVersion || "")
                .trim()
                .slice(0, 40) || undefined,
        license:
            String(skill.license || "")
                .trim()
                .slice(0, 40) || undefined,
    };
}

export function normalizeAgentSkills(skills: AgentSkill[] | undefined) {
    const normalized = Array.isArray(skills) ? skills.map(normalizeAgentSkill).filter((skill) => skill.name && skill.instructions) : [...DEFAULT_SETTINGS.agentSkills];
    if (!normalized.some((skill) => skill.id === YANAI_BEAUTY_SKILL.id)) normalized.push({ ...YANAI_BEAUTY_SKILL, keywords: [...YANAI_BEAUTY_SKILL.keywords], workspaces: [...YANAI_BEAUTY_SKILL.workspaces] });
    for (const skill of DEFAULT_CREATIVE_SHORTCUT_SKILLS) {
        const index = normalized.findIndex((item) => item.id === skill.id);
        if (index < 0) normalized.push({ ...skill, keywords: [...skill.keywords], workspaces: [...skill.workspaces] });
        else normalized[index] = { ...normalized[index], workspaces: [...new Set([...skill.workspaces, ...(normalized[index].workspaces || [])])] };
    }
    return normalized;
}

export function normalizeGenerationDefaults(settings: Partial<GenerationDefaultSettings> | undefined): GenerationDefaultSettings {
    return {
        canvasImageCount: Math.max(1, Math.min(10, Math.floor(Number(settings?.canvasImageCount) || DEFAULT_SETTINGS.generationDefaults.canvasImageCount))),
        imageSize: allowedText(settings?.imageSize, ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"], DEFAULT_SETTINGS.generationDefaults.imageSize),
        imageQuality: allowedText(settings?.imageQuality, ["auto", "low", "medium", "high"], DEFAULT_SETTINGS.generationDefaults.imageQuality),
        imageCount: Math.max(1, Math.min(10, Math.floor(Number(settings?.imageCount) || DEFAULT_SETTINGS.generationDefaults.imageCount))),
        videoQuality: allowedText(settings?.videoQuality, ["480", "720", "1080"], DEFAULT_SETTINGS.generationDefaults.videoQuality),
        videoSeconds: Math.max(1, Math.min(20, Math.floor(Number(settings?.videoSeconds) || DEFAULT_SETTINGS.generationDefaults.videoSeconds))),
        audioVoice: normalizeText(settings?.audioVoice, DEFAULT_SETTINGS.generationDefaults.audioVoice, 80),
        audioFormat: allowedText(settings?.audioFormat, ["mp3", "wav", "opus", "aac", "flac"], DEFAULT_SETTINGS.generationDefaults.audioFormat),
        workbenchSmartPlanning: {
            image: settings?.workbenchSmartPlanning?.image !== false,
            video: settings?.workbenchSmartPlanning?.video !== false,
        },
    };
}

export function allowedText(value: unknown, allowed: string[], fallback: string) {
    const text = typeof value === "string" ? value.trim() : "";
    return allowed.includes(text) ? text : fallback;
}

export function normalizeEntitlementSettings(settings: Partial<EntitlementSettings> | undefined): EntitlementSettings {
    const plans = Array.isArray(settings?.plans) ? settings.plans.map(normalizeEntitlementPlan).filter((plan) => plan.id) : [];
    const mergedPlans = plans.length ? plans : DEFAULT_ENTITLEMENT_SETTINGS.plans.map(normalizeEntitlementPlan);
    const defaultPlanId = normalizePlanId(settings?.defaultPlanId) || DEFAULT_ENTITLEMENT_PLAN_ID;
    const defaultPlan = mergedPlans.find((plan) => plan.id === defaultPlanId && plan.enabled) || mergedPlans.find((plan) => plan.enabled) || mergedPlans[0];
    return {
        enabled: settings?.enabled === true,
        defaultPlanId: defaultPlan.id,
        plans: mergedPlans.slice(0, 20),
    };
}

export function normalizeEntitlementPlan(plan: Partial<EntitlementPlan>): EntitlementPlan {
    const fallback = DEFAULT_ENTITLEMENT_SETTINGS.plans[0];
    return {
        id: normalizePlanId(plan.id) || fallback.id,
        name: normalizeText(plan.name, fallback.name, 40),
        enabled: plan.enabled !== false,
        dailyPoints: Math.max(0, normalizePoints(plan.dailyPoints, fallback.dailyPoints)),
        limits: normalizeEntitlementLimits(plan.limits),
        features: normalizeFeatureList(plan.features),
    };
}

export function normalizeEntitlementLimits(limits: Partial<EntitlementPlanLimits> | undefined): EntitlementPlanLimits {
    return {
        dailyPointSpend: normalizePointAmount(limits?.dailyPointSpend, DEFAULT_ENTITLEMENT_LIMITS.dailyPointSpend),
        dailyApiCalls: normalizePointAmount(limits?.dailyApiCalls, DEFAULT_ENTITLEMENT_LIMITS.dailyApiCalls),
        dailyImages: normalizePointAmount(limits?.dailyImages, DEFAULT_ENTITLEMENT_LIMITS.dailyImages),
        dailyVideos: normalizePointAmount(limits?.dailyVideos, DEFAULT_ENTITLEMENT_LIMITS.dailyVideos),
        dailyAudio: normalizePointAmount(limits?.dailyAudio, DEFAULT_ENTITLEMENT_LIMITS.dailyAudio),
        dailyText: normalizePointAmount(limits?.dailyText, DEFAULT_ENTITLEMENT_LIMITS.dailyText),
    };
}

export function normalizePlanId(value: unknown) {
    const id =
        typeof value === "string"
            ? value
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9_.-]/g, "-")
            : "";
    return id.slice(0, 40);
}

export function normalizeFeatureList(value: unknown) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => normalizeText(item, "", 60)).filter(Boolean))).slice(0, 40);
}

export function normalizeGenerationConcurrency(settings: Partial<GenerationConcurrencySettings> | undefined): GenerationConcurrencySettings {
    return {
        agent: Math.max(1, Math.min(10, Math.floor(Number(settings?.agent) || DEFAULT_SETTINGS.generationConcurrency.agent))),
        image: Math.max(1, Math.min(10, Math.floor(Number(settings?.image) || DEFAULT_SETTINGS.generationConcurrency.image))),
        video: Math.max(1, Math.min(5, Math.floor(Number(settings?.video) || DEFAULT_SETTINGS.generationConcurrency.video))),
        audio: Math.max(1, Math.min(10, Math.floor(Number(settings?.audio) || DEFAULT_SETTINGS.generationConcurrency.audio))),
        text: Math.max(1, Math.min(20, Math.floor(Number(settings?.text) || DEFAULT_SETTINGS.generationConcurrency.text))),
        render: Math.max(1, Math.min(5, Math.floor(Number(settings?.render) || DEFAULT_SETTINGS.generationConcurrency.render))),
    };
}

export function normalizeSiteSettings(settings: Partial<SiteSettings> | undefined): SiteSettings {
    const title = normalizeText(settings?.title, DEFAULT_SITE_SETTINGS.title, 40);
    const seoTitle = normalizeText(settings?.seoTitle, title, 72);
    return {
        title,
        logoUrl: normalizeLogoUrl(settings?.logoUrl),
        iconUrl: normalizeSiteIconUrl(settings?.iconUrl),
        seoTitle,
        seoDescription: normalizeText(settings?.seoDescription, DEFAULT_SITE_SETTINGS.seoDescription, 180),
        seoKeywords: normalizeText(settings?.seoKeywords, DEFAULT_SITE_SETTINGS.seoKeywords, 240),
        footerCopyright: normalizeText(settings?.footerCopyright, DEFAULT_SITE_SETTINGS.footerCopyright, 120),
        termsUrl: normalizeLinkUrl(settings?.termsUrl, DEFAULT_SITE_SETTINGS.termsUrl),
        privacyUrl: normalizeLinkUrl(settings?.privacyUrl, DEFAULT_SITE_SETTINGS.privacyUrl),
        homeShowcaseMode: settings?.homeShowcaseMode === "custom" ? "custom" : "random",
        homeShowcaseItems: normalizeSiteShowcaseItems(settings?.homeShowcaseItems),
        friendLinks: normalizeSiteFriendLinks(settings?.friendLinks),
        socials: normalizeSiteSocials(settings?.socials),
    };
}

export function normalizeSiteShowcaseItems(settings: unknown): SiteShowcaseItem[] {
    if (!Array.isArray(settings)) return [];
    return settings
        .map((item, index) => {
            const value = item as Partial<SiteShowcaseItem>;
            const title = normalizeText(value.title, "", 80);
            const prompt = normalizeText(value.prompt, "", 3000);
            if (!title || !prompt) return null;
            return {
                id: normalizeText(value.id, `showcase-${index + 1}`, 80),
                title,
                coverUrl: normalizeLinkUrl(value.coverUrl, ""),
                prompt,
                tags: normalizeShowcaseTags(value.tags),
                category: normalizeText(value.category, "精选展示", 40),
            };
        })
        .filter((item): item is SiteShowcaseItem => Boolean(item))
        .slice(0, 8);
}

export function normalizeShowcaseTags(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : String(value || "").split(/[,，\n]/);
    return Array.from(new Set(raw.map((tag) => String(tag || "").trim()).filter(Boolean))).slice(0, 4);
}

export function normalizeSiteFriendLinks(settings: unknown): SiteFriendLink[] {
    const links = Array.isArray(settings) ? settings : DEFAULT_SITE_FRIEND_LINKS;
    const normalized = links
        .map((link, index) => {
            const value = link as Partial<SiteFriendLink>;
            return {
                id: normalizeText(value.id, `friend-${index + 1}`, 80),
                label: normalizeText(value.url?.replace(/\/$/, "") === "https://www.vozeb.com" ? "VOZEB PRO" : value.label, "友情链接", 32),
                url: normalizeLinkUrl(value.url, ""),
                enabled: value.enabled !== false,
            };
        })
        .filter((link) => link.url)
        .slice(0, 12);
    for (const link of DEFAULT_SITE_FRIEND_LINKS) {
        if (normalized.some((item) => item.id === link.id || item.url.replace(/\/$/, "") === link.url.replace(/\/$/, ""))) continue;
        normalized.push(link);
    }
    const defaultOrdered = DEFAULT_SITE_FRIEND_LINKS.flatMap((link) => {
        const normalizedUrl = link.url.replace(/\/$/, "");
        const matched = normalized.find((item) => item.id === link.id || item.url.replace(/\/$/, "") === normalizedUrl);
        return matched ? [matched] : [];
    });
    const defaultKeys = new Set(DEFAULT_SITE_FRIEND_LINKS.flatMap((link) => [link.id, link.url.replace(/\/$/, "")]));
    const others = normalized.filter((link) => !defaultKeys.has(link.id) && !defaultKeys.has(link.url.replace(/\/$/, "")));
    return [...defaultOrdered, ...others].slice(0, 12);
}

export function normalizeSiteSocials(settings: Partial<SiteSocialSettings> | undefined): SiteSocialSettings {
    return {
        email: normalizeSiteSocial("email", settings?.email),
        telegram: normalizeSiteSocial("telegram", settings?.telegram),
        x: normalizeSiteSocial("x", settings?.x),
        instagram: normalizeSiteSocial("instagram", settings?.instagram),
    };
}

export function normalizeSiteSocial(key: SiteSocialKey, setting: Partial<SiteSocialSettings[SiteSocialKey]> | undefined) {
    const fallback = DEFAULT_SITE_SOCIALS[key];
    return {
        enabled: typeof setting?.enabled === "boolean" ? setting.enabled : fallback.enabled,
        label: normalizeText(setting?.label, fallback.label, 32),
        url: normalizeLinkUrl(setting?.url, fallback.url),
    };
}

export function normalizeMailSettings(settings: Partial<MailSettings> | undefined): MailSettings {
    const port = Math.max(1, Math.min(65535, Math.floor(Number(settings?.port) || DEFAULT_MAIL_SETTINGS.port)));
    return {
        provider: normalizeText(settings?.provider, DEFAULT_MAIL_SETTINGS.provider, 40),
        host: normalizeText(settings?.host, DEFAULT_MAIL_SETTINGS.host, 120),
        port,
        secure: settings?.secure !== false,
        username: normalizeText(settings?.username, DEFAULT_MAIL_SETTINGS.username, 160),
        password: normalizeSecretText(settings?.password, DEFAULT_MAIL_SETTINGS.password, 512),
        fromEmail: normalizeText(settings?.fromEmail, DEFAULT_MAIL_SETTINGS.fromEmail, 160),
        fromName: normalizeText(settings?.fromName, DEFAULT_MAIL_SETTINGS.fromName, 60),
    };
}

export function normalizeSecretText(value: unknown, fallback: string, maxPlainLength: number) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return fallback;
    return text.slice(0, isEncryptedSecretValue(text) ? 4000 : maxPlainLength);
}

export function normalizeText(value: unknown, fallback: string, maxLength: number) {
    const text = typeof value === "string" ? repairKnownMojibakeText(value.trim()) : "";
    return (text || fallback).slice(0, maxLength);
}

export function repairKnownMojibakeText(value: string) {
    if (value.includes("VOZEB PRO") && value.includes("AI") && !value.includes("绘图") && value.includes(",")) return DEFAULT_SITE_SETTINGS.seoKeywords;
    if (value.includes("VOZEB PRO") && value.includes("AI") && !value.includes("工作台")) return DEFAULT_SITE_SETTINGS.seoDescription;
    if (value.includes("2026 VOZEB PRO") && !value.startsWith("©")) return "© 2026 VOZEB PRO. All rights reserved.";
    if (value.startsWith("QQ ") && !value.includes("邮箱")) return "QQ 邮箱";
    return repairUtf8MojibakeText(value);
}

export function repairUtf8MojibakeText(value: string) {
    if (!looksLikeUtf8Mojibake(value)) return value;
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    if (!repaired || repaired.includes("\uFFFD")) return value;
    return textQualityScore(repaired) > textQualityScore(value) ? repaired : value;
}

export function looksLikeUtf8Mojibake(value: string) {
    if (!value) return false;
    if (/[\u0080-\u009f]/.test(value)) return true;
    if (/[ÂÃ][\u0080-\u00ff]/.test(value)) return true;
    const markers = value.match(/[åæçèéäöüï½ð]/g)?.length || 0;
    return markers >= 2 && !/[\u4e00-\u9fff]/.test(value);
}

export function textQualityScore(value: string) {
    const cjk = value.match(/[\u4e00-\u9fff]/g)?.length || 0;
    const controls = value.match(/[\u0080-\u009f]/g)?.length || 0;
    const replacements = value.match(/\uFFFD/g)?.length || 0;
    const mojibakeMarkers = value.match(/[ÂÃåæçèéäöüï½ð]/g)?.length || 0;
    return cjk * 4 - controls * 6 - replacements * 20 - mojibakeMarkers;
}

export function normalizeLogoUrl(value: unknown) {
    return normalizeSiteImageUrl(value, DEFAULT_SITE_SETTINGS.logoUrl);
}

export function normalizeSiteIconUrl(value: unknown) {
    return normalizeSiteImageUrl(value, DEFAULT_SITE_SETTINGS.iconUrl);
}

function normalizeSiteImageUrl(value: unknown, fallback: string) {
    const url = typeof value === "string" ? value.trim() : "";
    if (!url) return fallback;
    if (url.startsWith("data:image/")) return url.slice(0, 500000);
    if (url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://")) return url.slice(0, 2000);
    return fallback;
}

export function normalizeLinkUrl(value: unknown, fallback: string) {
    const url = typeof value === "string" ? value.trim() : "";
    if (!url) return fallback;
    if (url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:")) return url.slice(0, 2000);
    return fallback;
}

export function normalizeSystemChannel(channel: Partial<SystemModelChannel>): SystemModelChannel {
    return {
        id: channel.id?.trim() || randomUUID(),
        name: repairKnownMojibakeText(channel.name?.trim() || "") || "通用接口",
        baseUrl: channel.baseUrl?.trim() || "",
        apiKey: normalizeSecretText(channel.apiKey, "", 4000),
        apiFormat: channel.apiFormat === "gemini" ? "gemini" : "openai",
        models: Array.from(new Set((channel.models || []).map((model) => model.trim()).filter(Boolean))),
        enabled: channel.enabled !== false,
        advancedConfig: normalizeSystemChannelAdvancedConfig(channel.advancedConfig),
    };
}

export function normalizeSystemChannelAdvancedConfig(config: Partial<SystemChannelAdvancedConfig> | undefined): SystemChannelAdvancedConfig | undefined {
    if (!config || typeof config !== "object") return undefined;
    const protocol = ["auto", "openai", "sub2api", "qingyan", "globalaiopc", "seedance", "compatible"].includes(config.protocol || "") ? config.protocol! : "auto";
    const globalAiOpcPresets = Array.from(new Set((Array.isArray(config.globalAiOpcPresets) ? config.globalAiOpcPresets : []).filter(isGlobalAiOpcPreset)));
    const legacyGlobalAiOpcPreset = isGlobalAiOpcPreset(config.globalAiOpcPreset) ? config.globalAiOpcPreset : undefined;
    return {
        protocol,
        ...(globalAiOpcPresets.length
            ? { globalAiOpcPresets, ...(globalAiOpcPresets.length === 1 ? { globalAiOpcPreset: globalAiOpcPresets[0] } : {}) }
            : legacyGlobalAiOpcPreset
              ? { globalAiOpcPreset: legacyGlobalAiOpcPreset, globalAiOpcPresets: [legacyGlobalAiOpcPreset] }
              : {}),
        textModel: textOrEmpty(config.textModel, 120),
        imageModel: textOrEmpty(config.imageModel, 120),
        videoModel: textOrEmpty(config.videoModel, 120),
        createPath: normalizeApiPath(config.createPath),
        queryPath: normalizeApiPath(config.queryPath),
        requestTemplate: textOrEmpty(config.requestTemplate, 4000),
        resultField: textOrEmpty(config.resultField, 500),
        statusField: textOrEmpty(config.statusField, 500),
        durationRange: textOrEmpty(config.durationRange, 120),
        referenceRule: textOrEmpty(config.referenceRule, 1000),
        supportsReferenceImage: Boolean(config.supportsReferenceImage),
        supportsReferenceVideo: Boolean(config.supportsReferenceVideo),
        supportsReferenceAudio: Boolean(config.supportsReferenceAudio),
    };
}

export function normalizeApiPath(value: unknown) {
    const path = textOrEmpty(value, 300);
    if (!path) return "";
    return path.startsWith("/") ? path : `/${path}`;
}

export function textOrEmpty(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizePoints(value: unknown, fallback: number) {
    return normalizePointAmount(value, fallback);
}

export function normalizePointAmount(value: unknown, fallback: number) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.min(Number(numberValue.toFixed(2)), 1_000_000);
}

export function normalizePointMultiplier(value: unknown, fallback = 1) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) return fallback;
    return Math.min(Number(numberValue.toFixed(2)), 1_000_000);
}

export function normalizeModelPointCosts(value: unknown): ModelPointCosts {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .map(([model, cost]) => [model.trim(), normalizePointMultiplier(cost)] as const)
            .filter(([model]) => Boolean(model)),
    );
}

export function normalizeGenerationPointMultipliers(value: unknown): GenerationPointMultipliers {
    const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<GenerationPointMultipliers>) : {};
    return {
        imageQuality: normalizeMultiplierMap(source.imageQuality, DEFAULT_GENERATION_POINT_MULTIPLIERS.imageQuality),
        videoQuality: normalizeMultiplierMap(source.videoQuality, DEFAULT_GENERATION_POINT_MULTIPLIERS.videoQuality),
        videoSeconds: normalizeMultiplierMap(source.videoSeconds, DEFAULT_GENERATION_POINT_MULTIPLIERS.videoSeconds),
    };
}

export function normalizeMultiplierMap(value: unknown, defaults: Record<string, number>) {
    const entries = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : [];
    return {
        ...defaults,
        ...Object.fromEntries(entries.map(([key, multiplier]) => [key.trim(), normalizePointMultiplier(multiplier)] as const).filter(([key]) => Boolean(key))),
    };
}

export function resolveModelPointCost(costs: ModelPointCosts, model: string, logicalModels: LogicalModel[] = []) {
    return resolveConfiguredModelPointCost(costs, model, logicalModels);
}

export function buildPointRecordDescription(model: string, usageKind: PointUsageKind, action: "consume" | "refund") {
    const modelName = model.trim() || "默认模型";
    const actionLabels: Record<PointUsageKind, { consume: string; refund: string }> = {
        api: { consume: "模型调用扣除", refund: "模型调用失败退回" },
        image: { consume: "生成图片调用扣除", refund: "生成图片调用失败退回" },
        video: { consume: "生成视频调用扣除", refund: "生成视频调用失败退回" },
        audio: { consume: "生成音频调用扣除", refund: "生成音频调用失败退回" },
        text: { consume: "生成文本调用扣除", refund: "生成文本调用失败退回" },
    };
    return `${modelName} ${actionLabels[usageKind]?.[action] || actionLabels.api[action]}`;
}

export function legacyQuotaToPoints(quota: Partial<LegacyUserQuota> | undefined, fallback: number) {
    if (!quota || typeof quota !== "object") return fallback;
    return normalizePoints(quota.imageDaily, fallback);
}

export function normalizeQuotaUsage(value: Partial<StoredQuotaUsage>): StoredQuotaUsage {
    const usageKind: PointUsageKind = value.usageKind === "image" || value.usageKind === "video" || value.usageKind === "audio" || value.usageKind === "text" ? value.usageKind : "api";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value.date || "") ? value.date! : currentQuotaDate();
    return {
        userId: value.userId || "",
        date,
        usageKind,
        pointsSpent: normalizePointAmount(value.pointsSpent, 0),
        units: normalizePointAmount(value.units, 0),
        updatedAt: value.updatedAt || new Date().toISOString(),
    };
}

export function toPublicCdkCode(code: StoredCdkCode, db?: { users: Array<Pick<StoredUser, "id" | "username" | "displayName">> }, options?: { includePlain?: boolean }): PublicCdkCode {
    return {
        id: code.id,
        codePreview: code.codePreview,
        ...(options?.includePlain && code.code ? { code: code.code } : {}),
        points: code.points,
        maxRedemptions: code.maxRedemptions,
        redeemedCount: code.redeemedCount,
        redemptions: (code.redemptions || []).map((redemption) => {
            const user = db?.users.find((item) => item.id === redemption.userId);
            return {
                userId: redemption.userId,
                username: user?.username || "已删除用户",
                displayName: user?.displayName || user?.username || "已删除用户",
                redeemedAt: redemption.redeemedAt,
            };
        }),
        status: code.status,
        note: code.note,
        expiresAt: code.expiresAt,
        createdAt: code.createdAt,
        updatedAt: code.updatedAt,
    };
}

export function isCdkCodeExpired(code: PublicCdkCode) {
    return Boolean(code.expiresAt && Date.parse(code.expiresAt) <= Date.now());
}

export function normalizeCdkCodeRecord(value: Partial<StoredCdkCode>): StoredCdkCode {
    const redemptions = Array.isArray(value.redemptions)
        ? value.redemptions
              .map((item) => ({
                  userId: typeof item?.userId === "string" ? item.userId : "",
                  redeemedAt: typeof item?.redeemedAt === "string" ? item.redeemedAt : new Date().toISOString(),
              }))
              .filter((item) => item.userId)
        : [];
    const plainCode = formatCdkCodeForDisplay(value.code || "");
    const codePreview = normalizeText(value.codePreview || (plainCode ? previewCdkCode(plainCode) : ""), "CDK-****", 40);
    const codeHash = typeof value.codeHash === "string" && value.codeHash ? value.codeHash : plainCode ? hashToken(normalizeCdkCode(plainCode)) : "";
    const now = new Date().toISOString();
    return {
        id: value.id || randomUUID(),
        codePreview,
        ...(plainCode ? { code: plainCode } : {}),
        points: normalizePoints(value.points, 10),
        maxRedemptions: Math.max(redemptions.length || 1, Math.min(10000, Math.floor(Number(value.maxRedemptions) || 1))),
        redeemedCount: redemptions.length,
        status: value.status === "disabled" ? "disabled" : "active",
        note: normalizeText(value.note, "", 120),
        codeHash,
        redemptions,
        ...(normalizeOptionalIsoDate(value.expiresAt) ? { expiresAt: normalizeOptionalIsoDate(value.expiresAt) } : {}),
        createdAt: value.createdAt || now,
        updatedAt: value.updatedAt || value.createdAt || now,
    };
}

export function normalizeCdkCode(value: string) {
    return value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

export function generateCdkPlainCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const chars = Array.from(randomBytes(20), (byte) => alphabet[byte % alphabet.length]).join("");
    return `VZ-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}`;
}

export function formatCdkCodeForDisplay(value: string) {
    const code = normalizeCdkCode(value);
    if (!code) return "";
    if (code.startsWith("VZ") && code.length === 22) return `${code.slice(0, 2)}-${code.slice(2, 7)}-${code.slice(7, 12)}-${code.slice(12, 17)}-${code.slice(17, 22)}`;
    return code;
}

export function previewCdkCode(value: string) {
    const code = normalizeCdkCode(value);
    if (code.length <= 8) return `${code.slice(0, 2)}****`;
    return `${code.slice(0, 4)}****${code.slice(-4)}`;
}

export function normalizeAnnouncement(value: Partial<PublicAnnouncement>): PublicAnnouncement {
    const now = new Date().toISOString();
    const startsAt = normalizeOptionalIsoDate(value.startsAt);
    const endsAt = normalizeOptionalIsoDate(value.endsAt);
    return {
        id: value.id || randomUUID(),
        title: normalizeText(value.title, "", 80),
        content: normalizeText(value.content, "", 3000),
        enabled: value.enabled !== false,
        popupHome: value.popupHome === true,
        popupAfterLogin: value.popupAfterLogin === true,
        ...(startsAt ? { startsAt } : {}),
        ...(endsAt ? { endsAt } : {}),
        createdAt: value.createdAt || now,
        updatedAt: value.updatedAt || value.createdAt || now,
    };
}

export function isAnnouncementVisible(announcement: PublicAnnouncement) {
    if (!announcement.enabled) return false;
    const now = Date.now();
    if (announcement.startsAt && Date.parse(announcement.startsAt) > now) return false;
    if (announcement.endsAt && Date.parse(announcement.endsAt) <= now) return false;
    return true;
}

export function normalizeOptionalIsoDate(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return undefined;
    return new Date(time).toISOString();
}

function normalizeOptionalText(value: unknown, maxLength: number) {
    const text = normalizeText(value, "", maxLength);
    return text || undefined;
}

function normalizeDate(value: unknown) {
    const text = typeof value === "string" ? value.trim().slice(0, 10) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(`${text}T00:00:00Z`)) ? text : "";
}

export function resolveCdkExpiresAt(expiresAt: unknown, expiresInDays: unknown) {
    const explicitDate = normalizeOptionalIsoDate(expiresAt);
    if (explicitDate) return explicitDate;
    const days = Math.floor(Number(expiresInDays));
    if (!Number.isFinite(days) || days <= 0) return undefined;
    return new Date(Date.now() + Math.min(days, 3650) * 24 * 60 * 60 * 1000).toISOString();
}

export function normalizePointRecord(value: Partial<StoredPointRecord>): StoredPointRecord {
    const type = value.type === "consume" || value.type === "refund" || value.type === "credit" ? value.type : "admin-adjust";
    const amount = Number.isFinite(Number(value.amount)) ? Number(value.amount) : 0;
    const balanceAfter = normalizePoints(value.balanceAfter, 0);
    const permanentAmount = Number.isFinite(Number(value.permanentAmount)) ? Number(value.permanentAmount) : amount;
    const dailyAmount = Number.isFinite(Number(value.dailyAmount)) ? Number(value.dailyAmount) : 0;
    return {
        id: value.id || randomUUID(),
        userId: value.userId || "",
        type,
        amount,
        balanceAfter,
        permanentAmount,
        dailyAmount,
        permanentBalanceAfter: normalizePoints(value.permanentBalanceAfter, balanceAfter),
        dailyBalanceAfter: Math.max(0, normalizePoints(value.dailyBalanceAfter, 0)),
        description: normalizeText(value.description, type === "consume" ? "积分消耗" : "积分增加", 120),
        model: typeof value.model === "string" ? value.model.slice(0, 160) : undefined,
        idempotencyKey: normalizeOptionalText(value.idempotencyKey, 200),
        sourceRecordId: normalizeOptionalText(value.sourceRecordId, 120),
        sourceDate: normalizeDate(value.sourceDate) || undefined,
        createdAt: value.createdAt || new Date().toISOString(),
    };
}

export function normalizeDailyPlanPointWallet(value: Partial<StoredDailyPlanPointWallet>): StoredDailyPlanPointWallet {
    const now = new Date().toISOString();
    const grantedPoints = Math.max(0, normalizePoints(value.grantedPoints, 0));
    return {
        userId: value.userId || "",
        date: normalizeDate(value.date),
        planId: normalizePlanId(value.planId) || DEFAULT_ENTITLEMENT_PLAN_ID,
        assignmentId: normalizeOptionalText(value.assignmentId, 120),
        grantedPoints,
        remainingPoints: Math.min(grantedPoints, Math.max(0, normalizePoints(value.remainingPoints, grantedPoints))),
        createdAt: value.createdAt || now,
        updatedAt: value.updatedAt || now,
    };
}

type PointRecordInput = Omit<StoredPointRecord, "id" | "permanentAmount" | "dailyAmount" | "permanentBalanceAfter" | "dailyBalanceAfter"> &
    Partial<Pick<StoredPointRecord, "permanentAmount" | "dailyAmount" | "permanentBalanceAfter" | "dailyBalanceAfter">>;

export function addPointRecord(db: AuthDatabase, record: PointRecordInput) {
    db.pointRecords = db.pointRecords || [];
    db.pointRecords.push(normalizePointRecord({ id: randomUUID(), ...record }));
}

export function normalizeEmailCode(value: Partial<StoredEmailCode>): StoredEmailCode {
    return {
        id: value.id || randomUUID(),
        purpose: value.purpose === "email-change" || value.purpose === "password-reset" ? value.purpose : "register",
        email: normalizeEmail(value.email),
        userId: value.userId,
        codeHash: value.codeHash || "",
        createdAt: value.createdAt || new Date().toISOString(),
        expiresAt: value.expiresAt || new Date(0).toISOString(),
        consumedAt: value.consumedAt,
        attempts: typeof value.attempts === "number" && Number.isFinite(value.attempts) ? value.attempts : undefined,
    };
}

export function consumeEmailCode(db: AuthDatabase, input: { purpose: EmailCodePurpose; email: string; code?: string; userId?: string }) {
    const code = typeof input.code === "string" ? input.code.trim() : "";
    if (!/^\d{6}$/.test(code)) throw new AuthInputError("请输入 6 位邮箱验证码");
    const email = normalizeEmail(input.email);
    const item = db.emailCodes.find((entry) => entry.purpose === input.purpose && entry.email === email && entry.userId === input.userId && !entry.consumedAt && Date.parse(entry.expiresAt) > Date.now());
    if (!item) throw new AuthInputError("邮箱验证码不正确或已过期");
    item.attempts = (item.attempts || 0) + 1;
    if (item.attempts > 5) {
        item.consumedAt = new Date().toISOString();
        throw new EmailCodeAttemptError("验证码错误次数过多，请重新获取");
    }
    if (item.codeHash !== hashToken(code)) throw new EmailCodeAttemptError("邮箱验证码不正确或已过期");
    item.consumedAt = new Date().toISOString();
}

export function currentQuotaDate() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

export function validateUsername(username: string) {
    if (!USERNAME_PATTERN.test(username)) throw new AuthInputError("用户名只能使用 3-32 位字母、数字、下划线、点或短横线");
}

export function validateEmail(email: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) throw new AuthInputError("邮箱格式不正确");
}

export function validatePassword(password: string) {
    if (password.length < 8) throw new AuthInputError("密码至少需要 8 位");
    if (password.length > 128) throw new AuthInputError("密码不能超过 128 位");
}

export function parseSessionCookie(cookieValue: string | undefined) {
    if (!cookieValue) return null;
    const separatorIndex = cookieValue.indexOf(".");
    if (separatorIndex < 0) return null;
    return { id: cookieValue.slice(0, separatorIndex), token: cookieValue.slice(separatorIndex + 1) };
}

export function hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
}

export function randomNumericCode() {
    return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}
