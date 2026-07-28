import { randomUUID } from "node:crypto";

import type { AccountDeletionRequestStatus, AccountDeletionRequestView, AdminAccountDeletionRequest } from "@/lib/account-deletion-contract";
import type { PublicUser } from "@/lib/auth/store";
import { verifyUserPasswordForSensitiveAction } from "@/lib/auth/store";
import {
    createAccountDeletionRequest,
    listAccountDeletionRequests,
    readLatestAccountDeletionRequestForUser,
    reviewPendingAccountDeletionRequest,
    type StoredAccountDeletionRequest,
    withdrawPendingAccountDeletionRequest,
} from "@/lib/server/database/account-deletion-request-repository";

export class AccountDeletionRequestError extends Error {
    constructor(
        message: string,
        readonly status = 400,
    ) {
        super(message);
    }
}

export async function getOwnAccountDeletionRequest(userId: string): Promise<AccountDeletionRequestView | null> {
    const request = await readLatestAccountDeletionRequestForUser(userId);
    return request ? toUserView(request) : null;
}

export async function submitAccountDeletionRequest(user: Pick<PublicUser, "id" | "accountId" | "username" | "displayName" | "email">, input: { currentPassword: string; note?: string }) {
    if (!input.currentPassword) throw new AccountDeletionRequestError("请输入当前密码");
    await verifyUserPasswordForSensitiveAction(user.id, input.currentPassword);
    const latest = await readLatestAccountDeletionRequestForUser(user.id);
    if (latest?.status === "pending") throw new AccountDeletionRequestError("已有待处理的注销申请", 409);
    if (latest?.status === "accepted") throw new AccountDeletionRequestError("注销申请已受理，正在处理中", 409);

    const now = new Date().toISOString();
    const created = await createAccountDeletionRequest({
        id: randomUUID(),
        userId: user.id,
        accountId: user.accountId,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        status: "pending",
        note: normalizeText(input.note, 500),
        reviewNote: "",
        requestedAt: now,
        updatedAt: now,
    });
    if (!created) throw new AccountDeletionRequestError("已有待处理的注销申请", 409);
    return toUserView(created);
}

export async function withdrawOwnAccountDeletionRequest(userId: string) {
    const request = await withdrawPendingAccountDeletionRequest(userId, new Date().toISOString());
    if (!request) throw new AccountDeletionRequestError("没有可撤回的待处理申请", 409);
    return toUserView(request);
}

export async function listAdminAccountDeletionRequests(input: { page?: number; pageSize?: number; keyword?: string; status?: AccountDeletionRequestStatus }) {
    const result = await listAccountDeletionRequests(input);
    return { ...result, items: result.items.map(toAdminView) };
}

export async function reviewAccountDeletionRequest(input: { id: string; status: "accepted" | "rejected"; reviewNote: string; reviewer: Pick<PublicUser, "id" | "username"> }) {
    const reviewNote = normalizeText(input.reviewNote, 1000);
    if (!reviewNote) throw new AccountDeletionRequestError("请填写处理备注");
    const request = await reviewPendingAccountDeletionRequest({
        id: input.id,
        status: input.status,
        reviewNote,
        reviewedByUserId: input.reviewer.id,
        reviewedByUsername: input.reviewer.username,
        updatedAt: new Date().toISOString(),
    });
    if (!request) throw new AccountDeletionRequestError("申请不存在或已处理", 409);
    return toAdminView(request);
}

function toUserView(request: StoredAccountDeletionRequest): AccountDeletionRequestView {
    return {
        id: request.id,
        status: request.status,
        note: request.note,
        reviewNote: request.reviewNote,
        requestedAt: request.requestedAt,
        updatedAt: request.updatedAt,
        handledAt: request.handledAt,
    };
}

function toAdminView(request: StoredAccountDeletionRequest): AdminAccountDeletionRequest {
    return {
        ...toUserView(request),
        userId: request.userId,
        accountId: request.accountId,
        username: request.username,
        displayName: request.displayName,
        email: request.email,
        reviewedByUsername: request.reviewedByUsername,
    };
}

function normalizeText(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
