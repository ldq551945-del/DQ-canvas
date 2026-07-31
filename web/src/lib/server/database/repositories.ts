import { postgresQuery, type QueryExecutor } from "@/lib/server/database/postgres";
import { AuditLogsRepository } from "./audit-log-repository";
import { BillingOrderRepository } from "./billing-order-repository";
import { BillingPaymentRepository } from "./billing-payment-repository";
import { BillingProductRepository } from "./billing-product-repository";
import { CouponRepository } from "./coupon-repository";
import { PointsWalletRepository } from "./points-wallet-repository";
import { PromotionRepository } from "./promotion-repository";
import { ReferralRepository } from "./referral-repository";
import { WorkPublicationRepository } from "./work-publication-repository";
import { WorkGovernanceRepository } from "./work-governance-repository";
import { WorkCommunityRepository } from "./work-community-repository";
import { AnnouncementsRepository, GenerationLogsRepository, PromptsRepository } from "./content-repository";
import { CdkRepository, PointsRepository, SessionsRepository, UsersRepository } from "./user-repository";
import type { AppSettingsRecord, EntitlementPlanRecord, JsonValue, SystemModelChannelRecord } from "./repository-shared";
import { isoValue, jsonParam, jsonValue, numberValue, optionalIso, optionalJson, optionalString, stringValue } from "./repository-shared";

export type {
    AuthenticatedUserRecord,
    BillingOrderRecord,
    BillingOrderStatus,
    BillingProductRecord,
    BillingReconciliationRowRecord,
    BillingReconciliationRunRecord,
    CouponRedemptionRecord,
    CouponTemplateRecord,
    JsonValue,
    PaymentTransactionRecord,
    PromotionCampaignRecord,
    PromotionProductRecord,
    ReferralCodeRecord,
    ReferralProgramRecord,
    ReferralRelationshipRecord,
    ReferralRewardRecord,
    ReferralRewardStatus,
    ReferralRiskStatus,
    PublishedWorkAssetRecord,
    PublishedWorkAuthorDisplay,
    PublishedWorkLifecycleStatus,
    PublishedWorkModerationStatus,
    PublishedWorkRecord,
    PublishedWorkSourceType,
    PublishedWorkSummaryRecord,
    PublishedWorkVersionRecord,
    PublishedWorkVisibility,
    PublishedWorkCaseRecord,
    PublishedWorkCaseStatus,
    PublishedWorkCaseSummaryRecord,
    PublishedWorkCaseType,
    PublishedGalleryItemRecord,
    PublishedWorkRankingRecord,
    UserNotificationRecord,
    UserNotificationType,
    WorkCommunityRankingCursor,
    WorkCommunityRankingWindow,
    WorkCommunityRelationResultRecord,
    WorkCommunitySummaryRecord,
    UserFollowResultRecord,
    FollowedUserRecord,
    CommunityUserRecord,
    LikedPublishedWorkRecord,
    PublicCreatorProfileRecord,
    PublicCreatorWorkCursor,
    UserCommunitySummaryRecord,
    UserCouponListItemRecord,
    UserCouponRecord,
    UserSummaryRecord,
    UserPlanAssignmentRecord,
} from "./repository-shared";

export function createPostgresRepositories(executor: QueryExecutor = { query: postgresQuery }) {
    const billingProduct = new BillingProductRepository(executor);
    const billingOrder = new BillingOrderRepository(executor);
    const pointsWallet = new PointsWalletRepository(executor);
    const billingPayment = new BillingPaymentRepository(executor);
    const promotion = new PromotionRepository(executor);
    const coupons = new CouponRepository(executor);

    return {
        settings: new SettingsRepository(executor),
        users: new UsersRepository(executor),
        sessions: new SessionsRepository(executor),
        points: new PointsRepository(executor),
        pointsWallet,
        cdk: new CdkRepository(executor),
        announcements: new AnnouncementsRepository(executor),
        prompts: new PromptsRepository(executor),
        generationLogs: new GenerationLogsRepository(executor),
        billing: {
            listProducts: billingProduct.listProducts.bind(billingProduct),
            getProductById: billingProduct.getProductById.bind(billingProduct),
            getProductsByIds: billingProduct.getProductsByIds.bind(billingProduct),
            upsertProduct: billingProduct.upsertProduct.bind(billingProduct),
            updateProduct: billingProduct.updateProduct.bind(billingProduct),
            deleteProductIfUnused: billingProduct.deleteProductIfUnused.bind(billingProduct),
            createOrder: billingOrder.createOrder.bind(billingOrder),
            getOrderById: billingOrder.getOrderById.bind(billingOrder),
            getOrderByOrderNo: billingOrder.getOrderByOrderNo.bind(billingOrder),
            listOrders: billingOrder.listOrders.bind(billingOrder),
            getSummary: billingOrder.getSummary.bind(billingOrder),
            expirePendingOrders: billingOrder.expirePendingOrders.bind(billingOrder),
            updateOrder: billingOrder.updateOrder.bind(billingOrder),
            upsertPayment: billingPayment.upsertPayment.bind(billingPayment),
            listPayments: billingPayment.listPayments.bind(billingPayment),
            getPaymentByProviderIdentifier: billingPayment.getPaymentByProviderIdentifier.bind(billingPayment),
            createReconciliationRun: billingPayment.createReconciliationRun.bind(billingPayment),
            listReconciliationRuns: billingPayment.listReconciliationRuns.bind(billingPayment),
            getReconciliationRun: billingPayment.getReconciliationRun.bind(billingPayment),
            listReconciliationRows: billingPayment.listReconciliationRows.bind(billingPayment),
            createPlanAssignment: billingPayment.createPlanAssignment.bind(billingPayment),
            getActivePlanAssignment: billingPayment.getActivePlanAssignment.bind(billingPayment),
            listPlanAssignments: billingPayment.listPlanAssignments.bind(billingPayment),
            updatePlanAssignment: billingPayment.updatePlanAssignment.bind(billingPayment),
            upsertProviderEvent: billingPayment.upsertProviderEvent.bind(billingPayment),
            getProviderEventByProviderEventId: billingPayment.getProviderEventByProviderEventId.bind(billingPayment),
            claimProviderEvent: billingPayment.claimProviderEvent.bind(billingPayment),
            markProviderEventProcessed: billingPayment.markProviderEventProcessed.bind(billingPayment),
            releaseProviderEvent: billingPayment.releaseProviderEvent.bind(billingPayment),
        },
        promotions: promotion,
        coupons,
        referrals: new ReferralRepository(executor),
        workPublications: new WorkPublicationRepository(executor),
        workGovernance: new WorkGovernanceRepository(executor),
        workCommunity: new WorkCommunityRepository(executor),
        auditLogs: new AuditLogsRepository(executor),
    };
}

class SettingsRepository {
    constructor(private readonly db: QueryExecutor) {}

    async getPaymentConfig() {
        const result = await this.db.query("SELECT payment_config FROM app_settings WHERE id = 'default'");
        return result.rows[0] ? jsonValue(result.rows[0].payment_config) : {};
    }

    async getSettings() {
        const [settings, plans, channels] = await Promise.all([this.db.query("SELECT * FROM app_settings WHERE id = 'default'"), this.listEntitlementPlans(), this.listSystemModelChannels()]);
        return {
            settings: settings.rows[0] ? mapSettings(settings.rows[0]) : undefined,
            plans,
            channels,
        };
    }

    async getWalletSettings() {
        const [settings, plans] = await Promise.all([this.db.query("SELECT * FROM app_settings WHERE id = 'default'"), this.listEntitlementPlans()]);
        return {
            settings: settings.rows[0] ? mapSettings(settings.rows[0]) : undefined,
            plans,
        };
    }

    async updateSettings(input: Partial<Omit<AppSettingsRecord, "id" | "createdAt" | "updatedAt">>) {
        const row = await this.db.query(
            `
            UPDATE app_settings SET
                site = COALESCE($1, site),
                registration_enabled = COALESCE($2, registration_enabled),
                email_registration_enabled = COALESCE($3, email_registration_enabled),
                free_daily_points_enabled = COALESCE($4, free_daily_points_enabled),
                mail = COALESCE($5, mail),
                allow_user_api_config = COALESCE($6, allow_user_api_config),
                model_point_costs = COALESCE($7, model_point_costs),
                generation_point_multipliers = COALESCE($8, generation_point_multipliers),
                entitlements_enabled = COALESCE($9, entitlements_enabled),
                default_plan_id = COALESCE($10, default_plan_id),
                generation_concurrency = COALESCE($11, generation_concurrency),
                generation_defaults = COALESCE($12, generation_defaults),
                payment_config = COALESCE($13, payment_config),
                default_models = COALESCE($14, default_models),
                free_daily_points = COALESCE($15, free_daily_points)
            WHERE id = 'default'
            RETURNING *
            `,
            [
                jsonParam(input.site),
                input.registrationEnabled,
                input.emailRegistrationEnabled,
                input.freeDailyPointsEnabled,
                jsonParam(input.mail),
                input.allowUserApiConfig,
                jsonParam(input.modelPointCosts),
                jsonParam(input.generationPointMultipliers),
                input.entitlementsEnabled,
                input.defaultPlanId,
                jsonParam(input.generationConcurrency),
                jsonParam(input.generationDefaults),
                jsonParam(input.paymentConfig),
                jsonParam(input.defaultModels),
                input.freeDailyPoints,
            ],
        );
        return mapSettings(row.rows[0]);
    }

    async listEntitlementPlans() {
        const result = await this.db.query("SELECT * FROM entitlement_plans ORDER BY sort_order ASC, created_at ASC");
        return result.rows.map(mapEntitlementPlan);
    }

    async upsertEntitlementPlan(plan: Omit<EntitlementPlanRecord, "createdAt" | "updatedAt">) {
        const result = await this.db.query(
            `
            INSERT INTO entitlement_plans (id, name, enabled, daily_points, limits, features, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                enabled = EXCLUDED.enabled,
                daily_points = EXCLUDED.daily_points,
                limits = EXCLUDED.limits,
                features = EXCLUDED.features,
                sort_order = EXCLUDED.sort_order
            RETURNING *
            `,
            [plan.id, plan.name, plan.enabled, plan.dailyPoints, jsonParam(plan.limits), jsonParam(plan.features), plan.sortOrder],
        );
        return mapEntitlementPlan(result.rows[0]);
    }

    async listSystemModelChannels() {
        const result = await this.db.query("SELECT * FROM system_model_channels ORDER BY sort_order ASC, created_at ASC");
        return result.rows.map(mapSystemModelChannel);
    }

    async upsertSystemModelChannel(channel: Omit<SystemModelChannelRecord, "createdAt" | "updatedAt">) {
        const result = await this.db.query(
            `
            INSERT INTO system_model_channels (id, name, base_url, api_key_ciphertext, api_format, models, enabled, advanced_config, health_results, sort_order)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                base_url = EXCLUDED.base_url,
                api_key_ciphertext = EXCLUDED.api_key_ciphertext,
                api_format = EXCLUDED.api_format,
                models = EXCLUDED.models,
                enabled = EXCLUDED.enabled,
                advanced_config = EXCLUDED.advanced_config,
                health_results = EXCLUDED.health_results,
                sort_order = EXCLUDED.sort_order
            RETURNING *
            `,
            [channel.id, channel.name, channel.baseUrl, channel.apiKeyCiphertext, channel.apiFormat, jsonParam(channel.models), channel.enabled, jsonParam(channel.advancedConfig), jsonParam(channel.healthResults || {}), channel.sortOrder],
        );
        return mapSystemModelChannel(result.rows[0]);
    }
}

function mapSettings(row: Record<string, unknown>): AppSettingsRecord {
    return {
        id: "default",
        site: jsonValue(row.site),
        registrationEnabled: row.registration_enabled !== false,
        emailRegistrationEnabled: row.email_registration_enabled === true,
        freeDailyPointsEnabled: row.free_daily_points_enabled !== false,
        freeDailyPoints: numberValue(row.free_daily_points),
        mail: jsonValue(row.mail),
        allowUserApiConfig: row.allow_user_api_config === true,
        modelPointCosts: jsonValue(row.model_point_costs),
        generationPointMultipliers: jsonValue(row.generation_point_multipliers),
        entitlementsEnabled: row.entitlements_enabled === true,
        defaultPlanId: stringValue(row.default_plan_id),
        generationConcurrency: jsonValue(row.generation_concurrency),
        generationDefaults: jsonValue(row.generation_defaults),
        paymentConfig: jsonValue(row.payment_config),
        defaultModels: jsonValue(row.default_models),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}

function mapEntitlementPlan(row: Record<string, unknown>): EntitlementPlanRecord {
    return {
        id: stringValue(row.id),
        name: stringValue(row.name),
        enabled: row.enabled !== false,
        dailyPoints: numberValue(row.daily_points),
        limits: jsonValue(row.limits),
        features: jsonValue(row.features),
        sortOrder: numberValue(row.sort_order),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}

function mapSystemModelChannel(row: Record<string, unknown>): SystemModelChannelRecord {
    return {
        id: stringValue(row.id),
        name: stringValue(row.name),
        baseUrl: stringValue(row.base_url),
        apiKeyCiphertext: stringValue(row.api_key_ciphertext),
        apiFormat: row.api_format === "gemini" ? "gemini" : "openai",
        models: jsonValue(row.models),
        enabled: row.enabled !== false,
        advancedConfig: optionalJson(row.advanced_config),
        healthResults: optionalJson(row.health_results),
        sortOrder: numberValue(row.sort_order),
        createdAt: isoValue(row.created_at),
        updatedAt: isoValue(row.updated_at),
    };
}
