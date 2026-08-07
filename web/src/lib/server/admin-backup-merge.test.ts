import { describe, expect, it } from "vitest";

import { emptyDb } from "@/lib/auth/store-normalizers";
import type { StoredUser } from "@/lib/auth/store-types";

import { mergeAccountConfigBackup, type AdminBackupData } from "./admin-backup-merge";

const now = "2026-08-01T00:00:00.000Z";

describe("admin account-config backup merge", () => {
    it("updates imported records while retaining users and related data absent from the backup", () => {
        const current = backup([user("user-a", "admin", 10), user("user-b", "member", 20)]);
        current.auth.sessions.push({ id: "session-b", userId: "user-b", tokenHash: "token-b", createdAt: now, expiresAt: now });
        current.prompts.prompts.push(prompt("prompt-b"));
        const imported = backup([user("user-a", "admin", 99)]);
        imported.prompts.prompts.push(prompt("prompt-a"));

        const merged = mergeAccountConfigBackup(current, imported);

        expect(merged.auth.users).toEqual([expect.objectContaining({ id: "user-a", pointsBalance: 99 }), expect.objectContaining({ id: "user-b", pointsBalance: 20 })]);
        expect(merged.auth.sessions).toEqual(current.auth.sessions);
        expect(merged.prompts.prompts.map((item) => item.id)).toEqual(["prompt-b", "prompt-a"]);
    });
});

function backup(users: StoredUser[]): AdminBackupData {
    const auth = emptyDb();
    auth.users = users;
    return { auth, prompts: { version: 1, prompts: [], seedSources: [] }, generationLogs: { version: 1, logs: [] }, accountDeletionRequests: { version: 1, requests: [] } };
}

function user(id: string, username: string, pointsBalance: number): StoredUser {
    return {
        id,
        accountId: id === "user-a" ? "1" : "2",
        username,
        email: `${username}@example.com`,
        displayName: username,
        bio: "",
        role: username === "admin" ? "admin" : "user",
        status: "active",
        planId: "free",
        pointsBalance,
        passwordHash: `${id}-hash`,
        createdAt: now,
        updatedAt: now,
    };
}

function prompt(id: string) {
    return { id, scope: "library" as const, title: id, coverUrl: "", prompt: id, tags: [], category: "", preview: "", createdAt: now, updatedAt: now };
}
