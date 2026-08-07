import { describe, expect, it, vi } from "vitest";

import type { QueryExecutor } from "./postgres";
import { BillingRefundRepository } from "./billing-refund-repository";

const now = "2026-08-06T00:00:00.000Z";

describe("BillingRefundRepository", () => {
    it("claims due jobs with a lease and skip-locked concurrency", async () => {
        const row = refundRow({ status: "processing", attempts: 2, worker_id: "worker-one", lease_until: "2026-08-06T00:02:00.000Z" });
        const query = vi.fn(async () => ({ rows: [row], rowCount: 1 }));
        const repository = new BillingRefundRepository({ query } as unknown as QueryExecutor);

        const jobs = await repository.claimDue({ workerId: "worker-one", now, leaseUntil: "2026-08-06T00:02:00.000Z", limit: 10 });

        expect(jobs).toMatchObject([{ id: "refund-job-one", status: "processing", attempts: 2, workerId: "worker-one" }]);
        const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
        expect(sql).toContain("FOR UPDATE SKIP LOCKED");
        expect(sql).toContain("attempts = attempts + 1");
        expect(values).toEqual([now, 10, "worker-one", "2026-08-06T00:02:00.000Z"]);
    });

    it("releases only the job owned by the current worker", async () => {
        const query = vi.fn(async () => ({ rows: [refundRow({ status: "pending", worker_id: null, lease_until: null })], rowCount: 1 }));
        const repository = new BillingRefundRepository({ query } as unknown as QueryExecutor);

        await repository.release("refund-job-one", "worker-one", { status: "pending", attempts: 2, maxAttempts: 8, nextAttemptAt: "2026-08-06T00:01:00.000Z", lastError: "provider pending" });

        const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
        expect(sql).toContain("WHERE id = $1 AND worker_id = $2");
        expect(sql).toContain("worker_id = NULL");
        expect(sql).toContain("lease_until = NULL");
        expect(values.slice(0, 8)).toEqual(["refund-job-one", "worker-one", "pending", null, 2, 8, "2026-08-06T00:01:00.000Z", "provider pending"]);
    });
});

function refundRow(patch: Record<string, unknown> = {}) {
    return {
        id: "refund-job-one",
        order_id: "order-one",
        payment_id: "payment-one",
        provider: "stripe",
        status: "pending",
        provider_refund_id: "re_one",
        attempts: 1,
        max_attempts: 8,
        next_attempt_at: now,
        raw_payload: {},
        created_at: now,
        updated_at: now,
        ...patch,
    } satisfies Record<string, unknown>;
}
