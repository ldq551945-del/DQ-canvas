import { randomBytes, randomUUID } from "node:crypto";

import { inferModelCapability } from "@/lib/model-capability";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled, withPostgresTransaction } from "@/lib/server/database";
import { adjustPermanentPointsInAuthDb, consumePoints, creditPermanentPointsInAuthDb, refundPoints, walletClock } from "@/lib/server/points-wallet-service";
import { hashPassword, verifyPassword } from "./password";
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
    type AnnouncementPage,
    type AnnouncementPageInput,
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
    type PublicUserSummary,
    type StoredSession,
    type PublicPointRecord,
    type StoredPointRecord,
    type StoredQuotaUsage,
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
    DEFAULT_MODEL_POINT_COST_KEY,
    DEFAULT_SITE_SETTINGS,
    DEFAULT_MAIL_SETTINGS,
    DEFAULT_GENERATION_POINT_MULTIPLIERS,
    DEFAULT_ENTITLEMENT_LIMITS,
    DEFAULT_ENTITLEMENT_PLAN_ID,
    DEFAULT_SETTINGS,
    AUTH_DATA_FILE,
    USERNAME_PATTERN,
} from "./store-foundation";
import {
    mutationQueue,
    readAuthDb,
    mutateAuthDb,
    writeAuthDb,
    readPostgresAuthDb,
    readPostgresAnnouncementsPage,
    readPostgresAuthSettings,
    readPostgresCdkListData,
    readPostgresPublicUserData,
    writePostgresAuthDb,
    writePostgresAuthDbWithExecutor,
    mapPostgresSettings,
    mapPostgresUser,
    mapPostgresSession,
    mapPostgresQuotaUsage,
    mapPostgresPointRecord,
    mapPostgresEmailCode,
    mapPostgresCdkCode,
    mapPostgresAnnouncement,
    upsertPostgresEntitlementPlans,
    upsertPostgresSettings,
    upsertPostgresSystemChannels,
    insertPostgresUsers,
    insertPostgresSessions,
    insertPostgresEmailCodes,
    insertPostgresQuotaUsage,
    insertPostgresPointRecords,
    insertPostgresCdkCodes,
    insertPostgresAnnouncements,
    dbText,
    dbOptionalText,
    dbNumber,
    dbBool,
    dbIso,
    dbOptionalIso,
    dbDate,
    dbJson,
    dbJsonParam,
} from "./store-repository";

const AUTH_SETTINGS_CACHE_TTL_MS = 1000;
let postgresAuthSettingsCache: { value: AuthSettings; expiresAt: number } | null = null;
let postgresAuthSettingsRequest: Promise<AuthSettings> | null = null;
let postgresAuthSettingsVersion = 0;
import {
    normalizeDb,
    emptyDb,
    encryptAuthDbSecretsForStorage,
    decryptAuthSettingsSecrets,
    encryptAuthSettingsSecrets,
    pruneExpiredSessions,
    resolveDefaultPlan,
    resolveUserPlan,
    resolvePlanById,
    assertEntitlementUsageAllowed,
    recordQuotaUsage,
    findQuotaUsage,
    assertDailyLimit,
    resolveDailyUsageLimit,
    dailyUsageLimitLabel,
    countActiveAdmins,
    normalizeEmail,
    normalizeDisplayName,
    normalizeUserBio,
    normalizeSettings,
    normalizeLogicalModels,
    deriveLogicalModels,
    normalizeAgentSkill,
    normalizeAgentSkills,
    normalizeGenerationDefaults,
    allowedText,
    normalizeEntitlementSettings,
    normalizeEntitlementPlan,
    normalizeEntitlementLimits,
    normalizePlanId,
    normalizeFeatureList,
    normalizeGenerationConcurrency,
    normalizeSiteSettings,
    normalizeSiteShowcaseItems,
    normalizeShowcaseTags,
    normalizeSiteFriendLinks,
    normalizeSiteSocials,
    normalizeSiteSocial,
    normalizeMailSettings,
    normalizeSecretText,
    normalizeText,
    repairKnownMojibakeText,
    repairUtf8MojibakeText,
    looksLikeUtf8Mojibake,
    textQualityScore,
    normalizeLogoUrl,
    normalizeLinkUrl,
    normalizeSystemChannel,
    normalizeSystemChannelAdvancedConfig,
    normalizeApiPath,
    textOrEmpty,
    normalizePoints,
    normalizePointAmount,
    normalizePointMultiplier,
    normalizeModelPointCosts,
    normalizeGenerationPointMultipliers,
    normalizeMultiplierMap,
    resolveModelPointCost,
    buildPointRecordDescription,
    legacyQuotaToPoints,
    normalizeQuotaUsage,
    toPublicCdkCode,
    isCdkCodeExpired,
    normalizeCdkCodeRecord,
    normalizeCdkCode,
    generateCdkPlainCode,
    formatCdkCodeForDisplay,
    previewCdkCode,
    normalizeAnnouncement,
    isAnnouncementVisible,
    normalizeOptionalIsoDate,
    resolveCdkExpiresAt,
    normalizePointRecord,
    addPointRecord,
    normalizeEmailCode,
    consumeEmailCode,
    validateEmail,
    validatePassword,
    parseSessionCookie,
    hashToken,
} from "./store-normalizers";
import { matchesPublicUser, publicUserFromAuthenticatedRecord, summarizePublicUsers, toPublicUser } from "./store-user-projection";

export { authenticateUser, createEmailVerificationCode, createUser, createUserByAdmin } from "./store-user-access";
export { toPublicUser };

export function sessionMaxAgeSeconds() {
    return SESSION_MAX_AGE_SECONDS;
}

export async function getAuthSettings() {
    if (isPostgresDatabaseEnabled()) {
        const now = Date.now();
        if (postgresAuthSettingsCache && postgresAuthSettingsCache.expiresAt > now) return postgresAuthSettingsCache.value;
        if (postgresAuthSettingsRequest) return postgresAuthSettingsRequest;
        const requestVersion = postgresAuthSettingsVersion;
        const request = readPostgresAuthSettings().then((settings) => {
            if (requestVersion === postgresAuthSettingsVersion) postgresAuthSettingsCache = { value: settings, expiresAt: Date.now() + AUTH_SETTINGS_CACHE_TTL_MS };
            return settings;
        });
        postgresAuthSettingsRequest = request;
        void request.then(
            () => {
                if (postgresAuthSettingsRequest === request) postgresAuthSettingsRequest = null;
            },
            () => {
                if (postgresAuthSettingsRequest === request) postgresAuthSettingsRequest = null;
            },
        );
        return request;
    }
    return (await readAuthDb()).settings;
}

export async function setAuthSettings(patch: Partial<AuthSettings>) {
    const settings = await mutateAuthDb((db) => {
        db.settings = normalizeSettings({ ...db.settings, ...patch });
        return db.settings;
    });
    if (isPostgresDatabaseEnabled()) {
        postgresAuthSettingsVersion += 1;
        postgresAuthSettingsCache = { value: settings, expiresAt: Date.now() + AUTH_SETTINGS_CACHE_TTL_MS };
    }
    return settings;
}

export async function listPublicUsers() {
    if (isPostgresDatabaseEnabled()) {
        const data = await readPostgresPublicUserData(walletClock().date);
        return data.users.map((user) => toPublicUser(user, data)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    }
    const db = await readAuthDb();
    return db.users.map((user) => toPublicUser(user, db)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export type PublicUserListResult = {
    users: PublicUser[];
    total: number;
    page: number;
    pageSize: number;
    summary: PublicUserSummary;
};

export async function listPublicUsersPage(input?: { page?: number; pageSize?: number; keyword?: string; role?: UserRole; status?: UserStatus }): Promise<PublicUserListResult> {
    const page = Math.max(1, Math.floor(Number(input?.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input?.pageSize) || 20)));
    const keyword = normalizeText(input?.keyword, "", 120).toLowerCase();
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const repos = createPostgresRepositories();
        const clock = walletClock();
        const [result, summary] = await Promise.all([repos.users.list({ page, pageSize, keyword, role: input?.role, status: input?.status }), repos.users.summarize({ now: clock.now.toISOString(), date: clock.date })]);
        const details = await repos.users.getPublicDetails(
            result.items.map((user) => user.id),
            { now: clock.now.toISOString(), date: clock.date },
        );
        const usersById = new Map(details.map((record) => [record.user.id, publicUserFromAuthenticatedRecord(record, clock.expiresAt)]));
        return {
            users: result.items.map((user) => usersById.get(user.id)).filter((user): user is PublicUser => Boolean(user)),
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            summary,
        };
    }
    const db = await readAuthDb();
    const publicUsers = db.users.map((user) => toPublicUser(user, db)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const filtered = publicUsers.filter((user) => matchesPublicUser(user, { keyword, role: input?.role, status: input?.status }));
    const total = filtered.length;
    const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    return {
        users: filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
        total,
        page: safePage,
        pageSize,
        summary: summarizePublicUsers(publicUsers, db.settings.entitlements.defaultPlanId),
    };
}

export async function getPublicUserSummary(): Promise<PublicUserSummary> {
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const clock = walletClock();
        return createPostgresRepositories().users.summarize({ now: clock.now.toISOString(), date: clock.date });
    }
    const db = await readAuthDb();
    return summarizePublicUsers(
        db.users.map((user) => toPublicUser(user, db)),
        db.settings.entitlements.defaultPlanId,
    );
}

export async function getPublicUsersByIds(userIds: string[]): Promise<PublicUser[]> {
    const ids = Array.from(new Set(userIds.map((id) => normalizeText(id, "", 120)).filter(Boolean)));
    if (!ids.length) return [];
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const clock = walletClock();
        const records = await createPostgresRepositories().users.getPublicDetails(ids, { now: clock.now.toISOString(), date: clock.date });
        return records.map((record) => publicUserFromAuthenticatedRecord(record, clock.expiresAt));
    }
    const db = await readAuthDb();
    const idSet = new Set(ids);
    return db.users.filter((user) => idSet.has(user.id)).map((user) => toPublicUser(user, db));
}

export async function findPublicUserIdsByKeyword(value: string, limit = 100): Promise<string[]> {
    const keyword = normalizeText(value, "", 120).toLowerCase();
    if (!keyword) return [];
    const pageSize = Math.max(1, Math.min(100, Math.floor(limit)));
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const result = await createPostgresRepositories().users.list({ page: 1, pageSize, keyword });
        return result.items.map((user) => user.id);
    }
    const db = await readAuthDb();
    return db.users
        .map((user) => toPublicUser(user, db))
        .filter((user) => matchesPublicUser(user, { keyword }))
        .slice(0, pageSize)
        .map((user) => user.id);
}

export type PointRecordListResult = {
    records: PublicPointRecord[];
    total: number;
    page: number;
    pageSize: number;
};

export async function listPointRecordsPage(userId: string, input?: { page?: number; pageSize?: number; direction?: "credit" | "debit" }): Promise<PointRecordListResult> {
    const pageSize = Math.max(1, Math.min(50, Math.floor(Number(input?.pageSize) || 10)));
    const page = Math.max(1, Math.floor(Number(input?.page) || 1));
    const direction = input?.direction === "credit" || input?.direction === "debit" ? input.direction : undefined;
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const result = await createPostgresRepositories().points.listRecords(userId, { page, pageSize, direction });
        return {
            records: result.items.map(toPublicPointRecord),
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
        };
    }
    const db = await readAuthDb();
    const records = (db.pointRecords || [])
        .filter((record) => record.userId === userId && (!direction || (direction === "credit" ? record.amount > 0 : record.amount < 0)))
        .map(toPublicPointRecord)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const total = records.length;
    const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const start = (safePage - 1) * pageSize;
    return {
        records: records.slice(start, start + pageSize),
        total,
        page: safePage,
        pageSize,
    };
}

export type CdkListFilter = "all" | "redeemed" | "unused" | "expired";

export type CdkListResult = {
    codes: PublicCdkCode[];
    total: number;
    page: number;
    pageSize: number;
    stats: {
        total: number;
        redeemed: number;
        unused: number;
        expired: number;
    };
};

export async function listCdkCodes(input?: { page?: number; pageSize?: number; keyword?: string; filter?: CdkListFilter }): Promise<CdkListResult> {
    const keyword = normalizeText(input?.keyword, "", 120).toLowerCase();
    const filter = input?.filter === "redeemed" || input?.filter === "unused" || input?.filter === "expired" ? input.filter : "all";
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input?.pageSize) || 20)));
    const page = Math.max(1, Math.floor(Number(input?.page) || 1));
    if (isPostgresDatabaseEnabled()) {
        const db = await readPostgresCdkListData({ page, pageSize, keyword, filter, codeHash: keyword ? hashToken(normalizeCdkCode(keyword)) : "" });
        return {
            codes: db.cdkCodes.map((code) => toPublicCdkCode(code, db, { includePlain: true })),
            total: db.total,
            page: db.page,
            pageSize: db.pageSize,
            stats: db.stats,
        };
    }
    const db = await readAuthDb();
    const allCodes = db.cdkCodes
        .filter((code) => code.status === "active" && Boolean(code.code))
        .map((code) => toPublicCdkCode(code, db, { includePlain: true }))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const stats = {
        total: allCodes.length,
        redeemed: allCodes.filter((code) => code.redeemedCount > 0).length,
        unused: allCodes.filter((code) => !isCdkCodeExpired(code) && code.redeemedCount <= 0).length,
        expired: allCodes.filter(isCdkCodeExpired).length,
    };
    const filtered = allCodes.filter((code) => {
        const matchedFilter = filter === "all" || (filter === "redeemed" && code.redeemedCount > 0) || (filter === "unused" && !isCdkCodeExpired(code) && code.redeemedCount <= 0) || (filter === "expired" && isCdkCodeExpired(code));
        if (!matchedFilter) return false;
        if (!keyword) return true;
        const redemptionsText = code.redemptions.map((item) => `${item.accountId || ""} ${item.username} ${item.displayName}`).join(" ");
        return [code.code || "", code.note, redemptionsText].some((value) => value.toLowerCase().includes(keyword));
    });
    const total = filtered.length;
    const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const start = (safePage - 1) * pageSize;
    return {
        codes: filtered.slice(start, start + pageSize),
        total,
        page: safePage,
        pageSize,
        stats,
    };
}

export async function createCdkCodes(input: { count?: number; points?: number; maxRedemptions?: number; expiresAt?: string; expiresInDays?: number; note?: string }) {
    return mutateAuthDb((db) => {
        const count = Math.max(1, Math.min(100, Math.floor(Number(input.count) || 1)));
        const points = normalizePoints(input.points, 10);
        const maxRedemptions = Math.max(1, Math.min(10000, Math.floor(Number(input.maxRedemptions) || 1)));
        const expiresAt = resolveCdkExpiresAt(input.expiresAt, input.expiresInDays);
        const note = normalizeText(input.note, "", 120);
        const now = new Date().toISOString();
        const created: CreatedCdkCode[] = [];
        for (let index = 0; index < count; index += 1) {
            let code = generateCdkPlainCode();
            let attempts = 0;
            while (db.cdkCodes.some((item) => item.codeHash === hashToken(normalizeCdkCode(code))) && attempts < 8) {
                code = generateCdkPlainCode();
                attempts += 1;
            }
            const publicCode: PublicCdkCode = {
                id: randomUUID(),
                codePreview: previewCdkCode(code),
                code,
                points,
                maxRedemptions,
                redeemedCount: 0,
                redemptions: [],
                status: "active",
                note,
                ...(expiresAt ? { expiresAt } : {}),
                createdAt: now,
                updatedAt: now,
            };
            db.cdkCodes.push({
                ...publicCode,
                codeHash: hashToken(normalizeCdkCode(code)),
                redemptions: [],
            });
            created.push({ ...publicCode, code });
        }
        return created;
    });
}

export async function updateCdkCode(id: string, patch: Partial<Pick<PublicCdkCode, "status" | "note" | "expiresAt" | "points" | "maxRedemptions">>) {
    return mutateAuthDb((db) => {
        const item = db.cdkCodes.find((code) => code.id === id);
        if (!item) throw new AuthInputError("CDK 不存在");
        if (patch.status) item.status = patch.status === "active" ? "active" : "disabled";
        if (patch.note !== undefined) item.note = normalizeText(patch.note, "", 120);
        if (patch.expiresAt !== undefined) {
            const expiresAt = normalizeOptionalIsoDate(patch.expiresAt);
            if (expiresAt) item.expiresAt = expiresAt;
            else delete item.expiresAt;
        }
        if (patch.points !== undefined) item.points = normalizePoints(patch.points, item.points);
        if (patch.maxRedemptions !== undefined) item.maxRedemptions = Math.max(item.redeemedCount, Math.min(10000, Math.max(1, Math.floor(Number(patch.maxRedemptions) || item.maxRedemptions))));
        item.updatedAt = new Date().toISOString();
        return toPublicCdkCode(item, db, { includePlain: true });
    });
}

export async function deleteCdkCode(id: string) {
    return mutateAuthDb((db) => {
        const index = db.cdkCodes.findIndex((code) => code.id === id);
        if (index < 0) throw new AuthInputError("CDK 不存在");
        db.cdkCodes.splice(index, 1);
        return { ok: true, deleted: 1 };
    });
}

export async function deleteCdkCodes(ids: string[]) {
    return mutateAuthDb((db) => {
        const deletingIds = Array.from(new Set(ids.map((id) => normalizeText(id, "", 80)).filter(Boolean)));
        if (!deletingIds.length) throw new AuthInputError("请选择要删除的 CDK");
        const before = db.cdkCodes.length;
        db.cdkCodes = db.cdkCodes.filter((code) => !deletingIds.includes(code.id));
        return { ok: true, deleted: before - db.cdkCodes.length };
    });
}

export async function redeemCdkCode(userId: string, rawCode: string) {
    return mutateAuthDb((db) => {
        const code = normalizeCdkCode(rawCode);
        if (!code) throw new AuthInputError("请输入 CDK 密钥");
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
        const item = db.cdkCodes.find((entry) => entry.codeHash === hashToken(code));
        if (!item || item.status !== "active") throw new AuthInputError("CDK 无效或已停用");
        if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) throw new AuthInputError("CDK 已过期");
        if (item.redeemedCount >= item.maxRedemptions) throw new AuthInputError("CDK 已兑换完");
        if (item.redemptions.some((entry) => entry.userId === userId)) throw new AuthInputError("该 CDK 已被当前账号兑换");

        const points = normalizePoints(item.points, 0);
        const now = new Date().toISOString();
        const wallet = creditPermanentPointsInAuthDb(db, {
            userId,
            amount: points,
            description: `CDK 兑换：${item.codePreview}`,
            idempotencyKey: `cdk:${item.id}:user:${userId}`,
            type: "credit",
            now: new Date(now),
        });
        item.redemptions.push({ userId, redeemedAt: now });
        item.redeemedCount = item.redemptions.length;
        item.updatedAt = now;
        return { user: { ...toPublicUser(user, db), pointsBalance: wallet.snapshot.totalPoints }, points, cdk: toPublicCdkCode(item, db) };
    });
}

export async function listAnnouncements(includeDisabled = false) {
    return (await listAnnouncementsPage(includeDisabled, { page: 1, pageSize: 100 })).items;
}

export async function listAnnouncementsPage(includeDisabled = false, input: AnnouncementPageInput = {}): Promise<AnnouncementPage> {
    const requestedPage = Number(input.page);
    const requestedPageSize = Number(input.pageSize);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0 ? Math.min(100, requestedPageSize) : 20;
    if (isPostgresDatabaseEnabled()) return readPostgresAnnouncementsPage({ includeDisabled, page, pageSize });

    const announcements = (await readAuthDb()).announcements.filter((announcement) => includeDisabled || isAnnouncementVisible(announcement)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
    return {
        items: announcements.slice((page - 1) * pageSize, page * pageSize),
        total: announcements.length,
        page,
        pageSize,
    };
}

export async function createAnnouncement(input: Partial<PublicAnnouncement>) {
    return mutateAuthDb((db) => {
        const now = new Date().toISOString();
        const announcement = normalizeAnnouncement({
            id: randomUUID(),
            title: input.title || "",
            content: input.content || "",
            enabled: input.enabled !== false,
            popupHome: input.popupHome === true,
            popupAfterLogin: input.popupAfterLogin === true,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            createdAt: now,
            updatedAt: now,
        });
        if (!announcement.title || !announcement.content) throw new AuthInputError("请填写公告标题和内容");
        db.announcements.push(announcement);
        return announcement;
    });
}

export async function updateAnnouncement(id: string, patch: Partial<PublicAnnouncement>) {
    return mutateAuthDb((db) => {
        const index = db.announcements.findIndex((announcement) => announcement.id === id);
        if (index < 0) throw new AuthInputError("公告不存在");
        const next = normalizeAnnouncement({
            ...db.announcements[index],
            ...patch,
            id,
            updatedAt: new Date().toISOString(),
        });
        if (!next.title || !next.content) throw new AuthInputError("请填写公告标题和内容");
        db.announcements[index] = next;
        return next;
    });
}

export async function deleteAnnouncement(id: string) {
    return mutateAuthDb((db) => {
        const before = db.announcements.length;
        db.announcements = db.announcements.filter((announcement) => announcement.id !== id);
        if (before === db.announcements.length) throw new AuthInputError("公告不存在");
        return { ok: true };
    });
}

export function toPublicPointRecord(record: StoredPointRecord): PublicPointRecord {
    return { ...record, description: displayPointRecordDescription(record) };
}

export function displayPointRecordDescription(record: StoredPointRecord) {
    const description = record.description.trim();
    const model = (record.model || "").trim();
    if (!model) return description;
    if (record.type === "consume") {
        return buildPointRecordDescription(model, legacyPointUsageKindFromModel(model), "consume");
    }
    if (record.type === "admin-adjust" && record.amount > 0) {
        return buildPointRecordDescription(model, legacyPointUsageKindFromModel(model), "refund");
    }
    return description;
}

export function legacyPointUsageKindFromModel(model: string): PointUsageKind {
    const capability = inferModelCapability(model);
    if (capability !== "text") return capability;
    return "api";
}

export async function consumeUserPoints(userId: string, model: string, amount = 1, usageKind: PointUsageKind = "api", idempotencyKey?: string) {
    const normalizedModel = model.trim();
    const db = isPostgresDatabaseEnabled() ? null : await readAuthDb();
    const user = db?.users.find((item) => item.id === userId);
    if (db && (!user || user.status !== "active")) throw new AuthInputError("用户不可用");
    const settings = db ? db.settings : await getAuthSettings();
    const multiplier = resolveModelPointCost(settings.modelPointCosts, normalizedModel, settings.logicalModels);
    const units = Math.min(1000, normalizePointAmount(amount, 1));
    const cost = normalizePointAmount(units * multiplier, 0);
    const operationKey = idempotencyKey?.trim() || `points-consume:${randomUUID()}`;
    const result = await consumePoints({
        userId,
        amount: cost,
        units,
        usageKind,
        model: normalizedModel,
        description: buildPointRecordDescription(normalizedModel, usageKind, "consume"),
        idempotencyKey: operationKey,
    });
    return {
        model: normalizedModel,
        units,
        multiplier,
        cost,
        remaining: result.snapshot.totalPoints,
        permanentRemaining: result.snapshot.permanentPoints,
        dailyRemaining: result.snapshot.dailyPoints,
        dailyExpiresAt: result.snapshot.dailyExpiresAt,
        usageKind,
        planId: result.snapshot.activePlanId || (db && user ? resolveUserPlan(db, user).id : DEFAULT_ENTITLEMENT_PLAN_ID),
        recordId: result.record.id,
        idempotencyKey: result.record.idempotencyKey,
    };
}

export async function refundUserPoints(userId: string, model: string, amount: number, usageKind: PointUsageKind = "api", units = 0, idempotencyKey?: string, sourceRecordId?: string) {
    const refund = normalizePointAmount(amount, 0);
    const sourceId = sourceRecordId?.trim();
    if (isPostgresDatabaseEnabled()) {
        const clock = walletClock();
        if (!refund && !sourceId) {
            const details = await createPostgresRepositories().users.getPublicDetails([userId], { now: clock.now.toISOString(), date: clock.date });
            const user = details[0];
            return user ? publicUserFromAuthenticatedRecord(user, clock.expiresAt) : null;
        }
        if (!sourceId) throw new AuthInputError("退款缺少原消费流水");
        const result = await refundPoints({
            userId,
            sourceRecordId: sourceId,
            idempotencyKey: idempotencyKey?.trim() || `points-refund:${sourceId}`,
            usageKind,
            units: normalizePointAmount(units, 0),
            model: model.trim(),
            description: buildPointRecordDescription(model, usageKind, "refund"),
        });
        const details = await createPostgresRepositories().users.getPublicDetails([userId], { now: clock.now.toISOString(), date: clock.date });
        const user = details[0];
        return user ? { ...publicUserFromAuthenticatedRecord(user, result.snapshot.dailyExpiresAt), pointsBalance: result.snapshot.totalPoints } : null;
    }
    const db = await readAuthDb();
    const user = db.users.find((item) => item.id === userId);
    if (!user) return null;
    if (!refund && !sourceId) return toPublicUser(user, db);

    if (!sourceId) throw new AuthInputError("退款缺少原消费流水");
    const result = await refundPoints({
        userId,
        sourceRecordId: sourceId,
        idempotencyKey: idempotencyKey?.trim() || `points-refund:${sourceId}`,
        usageKind,
        units: normalizePointAmount(units, 0),
        model: model.trim(),
        description: buildPointRecordDescription(model, usageKind, "refund"),
    });
    const nextDb = await readAuthDb();
    const nextUser = nextDb.users.find((item) => item.id === userId);
    return nextUser ? { ...toPublicUser(nextUser, nextDb), pointsBalance: result.snapshot.totalPoints } : null;
}

export async function updateOwnProfile(userId: string, input: { displayName?: string; bio?: string; email?: string; emailCode?: string }) {
    if (isPostgresDatabaseEnabled() && input.email === undefined) {
        await ensurePostgresSchema();
        const clock = walletClock();
        const record = await withPostgresTransaction(async (client) => {
            const users = createPostgresRepositories(client).users;
            const current = await users.getById(userId, true);
            if (!current || current.status !== "active") throw new AuthInputError("用户不可用");
            await users.update(userId, {
                displayName: input.displayName === undefined ? undefined : normalizeDisplayName(input.displayName || current.username),
                bio: input.bio === undefined ? undefined : normalizeUserBio(input.bio),
            });
            return (await users.getPublicDetails([userId], { now: clock.now.toISOString(), date: clock.date }))[0];
        });
        if (!record) throw new AuthInputError("用户不可用");
        return publicUserFromAuthenticatedRecord(record, clock.expiresAt);
    }
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");

        if (input.displayName !== undefined) user.displayName = normalizeDisplayName(input.displayName || user.username);
        if (input.bio !== undefined) user.bio = normalizeUserBio(input.bio);

        if (input.email !== undefined) {
            const email = normalizeEmail(input.email);
            if (!email) throw new AuthInputError("请填写邮箱地址");
            validateEmail(email);
            if (email !== (user.email || "").toLowerCase()) {
                if (db.users.some((item) => item.id !== user.id && item.email?.toLowerCase() === email)) throw new AuthInputError("邮箱已被注册");
                consumeEmailCode(db, { purpose: "email-change", email, code: input.emailCode, userId });
                user.email = email;
            }
        }

        user.updatedAt = new Date().toISOString();
        return toPublicUser(user, db);
    });
}

export async function updateOwnPassword(userId: string, input: { currentPassword: string; newPassword: string }) {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
        if (!verifyPassword(input.currentPassword, user.passwordHash)) throw new AuthInputError("当前密码不正确");
        validatePassword(input.newPassword);
        user.passwordHash = hashPassword(input.newPassword);
        user.updatedAt = new Date().toISOString();
        db.sessions = db.sessions.filter((session) => session.userId !== user.id);
        return toPublicUser(user, db);
    });
}

export async function verifyUserPasswordForSensitiveAction(userId: string, password: string) {
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const user = await createPostgresRepositories().users.getById(userId);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
        if (!verifyPassword(password, user.passwordHash)) throw new AuthInputError("当前密码不正确");
        return;
    }
    const db = await readAuthDb();
    const user = db.users.find((item) => item.id === userId);
    if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
    if (!verifyPassword(password, user.passwordHash)) throw new AuthInputError("当前密码不正确");
}

export async function resetPasswordByEmail(input: { email: string; code?: string; newPassword: string }) {
    return mutateAuthDb((db) => {
        const email = normalizeEmail(input.email);
        validateEmail(email);
        const user = db.users.find((item) => item.email?.toLowerCase() === email);
        if (!user || user.status !== "active") throw new AuthInputError("没有找到可用账号");
        consumeEmailCode(db, { purpose: "password-reset", email, code: input.code });
        validatePassword(input.newPassword);
        user.passwordHash = hashPassword(input.newPassword);
        user.updatedAt = new Date().toISOString();
        db.sessions = db.sessions.filter((session) => session.userId !== user.id);
        return toPublicUser(user, db);
    });
}

export async function createSession(userId: string) {
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const now = new Date();
        const sessionId = randomUUID();
        const token = randomBytes(32).toString("base64url");
        await withPostgresTransaction(async (client) => {
            const repos = createPostgresRepositories(client);
            const user = await repos.users.getById(userId, true);
            if (!user || user.status !== "active") throw new AuthInputError("用户不可用");
            await repos.sessions.pruneExpired(now);
            await repos.sessions.create({
                id: sessionId,
                userId,
                tokenHash: hashToken(token),
                createdAt: now.toISOString(),
                expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
            });
        });
        return `${sessionId}.${token}`;
    }
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user || user.status !== "active") throw new AuthInputError("用户不可用");

        const now = new Date();
        const sessionId = randomUUID();
        const token = randomBytes(32).toString("base64url");
        db.sessions.push({
            id: sessionId,
            userId,
            tokenHash: hashToken(token),
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
        });
        return `${sessionId}.${token}`;
    });
}

export async function getUserBySession(cookieValue: string | undefined) {
    const sessionParts = parseSessionCookie(cookieValue);
    if (!sessionParts) return null;

    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const clock = walletClock();
        const snapshot = await createPostgresRepositories().sessions.getAuthenticatedUser({
            sessionId: sessionParts.id,
            tokenHash: hashToken(sessionParts.token),
            now: clock.now.toISOString(),
            date: clock.date,
        });
        if (!snapshot) return null;
        return publicUserFromAuthenticatedRecord(snapshot, clock.expiresAt);
    }

    const db = await readAuthDb();
    const session = db.sessions.find((item) => item.id === sessionParts.id);
    if (!session || session.tokenHash !== hashToken(sessionParts.token) || Date.parse(session.expiresAt) <= Date.now()) return null;
    const user = db.users.find((item) => item.id === session.userId);
    if (!user || user.status !== "active") return null;
    return toPublicUser(user, db);
}

export async function deleteSession(cookieValue: string | undefined) {
    const sessionParts = parseSessionCookie(cookieValue);
    if (!sessionParts) return;
    await mutateAuthDb((db) => {
        db.sessions = db.sessions.filter((item) => item.id !== sessionParts.id);
    });
}

export async function updateUserByAdmin(actorId: string, userId: string, patch: Partial<Pick<PublicUser, "displayName" | "email" | "role" | "status" | "pointsBalance" | "planId">> & { password?: string }) {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user) throw new AuthInputError("用户不存在");
        if (user.id === actorId && patch.status === "disabled") throw new AuthInputError("不能禁用当前登录的管理员账号");

        const nextRole = patch.role || user.role;
        const nextStatus = patch.status || user.status;
        if (user.role === "admin" && nextRole !== "admin" && countActiveAdmins(db, user.id) === 0) throw new AuthInputError("至少需要保留一个管理员");
        if (user.role === "admin" && nextStatus !== "active" && countActiveAdmins(db, user.id) === 0) throw new AuthInputError("至少需要保留一个可用管理员");

        if (patch.displayName !== undefined) user.displayName = normalizeDisplayName(patch.displayName || user.username);
        if (patch.email !== undefined) {
            const email = normalizeEmail(patch.email);
            if (email) {
                validateEmail(email);
                if (db.users.some((item) => item.id !== user.id && item.email?.toLowerCase() === email)) throw new AuthInputError("邮箱已被注册");
                user.email = email;
            } else {
                user.email = undefined;
            }
        }
        if (patch.password) {
            validatePassword(patch.password);
            user.passwordHash = hashPassword(patch.password);
            db.sessions = db.sessions.filter((session) => session.userId !== user.id);
        }
        user.role = nextRole;
        if (patch.planId !== undefined) user.planId = resolvePlanById(db.settings.entitlements, patch.planId).id;
        let walletPointsBalance: number | undefined;
        if (patch.pointsBalance !== undefined) {
            const previousBalance = normalizePoints(user.pointsBalance, 0);
            const delta = normalizePoints(patch.pointsBalance, user.pointsBalance) - previousBalance;
            if (nextStatus === "active") user.status = "active";
            const wallet = adjustPermanentPointsInAuthDb(db, {
                userId: user.id,
                amount: delta,
                description: "管理员后台调整",
                idempotencyKey: `admin-adjust:${user.id}:${randomUUID()}`,
            });
            walletPointsBalance = wallet?.snapshot.totalPoints;
        }
        user.status = nextStatus;
        user.updatedAt = new Date().toISOString();
        if (user.status !== "active") db.sessions = db.sessions.filter((session) => session.userId !== user.id);
        return { ...toPublicUser(user, db), ...(walletPointsBalance === undefined ? {} : { pointsBalance: walletPointsBalance }) };
    });
}

export async function deleteUserByAdmin(actorId: string, userId: string) {
    return mutateAuthDb((db) => {
        const user = db.users.find((item) => item.id === userId);
        if (!user) throw new AuthInputError("用户不存在");
        if (user.id === actorId) throw new AuthInputError("不能删除当前登录的管理员账号");
        if (user.role === "admin" && countActiveAdmins(db, user.id) === 0) throw new AuthInputError("至少需要保留一个管理员");
        db.users = db.users.filter((item) => item.id !== user.id);
        db.sessions = db.sessions.filter((session) => session.userId !== user.id);
        db.quotaUsage = db.quotaUsage.filter((usage) => !usage || typeof usage !== "object" || (usage as { userId?: unknown }).userId !== user.id);
        db.emailCodes = db.emailCodes.filter((code) => code.userId !== user.id);
        return { ok: true };
    });
}
