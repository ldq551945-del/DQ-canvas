import { describe, expect, it } from "vitest";

import { hasSystemAiCharge, readSystemAiBilling, systemAiBillingHeaders, systemAiIdempotencyKey } from "./system-ai-billing";

describe("system AI billing helpers", () => {
    it("preserves a zero-cost consumption record so its quota can be refunded", () => {
        const billing = readSystemAiBilling(new Headers({ "x-dq-points-cost": "0", "x-dq-points-record-id": "points-free-text" }));

        expect(billing).toEqual({ pointsCost: 0, pointsRecordId: "points-free-text" });
        expect(hasSystemAiCharge(billing)).toBe(true);
    });

    it("creates stable scoped idempotency headers without exposing source identifiers", () => {
        const first = systemAiIdempotencyKey("workbench-plan", "user-one", "request-one", "image", "channel-one");
        const second = systemAiIdempotencyKey("workbench-plan", "user-one", "request-one", "image", "channel-one");

        expect(first).toBe(second);
        expect(first).toMatch(/^workbench-plan:[a-f0-9]{32}$/);
        expect(systemAiBillingHeaders("planner", first)).toEqual({ "x-dq-logical-model": "planner", "x-dq-points-idempotency-key": first });
    });
});
