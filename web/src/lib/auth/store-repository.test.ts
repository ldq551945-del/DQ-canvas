import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueryExecutor } from "@/lib/server/database";
import { POSTGRESQL_SCHEMA_SQL } from "@/lib/server/database/schema";
import { encryptSecretValue } from "@/lib/server/secret-crypto";
import { mapPostgresSettings, readPostgresAnnouncementsPage, readPostgresAuthSettings, readPostgresCdkListData, readPostgresPublicUserData, upsertPostgresSystemChannels } from "./store-repository";

const originalEncryptionKey = process.env.VOZEB_PRO_ENCRYPTION_KEY;

afterEach(() => {
    if (originalEncryptionKey === undefined) delete process.env.VOZEB_PRO_ENCRYPTION_KEY;
    else process.env.VOZEB_PRO_ENCRYPTION_KEY = originalEncryptionKey;
});

function mockExecutor(rows: Record<string, unknown>[][]) {
    const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: rows.shift() || [], rowCount: 1 }));
    return { executor: { query } as unknown as QueryExecutor, query };
}

describe("PostgreSQL auth read paths", () => {
    it("normalizes newly added generation defaults for existing database rows", () => {
        const settings = mapPostgresSettings({ generation_defaults: { imageCount: 2 } }, [], []);

        expect(settings.generationDefaults).toMatchObject({
            imageCount: 2,
            workbenchSmartPlanning: { image: true, video: true },
        });
    });

    it("decrypts system channel API keys on the settings fast path", async () => {
        process.env.VOZEB_PRO_ENCRYPTION_KEY = "31".repeat(32);
        const encryptedApiKey = encryptSecretValue("provider-secret");
        const { executor } = mockExecutor([[{ id: "default" }], [], [{ id: "channel-one", name: "主渠道", base_url: "https://api.example.com/v1", api_key_ciphertext: encryptedApiKey, api_format: "openai", models: [], enabled: true }]]);

        const settings = await readPostgresAuthSettings(executor);

        expect(settings.systemChannels[0].apiKey).toBe("provider-secret");
        expect(settings.systemChannels[0].apiKey).not.toContain("vozeb-pro-secret:v1:");
    });

    it("round-trips channel health snapshots through PostgreSQL", async () => {
        const healthResults = { text: { ok: true, kind: "text" as const, model: "gpt-test", status: 200, checkedAt: "2026-08-01T00:00:00.000Z" } };
        const settings = mapPostgresSettings({ id: "default" }, [], [{ id: "channel-one", name: "主渠道", base_url: "https://api.example.com/v1", api_format: "openai", models: ["gpt-test"], enabled: true, health_results: healthResults }]);
        expect(settings.systemChannels[0].healthResults).toEqual(healthResults);

        const { executor, query } = mockExecutor([[]]);
        await upsertPostgresSystemChannels(executor, [{ id: "channel-one", name: "主渠道", baseUrl: "https://api.example.com/v1", apiKey: "encrypted", apiFormat: "openai", models: ["gpt-test"], enabled: true, healthResults }]);
        const [statement, values] = query.mock.calls[0];
        expect(statement).toContain("health_results");
        expect(JSON.parse(String(values?.[8]))).toEqual(healthResults);
        expect(POSTGRESQL_SCHEMA_SQL).toContain("health_results jsonb NOT NULL DEFAULT '{}'::jsonb");
    });

    it("loads public users with only plans, users and today's wallets", async () => {
        const timestamp = "2026-01-01T00:00:00.000Z";
        const { executor, query } = mockExecutor([
            [{ id: "default", default_plan_id: "free", free_daily_points_enabled: true, free_daily_points: 3 }],
            [{ id: "free", name: "免费版", enabled: true, daily_points: 0, limits: {}, features: [] }],
            [{ id: "user-one", account_id: 1, username: "user-one", display_name: "用户一", role: "user", status: "active", plan_id: "free", points_balance: 10, password_hash: "hash", created_at: timestamp, updated_at: timestamp }],
            [{ user_id: "user-one", date: "2026-01-01", plan_id: "free", granted_points: 3, remaining_points: 2, created_at: timestamp, updated_at: timestamp }],
        ]);

        const data = await readPostgresPublicUserData("2026-01-01", executor);

        expect(data.users).toHaveLength(1);
        expect(data.users[0]?.accountId).toBe("0001");
        expect(data.dailyPlanPointWallets[0]).toMatchObject({ userId: "user-one", remainingPoints: 2 });
        expect(query).toHaveBeenCalledTimes(4);
        expect(query.mock.calls.map(([statement]) => String(statement))).toEqual([
            expect.stringContaining("FROM app_settings"),
            expect.stringContaining("FROM entitlement_plans"),
            expect.stringContaining("FROM users"),
            expect.stringContaining("FROM daily_plan_point_wallets WHERE date = $1"),
        ]);
    });

    it("loads CDK codes without point records, sessions or unrelated users", async () => {
        const { executor, query } = mockExecutor([
            [{ total: 1 }],
            [{ total: 1, redeemed: 1, unused: 0, expired: 0 }],
            [
                {
                    id: "cdk-one",
                    status: "active",
                    code_hash: "hash",
                    code_ciphertext: "ciphertext",
                    code_preview: "CDK-ONE",
                    points: 20,
                    max_redemptions: 1,
                    redeemed_count: 1,
                    note: "测试",
                    created_at: "2026-01-01T00:00:00.000Z",
                    updated_at: "2026-01-01T00:00:00.000Z",
                    redemptions: [{ cdk_code_id: "cdk-one", user_id: "user-one", redeemed_at: "2026-01-01T00:00:00.000Z", account_id: 1, username: "user-one", display_name: "用户一" }],
                },
            ],
        ]);

        const data = await readPostgresCdkListData({ page: 1, pageSize: 20, filter: "all" }, executor);

        expect(data.cdkCodes[0]).toMatchObject({ id: "cdk-one", redeemedCount: 1 });
        expect(data.users).toEqual([{ id: "user-one", accountId: "0001", username: "user-one", displayName: "用户一" }]);
        expect(data.stats).toEqual({ total: 1, redeemed: 1, unused: 0, expired: 0 });
        expect(query).toHaveBeenCalledTimes(3);
        expect(query.mock.calls.map(([statement]) => String(statement))).toEqual([expect.stringContaining("count(*) AS total"), expect.stringContaining("count(*) FILTER"), expect.stringContaining("LIMIT $5 OFFSET $6")]);
    });

    it("filters and paginates announcements inside PostgreSQL", async () => {
        const visibleAt = "2026-07-27T00:00:00.000Z";
        const { executor, query } = mockExecutor([
            [
                {
                    id: "announcement-one",
                    title: "公告",
                    content: "内容",
                    enabled: true,
                    popup_home: false,
                    popup_after_login: false,
                    created_at: "2026-01-01T00:00:00.000Z",
                    updated_at: "2026-01-01T00:00:00.000Z",
                    total_count: "47",
                },
            ],
        ]);

        const page = await readPostgresAnnouncementsPage({ includeDisabled: false, page: 3, pageSize: 12, visibleAt }, executor);

        expect(page).toMatchObject({ items: [{ id: "announcement-one", title: "公告" }], total: 47, page: 3, pageSize: 12 });
        expect(query).toHaveBeenCalledWith(expect.stringMatching(/count\(\*\) OVER\(\)[\s\S]*WHERE[\s\S]*enabled = true[\s\S]*starts_at[\s\S]*ends_at[\s\S]*LIMIT \$3 OFFSET \$4/), [false, visibleAt, 12, 24]);
    });
});
