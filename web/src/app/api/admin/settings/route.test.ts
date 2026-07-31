import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getAuthSettings: vi.fn(),
    setAuthSettings: vi.fn(),
    safeRecordAuditLog: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "admin", role: "admin" })) }));
vi.mock("@/lib/auth/store", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/auth/store")>();
    return { ...actual, getAuthSettings: mocks.getAuthSettings, setAuthSettings: mocks.setAuthSettings };
});
vi.mock("@/lib/server/audit-log-store", () => ({ auditActorFromRequest: vi.fn(() => ({ id: "admin" })), safeRecordAuditLog: mocks.safeRecordAuditLog }));

import { PATCH } from "./route";

const savedSettings = {
    systemChannels: [{ id: "one", name: "主渠道", baseUrl: "https://api.example.com/v1", apiKey: "saved-secret", apiFormat: "openai", models: ["vendor/writer"], enabled: true }],
    logicalModels: [{ id: "writer", name: "Writer", capability: "text", enabled: true, bindings: [{ id: "binding", channelId: "one", upstreamModel: "vendor/writer", enabled: true, priority: 1 }] }],
    defaultModels: { textModel: "writer", imageModel: "", videoModel: "", audioModel: "" },
};

describe("admin settings model routing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAuthSettings.mockResolvedValue(savedSettings);
        mocks.setAuthSettings.mockImplementation(async (patch) => ({ ...savedSettings, ...patch }));
    });

    it("saves a consistent channel, logical model, and default snapshot", async () => {
        const response = await PATCH(
            request({
                systemChannels: [{ ...savedSettings.systemChannels[0], apiKey: "", hasApiKey: true }],
                logicalModels: savedSettings.logicalModels,
                defaultModels: savedSettings.defaultModels,
            }),
        );
        expect(response.status).toBe(200);
        expect(mocks.setAuthSettings).toHaveBeenCalledWith(
            expect.objectContaining({
                systemChannels: [expect.objectContaining({ id: "one", apiKey: "saved-secret" })],
                logicalModels: savedSettings.logicalModels,
                defaultModels: savedSettings.defaultModels,
            }),
        );
        expect(mocks.safeRecordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.settings.update", metadata: { fields: expect.arrayContaining(["systemChannels", "logicalModels", "defaultModels"]) } }));
    });

    it("rejects deleting a channel while a logical binding still references it", async () => {
        const response = await PATCH(request({ systemChannels: [], logicalModels: savedSettings.logicalModels, defaultModels: savedSettings.defaultModels }));
        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("不存在的渠道");
        expect(mocks.setAuthSettings).not.toHaveBeenCalled();
    });

    it("keeps an explicitly empty logical model catalog empty", async () => {
        const response = await PATCH(request({ logicalModels: [], defaultModels: { ...savedSettings.defaultModels, textModel: "" } }));

        expect(response.status).toBe(200);
        expect(mocks.setAuthSettings).toHaveBeenCalledWith(expect.objectContaining({ logicalModels: [], defaultModels: expect.objectContaining({ textModel: "" }) }));
    });

    it("does not recreate deleted logical models during a later channel-only save", async () => {
        mocks.getAuthSettings.mockResolvedValue({ ...savedSettings, logicalModels: [], defaultModels: { ...savedSettings.defaultModels, textModel: "" } });

        const response = await PATCH(request({ systemChannels: savedSettings.systemChannels }));

        expect(response.status).toBe(200);
        expect(mocks.setAuthSettings).toHaveBeenCalledWith(expect.objectContaining({ logicalModels: [] }));
    });

    it("saves a disabled channel after clearing its now-unresolvable default", async () => {
        const response = await PATCH(
            request({
                systemChannels: [{ ...savedSettings.systemChannels[0], enabled: false, apiKey: "", hasApiKey: true }],
                logicalModels: savedSettings.logicalModels,
                defaultModels: savedSettings.defaultModels,
            }),
        );

        expect(response.status).toBe(200);
        expect(mocks.setAuthSettings).toHaveBeenCalledWith(expect.objectContaining({ defaultModels: expect.objectContaining({ textModel: "" }) }));
    });
});

function request(body: unknown) {
    return new Request("http://localhost/api/admin/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
