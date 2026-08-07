import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "admin-one", role: "admin" })) }));
vi.mock("@/lib/auth/store-normalizers", () => ({ encryptAuthDbSecretsForStorage: vi.fn((value) => value) }));
vi.mock("@/lib/server/admin-backup-policy", () => ({ mergeAuthBackupSecrets: vi.fn(), sanitizeAuthBackup: vi.fn() }));
vi.mock("@/lib/server/admin-backup-store", () => ({ readAdminBackupData: vi.fn(), restoreAdminBackupData: vi.fn() }));
vi.mock("@/lib/server/database", () => ({ getDatabaseProvider: vi.fn(() => "file") }));
vi.mock("@/lib/server/data-adapter", () => ({
    copyDataFile: vi.fn(),
    ensureDataDirectory: vi.fn(),
    listDataDirectory: vi.fn(),
    removeDataPath: vi.fn(),
    resolveDataPath: vi.fn(),
    writeJsonDataFile: vi.fn(),
}));

import { POST } from "./route";

describe("POST /api/admin/backup", () => {
    it("rejects an oversized multipart backup before parsing it", async () => {
        const response = await POST(
            new Request("http://localhost/api/admin/backup", {
                method: "POST",
                headers: { "content-type": "multipart/form-data; boundary=test", "content-length": String(30 * 1024 * 1024 + 64 * 1024 + 1) },
                body: "--test--",
            }),
        );

        expect(response.status).toBe(413);
        expect((await response.json()).error).toBe("备份文件过大，请确认文件是否正确");
    });

    it("rejects a disaster recovery manifest at the account-config import endpoint", async () => {
        const formData = new FormData();
        formData.set("file", new File([JSON.stringify({ app: "DQ-绘图", backupType: "disaster", files: {} })], "recovery-point.json", { type: "application/json" }));

        const response = await POST(new Request("http://localhost/api/admin/backup", { method: "POST", body: formData }));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("不能用于整库灾难恢复");
    });
});
