import { describe, expect, it, vi } from "vitest";

import type { PaymentCheckout } from "@/services/api/billing";
import { openPaymentCheckoutWindow, safePaymentUrl } from "./payment-checkout-window";

describe("payment checkout window", () => {
    it("opens redirect payments through a synchronous blank popup", () => {
        const popup = popupWindow();
        const open = vi.fn(() => popup);

        expect(openPaymentCheckoutWindow(checkout({ kind: "redirect", url: "https://pay.example/checkout" }), open)).toEqual({ status: "opened" });
        expect(open).toHaveBeenCalledWith("about:blank", "_blank");
        expect(popup.opener).toBeNull();
        expect(popup.location.replace).toHaveBeenCalledWith("https://pay.example/checkout");
    });

    it("writes form checkouts into the popup when no safe redirect url exists", () => {
        const popup = popupWindow();

        expect(
            openPaymentCheckoutWindow(
                checkout({ kind: "form", formHtml: "<form>pay</form>" }),
                vi.fn(() => popup),
            ),
        ).toEqual({ status: "opened" });
        expect(popup.document.write).toHaveBeenLastCalledWith("<form>pay</form>");
    });

    it("reports blocked popups with copyable fallback payment information", () => {
        expect(
            openPaymentCheckoutWindow(
                checkout({ kind: "redirect", url: "https://pay.example/checkout" }),
                vi.fn(() => null),
            ),
        ).toEqual({ status: "blocked", fallbackValue: "https://pay.example/checkout" });
    });

    it("rejects unsafe redirect urls before opening a blank page", () => {
        const open = vi.fn();

        expect(openPaymentCheckoutWindow(checkout({ kind: "redirect", url: "javascript:alert(1)" }), open)).toEqual({ status: "invalid", fallbackValue: "javascript:alert(1)" });
        expect(open).not.toHaveBeenCalled();
    });

    it("accepts only http and https payment urls", () => {
        expect(safePaymentUrl("https://pay.example/path")).toBe("https://pay.example/path");
        expect(safePaymentUrl("http://pay.example/path")).toBe("http://pay.example/path");
        expect(safePaymentUrl("alipays://platformapi/startapp")).toBe("");
    });
});

function checkout(patch: Partial<PaymentCheckout>): PaymentCheckout {
    return { provider: "stripe", orderId: "order", orderNo: "VZ001", kind: "redirect", ...patch };
}

function popupWindow() {
    return {
        opener: {} as Window | null,
        close: vi.fn(),
        location: { replace: vi.fn() },
        document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
    } as unknown as Window;
}
