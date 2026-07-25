import { Pool, type QueryResult, type QueryResultRow } from "pg";

import { POSTGRESQL_SCHEMA_SQL } from "@/lib/server/database/schema";

type DatabaseProvider = "file" | "postgres";

export type QueryExecutor = {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
};

const POSTGRES_TABLE_PREFIX = "vozeb_pro_";
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
    "billing_orders",
    "payment_transactions",
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
    "billing_orders_user_created_idx",
    "billing_orders_status_created_idx",
    "billing_orders_pending_expires_idx",
    "billing_orders_provider_idx",
    "billing_orders_product_idx",
    "payment_transactions_order_idx",
    "payment_transactions_user_idx",
    "payment_transactions_provider_trade_idx",
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
    "cdk_redemptions_user_id_idx",
    "announcements_visible_idx",
    "prompts_scope_updated_idx",
    "prompts_owner_updated_idx",
    "prompts_tags_gin_idx",
    "generation_logs_user_created_idx",
    "generation_logs_admin_filter_idx",
    "generation_logs_conversation_idx",
    "generation_log_assets_log_idx",
    "generation_tasks_user_status_idx",
    "generation_tasks_expires_idx",
    "generation_tasks_user_client_request_idx",
    "generation_tasks_conversation_idx",
    "generation_tasks_run_idx",
    "creative_conversations_user_updated_idx",
    "creative_conversations_project_idx",
    "creative_messages_conversation_sequence_idx",
    "creative_messages_run_idx",
    "creative_assets_conversation_idx",
    "creative_assets_run_idx",
    "local_media_assets_owner_created_idx",
    "local_media_assets_source_idx",
    "local_media_assets_expires_idx",
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
    "billing_orders_set_updated_at",
    "payment_transactions_set_updated_at",
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
    __vozebProPostgresPool?: Pool;
    __vozebProPostgresSchemaReady?: Promise<void>;
};

export function getDatabaseProvider(): DatabaseProvider {
    return process.env.VOZEB_PRO_DATABASE_PROVIDER?.trim().toLowerCase() === "file" ? "file" : "postgres";
}

export function isPostgresDatabaseEnabled() {
    return getDatabaseProvider() === "postgres";
}

export function getPostgresConnectionString() {
    return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || "";
}

function getPostgresPool() {
    const connectionString = getPostgresConnectionString();
    if (!connectionString) throw new Error("DATABASE_URL is required when VOZEB_PRO_DATABASE_PROVIDER=postgres");

    if (!globalForPostgres.__vozebProPostgresPool) {
        globalForPostgres.__vozebProPostgresPool = new Pool({
            connectionString,
            max: normalizePoolMax(process.env.VOZEB_PRO_DATABASE_POOL_MAX),
            ssl: parseBoolean(process.env.VOZEB_PRO_DATABASE_SSL) ? { rejectUnauthorized: false } : undefined,
        });
    }

    return globalForPostgres.__vozebProPostgresPool;
}

export async function postgresQuery<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
    return getPostgresPool().query<T>(prefixPostgresSql(text), values);
}

export async function withPostgresTransaction<T>(handler: (client: QueryExecutor) => Promise<T>) {
    const client = await getPostgresPool().connect();
    const executor: QueryExecutor = {
        query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
            return client.query<T>(prefixPostgresSql(text), values);
        },
    };
    try {
        await client.query("BEGIN");
        const result = await handler(executor);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function ensurePostgresSchema() {
    if (globalForPostgres.__vozebProPostgresSchemaReady) return globalForPostgres.__vozebProPostgresSchemaReady;

    const result = await getPostgresPool().query<{ table_name: string | null }>("SELECT to_regclass('public.vozeb_pro_users')::text AS table_name");
    if (!result.rows[0]?.table_name) throw new Error("PostgreSQL schema has not been initialized");

    return initializePostgresSchema();
}

export async function initializePostgresSchema() {
    if (!globalForPostgres.__vozebProPostgresSchemaReady) {
        globalForPostgres.__vozebProPostgresSchemaReady = getPostgresPool()
            .query(prefixPostgresSql(POSTGRESQL_SCHEMA_SQL))
            .then(() => undefined)
            .catch((error) => {
                globalForPostgres.__vozebProPostgresSchemaReady = undefined;
                throw error;
            });
    }
    return globalForPostgres.__vozebProPostgresSchemaReady;
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

function parseBoolean(value: string | undefined) {
    return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() || "");
}
