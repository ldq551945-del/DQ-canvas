import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { ensurePostgresSchema, getDatabaseProvider, withPostgresTransaction } from "@/lib/server/database";
import type { GenerationTaskType } from "@/lib/server/generation-task-store";

const SECRET_MIN_LENGTH = 32;

export class GenerationWebhookError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

export function isGenerationWebhookConfigured() {
    return webhookSecret().length >= SECRET_MIN_LENGTH;
}

export function verifyGenerationWebhookSignature(body: string, signatureHeader: string) {
    const secret = webhookSecret();
    if (secret.length < SECRET_MIN_LENGTH) return false;
    const provided = signatureHeader
        .trim()
        .replace(/^sha256=/i, "")
        .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(provided)) return false;
    const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}

export async function recordGenerationWebhook(input: { channelId: string; eventId: string; upstreamTaskId: string; clientRequestId?: string; upstreamStatus?: string; resultUrl?: string; rawBody: string }) {
    if (getDatabaseProvider() !== "postgres") throw new GenerationWebhookError("生成回调幂等处理需要 PostgreSQL", 409);
    const channelId = required(input.channelId, "回调渠道 ID", 160);
    const eventId = required(input.eventId, "回调事件 ID", 300);
    const upstreamTaskId = required(input.upstreamTaskId, "上游任务 ID", 500);
    const clientRequestId = clean(input.clientRequestId, 160);
    const upstreamStatus = clean(input.upstreamStatus, 160) || "webhook_received";
    const resultUrl = clean(input.resultUrl, 4_000);
    const payloadHash = createHash("sha256").update(input.rawBody, "utf8").digest("hex");
    await ensurePostgresSchema();
    return withPostgresTransaction(async (client) => {
        const inserted = await client.query<{ event_id: string }>(
            `INSERT INTO generation_webhook_events (channel_id, event_id, upstream_task_id, payload_hash, status)
             VALUES ($1, $2, $3, $4, 'received')
             ON CONFLICT (channel_id, event_id) DO NOTHING
             RETURNING event_id`,
            [channelId, eventId, upstreamTaskId, payloadHash],
        );
        if (!inserted.rows[0]) return { duplicate: true, matched: false };

        const task = await client.query<{ id: string; task_type: GenerationTaskType }>(
            `UPDATE generation_tasks
             SET execution_phase = CASE WHEN $5::text IS NOT NULL THEN 'result_ready' ELSE execution_phase END,
                 result_payload = CASE WHEN $5::text IS NOT NULL THEN jsonb_build_object('url', $5::text) ELSE result_payload END,
                 next_poll_at = now(), last_poll_at = now(), last_upstream_status = $4,
                 worker_id = NULL, lease_until = NULL
             WHERE channel_id = $1
               AND (upstream_task_id = $2 OR ($3::text IS NOT NULL AND client_request_id = $3))
               AND task_type IN ('image', 'video', 'audio')
               AND status IN ('pending', 'running')
               AND execution_phase IN ('submitted', 'polling', 'result_ready', 'persisting')
             RETURNING id, task_type`,
            [channelId, upstreamTaskId, clientRequestId || null, upstreamStatus, resultUrl || null],
        );
        const matched = task.rows[0];
        await client.query(
            `UPDATE generation_webhook_events
             SET task_id = $3, task_type = $4, status = $5, processed_at = now()
             WHERE channel_id = $1 AND event_id = $2`,
            [channelId, eventId, matched?.id || null, matched?.task_type || null, matched ? (resultUrl ? "result_ready" : "poll_scheduled") : "unmatched"],
        );
        return { duplicate: false, matched: Boolean(matched), taskId: matched?.id, taskType: matched?.task_type, resultReady: Boolean(matched && resultUrl) };
    });
}

function webhookSecret() {
    return process.env.VOZEB_PRO_GENERATION_WEBHOOK_SECRET?.trim() || "";
}

function required(value: unknown, label: string, max: number) {
    const result = clean(value, max);
    if (!result) throw new GenerationWebhookError(`${label}不能为空`, 400);
    return result;
}

function clean(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) || undefined : undefined;
}
