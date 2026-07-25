import { describe, expect, it } from "vitest";

import { isPaymentRuntimeProviderCheckoutReady, type PaymentRuntimeConfig } from "./payment-config-store";

describe("payment provider checkout readiness", () => {
    it("keeps manual checkout available without configuration", () => {
        expect(isPaymentRuntimeProviderCheckoutReady(config(), "manual")).toBe(true);
    });

    it("rejects an enabled provider with missing checkout credentials", () => {
        expect(isPaymentRuntimeProviderCheckoutReady(config({ stripe: { enabled: true, saved: true } }), "stripe")).toBe(false);
    });

    it("accepts an enabled provider with production checkout credentials", () => {
        expect(isPaymentRuntimeProviderCheckoutReady(config({ stripe: { enabled: true, saved: true } }, { VOZEB_PRO_STRIPE_SECRET_KEY: "sk_live_real_key" }), "stripe")).toBe(true);
    });
});

function config(providers: PaymentRuntimeConfig["providers"] = {}, valuesByEnvName: Record<string, string> = {}): PaymentRuntimeConfig {
    return { saved: { providers: {} }, providers, valuesByEnvName };
}
