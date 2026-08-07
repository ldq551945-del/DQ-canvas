import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({ configured: vi.fn(), authorized: vi.fn(), snapshot: vi.fn() }));

vi.mock("@/lib/server/maintenance-auth", () => ({ isMaintenanceTokenConfigured: routeMocks.configured, isAuthorizedMaintenanceRequest: routeMocks.authorized }));
vi.mock("@/lib/server/observability-snapshot", () => ({ getOperationalObservabilitySnapshot: routeMocks.snapshot }));

import { getHttpObservabilitySnapshot, normalizeSqlForLog, percentiles, recordHttpRequest, redactObservabilityText } from "./observability";

describe("observability primitives", () => {
    beforeEach(() => {
        delete (globalThis as Record<string, unknown>).__dqHttpObservability;
    });

    it("calculates bounded percentiles from request samples", () => {
        expect(percentiles([1, 2, 3, 4, 5])).toEqual({ p50: 3, p95: 5, p99: 5, max: 5 });
    });

    it("tracks HTTP status, route and latency without exposing query values", () => {
        recordHttpRequest({ method: "GET", route: "/api/tasks/:id", status: 200, durationMs: 20 });
        recordHttpRequest({ method: "GET", route: "/api/tasks/:id", status: 503, durationMs: 120 });

        expect(getHttpObservabilitySnapshot()).toMatchObject({
            requests: 2,
            errors5xx: 1,
            errorRate: 50,
            routes: [{ route: "/api/tasks/:id", count: 2, errors5xx: 1, errorRate: 50, latencyMs: { p50: 20, p95: 120, p99: 120 } }],
        });
    });

    it("normalizes literals before a SQL fingerprint is logged", () => {
        expect(normalizeSqlForLog("SELECT * FROM users WHERE id = 'user-secret' AND points > 12")).toBe("SELECT * FROM users WHERE id = ? AND points > ?");
    });

    it("redacts credentials embedded in error strings", () => {
        const message = "Authorization Bearer secret-value https://api.example.test/callback?signature=signed-value postgres://dq:password@db.example.test/dq";
        expect(redactObservabilityText(message)).toBe("Authorization Bearer [redacted] https://api.example.test/callback?signature=[redacted] postgres://[redacted]@db.example.test/dq");
    });
});

describe("GET /api/maintenance/observability", () => {
    it("requires the maintenance token and returns no-store snapshots", async () => {
        const { GET } = await import("@/app/api/maintenance/observability/route");
        routeMocks.configured.mockReturnValue(true);
        routeMocks.authorized.mockReturnValue(true);
        routeMocks.snapshot.mockResolvedValue({ http: { requests: 1 } });

        const response = await GET(new Request("http://localhost/api/maintenance/observability", { headers: { authorization: "Bearer test" } }));

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        await expect(response.json()).resolves.toMatchObject({ code: 0, data: { http: { requests: 1 } } });
    });
});
