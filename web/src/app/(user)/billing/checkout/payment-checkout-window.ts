import type { PaymentCheckout } from "@/services/api/billing";

export type PaymentCheckoutOpenResult = { status: "opened" | "blocked" | "invalid" | "manual"; fallbackValue?: string };

type CheckoutWindow = Pick<Window, "close" | "document" | "location"> & { opener: Window["opener"] };
type WindowOpen = (url?: string | URL, target?: string, features?: string) => Window | null;

export function openPaymentCheckoutWindow(checkout: PaymentCheckout, openWindow: WindowOpen = (url, target, features) => window.open(url, target, features)): PaymentCheckoutOpenResult {
    const fallbackValue = checkout.qrContent || checkout.url || checkout.orderNo;
    if (checkout.kind === "manual") return { status: "manual", fallbackValue };

    const redirectUrl = safePaymentUrl(checkout.url || checkout.qrContent);
    if (redirectUrl) return openPaymentRedirect(redirectUrl, fallbackValue, openWindow);

    if (checkout.kind === "form" && checkout.formHtml) {
        const popup = openCheckoutWindow(openWindow);
        if (!popup) return { status: "blocked", fallbackValue };
        try {
            popup.document.open();
            popup.document.write(checkout.formHtml);
            popup.document.close();
            return { status: "opened" };
        } catch {
            closePopup(popup);
            return { status: "invalid", fallbackValue };
        }
    }

    return { status: "invalid", fallbackValue };
}

export function safePaymentUrl(value?: string) {
    const text = value?.trim();
    if (!text) return "";
    try {
        const url = new URL(text);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
    } catch {
        return "";
    }
}

function openPaymentRedirect(url: string, fallbackValue: string, openWindow: WindowOpen): PaymentCheckoutOpenResult {
    const popup = openCheckoutWindow(openWindow);
    if (!popup) return { status: "blocked", fallbackValue };
    try {
        popup.location.replace(url);
        return { status: "opened" };
    } catch {
        closePopup(popup);
        return { status: "invalid", fallbackValue };
    }
}

function openCheckoutWindow(openWindow: WindowOpen): CheckoutWindow | null {
    const popup = openWindow("about:blank", "_blank");
    if (!popup) return null;
    const checkoutWindow = popup as CheckoutWindow;
    checkoutWindow.opener = null;
    try {
        checkoutWindow.document.open();
        checkoutWindow.document.write(
            '<!doctype html><html><head><meta charset="utf-8" /><title>正在打开支付</title></head><body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:32px;color:#111827">正在打开支付页面，请稍候...</body></html>',
        );
        checkoutWindow.document.close();
    } catch {
        // Some browser payment windows restrict document access; navigation can still continue.
    }
    return checkoutWindow;
}

function closePopup(popup: CheckoutWindow) {
    try {
        popup.close();
    } catch {
        // Ignore close failures from browser-managed payment windows.
    }
}
