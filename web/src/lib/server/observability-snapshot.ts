import { statfs } from "node:fs/promises";
import { dirname } from "node:path";

import { getDatabaseProvider, getPostgresOperationalSnapshot, postgresQuery } from "@/lib/server/database";
import { getServerDataDir } from "@/lib/server/data-dir";
import { getAdminGenerationOverviewSummary } from "@/lib/server/generation-overview-service";
import { getLocalMediaAssetSummary } from "@/lib/server/local-media-storage";
import { getHttpObservabilitySnapshot, logStructured } from "@/lib/server/observability";

type SnapshotSection<T> = { status: "ok"; data: T } | { status: "error"; error: "unavailable" };

export async function getOperationalObservabilitySnapshot(now = new Date()) {
    const [generation, commerce, media] = await Promise.all([captureSection("generation", () => getAdminGenerationOverviewSummary(now)), captureSection("commerce", () => getCommerceMetrics(now)), captureSection("media", getMediaCapacityMetrics)]);
    const memory = process.memoryUsage();
    return {
        generatedAt: now.toISOString(),
        process: {
            pid: process.pid,
            uptimeSeconds: Math.floor(process.uptime()),
            nodeVersion: process.version,
            memoryBytes: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external },
        },
        http: getHttpObservabilitySnapshot(),
        database: { provider: getDatabaseProvider(), ...getPostgresOperationalSnapshot() },
        generation,
        commerce,
        media,
    };
}

async function getCommerceMetrics(now: Date) {
    const provider = getDatabaseProvider();
    if (provider !== "postgres") return { available: false as const, reason: "postgres_required" as const };
    const windowHours = 24;
    const startAt = new Date(now.getTime() - windowHours * 60 * 60 * 1_000).toISOString();
    const result = await postgresQuery<Record<string, unknown>>(
        `SELECT
            (SELECT count(*) FILTER (WHERE status = 'succeeded') FROM payment_transactions WHERE created_at >= $1) AS payment_succeeded,
            (SELECT count(*) FILTER (WHERE status = 'failed') FROM payment_transactions WHERE created_at >= $1) AS payment_failed,
            (SELECT count(*) FILTER (WHERE status = 'pending') FROM payment_transactions WHERE created_at >= $1) AS payment_pending,
            (SELECT count(*) FILTER (WHERE status = 'completed') FROM billing_refund_jobs WHERE created_at >= $1) AS refund_completed,
            (SELECT count(*) FILTER (WHERE status = 'failed') FROM billing_refund_jobs WHERE created_at >= $1) AS refund_failed,
            (SELECT count(*) FILTER (WHERE status = 'manual') FROM billing_refund_jobs WHERE created_at >= $1) AS refund_manual,
            (SELECT count(*) FILTER (WHERE status IN ('pending', 'processing', 'compensating')) FROM billing_refund_jobs WHERE created_at >= $1) AS refund_pending`,
        [startAt],
    );
    const row = result.rows[0] || {};
    const payments = { succeeded: count(row.payment_succeeded), failed: count(row.payment_failed), pending: count(row.payment_pending) };
    const refunds = { completed: count(row.refund_completed), failed: count(row.refund_failed), manual: count(row.refund_manual), pending: count(row.refund_pending) };
    return {
        available: true as const,
        windowHours,
        startAt,
        payments: { ...payments, successRate: percent(payments.succeeded, payments.succeeded + payments.failed) },
        refunds: { ...refunds, successRate: percent(refunds.completed, refunds.completed + refunds.failed + refunds.manual) },
    };
}

async function getMediaCapacityMetrics() {
    const [registered, disk] = await Promise.all([getLocalMediaAssetSummary(), getDataFilesystemCapacity()]);
    return { registeredLocalMedia: registered, disk };
}

async function getDataFilesystemCapacity() {
    const filesystem = await statfsExistingPath(getServerDataDir());
    const totalBytes = Number(filesystem.blocks) * Number(filesystem.bsize);
    const freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPercent = percent(usedBytes, totalBytes);
    const warningPercent = boundedPercent(process.env.DQ_MEDIA_DISK_WARN_PERCENT, 85);
    return { totalBytes, freeBytes, usedBytes, usedPercent, warningPercent, warning: usedPercent >= warningPercent };
}

async function statfsExistingPath(initialPath: string): Promise<Awaited<ReturnType<typeof statfs>>> {
    let candidate = initialPath;
    while (true) {
        try {
            return await statfs(candidate);
        } catch (error) {
            if (!isMissingPathError(error)) throw error;
            const parent = dirname(candidate);
            if (parent === candidate) throw error;
            candidate = parent;
        }
    }
}

async function captureSection<T>(section: string, read: () => Promise<T>): Promise<SnapshotSection<T>> {
    try {
        return { status: "ok", data: await read() };
    } catch (error) {
        logStructured("error", "observability.snapshot.section_failed", { section, error });
        return { status: "error", error: "unavailable" };
    }
}

function count(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function percent(numerator: number, denominator: number) {
    return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

function boundedPercent(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(99, Math.round(parsed))) : fallback;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
