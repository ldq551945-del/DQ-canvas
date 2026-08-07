import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    provider: "file" as "file" | "postgres",
    runBatch: vi.fn(),
    installStatus: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({ getDatabaseProvider: () => mocks.provider }));
vi.mock("@/lib/server/billing-refund-orchestration-service", () => ({ runBillingRefundReconciliationBatch: mocks.runBatch }));
vi.mock("@/lib/server/install-status", () => ({ getInstallStatus: mocks.installStatus }));

import { POST } from "./route";

const workerToken = "worker-token-at-least-thirty-two-characters";
const maintenanceToken = "maintenance-token-at-least-thirty-two-characters";

describe("billing refund maintenance route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.provider = "file";
        process.env.DQ_WORKER_TOKEN = workerToken;
        process.env.DQ_MAINTENANCE_TOKEN = maintenanceToken;
    });

    afterEach(() => {
        delete process.env.DQ_WORKER_TOKEN;
        delete process.env.DQ_MAINTENANCE_TOKEN;
    });

    it("rejects requests without the configured bearer token", async () => {
        const response = await POST(request({ authorized: false }));

        expect(response.status).toBe(401);
        expect(mocks.runBatch).not.toHaveBeenCalled();
    });

    it("rejects the external maintenance token at the Worker endpoint", async () => {
        const response = await POST(request({ token: maintenanceToken }));

        expect(response.status).toBe(401);
        expect(mocks.runBatch).not.toHaveBeenCalled();
    });

    it("stays idle in file storage mode", async () => {
        const response = await POST(request());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ code: 0, data: { claimed: 0 }, msg: "当前存储模式无需处理退款补偿任务" });
        expect(mocks.installStatus).not.toHaveBeenCalled();
        expect(mocks.runBatch).not.toHaveBeenCalled();
    });

    it("runs a bounded batch for a ready PostgreSQL database", async () => {
        mocks.provider = "postgres";
        mocks.installStatus.mockResolvedValue({ database: { schemaReady: true } });
        mocks.runBatch.mockResolvedValue({ claimed: 1, completed: 1, pending: 0, manual: 0, failed: 0 });

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.runBatch).toHaveBeenCalledWith({ workerId: "refund-worker", limit: 10 });
    });
});

function request(input: { authorized?: boolean; token?: string } = {}) {
    const authorized = input.authorized !== false;
    return new Request("http://localhost/api/maintenance/billing-refunds/run", {
        method: "POST",
        headers: {
            ...(authorized ? { authorization: `Bearer ${input.token || workerToken}` } : {}),
            "x-dq-worker-id": "refund-worker",
        },
    });
}
