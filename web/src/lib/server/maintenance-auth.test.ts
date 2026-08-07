import { afterEach, describe, expect, it } from "vitest";

import { authorizedWorkerUserId, isAuthorizedMaintenanceRequest, isAuthorizedWorkerRequest, isMaintenanceTokenConfigured, isWorkerTokenConfigured, workerContext, workerContextHeaders, workerHeaders } from "./maintenance-auth";

const maintenanceToken = "maintenance-token-at-least-thirty-two-characters";
const workerToken = "worker-token-at-least-thirty-two-characters";

describe("maintenance and Worker authentication", () => {
    afterEach(() => {
        delete process.env.DQ_MAINTENANCE_TOKEN;
        delete process.env.DQ_WORKER_TOKEN;
    });

    it("keeps maintenance and Worker bearer tokens on separate boundaries", () => {
        process.env.DQ_MAINTENANCE_TOKEN = maintenanceToken;
        process.env.DQ_WORKER_TOKEN = workerToken;

        expect(isMaintenanceTokenConfigured()).toBe(true);
        expect(isWorkerTokenConfigured()).toBe(true);
        expect(isAuthorizedMaintenanceRequest(request(maintenanceToken))).toBe(true);
        expect(isAuthorizedMaintenanceRequest(request(workerToken))).toBe(false);
        expect(isAuthorizedWorkerRequest(request(workerToken))).toBe(true);
        expect(isAuthorizedWorkerRequest(request(maintenanceToken))).toBe(false);
    });

    it("rejects a shared secret instead of treating it as isolated", () => {
        process.env.DQ_MAINTENANCE_TOKEN = maintenanceToken;
        process.env.DQ_WORKER_TOKEN = maintenanceToken;

        expect(isWorkerTokenConfigured()).toBe(false);
        expect(isAuthorizedWorkerRequest(request(maintenanceToken))).toBe(false);
    });

    it("signs and verifies internal user context with the Worker token", () => {
        process.env.DQ_MAINTENANCE_TOKEN = maintenanceToken;
        process.env.DQ_WORKER_TOKEN = workerToken;

        const context = workerContext("user-one");
        expect(workerContextHeaders(context)).toEqual({ authorization: `Bearer ${workerToken}`, "x-dq-worker-user-id": "user-one" });
        expect(authorizedWorkerUserId(new Request("http://localhost", { headers: workerHeaders("user-one") }))).toBe("user-one");

        process.env.DQ_WORKER_TOKEN = "rotated-worker-token-at-least-thirty-two-characters";
        expect(workerContextHeaders(context)).toBeNull();
    });
});

function request(token: string) {
    return new Request("http://localhost/api/maintenance", { headers: { authorization: `Bearer ${token}` } });
}
