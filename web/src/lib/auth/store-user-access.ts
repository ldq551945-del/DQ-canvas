import { randomUUID } from "node:crypto";

import { formatAccountId } from "@/lib/account-id";
import { BillingInputError } from "@/lib/server/billing-errors";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled, postgresQuery } from "@/lib/server/database";
import { assertInstallToken, InstallTokenError } from "@/lib/server/install-token";
import { adjustPermanentPointsInAuthDb, walletClock } from "@/lib/server/points-wallet-service";
import { bindReferralRelationshipAfterRegistration, normalizeReferralCode } from "@/lib/server/referral-service";

import { hashPassword, verifyPassword } from "./password";
import { AuthInputError, EMAIL_CODE_MAX_AGE_MS, EMAIL_CODE_RESEND_COOLDOWN_MS } from "./store-foundation";
import {
    consumeEmailCode,
    hashToken,
    normalizeDisplayName,
    normalizeEmail,
    normalizePoints,
    normalizeUsername,
    randomNumericCode,
    resolveDefaultPlan,
    resolveInitialUserPoints,
    resolvePlanById,
    validateEmail,
    validatePassword,
    validateUsername,
} from "./store-normalizers";
import { mutateAuthDb, readAuthDb } from "./store-repository";
import { publicUserFromAuthenticatedRecord, toPublicUser } from "./store-user-projection";
import { type AuthDatabase, type EmailCodePurpose, type StoredUser, type UserRole, type UserStatus } from "./store-types";

export async function createUser(input: { username: string; email?: string; emailCode?: string; displayName?: string; password: string; referralCode?: string; referralSource?: string; referralClientIp?: string }) {
    const referralCode = normalizeReferralCode(input.referralCode);
    if (referralCode && !isPostgresDatabaseEnabled()) throw new AuthInputError("邀请功能需要启用 PostgreSQL", 501);
    const reservedAccountId = isPostgresDatabaseEnabled() ? await reservePostgresAccountId() : undefined;
    return mutateAuthDb(
        (db) => {
            const username = normalizeUsername(input.username);
            const email = normalizeEmail(input.email);
            const displayName = normalizeDisplayName(input.displayName || username);
            validateUsername(username);
            validatePassword(input.password);

            if (db.users.length === 0) throw new AuthInputError("请先通过安装向导创建管理员", 503);
            if (!db.settings.registrationEnabled) throw new AuthInputError("注册已关闭");
            if (db.settings.emailRegistrationEnabled && !email) throw new AuthInputError("请填写邮箱地址");
            if (email) validateEmail(email);
            if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) throw new AuthInputError("用户名已存在");
            if (email && db.users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) throw new AuthInputError("邮箱已被注册");
            if (db.settings.emailRegistrationEnabled) consumeEmailCode(db, { purpose: "register", email, code: input.emailCode });

            const now = new Date().toISOString();
            const user: StoredUser = {
                id: randomUUID(),
                accountId: reservedAccountId || takeNextFileAccountId(db),
                username,
                email: email || undefined,
                displayName,
                bio: "",
                role: "user",
                status: "active",
                planId: resolveDefaultPlan(db.settings.entitlements).id,
                pointsBalance: 0,
                passwordHash: hashPassword(input.password),
                createdAt: now,
                updatedAt: now,
            };
            db.users.push(user);
            return toPublicUser(user, db);
        },
        referralCode
            ? {
                  afterPostgresPersist: async (user, client) => {
                      try {
                          await bindReferralRelationshipAfterRegistration(client, {
                              inviteeUserId: user.id,
                              referralCode,
                              attributionSource: input.referralSource,
                              clientIp: input.referralClientIp,
                              strict: true,
                          });
                      } catch (error) {
                          if (error instanceof BillingInputError) throw new AuthInputError(error.message, error.status);
                          throw error;
                      }
                  },
              }
            : undefined,
    );
}

export async function createFirstAdmin(input: { username: string; email?: string; displayName?: string; password: string; installToken: unknown }) {
    try {
        assertInstallToken(input.installToken);
    } catch (error) {
        if (error instanceof InstallTokenError) throw new AuthInputError(error.message, error.status);
        throw error;
    }

    const reservedAccountId = isPostgresDatabaseEnabled() ? await reservePostgresAccountId() : undefined;
    return mutateAuthDb((db) => {
        if (db.users.length !== 0) throw new AuthInputError("项目已完成安装，禁止重复创建首个管理员", 409);
        const username = normalizeUsername(input.username);
        const email = normalizeEmail(input.email);
        const displayName = normalizeDisplayName(input.displayName || username);
        validateUsername(username);
        validatePassword(input.password);
        if (email) validateEmail(email);

        const now = new Date().toISOString();
        const user: StoredUser = {
            id: randomUUID(),
            accountId: reservedAccountId || takeNextFileAccountId(db),
            username,
            email: email || undefined,
            displayName,
            bio: "",
            role: "admin",
            status: "active",
            planId: resolveDefaultPlan(db.settings.entitlements).id,
            pointsBalance: 0,
            passwordHash: hashPassword(input.password),
            createdAt: now,
            updatedAt: now,
        };
        db.users.push(user);
        return toPublicUser(user, db);
    });
}

export async function createUserByAdmin(input: { username: string; email?: string; displayName?: string; password: string; role?: UserRole; status?: UserStatus; pointsBalance?: number; planId?: string }) {
    const reservedAccountId = isPostgresDatabaseEnabled() ? await reservePostgresAccountId() : undefined;
    return mutateAuthDb((db) => {
        const username = normalizeUsername(input.username);
        const email = normalizeEmail(input.email);
        const displayName = normalizeDisplayName(input.displayName || username);
        validateUsername(username);
        validatePassword(input.password);
        if (email) validateEmail(email);
        if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) throw new AuthInputError("用户名已存在");
        if (email && db.users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) throw new AuthInputError("邮箱已被注册");

        const now = new Date().toISOString();
        const plan = resolvePlanById(db.settings.entitlements, input.planId);
        const pointsBalance = normalizePoints(input.pointsBalance, resolveInitialUserPoints(db, plan));
        const intendedStatus = input.status === "disabled" ? "disabled" : "active";
        const user: StoredUser = {
            id: randomUUID(),
            accountId: reservedAccountId || takeNextFileAccountId(db),
            username,
            email: email || undefined,
            displayName,
            bio: "",
            role: input.role === "admin" ? "admin" : "user",
            status: "active",
            planId: plan.id,
            pointsBalance: 0,
            passwordHash: hashPassword(input.password),
            createdAt: now,
            updatedAt: now,
        };
        db.users.push(user);
        const wallet = pointsBalance ? adjustPermanentPointsInAuthDb(db, { userId: user.id, amount: pointsBalance, description: "管理员创建用户", idempotencyKey: `admin-create:${user.id}`, now: new Date(now) }) : null;
        user.status = intendedStatus;
        return { ...toPublicUser(user, db), pointsBalance: wallet?.snapshot.totalPoints || 0 };
    });
}

export async function authenticateUser(input: { username: string; password: string }) {
    const account = normalizeUsername(input.username);
    const accountEmail = normalizeEmail(input.username);
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const repos = createPostgresRepositories();
        const user = await repos.users.getByLogin(account, accountEmail || undefined);
        if (!user || !verifyPassword(input.password, user.passwordHash)) throw new AuthInputError("用户名或密码不正确");
        if (user.status !== "active") throw new AuthInputError("账号已被禁用");

        const lastLoginAt = new Date().toISOString();
        const updatedUser = await repos.users.update(user.id, { lastLoginAt });
        const clock = walletClock();
        const details = await repos.users.getPublicDetails([user.id], { now: clock.now.toISOString(), date: clock.date });
        const snapshot = details[0];
        return snapshot ? publicUserFromAuthenticatedRecord(snapshot, clock.expiresAt) : toPublicUser({ ...(updatedUser || user), lastLoginAt });
    }
    const db = await readAuthDb();
    const user = db.users.find((item) => item.username.toLowerCase() === account.toLowerCase() || (accountEmail && item.email?.toLowerCase() === accountEmail));
    if (!user || !verifyPassword(input.password, user.passwordHash)) throw new AuthInputError("用户名或密码不正确");
    if (user.status !== "active") throw new AuthInputError("账号已被禁用");

    await mutateAuthDb((nextDb) => {
        const nextUser = nextDb.users.find((item) => item.id === user.id);
        if (nextUser) {
            nextUser.lastLoginAt = new Date().toISOString();
            nextUser.updatedAt = nextUser.lastLoginAt;
        }
    });

    return toPublicUser({ ...user, lastLoginAt: new Date().toISOString() }, db);
}

type EmailVerificationCodeInput = { purpose: EmailCodePurpose; email: string; userId?: string };

export function createEmailVerificationCode(input: EmailVerificationCodeInput & { silentPasswordResetMissing: true }): Promise<{ code?: string; email: string }>;
export function createEmailVerificationCode(input: EmailVerificationCodeInput): Promise<{ code: string; email: string }>;
export async function createEmailVerificationCode(input: EmailVerificationCodeInput & { silentPasswordResetMissing?: boolean }) {
    return mutateAuthDb((db) => {
        const email = normalizeEmail(input.email);
        validateEmail(email);
        const now = new Date();

        if (input.purpose === "register") {
            if (!db.settings.emailRegistrationEnabled) throw new AuthInputError("当前未开启邮箱注册");
            if (db.users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) throw new AuthInputError("邮箱已被注册");
        }

        if (input.purpose === "email-change") {
            if (!input.userId) throw new AuthInputError("请先登录");
            if (db.users.some((user) => user.id !== input.userId && user.email?.toLowerCase() === email.toLowerCase())) throw new AuthInputError("邮箱已被注册");
        }

        if (input.purpose === "password-reset" && !db.users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) {
            if (input.silentPasswordResetMissing) return { email };
            throw new AuthInputError("没有找到绑定该邮箱的账号");
        }

        const code = randomNumericCode();
        const activeCode = db.emailCodes.find((item) => item.purpose === input.purpose && item.email === email && item.userId === input.userId && !item.consumedAt && Date.parse(item.expiresAt) > now.getTime());
        if (activeCode && now.getTime() - Date.parse(activeCode.createdAt) < EMAIL_CODE_RESEND_COOLDOWN_MS) {
            throw new AuthInputError("验证码发送过于频繁，请 60 秒后再试");
        }
        db.emailCodes = db.emailCodes.filter((item) => !(item.purpose === input.purpose && item.email === email && item.userId === input.userId && !item.consumedAt));
        db.emailCodes.push({
            id: randomUUID(),
            purpose: input.purpose,
            email,
            userId: input.userId,
            codeHash: hashToken(code),
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + EMAIL_CODE_MAX_AGE_MS).toISOString(),
            attempts: 0,
        });
        return { code, email };
    });
}

async function reservePostgresAccountId() {
    await ensurePostgresSchema();
    const result = await postgresQuery<{ account_id: string | number }>("SELECT nextval('user_account_id_seq') AS account_id");
    return formatAccountId(result.rows[0]?.account_id);
}

function takeNextFileAccountId(db: AuthDatabase) {
    const accountId = Math.max(1, Math.floor(db.nextUserAccountId || 1));
    db.nextUserAccountId = accountId + 1;
    return formatAccountId(accountId);
}
