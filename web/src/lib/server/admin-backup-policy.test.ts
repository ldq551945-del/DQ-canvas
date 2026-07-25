import { describe, expect, it } from "vitest";

import { mergeAuthBackupSecrets, sanitizeAuthBackup } from "./admin-backup-policy";

const current = {
    users: [{ id: "user-1", username: "admin", email: "admin@example.com", passwordHash: "hash-current", pointsBalance: 10 }],
    sessions: [{ id: "session-1", tokenHash: "token-hash" }],
    emailCodes: [{ id: "code-1", codeHash: "code-hash" }],
    cdkCodes: [{ id: "cdk-1", codeHash: "cdk-hash" }],
    settings: {
        mail: { host: "smtp.example.com", password: "mail-secret" },
        systemChannels: [{ id: "channel-1", name: "主渠道", apiKey: "api-secret" }],
    },
};

describe("admin backup policy", () => {
    it("removes authentication and upstream secrets from exported auth data", () => {
        expect(sanitizeAuthBackup(current)).toEqual({
            users: [{ id: "user-1", username: "admin", pointsBalance: 10 }],
            sessions: [],
            emailCodes: [],
            cdkCodes: [],
            settings: {
                mail: { host: "smtp.example.com", password: "" },
                systemChannels: [{ id: "channel-1", name: "主渠道", apiKey: "" }],
            },
        });
    });

    it("keeps current server credentials when importing sanitized data", () => {
        const imported = sanitizeAuthBackup({
            ...current,
            users: [{ ...current.users[0], email: "exported@example.com", passwordHash: "exported-hash", pointsBalance: 99 }],
        });

        expect(mergeAuthBackupSecrets(imported, current)).toMatchObject({
            users: [{ email: "admin@example.com", passwordHash: "hash-current", pointsBalance: 99 }],
            sessions: current.sessions,
            emailCodes: current.emailCodes,
            cdkCodes: current.cdkCodes,
            settings: {
                mail: { host: "smtp.example.com", password: "mail-secret" },
                systemChannels: [{ id: "channel-1", apiKey: "api-secret" }],
            },
        });
    });

    it("rejects users that do not exist on the target server", () => {
        const imported = { ...(sanitizeAuthBackup(current) as Record<string, unknown>), users: [{ id: "other", username: "other", role: "admin", status: "active" }] };
        expect(() => mergeAuthBackupSecrets(imported, current)).toThrow("当前服务器不存在");
    });
});
