export type BillingProduct = {
    id: string;
    productKind: "plan" | "points";
    planId?: string;
    name: string;
    description: string;
    amountCents: number;
    currency: string;
    pointsAmount: number;
    dailyPoints: number;
    periodDays: number;
    enabled: boolean;
    sortOrder: number;
    metadata?: unknown;
    createdAt: string;
    updatedAt: string;
};

export type BillingOrderStatus = "pending" | "paid" | "closed" | "canceled" | "refunding" | "refunded";

export type BillingOrder = {
    id: string;
    orderNo: string;
    productId?: string;
    userId?: string;
    productKind: "plan" | "points";
    planId?: string;
    status: BillingOrderStatus;
    subject: string;
    amountCents: number;
    currency: string;
    pointsAmount: number;
    dailyPoints: number;
    periodDays: number;
    quantity: number;
    provider: string;
    providerOrderId?: string;
    providerPaymentId?: string;
    expiresAt?: string;
    paidAt?: string;
    closedAt?: string;
    metadata?: unknown;
    createdAt: string;
    updatedAt: string;
};

export type PaymentCheckout = {
    provider: string;
    orderId: string;
    orderNo: string;
    kind: "manual" | "redirect" | "form" | "qr";
    url?: string;
    formHtml?: string;
    qrContent?: string;
    providerOrderId?: string;
    providerPaymentId?: string;
    expiresAt?: string;
};

export async function listBillingProducts() {
    return requestBilling<{ products: BillingProduct[]; paymentProviders: string[] }>("/api/billing/products");
}

export async function listBillingOrders(input: { page?: number; pageSize?: number; status?: BillingOrderStatus } = {}) {
    const params = new URLSearchParams();
    if (input.page) params.set("page", String(input.page));
    if (input.pageSize) params.set("pageSize", String(input.pageSize));
    if (input.status) params.set("status", input.status);
    const query = params.toString();
    return requestBilling<{ orders: BillingOrder[]; total: number; page: number; pageSize: number }>(`/api/billing/orders${query ? `?${query}` : ""}`);
}

export async function getBillingOrder(orderId: string) {
    return requestBilling<{ order: BillingOrder }>(`/api/billing/orders/${encodeURIComponent(orderId)}`);
}

export async function cancelBillingOrder(orderId: string) {
    return requestBilling<{ order: BillingOrder }>(`/api/billing/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST" });
}

export async function createBillingOrder(input: { productId: string; provider: string; quantity?: number }) {
    return requestBilling<{ order: BillingOrder }>("/api/billing/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
}

export async function createPaymentCheckout(orderId: string, input: { provider?: string } = {}) {
    return requestBilling<{ checkout: PaymentCheckout }>(`/api/billing/orders/${encodeURIComponent(orderId)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
}

async function requestBilling<T>(url: string, init?: RequestInit) {
    const response = await fetch(url, { cache: "no-store", ...init });
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || "请求失败");
    return payload;
}
