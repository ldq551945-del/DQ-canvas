export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PageInput = {
    page?: number;
    pageSize?: number;
};

export type PageResult<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";
export type PromptScope = "library" | "user";
export type UsageKind = "api" | "image" | "video" | "audio" | "text";
export type GenerationKind = "image" | "video";
export type GenerationStatus = "pending" | "success" | "failed";
export type AuditStatus = "success" | "failure";
export type BillingOrderStatus = "pending" | "paid" | "closed" | "canceled" | "refunding" | "refunded";
export type BillingProductKind = "plan" | "points";
export type PaymentTransactionStatus = "pending" | "succeeded" | "failed" | "refunded";
export type BillingReconciliationRunStatus = "completed" | "failed";
export type BillingReconciliationSource = "csv" | "provider-api" | "manual";
export type BillingReconciliationStatementStatus = "paid" | "refunded" | "pending" | "failed" | "unknown";
export type PlanAssignmentStatus = "active" | "expired" | "canceled";
export type PlanAssignmentSource = "admin" | "order" | "cdk" | "system";

export type UserRecord = {
    id: string;
    username: string;
    email?: string;
    displayName: string;
    role: UserRole;
    status: UserStatus;
    planId: string;
    pointsBalance: number;
    passwordHash: string;
    lastLoginAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type SessionRecord = {
    id: string;
    userId: string;
    tokenHash: string;
    createdAt: string;
    expiresAt: string;
};

export type AuthenticatedUserRecord = {
    user: UserRecord;
    planId: string;
    planName: string;
    permanentPoints: number;
    dailyPoints: number;
};

export type UserSummaryRecord = {
    total: number;
    active: number;
    disabled: number;
    admins: number;
    activeAdmins: number;
    usersWithPlan: number;
    totalPointsBalance: number;
};

export type EntitlementPlanRecord = {
    id: string;
    name: string;
    enabled: boolean;
    dailyPoints: number;
    limits: JsonValue;
    features: JsonValue;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
};

export type AppSettingsRecord = {
    id: "default";
    site: JsonValue;
    registrationEnabled: boolean;
    emailRegistrationEnabled: boolean;
    freeDailyPointsEnabled: boolean;
    freeDailyPoints: number;
    mail: JsonValue;
    allowUserApiConfig: boolean;
    modelPointCosts: JsonValue;
    generationPointMultipliers: JsonValue;
    entitlementsEnabled: boolean;
    defaultPlanId: string;
    generationConcurrency: JsonValue;
    generationDefaults: JsonValue;
    paymentConfig: JsonValue;
    defaultModels: JsonValue;
    createdAt: string;
    updatedAt: string;
};

export type SystemModelChannelRecord = {
    id: string;
    name: string;
    baseUrl: string;
    apiKeyCiphertext: string;
    apiFormat: "openai" | "gemini";
    models: JsonValue;
    enabled: boolean;
    advancedConfig?: JsonValue;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
};

export type PointRecord = {
    id: string;
    userId: string;
    type: "consume" | "refund" | "credit" | "admin-adjust";
    amount: number;
    balanceAfter: number;
    permanentAmount: number;
    dailyAmount: number;
    permanentBalanceAfter: number;
    dailyBalanceAfter: number;
    description: string;
    model?: string;
    idempotencyKey?: string;
    sourceRecordId?: string;
    sourceDate?: string;
    createdAt: string;
};

export type PointRecordInput = Omit<PointRecord, "permanentAmount" | "dailyAmount" | "permanentBalanceAfter" | "dailyBalanceAfter"> & Partial<Pick<PointRecord, "permanentAmount" | "dailyAmount" | "permanentBalanceAfter" | "dailyBalanceAfter">>;

export type DailyPlanPointWalletRecord = {
    userId: string;
    date: string;
    planId: string;
    assignmentId?: string;
    grantedPoints: number;
    remainingPoints: number;
    createdAt: string;
    updatedAt: string;
};

export type QuotaUsageRecord = {
    userId: string;
    date: string;
    usageKind: UsageKind;
    pointsSpent: number;
    units: number;
    updatedAt: string;
};

export type CdkCodeRecord = {
    id: string;
    codeHash: string;
    codePreview: string;
    points: number;
    maxRedemptions: number;
    redeemedCount: number;
    status: "active" | "disabled";
    note: string;
    expiresAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type CdkRedemptionRecord = {
    cdkCodeId: string;
    userId: string;
    redeemedAt: string;
};

export type CdkListFilter = "all" | "redeemed" | "unused" | "expired";

export type CdkListInput = PageInput & {
    keyword?: string;
    codeHash?: string;
    filter?: CdkListFilter;
};

export type CdkListRedemptionRecord = CdkRedemptionRecord & {
    username?: string;
    displayName?: string;
};

export type CdkListCodeRecord = CdkCodeRecord & {
    codeCiphertext: string;
    redemptions: CdkListRedemptionRecord[];
};

export type CdkListResult = PageResult<CdkListCodeRecord> & {
    stats: {
        total: number;
        redeemed: number;
        unused: number;
        expired: number;
    };
};

export type AnnouncementRecord = {
    id: string;
    title: string;
    content: string;
    enabled: boolean;
    popupHome: boolean;
    popupAfterLogin: boolean;
    startsAt?: string;
    endsAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type PromptRecord = {
    id: string;
    scope: PromptScope;
    ownerUserId?: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: JsonValue;
    category: string;
    preview: string;
    githubUrl?: string;
    source?: string;
    createdAt: string;
    updatedAt: string;
};

export type GenerationLogAssetRecord = {
    type: GenerationKind;
    url: string;
    remoteUrl?: string;
    serverUrl?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    bytes?: number;
};

export type GenerationLogRecord = {
    id: string;
    userId: string;
    conversationId?: string;
    username: string;
    displayName: string;
    kind: GenerationKind;
    source: string;
    status: GenerationStatus;
    title: string;
    prompt: string;
    model: string;
    summary: string;
    durationMs: number;
    count: number;
    successCount: number;
    failCount: number;
    assets: GenerationLogAssetRecord[];
    taskId?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
};

export type AuditLogRecord = {
    id: string;
    action: string;
    status: AuditStatus;
    actorUserId?: string;
    actorUsername?: string;
    actorRole?: UserRole;
    actorIp?: string;
    actorUserAgent?: string;
    targetType?: string;
    targetId?: string;
    targetLabel?: string;
    metadata?: JsonValue;
    createdAt: string;
};

export type BillingOrderRecord = {
    id: string;
    orderNo: string;
    productId?: string;
    userId?: string;
    productKind: BillingProductKind;
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
    metadata?: JsonValue;
    createdAt: string;
    updatedAt: string;
};

export type BillingProductRecord = {
    id: string;
    productKind: BillingProductKind;
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
    metadata?: JsonValue;
    createdAt: string;
    updatedAt: string;
};

export type PaymentTransactionRecord = {
    id: string;
    orderId: string;
    userId?: string;
    provider: string;
    channel: string;
    status: PaymentTransactionStatus;
    amountCents: number;
    currency: string;
    providerTradeId?: string;
    providerPaymentId?: string;
    rawPayload?: JsonValue;
    paidAt?: string;
    refundedAt?: string;
    failedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type BillingReconciliationRunRecord = {
    id: string;
    provider: string;
    source: BillingReconciliationSource;
    status: BillingReconciliationRunStatus;
    totalRows: number;
    matchedRows: number;
    okRows: number;
    issueRows: number;
    statementPaidAmountCents: number;
    statementRefundedAmountCents: number;
    localMatchedAmountCents: number;
    differenceAmountCents: number;
    importedByUserId?: string;
    importedByUsername?: string;
    fileName?: string;
    note?: string;
    metadata?: JsonValue;
    createdAt: string;
    updatedAt: string;
};

export type BillingReconciliationRowRecord = {
    id: string;
    runId: string;
    rowNumber: number;
    rowKey: string;
    provider: string;
    orderNo?: string;
    providerOrderId?: string;
    providerPaymentId?: string;
    statementStatus: BillingReconciliationStatementStatus;
    amountCents?: number;
    currency?: string;
    localOrderId?: string;
    localOrderNo?: string;
    localOrderStatus?: string;
    localAmountCents?: number;
    localCurrency?: string;
    issueCodes: JsonValue;
    issues: JsonValue;
    createdAt: string;
    updatedAt: string;
};

export type UserPlanAssignmentRecord = {
    id: string;
    userId: string;
    planId: string;
    status: PlanAssignmentStatus;
    source: PlanAssignmentSource;
    sourceId?: string;
    startsAt: string;
    endsAt?: string;
    metadata?: JsonValue;
    createdAt: string;
    updatedAt: string;
};

export type PaymentProviderEventRecord = {
    id: string;
    provider: string;
    eventId?: string;
    eventType: string;
    orderId?: string;
    signatureValid: boolean;
    payload?: JsonValue;
    processingAt?: string;
    processedAt?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
};

export type BillingSummaryProviderRecord = {
    provider: string;
    totalOrders: number;
    pendingOrders: number;
    paidOrders: number;
    refundedOrders: number;
    paidAmountCents: number;
    refundedAmountCents: number;
};

export type BillingSummaryRecord = {
    orders: {
        total: number;
        pending: number;
        paid: number;
        closed: number;
        canceled: number;
        refunded: number;
        grossAmountCents: number;
        paidAmountCents: number;
        pendingAmountCents: number;
        refundedAmountCents: number;
    };
    payments: {
        succeeded: number;
        refunded: number;
        succeededAmountCents: number;
        refundedAmountCents: number;
    };
    providers: BillingSummaryProviderRecord[];
    reconciliation: {
        paidOrdersWithoutSucceededPayment: number;
        succeededPaymentsWithoutPaidOrder: number;
        amountMismatchPayments: number;
    };
};
