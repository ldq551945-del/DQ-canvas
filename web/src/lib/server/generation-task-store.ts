import { getDatabaseProvider, ensurePostgresSchema, postgresQuery, withPostgresTransaction } from "@/lib/server/database";
import { readJsonDataFile, writeJsonDataFile } from "@/lib/server/data-adapter";

export type GenerationTaskType = "text" | "image" | "video" | "audio" | "agent" | "render";
type GenerationTaskStatus = "pending" | "running" | "success" | "error" | "paused" | "cancelled";

export type GenerationTaskContext = {
    conversationId?: string;
    runId?: string;
    surface?: "chat" | "canvas" | "drama";
    projectId?: string;
    episodeId?: string;
    shotId?: string;
    estimatedPoints?: number;
    parentTaskId?: string;
    attemptNo?: number;
    clientRequestId?: string;
};

export type StoredGenerationTaskRecord = {
    id: string;
    userId: string;
    type: GenerationTaskType;
    status: GenerationTaskStatus;
    payload: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
} & GenerationTaskContext;

export type GenerationTaskRecordListOptions = {
    page?: number;
    pageSize?: number;
    type?: string;
    status?: string;
    surface?: string;
    projectId?: string;
    userId?: string;
    search?: string;
    includeAll?: boolean;
};

export type GenerationTaskRecordSummary = {
    total: number;
    active: number;
    success: number;
    failed: number;
    averageDurationMs: number;
    totalPointsCost: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
};

type GenerationTaskSummaryAccumulator = Omit<GenerationTaskRecordSummary, "averageDurationMs"> & {
    averageDurationMs: number;
    completedCount: number;
};

const TASK_FILE = "generation-tasks.json";
let fileMutationQueue = Promise.resolve();
const concurrencyQueues = new Map<string, Promise<void>>();

export async function createStoredGenerationTask<T extends { id: string; userId: string; status: string; createdAt: number; updatedAt: number }>(type: GenerationTaskType, task: T, ttlMs: number) {
    await cleanupStoredGenerationTasks();
    return insertTask(type, task, ttlMs);
}

export async function getStoredGenerationTask<T>(type: GenerationTaskType, id: string): Promise<T | null> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ payload: T }>("SELECT payload FROM generation_tasks WHERE id = $1 AND task_type = $2 AND expires_at > now()", [id, type]);
        return result.rows[0]?.payload || null;
    }
    const tasks = await readFileTasks();
    return (tasks.find((task) => task.id === id && task.type === type && task.expiresAt > Date.now())?.payload as T | undefined) || null;
}

export async function getStoredGenerationTaskByRequest<T>(type: GenerationTaskType, userId: string, clientRequestId: string, attemptNo?: number): Promise<T | null> {
    const requestId = cleanContextText(clientRequestId);
    if (!requestId) return null;
    const attempt = normalizedAttemptNo(attemptNo);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ payload: T }>("SELECT payload FROM generation_tasks WHERE user_id = $1 AND task_type = $2 AND client_request_id = $3 AND COALESCE(attempt_no, 0) = $4 AND expires_at > now() LIMIT 1", [
            userId,
            type,
            requestId,
            attempt,
        ]);
        return result.rows[0]?.payload || null;
    }
    const tasks = await readFileTasks();
    return (tasks.find((task) => sameTaskRequest(task, type, userId, requestId, attempt) && task.expiresAt > Date.now())?.payload as T | undefined) || null;
}

export async function listStoredGenerationTasks<T>(type: GenerationTaskType, userId: string, limit = 20): Promise<T[]> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ payload: T }>("SELECT payload FROM generation_tasks WHERE user_id = $1 AND task_type = $2 AND expires_at > now() ORDER BY updated_at DESC LIMIT $3", [userId, type, Math.max(1, Math.min(100, limit))]);
        return result.rows.map((row) => row.payload);
    }
    const tasks = await readFileTasks();
    return tasks
        .filter((task) => task.userId === userId && task.type === type && task.expiresAt > Date.now())
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, Math.max(1, Math.min(100, limit)))
        .map((task) => task.payload as T);
}

export async function listStoredGenerationTaskRecords(options: GenerationTaskRecordListOptions = {}) {
    let records: StoredGenerationTaskRecord[];
    let databaseTotal = 0;
    let summary: GenerationTaskRecordSummary | null = null;
    const projectId = options.projectId?.trim() || null;
    const page = Math.max(1, Math.floor(Number(options.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(options.pageSize) || 20)));
    const includeAll = options.includeAll !== false;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const type = isTaskType(options.type) ? options.type : null;
        const status = isTaskStatus(options.status) ? options.status : null;
        const surface = isTaskSurface(options.surface) ? options.surface : null;
        const userId = options.userId?.trim() || null;
        const search = (options.search || "").trim().slice(0, 160);
        const params = [type, status, surface, projectId, userId, search];
        if (!includeAll) {
            const [pageResult, summaryResult] = await Promise.all([
                postgresQuery<Record<string, unknown>>(
                    `${generationTaskSelect()}
                     ${generationTaskWhere()}
                     ORDER BY updated_at DESC
                     LIMIT $7 OFFSET $8`,
                    [...params, pageSize, (page - 1) * pageSize],
                ),
                postgresQuery<Record<string, unknown>>(`${generationTaskSummarySelect()} ${generationTaskWhere()} GROUP BY task_type, status`, params),
            ]);
            records = pageResult.rows.map(mapStoredTaskRecord);
            summary = mapGenerationTaskSummary(summaryResult.rows);
            return { items: records, total: summary.total, page, pageSize, all: [], summary };
        }
        const result = await postgresQuery<Record<string, unknown>>(
            `${generationTaskSelect()}
             ${generationTaskWhere()}
             ORDER BY updated_at DESC
             LIMIT 5000`,
            params,
        );
        databaseTotal = Number(result.rows[0]?.total_count || 0);
        records = result.rows.map(mapStoredTaskRecord);
    } else {
        records = (await readFileTasks()).filter((record) => record.expiresAt > Date.now());
    }
    const search = (options.search || "").trim().toLowerCase();
    const filtered = records
        .filter((record) => (isTaskType(options.type) ? record.type === options.type : true))
        .filter((record) => (isTaskStatus(options.status) ? record.status === options.status : true))
        .filter((record) => (isTaskSurface(options.surface) ? record.surface === options.surface : true))
        .filter((record) => (projectId ? record.projectId === projectId : true))
        .filter((record) => (options.userId ? record.userId === options.userId : true))
        .filter(
            (record) =>
                !search ||
                [record.id, record.userId, record.conversationId, record.runId, record.projectId, JSON.stringify(record.payload)].some((value) =>
                    String(value || "")
                        .toLowerCase()
                        .includes(search),
                ),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = (page - 1) * pageSize;
    summary = summarizeGenerationTaskRecords(filtered);
    return { items: filtered.slice(offset, offset + pageSize), total: databaseTotal || summary.total, page, pageSize, all: includeAll ? filtered : [], summary };
}

export function generationTaskPointsCost(payload: Record<string, unknown>) {
    const config = recordObject(payload.config);
    const upstream = recordObject(payload.upstream);
    const tasks = Array.isArray(payload.tasks) ? payload.tasks.map(recordObject) : [];
    return positiveNumber(payload.pointsCost, recordObject(payload.billing).pointsCost, upstream.pointsCost) || tasks.reduce((total, task) => total + positiveNumber(task.pointsCost, recordObject(task.billing).pointsCost), 0);
}

function generationTaskSelect() {
    return `SELECT generation_tasks.*, count(*) OVER() AS total_count FROM generation_tasks`;
}

function generationTaskWhere() {
    return `WHERE expires_at > now()
              AND ($1::text IS NULL OR task_type = $1)
              AND ($2::text IS NULL OR status = $2)
              AND ($3::text IS NULL OR surface = $3)
              AND ($4::text IS NULL OR project_id = $4)
              AND ($5::text IS NULL OR user_id = $5)
              AND (
                  $6 = ''
                  OR id ILIKE '%' || $6 || '%'
                  OR user_id ILIKE '%' || $6 || '%'
                  OR coalesce(conversation_id, '') ILIKE '%' || $6 || '%'
                  OR coalesce(run_id, '') ILIKE '%' || $6 || '%'
                  OR coalesce(project_id, '') ILIKE '%' || $6 || '%'
                  OR payload::text ILIKE '%' || $6 || '%'
              )`;
}

function generationTaskSummarySelect() {
    return `SELECT
                task_type,
                status,
                count(*)::int AS total,
                count(*) FILTER (WHERE status IN ('success', 'error', 'cancelled'))::int AS completed_total,
                coalesce(sum(CASE WHEN status IN ('success', 'error', 'cancelled') THEN greatest(0, extract(epoch FROM updated_at - created_at) * 1000) ELSE 0 END), 0) AS duration_total_ms,
                coalesce(sum(${generationTaskPointsSql()}), 0) AS points_cost
            FROM generation_tasks`;
}

function generationTaskPointsSql() {
    return `coalesce(
                ${numericJsonValue("payload->>'pointsCost'")},
                ${numericJsonValue("payload#>>'{billing,pointsCost}'")},
                ${numericJsonValue("payload#>>'{upstream,pointsCost}'")},
                (SELECT coalesce(sum(${numericJsonValue("task->>'pointsCost'")}), 0)
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload->'tasks') = 'array' THEN payload->'tasks' ELSE '[]'::jsonb END) AS task),
                0
            )`;
}

function numericJsonValue(expression: string) {
    return `CASE WHEN coalesce(${expression}, '') ~ '^[0-9]+(?:\\.[0-9]+)?$' THEN (${expression})::numeric ELSE NULL END`;
}

function summarizeGenerationTaskRecords(records: StoredGenerationTaskRecord[]): GenerationTaskRecordSummary {
    const summary = emptyGenerationTaskSummary();
    for (const record of records) {
        summary.total += 1;
        summary.byType[record.type] = (summary.byType[record.type] || 0) + 1;
        summary.byStatus[record.status] = (summary.byStatus[record.status] || 0) + 1;
        if (record.status === "pending" || record.status === "running" || record.status === "paused") summary.active += 1;
        if (record.status === "success") summary.success += 1;
        if (record.status === "error") summary.failed += 1;
        if (record.status === "success" || record.status === "error" || record.status === "cancelled") {
            summary.averageDurationMs += Math.max(0, record.updatedAt - record.createdAt);
            summary.completedCount += 1;
        }
        summary.totalPointsCost += generationTaskPointsCost(record.payload);
    }
    return finalizeGenerationTaskSummary(summary);
}

function mapGenerationTaskSummary(rows: Array<Record<string, unknown>>): GenerationTaskRecordSummary {
    const summary = emptyGenerationTaskSummary();
    for (const row of rows) {
        const type = isTaskType(row.task_type) ? row.task_type : "agent";
        const status = isTaskStatus(row.status) ? row.status : "error";
        const total = Math.max(0, Math.floor(Number(row.total) || 0));
        summary.total += total;
        summary.byType[type] = (summary.byType[type] || 0) + total;
        summary.byStatus[status] = (summary.byStatus[status] || 0) + total;
        if (status === "pending" || status === "running" || status === "paused") summary.active += total;
        if (status === "success") summary.success += total;
        if (status === "error") summary.failed += total;
        summary.completedCount += Math.max(0, Math.floor(Number(row.completed_total) || 0));
        summary.averageDurationMs += Math.max(0, Number(row.duration_total_ms) || 0);
        summary.totalPointsCost += Math.max(0, Number(row.points_cost) || 0);
    }
    return finalizeGenerationTaskSummary(summary);
}

function emptyGenerationTaskSummary(): GenerationTaskSummaryAccumulator {
    return { total: 0, active: 0, success: 0, failed: 0, averageDurationMs: 0, completedCount: 0, totalPointsCost: 0, byType: {}, byStatus: {} };
}

function finalizeGenerationTaskSummary(summary: GenerationTaskSummaryAccumulator): GenerationTaskRecordSummary {
    return {
        total: summary.total,
        active: summary.active,
        success: summary.success,
        failed: summary.failed,
        averageDurationMs: summary.completedCount ? Math.round(summary.averageDurationMs / summary.completedCount) : 0,
        totalPointsCost: Number(summary.totalPointsCost.toFixed(2)),
        byType: summary.byType,
        byStatus: summary.byStatus,
    };
}

export async function updateStoredGenerationTask<T extends { id: string; userId: string; status: string; createdAt: number; updatedAt: number }>(type: GenerationTaskType, task: T, ttlMs: number) {
    await upsertTask(type, task, ttlMs);
    return task;
}

export async function transitionStoredGenerationTask<T extends { id: string; userId: string; status: string; createdAt: number; updatedAt: number }>(
    type: GenerationTaskType,
    id: string,
    userId: string,
    allowedStatuses: string[],
    patch: Partial<T> & { status: string },
    ttlMs: number,
): Promise<T | null> {
    const updatedAt = Date.now();
    const nextPatch = { ...patch, updatedAt };
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ payload: T }>(
            `UPDATE generation_tasks
             SET status = $5, payload = payload || $6::jsonb, updated_at = $7, expires_at = $8
             WHERE id = $1 AND task_type = $2 AND user_id = $3 AND status = ANY($4::text[]) AND expires_at > now()
             RETURNING payload`,
            [id, type, userId, allowedStatuses.map(normalizeGenerationTaskStatus), normalizeGenerationTaskStatus(patch.status), JSON.stringify(nextPatch), new Date(updatedAt), new Date(updatedAt + ttlMs)],
        );
        return result.rows[0]?.payload || null;
    }
    let transitioned: T | null = null;
    const allowed = new Set(allowedStatuses.map(normalizeGenerationTaskStatus));
    await mutateFileTasks((tasks) =>
        tasks.map((record) => {
            if (record.id !== id || record.type !== type || record.userId !== userId || record.expiresAt <= updatedAt || !allowed.has(record.status)) return record;
            transitioned = { ...(record.payload as T), ...nextPatch };
            return { ...record, status: normalizeGenerationTaskStatus(patch.status), payload: transitioned as unknown as Record<string, unknown>, updatedAt, expiresAt: updatedAt + ttlMs };
        }),
    );
    return transitioned;
}

export async function mutateStoredGenerationTask<T extends { id: string; userId: string; status: string; createdAt: number; updatedAt: number }>(type: GenerationTaskType, id: string, ttlMs: number, mutate: (current: T) => T | null): Promise<T | null> {
    const updatedAt = Date.now();
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => {
            const result = await client.query<{ payload: T }>("SELECT payload FROM generation_tasks WHERE id = $1 AND task_type = $2 AND expires_at > now() FOR UPDATE", [id, type]);
            const current = result.rows[0]?.payload;
            if (!current) return null;
            const next = normalizeMutation(current, mutate(current), updatedAt);
            if (!next) return null;
            const updated = await client.query<{ payload: T }>(
                `UPDATE generation_tasks
                 SET status = $3, payload = $4::jsonb, updated_at = $5, expires_at = $6
                 WHERE id = $1 AND task_type = $2
                 RETURNING payload`,
                [id, type, normalizeGenerationTaskStatus(next.status), JSON.stringify(next), new Date(updatedAt), new Date(updatedAt + ttlMs)],
            );
            return updated.rows[0]?.payload || null;
        });
    }
    let mutated: T | null = null;
    await mutateFileTasks((tasks) =>
        tasks.map((record) => {
            if (record.id !== id || record.type !== type || record.expiresAt <= updatedAt) return record;
            const current = record.payload as T;
            const next = normalizeMutation(current, mutate(current), updatedAt);
            if (!next) return record;
            mutated = next;
            return { ...record, status: normalizeGenerationTaskStatus(next.status), payload: next as unknown as Record<string, unknown>, updatedAt, expiresAt: updatedAt + ttlMs };
        }),
    );
    return mutated;
}

export async function touchStoredGenerationTask(type: GenerationTaskType, id: string, updatedAt: number, ttlMs: number) {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        await postgresQuery("UPDATE generation_tasks SET updated_at = $3, expires_at = $4, payload = jsonb_set(payload, '{updatedAt}', to_jsonb($5::bigint)) WHERE id = $1 AND task_type = $2", [
            id,
            type,
            new Date(updatedAt),
            new Date(updatedAt + ttlMs),
            updatedAt,
        ]);
        return;
    }
    await mutateFileTasks((tasks) => tasks.map((task) => (task.id === id && task.type === type ? { ...task, updatedAt, expiresAt: updatedAt + ttlMs, payload: { ...task.payload, updatedAt } } : task)));
}

export async function linkStoredGenerationTask(type: GenerationTaskType, id: string, context: GenerationTaskContext) {
    const normalized = normalizeGenerationTaskContext(context);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        await postgresQuery(
            `UPDATE generation_tasks
             SET conversation_id = COALESCE($3, conversation_id), run_id = COALESCE($4, run_id), surface = COALESCE($5, surface),
                 project_id = COALESCE($6, project_id), parent_task_id = COALESCE($7, parent_task_id), attempt_no = COALESCE($8, attempt_no),
                 client_request_id = COALESCE($9, client_request_id), payload = payload || $10::jsonb
             WHERE id = $1 AND task_type = $2`,
            [
                id,
                type,
                normalized.conversationId || null,
                normalized.runId || null,
                normalized.surface || null,
                normalized.projectId || null,
                normalized.parentTaskId || null,
                normalized.attemptNo ?? null,
                normalized.clientRequestId || null,
                JSON.stringify(normalized),
            ],
        );
        return;
    }
    await mutateFileTasks((tasks) => tasks.map((task) => (task.id === id && task.type === type ? { ...task, ...normalized, payload: { ...task.payload, ...normalized } } : task)));
}

export async function countActiveStoredGenerationTasks(userId: string, type: GenerationTaskType, staleMs: number) {
    const activeAfter = Date.now() - staleMs;
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const result = await postgresQuery<{ total: string | number }>("SELECT count(*) AS total FROM generation_tasks WHERE user_id = $1 AND task_type = $2 AND status IN ('pending', 'running') AND updated_at >= $3 AND expires_at > now()", [
            userId,
            type,
            new Date(activeAfter),
        ]);
        return Number(result.rows[0]?.total || 0);
    }
    const tasks = await readFileTasks();
    return tasks.filter((task) => task.userId === userId && task.type === type && ["pending", "running"].includes(task.status) && task.updatedAt >= activeAfter && task.expiresAt > Date.now()).length;
}

export async function withGenerationConcurrencyLimit<T>(userId: string, type: GenerationTaskType, staleMs: number, limit: number, handler: () => Promise<T>): Promise<T | null> {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => {
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [userId, type]);
            const result = await client.query<{ total: string | number }>("SELECT count(*) AS total FROM generation_tasks WHERE user_id = $1 AND task_type = $2 AND status IN ('pending', 'running') AND updated_at >= $3 AND expires_at > now()", [
                userId,
                type,
                new Date(Date.now() - staleMs),
            ]);
            return Number(result.rows[0]?.total || 0) >= limit ? null : handler();
        });
    }

    const key = `${userId}:${type}`;
    const previous = concurrencyQueues.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const queued = previous.then(() => current);
    concurrencyQueues.set(key, queued);
    await previous;
    try {
        return (await countActiveStoredGenerationTasks(userId, type, staleMs)) >= limit ? null : handler();
    } finally {
        release();
        if (concurrencyQueues.get(key) === queued) concurrencyQueues.delete(key);
    }
}

async function upsertTask<T extends { id: string; userId: string; status: string; createdAt: number; updatedAt: number }>(type: GenerationTaskType, task: T, ttlMs: number) {
    const status = normalizeGenerationTaskStatus(task.status);
    const context = normalizeGenerationTaskContext(task as GenerationTaskContext);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        await postgresQuery(
            `INSERT INTO generation_tasks (
                id, user_id, task_type, status, payload, created_at, updated_at, expires_at,
                conversation_id, run_id, surface, project_id, parent_task_id, attempt_no, client_request_id
             )
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at, expires_at = EXCLUDED.expires_at,
                conversation_id = COALESCE(EXCLUDED.conversation_id, generation_tasks.conversation_id),
                run_id = COALESCE(EXCLUDED.run_id, generation_tasks.run_id), surface = COALESCE(EXCLUDED.surface, generation_tasks.surface),
                project_id = COALESCE(EXCLUDED.project_id, generation_tasks.project_id), parent_task_id = COALESCE(EXCLUDED.parent_task_id, generation_tasks.parent_task_id),
                attempt_no = COALESCE(EXCLUDED.attempt_no, generation_tasks.attempt_no), client_request_id = COALESCE(EXCLUDED.client_request_id, generation_tasks.client_request_id)`,
            [
                task.id,
                task.userId,
                type,
                status,
                JSON.stringify(task),
                new Date(task.createdAt),
                new Date(task.updatedAt),
                new Date(task.updatedAt + ttlMs),
                context.conversationId || null,
                context.runId || null,
                context.surface || null,
                context.projectId || null,
                context.parentTaskId || null,
                context.attemptNo ?? null,
                context.clientRequestId || null,
            ],
        );
        return;
    }
    await mutateFileTasks((tasks) => {
        const previous = tasks.find((item) => item.id === task.id);
        const record: StoredGenerationTaskRecord = {
            id: task.id,
            userId: task.userId,
            type,
            status,
            payload: task as unknown as Record<string, unknown>,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            expiresAt: task.updatedAt + ttlMs,
            ...preserveTaskContext(previous, context),
        };
        return [record, ...tasks.filter((item) => item.id !== task.id)];
    });
}

async function insertTask<T extends { id: string; userId: string; status: string; createdAt: number; updatedAt: number }>(type: GenerationTaskType, task: T, ttlMs: number): Promise<T> {
    const status = normalizeGenerationTaskStatus(task.status);
    const context = normalizeGenerationTaskContext(task as GenerationTaskContext);
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        const values = taskValues(type, task, ttlMs, status, context);
        const inserted = await postgresQuery<{ payload: T }>(
            `INSERT INTO generation_tasks (
                id, user_id, task_type, status, payload, created_at, updated_at, expires_at,
                conversation_id, run_id, surface, project_id, parent_task_id, attempt_no, client_request_id
             )
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT DO NOTHING
             RETURNING payload`,
            values,
        );
        if (inserted.rows[0]?.payload) return inserted.rows[0].payload;
        const existing = context.clientRequestId ? await getStoredGenerationTaskByRequest<T>(type, task.userId, context.clientRequestId, context.attemptNo) : await getStoredGenerationTask<T>(type, task.id);
        if (existing) return existing;
        throw new Error("生成任务写入冲突，请重试");
    }
    return withGenerationTaskFileMutation(async (tasks) => {
        const duplicate = tasks.find((item) => item.id === task.id || (context.clientRequestId && sameTaskRequest(item, type, task.userId, context.clientRequestId, normalizedAttemptNo(context.attemptNo))));
        if (duplicate) return { tasks, result: duplicate.payload as T };
        const record: StoredGenerationTaskRecord = {
            id: task.id,
            userId: task.userId,
            type,
            status,
            payload: task as unknown as Record<string, unknown>,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            expiresAt: task.updatedAt + ttlMs,
            ...context,
        };
        return { tasks: [record, ...tasks], result: task };
    });
}

function taskValues<T extends { id: string; userId: string; createdAt: number; updatedAt: number }>(type: GenerationTaskType, task: T, ttlMs: number, status: GenerationTaskStatus, context: GenerationTaskContext) {
    return [
        task.id,
        task.userId,
        type,
        status,
        JSON.stringify(task),
        new Date(task.createdAt),
        new Date(task.updatedAt),
        new Date(task.updatedAt + ttlMs),
        context.conversationId || null,
        context.runId || null,
        context.surface || null,
        context.projectId || null,
        context.parentTaskId || null,
        context.attemptNo ?? null,
        context.clientRequestId || null,
    ];
}

async function cleanupStoredGenerationTasks() {
    if (getDatabaseProvider() === "postgres") {
        await ensurePostgresSchema();
        await postgresQuery("DELETE FROM generation_tasks WHERE expires_at <= now()");
        return;
    }
    await mutateFileTasks((tasks) => tasks.filter((task) => task.expiresAt > Date.now()));
}

async function readFileTasks() {
    return readJsonDataFile<StoredGenerationTaskRecord[]>(TASK_FILE, []);
}

function mutateFileTasks(mutator: (tasks: StoredGenerationTaskRecord[]) => StoredGenerationTaskRecord[]) {
    return withGenerationTaskFileMutation(async (tasks) => ({ tasks: mutator(tasks), result: undefined }));
}

export function withGenerationTaskFileMutation<T>(mutator: (tasks: StoredGenerationTaskRecord[]) => Promise<{ tasks: StoredGenerationTaskRecord[]; result: T }>) {
    const run = fileMutationQueue.then(async () => {
        const mutation = await mutator(await readFileTasks());
        await writeJsonDataFile(TASK_FILE, mutation.tasks);
        return mutation.result;
    });
    fileMutationQueue = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

function normalizeGenerationTaskContext(context: GenerationTaskContext): GenerationTaskContext {
    const attempt = Number(context.attemptNo);
    return {
        conversationId: cleanContextText(context.conversationId),
        runId: cleanContextText(context.runId),
        surface: context.surface === "chat" || context.surface === "canvas" || context.surface === "drama" ? context.surface : undefined,
        projectId: cleanContextText(context.projectId),
        episodeId: cleanContextText(context.episodeId),
        shotId: cleanContextText(context.shotId),
        estimatedPoints: positiveContextNumber(context.estimatedPoints),
        parentTaskId: cleanContextText(context.parentTaskId),
        attemptNo: Number.isFinite(attempt) && attempt >= 0 ? Math.floor(attempt) : undefined,
        clientRequestId: cleanContextText(context.clientRequestId),
    };
}

function preserveTaskContext(previous: StoredGenerationTaskRecord | undefined, next: GenerationTaskContext): GenerationTaskContext {
    return {
        conversationId: next.conversationId || previous?.conversationId,
        runId: next.runId || previous?.runId,
        surface: next.surface || previous?.surface,
        projectId: next.projectId || previous?.projectId,
        episodeId: next.episodeId || previous?.episodeId,
        shotId: next.shotId || previous?.shotId,
        estimatedPoints: next.estimatedPoints ?? previous?.estimatedPoints,
        parentTaskId: next.parentTaskId || previous?.parentTaskId,
        attemptNo: next.attemptNo ?? previous?.attemptNo,
        clientRequestId: next.clientRequestId || previous?.clientRequestId,
    };
}

function cleanContextText(value?: string) {
    return value?.trim().slice(0, 160) || undefined;
}

function normalizedAttemptNo(value: unknown) {
    const attempt = Number(value);
    return Number.isFinite(attempt) && attempt >= 0 ? Math.floor(attempt) : 0;
}

function sameTaskRequest(task: StoredGenerationTaskRecord, type: GenerationTaskType, userId: string, clientRequestId: string, attemptNo: number) {
    return task.type === type && task.userId === userId && task.clientRequestId === clientRequestId && normalizedAttemptNo(task.attemptNo) === attemptNo;
}

function positiveContextNumber(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Number(number.toFixed(2)) : undefined;
}

function normalizeGenerationTaskStatus(status: string): GenerationTaskStatus {
    const value = status.trim().toLowerCase();
    if (["planning", "queued", "created", "pending"].includes(value)) return "pending";
    if (["processing", "in_progress", "running"].includes(value)) return "running";
    if (["completed", "succeeded", "success"].includes(value)) return "success";
    if (["failed", "failure", "error", "expired"].includes(value)) return "error";
    if (value === "paused") return "paused";
    if (value === "cancelled" || value === "canceled") return "cancelled";
    return "error";
}

function mapStoredTaskRecord(row: Record<string, unknown>): StoredGenerationTaskRecord {
    const payload = row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
    return {
        id: String(row.id || ""),
        userId: String(row.user_id || ""),
        type: isTaskType(row.task_type) ? row.task_type : "text",
        status: isTaskStatus(row.status) ? row.status : "error",
        payload,
        createdAt: databaseTime(row.created_at),
        updatedAt: databaseTime(row.updated_at),
        expiresAt: databaseTime(row.expires_at),
        conversationId: cleanContextText(String(row.conversation_id || "")),
        runId: cleanContextText(String(row.run_id || "")),
        surface: isTaskSurface(row.surface) ? row.surface : undefined,
        projectId: cleanContextText(String(row.project_id || "")),
        episodeId: cleanContextText(String(payload.episodeId || "")),
        shotId: cleanContextText(String(payload.shotId || "")),
        estimatedPoints: positiveContextNumber(payload.estimatedPoints),
        parentTaskId: cleanContextText(String(row.parent_task_id || "")),
        attemptNo: row.attempt_no === null || row.attempt_no === undefined ? undefined : Math.max(0, Math.floor(Number(row.attempt_no) || 0)),
        clientRequestId: cleanContextText(String(row.client_request_id || "")),
    };
}

function isTaskType(value: unknown): value is GenerationTaskType {
    return value === "text" || value === "image" || value === "video" || value === "audio" || value === "agent" || value === "render";
}

function isTaskStatus(value: unknown): value is GenerationTaskStatus {
    return value === "pending" || value === "running" || value === "success" || value === "error" || value === "paused" || value === "cancelled";
}

function isTaskSurface(value: unknown): value is NonNullable<GenerationTaskContext["surface"]> {
    return value === "chat" || value === "canvas" || value === "drama";
}

function databaseTime(value: unknown) {
    const time = value instanceof Date ? value.getTime() : new Date(String(value || "")).getTime();
    return Number.isFinite(time) ? time : 0;
}

function recordObject(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function positiveNumber(...values: unknown[]) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
    }
    return 0;
}

function normalizeMutation<T extends { id: string; userId: string; status: string; createdAt: number; updatedAt: number }>(current: T, next: T | null, updatedAt: number) {
    return next ? { ...next, id: current.id, userId: current.userId, createdAt: current.createdAt, updatedAt } : null;
}
