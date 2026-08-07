import { Client, Pool, type QueryResult, type QueryResultRow } from "pg";

import { POSTGRESQL_SCHEMA_SQL } from "@/lib/server/database/schema";
import { logStructured, normalizeSqlForLog, percentiles, stableFingerprint, type PercentileSnapshot } from "@/lib/server/observability";

type DatabaseProvider = "file" | "postgres";

export type QueryExecutor = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};

const POSTGRES_TABLE_PREFIX = "dq_";
const POSTGRES_TABLES = [
    "schema_migrations",
    "app_settings",
    "system_model_channels",
    "entitlement_plans",
    "users",
    "sessions",
    "account_deletion_requests",
    "rate_limits",
    "email_codes",
    "quota_usage",
    "point_records",
    "daily_plan_point_wallets",
    "billing_products",
    "promotion_campaigns",
    "promotion_products",
    "coupon_templates",
    "coupon_template_products",
    "billing_orders",
    "user_coupons",
    "coupon_redemptions",
    "payment_transactions",
    "billing_refund_jobs",
    "referral_programs",
    "referral_codes",
    "referral_relationships",
    "referral_rewards",
    "published_works",
    "published_work_versions",
    "published_work_assets",
    "published_work_cases",
    "published_work_likes",
    "user_follows",
    "user_blocks",
    "user_notifications",
    "billing_reconciliation_runs",
    "billing_reconciliation_rows",
    "user_plan_assignments",
    "payment_provider_events",
    "cdk_codes",
    "cdk_redemptions",
    "announcements",
    "prompts",
    "prompt_seed_sources",
    "generation_logs",
    "generation_log_assets",
    "generation_tasks",
    "generation_worker_heartbeats",
    "generation_webhook_events",
    "creative_conversations",
    "creative_messages",
    "creative_assets",
    "local_media_assets",
    "object_storage_settings",
    "canvas_projects",
    "library_assets",
    "drama_projects",
    "drama_project_versions",
    "creative_run_events",
    "audit_logs",
    "check_ins",
] as const;

const POSTGRES_SCHEMA_OBJECTS = [
    "user_account_id_seq",
    "users_account_id_idx",
    "users_username_lower_idx",
    "users_email_lower_idx",
    "users_plan_id_idx",
    "sessions_user_id_idx",
    "sessions_expires_at_idx",
    "account_deletion_requests_user_pending_idx",
    "account_deletion_requests_user_created_idx",
    "account_deletion_requests_status_created_idx",
    "rate_limits_reset_idx",
    "email_codes_lookup_idx",
    "quota_usage_date_idx",
    "point_records_user_created_idx",
    "point_records_idempotency_idx",
    "point_records_refund_source_idx",
    "daily_plan_point_wallets_assignment_idx",
    "billing_products_plan_idx",
    "billing_products_enabled_idx",
    "promotion_campaigns_active_idx",
    "promotion_products_product_idx",
    "coupon_templates_code_idx",
    "coupon_templates_active_idx",
    "coupon_template_products_product_idx",
    "billing_orders_user_created_idx",
    "billing_orders_status_created_idx",
    "billing_orders_created_idx",
    "billing_orders_pending_expires_idx",
    "billing_orders_provider_idx",
    "billing_orders_product_idx",
    "user_coupons_user_status_idx",
    "user_coupons_template_user_idx",
    "user_coupons_locked_order_idx",
    "coupon_redemptions_order_idx",
    "coupon_redemptions_coupon_idx",
    "payment_transactions_order_idx",
    "payment_transactions_user_idx",
    "payment_transactions_created_idx",
    "payment_transactions_provider_trade_idx",
    "payment_transactions_provider_payment_idx",
    "billing_refund_jobs_due_idx",
    "billing_refund_jobs_provider_refund_idx",
    "referral_codes_code_idx",
    "referral_relationships_inviter_idx",
    "referral_relationships_risk_idx",
    "referral_relationships_ip_idx",
    "referral_relationships_payment_idx",
    "referral_rewards_relationship_role_idx",
    "referral_rewards_trigger_order_idx",
    "referral_rewards_beneficiary_idx",
    "referral_rewards_due_idx",
    "referral_rewards_status_idx",
    "published_works_slug_idx",
    "published_works_owner_updated_idx",
    "published_works_lifecycle_idx",
    "published_works_gallery_featured_idx",
    "published_works_gallery_popular_idx",
    "published_work_versions_work_number_idx",
    "published_work_versions_moderation_idx",
    "published_work_versions_public_idx",
    "published_work_versions_public_category_idx",
    "published_work_versions_public_tags_idx",
    "published_work_versions_public_search_idx",
    "published_work_assets_unique_role",
    "published_work_assets_version_order_idx",
    "published_work_assets_storage_idx",
    "published_work_cases_open_unique_idx",
    "published_work_cases_admin_idx",
    "published_work_cases_work_idx",
    "published_work_likes_user_created_idx",
    "published_work_likes_work_created_idx",
    "user_follows_followed_created_idx",
    "user_follows_follower_created_idx",
    "user_blocks_blocked_created_idx",
    "user_notifications_dedup_idx",
    "user_notifications_user_created_idx",
    "user_notifications_unread_idx",
    "billing_reconciliation_runs_created_idx",
    "billing_reconciliation_runs_provider_created_idx",
    "billing_reconciliation_rows_run_idx",
    "billing_reconciliation_rows_issue_codes_gin_idx",
    "user_plan_assignments_user_active_idx",
    "user_plan_assignments_plan_idx",
    "user_plan_assignments_source_idx",
    "user_plan_assignments_source_unique_idx",
    "payment_provider_events_provider_created_idx",
    "payment_provider_events_provider_event_idx",
    "cdk_codes_status_idx",
    "cdk_codes_status_created_idx",
    "cdk_redemptions_user_id_idx",
    "announcements_visible_idx",
    "prompts_scope_updated_idx",
    "prompts_owner_updated_idx",
    "prompts_tags_gin_idx",
    "generation_logs_user_created_idx",
    "generation_logs_created_idx",
    "generation_logs_admin_filter_idx",
    "generation_logs_conversation_idx",
    "generation_log_assets_log_idx",
    "generation_tasks_user_status_idx",
    "generation_tasks_expires_idx",
    "generation_tasks_user_client_request_idx",
    "generation_tasks_owner_upstream_idx",
    "generation_tasks_image_process_source_active_idx",
    "generation_tasks_conversation_idx",
    "generation_tasks_run_idx",
    "generation_tasks_user_project_idx",
    "generation_tasks_recovery_due_idx",
    "generation_worker_heartbeats_seen_idx",
    "generation_webhook_events_received_idx",
    "creative_conversations_user_updated_idx",
    "creative_conversations_user_source_idx",
    "creative_conversations_project_idx",
    "creative_messages_conversation_sequence_idx",
    "creative_messages_run_idx",
    "creative_assets_conversation_idx",
    "creative_assets_run_idx",
    "local_media_assets_owner_created_idx",
    "local_media_assets_source_idx",
    "local_media_assets_expires_idx",
    "local_media_assets_local_created_idx",
    "local_media_assets_local_filter_idx",
    "local_media_assets_storage_provider_check",
    "local_media_assets_external_object_idx",
    "canvas_projects_user_updated_idx",
    "library_assets_user_updated_idx",
    "drama_projects_user_updated_idx",
    "drama_project_versions_user_created_idx",
    "creative_run_events_run_id_idx",
    "audit_logs_created_idx",
    "audit_logs_action_idx",
    "audit_logs_actor_user_idx",
    "audit_logs_target_idx",
    "entitlement_plans_set_updated_at",
    "app_settings_set_updated_at",
    "system_model_channels_set_updated_at",
    "users_set_updated_at",
    "daily_plan_point_wallets_set_updated_at",
    "billing_products_set_updated_at",
    "promotion_campaigns_set_updated_at",
    "coupon_templates_set_updated_at",
    "billing_orders_set_updated_at",
    "user_coupons_set_updated_at",
    "coupon_redemptions_set_updated_at",
    "payment_transactions_set_updated_at",
    "billing_refund_jobs_set_updated_at",
    "referral_programs_set_updated_at",
    "referral_codes_set_updated_at",
    "referral_relationships_set_updated_at",
    "referral_rewards_set_updated_at",
    "published_works_set_updated_at",
    "published_work_versions_set_updated_at",
    "published_work_cases_set_updated_at",
    "billing_reconciliation_runs_set_updated_at",
    "billing_reconciliation_rows_set_updated_at",
    "user_plan_assignments_set_updated_at",
    "payment_provider_events_set_updated_at",
    "cdk_codes_set_updated_at",
    "announcements_set_updated_at",
    "prompts_set_updated_at",
    "generation_logs_set_updated_at",
    "drama_projects_set_updated_at",
    "object_storage_settings_set_updated_at",
] as const;

const globalForPostgres = globalThis as typeof globalThis & {
    __dqPostgresPool?: Pool;
    __dqPostgresSchemaReady?: Promise<void>;
    __dqPostgresNotifications?: PostgresNotificationState;
    __dqPostgresObservability?: PostgresObservabilityState;
};

type PostgresQuerySample = { timestamp: string; durationMs: number; fingerprint: string; sql: string; failed: boolean };
type PostgresObservabilityState = {
    queryCount: number;
    queryErrors: number;
    slowQueries: number;
    totalDurationMs: number;
    durationSamplesMs: number[];
    recentSlowQueries: PostgresQuerySample[];
    poolAcquisitions: number;
    poolAcquisitionErrors: number;
    poolWaitSamplesMs: number[];
    poolErrors: number;
};

export type PostgresOperationalSnapshot = {
    configured: boolean;
    initialized: boolean;
    pool: { max: number; total: number; idle: number; waiting: number; acquisitions: number; acquisitionErrors: number; waitMs: PercentileSnapshot; errors: number };
    queries: { total: number; errors: number; slow: number; averageDurationMs: number; durationMs: PercentileSnapshot; recentSlow: PostgresQuerySample[] };
};

type PostgresNotificationListener = (payload: string) => void;
type PostgresNotificationState = {
    client?: Client;
    connecting?: Promise<void>;
    reconnectTimer?: ReturnType<typeof setTimeout>;
    listeners: Map<string, Set<PostgresNotificationListener>>;
};

export function getDatabaseProvider(): DatabaseProvider {
    return process.env.DQ_DATABASE_PROVIDER?.trim().toLowerCase() === "file" ? "file" : "postgres";
}

export function isPostgresDatabaseEnabled() {
    return getDatabaseProvider() === "postgres";
}

export function getPostgresConnectionString() {
    return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || "";
}

function getPostgresPool() {
    const connectionString = getPostgresConnectionString();
    if (!connectionString) throw new Error("DATABASE_URL is required when DQ_DATABASE_PROVIDER=postgres");

    if (!globalForPostgres.__dqPostgresPool) {
        const pool = new Pool({
            connectionString,
            max: normalizePoolMax(process.env.DQ_DATABASE_POOL_MAX),
            connectionTimeoutMillis: normalizeDuration(process.env.DQ_DATABASE_CONNECTION_TIMEOUT_MS, 5_000, 100, 60_000),
            idleTimeoutMillis: normalizeDuration(process.env.DQ_DATABASE_IDLE_TIMEOUT_MS, 30_000, 1_000, 600_000),
            ssl: parseBoolean(process.env.DQ_DATABASE_SSL) ? { rejectUnauthorized: false } : undefined,
        });
        pool.on?.("error", (error) => {
            postgresObservabilityState().poolErrors += 1;
            logStructured("error", "postgres.pool.error", { error });
        });
        globalForPostgres.__dqPostgresPool = pool;
    }

    return globalForPostgres.__dqPostgresPool;
}

export async function postgresQuery<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
    const sql = prefixPostgresSql(text);
    return observePostgresQuery(sql, () => getPostgresPool().query<T>(sql, values));
}

export async function withPostgresTransaction<T>(handler: (client: QueryExecutor) => Promise<T>) {
    const client = await acquirePostgresClient();
    let queryQueue = Promise.resolve();
    let queryFailed = false;
    let queryError: unknown;
    const executor: QueryExecutor = {
        query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
            const pending = queryQueue.then(async () => {
                if (queryFailed) throw queryError;
                try {
                    const sql = prefixPostgresSql(text);
                    return await observePostgresQuery(sql, () => client.query<T>(sql, values));
                } catch (error) {
                    queryFailed = true;
                    queryError = error;
                    throw error;
                }
            });
            queryQueue = pending.then(
                () => undefined,
                () => undefined,
            );
            return pending;
        },
    };
    try {
        await observePostgresQuery("BEGIN", () => client.query("BEGIN"));
        const result = await handler(executor);
        await queryQueue;
        if (queryFailed) throw queryError;
        await observePostgresQuery("COMMIT", () => client.query("COMMIT"));
        return result;
    } catch (error) {
        await queryQueue;
        await observePostgresQuery("ROLLBACK", () => client.query("ROLLBACK"));
        throw error;
    } finally {
        client.release();
    }
}

export async function subscribePostgresNotification(channel: string, listener: PostgresNotificationListener) {
    const name = normalizeNotificationChannel(channel);
    const state: PostgresNotificationState = globalForPostgres.__dqPostgresNotifications ?? (globalForPostgres.__dqPostgresNotifications = { listeners: new Map() });
    const existing = state.listeners.get(name);
    const listeners = existing || new Set<PostgresNotificationListener>();
    listeners.add(listener);
    state.listeners.set(name, listeners);
    if (state.client && !existing) await state.client.query(`LISTEN ${name}`);
    else await ensurePostgresNotificationClient(state);
    return () => {
        const current = state.listeners.get(name);
        current?.delete(listener);
        if (!current?.size) state.listeners.delete(name);
    };
}

async function ensurePostgresNotificationClient(state: PostgresNotificationState) {
    if (state.client) return;
    if (state.connecting) return state.connecting;
    const connectionString = getPostgresConnectionString();
    if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL notifications");
    const client = new Client({ connectionString, ssl: parseBoolean(process.env.DQ_DATABASE_SSL) ? { rejectUnauthorized: false } : undefined });
    state.connecting = (async () => {
        await client.connect();
        client.on("notification", (message) => {
            for (const listener of [...(state.listeners.get(message.channel) || [])]) listener(message.payload || "");
        });
        client.on("error", () => reconnectPostgresNotifications(state, client));
        for (const channel of state.listeners.keys()) await client.query(`LISTEN ${channel}`);
        state.client = client;
    })().finally(() => {
        state.connecting = undefined;
    });
    return state.connecting;
}

function reconnectPostgresNotifications(state: PostgresNotificationState, client: Client) {
    if (state.client === client) state.client = undefined;
    void client.end().catch(() => undefined);
    if (!state.listeners.size || state.reconnectTimer) return;
    state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = undefined;
        void ensurePostgresNotificationClient(state).catch(() => reconnectPostgresNotifications(state, client));
    }, 1_000);
    state.reconnectTimer.unref?.();
}

function normalizeNotificationChannel(value: string) {
    const channel = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(channel)) throw new Error("Invalid PostgreSQL notification channel");
    return channel;
}

export async function ensurePostgresSchema() {
    if (globalForPostgres.__dqPostgresSchemaReady) return globalForPostgres.__dqPostgresSchemaReady;

    const result = await postgresQuery<{ table_name: string | null }>("SELECT to_regclass('public.dq_users')::text AS table_name");
    if (!result.rows[0]?.table_name) throw new Error("PostgreSQL schema has not been initialized");

    return initializePostgresSchema();
}

export async function initializePostgresSchema() {
    if (!globalForPostgres.__dqPostgresSchemaReady) {
        globalForPostgres.__dqPostgresSchemaReady = postgresQuery(POSTGRESQL_SCHEMA_SQL)
            .then(() => undefined)
            .catch((error) => {
                globalForPostgres.__dqPostgresSchemaReady = undefined;
                throw error;
            });
    }
    return globalForPostgres.__dqPostgresSchemaReady;
}

function prefixPostgresSql(sql: string) {
    let next = sql;
    for (const objectName of POSTGRES_SCHEMA_OBJECTS) {
        next = next.replace(new RegExp(`(?<!${POSTGRES_TABLE_PREFIX})\\b${objectName}\\b`, "g"), `${POSTGRES_TABLE_PREFIX}${objectName}`);
    }
    for (const table of POSTGRES_TABLES) {
        next = next.replace(new RegExp(`(?<!${POSTGRES_TABLE_PREFIX})\\b${table}\\b`, "g"), `${POSTGRES_TABLE_PREFIX}${table}`);
    }
    return next;
}

function normalizePoolMax(value: string | undefined) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(50, Math.floor(parsed)) : 10;
}

export function getPostgresOperationalSnapshot(): PostgresOperationalSnapshot {
    const state = postgresObservabilityState();
    const pool = globalForPostgres.__dqPostgresPool;
    return {
        configured: Boolean(getPostgresConnectionString()),
        initialized: Boolean(pool),
        pool: {
            max: normalizePoolMax(process.env.DQ_DATABASE_POOL_MAX),
            total: pool?.totalCount || 0,
            idle: pool?.idleCount || 0,
            waiting: pool?.waitingCount || 0,
            acquisitions: state.poolAcquisitions,
            acquisitionErrors: state.poolAcquisitionErrors,
            waitMs: percentiles(state.poolWaitSamplesMs),
            errors: state.poolErrors,
        },
        queries: {
            total: state.queryCount,
            errors: state.queryErrors,
            slow: state.slowQueries,
            averageDurationMs: state.queryCount ? Math.round(state.totalDurationMs / state.queryCount) : 0,
            durationMs: percentiles(state.durationSamplesMs),
            recentSlow: [...state.recentSlowQueries],
        },
    };
}

async function acquirePostgresClient() {
    const startedAt = performance.now();
    const state = postgresObservabilityState();
    try {
        const client = await getPostgresPool().connect();
        state.poolAcquisitions += 1;
        pushMetricSample(state.poolWaitSamplesMs, performance.now() - startedAt);
        return client;
    } catch (error) {
        const durationMs = performance.now() - startedAt;
        state.poolAcquisitions += 1;
        state.poolAcquisitionErrors += 1;
        pushMetricSample(state.poolWaitSamplesMs, durationMs);
        logStructured("error", "postgres.pool.acquire_failed", { durationMs: Math.round(durationMs), error });
        throw error;
    }
}

async function observePostgresQuery<T>(sql: string, execute: () => Promise<T>) {
    const startedAt = performance.now();
    try {
        const result = await execute();
        recordPostgresQuery(sql, performance.now() - startedAt, false);
        return result;
    } catch (error) {
        const durationMs = performance.now() - startedAt;
        recordPostgresQuery(sql, durationMs, true);
        if (!isExpectedDatabaseConfigurationError(error)) logStructured("error", "postgres.query.failed", queryLogFields(sql, durationMs, { error }));
        throw error;
    }
}

function recordPostgresQuery(sql: string, duration: number, failed: boolean) {
    const state = postgresObservabilityState();
    const durationMs = Math.max(0, Math.round(duration));
    state.queryCount += 1;
    state.totalDurationMs += durationMs;
    if (failed) state.queryErrors += 1;
    pushMetricSample(state.durationSamplesMs, durationMs);
    if (durationMs < normalizeDuration(process.env.DQ_DATABASE_SLOW_QUERY_MS, 500, 10, 600_000)) return;
    state.slowQueries += 1;
    const sample = { timestamp: new Date().toISOString(), durationMs, ...queryIdentity(sql), failed };
    state.recentSlowQueries.push(sample);
    if (state.recentSlowQueries.length > 20) state.recentSlowQueries.splice(0, state.recentSlowQueries.length - 20);
    logStructured("warn", "postgres.query.slow", sample);
}

function queryLogFields(sql: string, durationMs: number, extra: Record<string, unknown>) {
    return { durationMs: Math.max(0, Math.round(durationMs)), ...queryIdentity(sql), ...extra };
}

function queryIdentity(sql: string) {
    const normalized = normalizeSqlForLog(sql);
    return { fingerprint: stableFingerprint(normalized), sql: normalized };
}

function postgresObservabilityState() {
    return (globalForPostgres.__dqPostgresObservability ??= {
        queryCount: 0,
        queryErrors: 0,
        slowQueries: 0,
        totalDurationMs: 0,
        durationSamplesMs: [],
        recentSlowQueries: [],
        poolAcquisitions: 0,
        poolAcquisitionErrors: 0,
        poolWaitSamplesMs: [],
        poolErrors: 0,
    });
}

function pushMetricSample(samples: number[], value: number) {
    samples.push(Math.max(0, Math.round(value)));
    if (samples.length > 2_000) samples.splice(0, samples.length - 2_000);
}

function normalizeDuration(value: string | undefined, fallback: number, minimum: number, maximum: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}

function isExpectedDatabaseConfigurationError(error: unknown) {
    return error instanceof Error && /^DATABASE_URL is required/.test(error.message);
}

function parseBoolean(value: string | undefined) {
    return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() || "");
}
