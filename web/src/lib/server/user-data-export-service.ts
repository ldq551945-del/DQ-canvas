import { getPublicUsersByIds, listPointRecordsPage } from "@/lib/auth/store";
import { listPrompts } from "@/lib/prompts/store";
import { listCanvasProjects } from "@/lib/server/canvas-project-store";
import { listCreativeAssets, listCreativeConversations, listCreativeMessages } from "@/lib/server/creative-runtime-store";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled } from "@/lib/server/database";
import { getDramaProject, listDramaProjectSummaries } from "@/lib/server/drama-project-store";
import { listGenerationLogs } from "@/lib/server/generation-log-store";
import { listLibraryAssets } from "@/lib/server/library-asset-store";
import { listLocalMediaRegistrationsForUser } from "@/lib/server/local-media-registry";
import { getOwnAccountDeletionRequest } from "@/lib/server/account-deletion-request-service";
import { sanitizePortableData } from "@/lib/server/user-data-export-policy";

const PAGE_SIZE = 100;
const CONVERSATION_PAGE_SIZE = 200;

export async function buildUserDataExport(userId: string) {
    const [account, points, billing, prompts, creative, generationLogs, canvasProjects, libraryAssets, dramaProjects, media, accountDeletionRequest] = await Promise.all([
        getPublicUsersByIds([userId]).then((users) => users[0] || null),
        collectPages((page) => listPointRecordsPage(userId, { page, pageSize: 50 }).then((result) => ({ items: result.records, total: result.total }))),
        readBillingData(userId),
        collectPages((page) => listPrompts({ scope: "user", ownerUserId: userId, page, pageSize: PAGE_SIZE })),
        readCreativeData(userId),
        collectPages((page) => listGenerationLogs({ userId, page, pageSize: PAGE_SIZE })),
        listCanvasProjects(userId),
        listLibraryAssets(userId),
        readDramaProjects(userId),
        listLocalMediaRegistrationsForUser(userId),
        getOwnAccountDeletionRequest(userId),
    ]);
    if (!account) throw new Error("Personal data export user does not exist");

    return {
        format: "vozeb-pro-personal-data",
        version: 1,
        exportedAt: new Date().toISOString(),
        account,
        points: points.map(({ userId: _userId, idempotencyKey: _idempotencyKey, sourceRecordId: _sourceRecordId, ...record }) => record),
        billing: {
            orders: billing.orders.map(({ userId: _userId, metadata: _metadata, providerOrderId: _providerOrderId, providerPaymentId: _providerPaymentId, ...order }) => order),
            payments: billing.payments.map(({ userId: _userId, rawPayload: _rawPayload, providerTradeId: _providerTradeId, providerPaymentId: _providerPaymentId, ...payment }) => payment),
            planAssignments: billing.planAssignments.map(({ userId: _userId, metadata: _metadata, sourceId: _sourceId, ...assignment }) => assignment),
        },
        prompts: prompts.map(({ ownerUserId: _ownerUserId, ...prompt }) => sanitizePortableData(prompt)),
        creative,
        generationLogs: generationLogs.map((log) =>
            sanitizePortableData({
                id: log.id,
                conversationId: log.conversationId,
                kind: log.kind,
                source: log.source,
                status: log.status,
                title: log.title,
                prompt: log.prompt,
                model: log.model,
                summary: log.summary,
                durationMs: log.durationMs,
                count: log.count,
                successCount: log.successCount,
                failCount: log.failCount,
                assets: log.assets,
                taskId: log.taskId,
                error: log.error,
                createdAt: log.createdAt,
                updatedAt: log.updatedAt,
                completedAt: log.completedAt,
            }),
        ),
        canvasProjects: sanitizePortableData(canvasProjects),
        libraryAssets: sanitizePortableData(libraryAssets),
        dramaProjects: sanitizePortableData(dramaProjects),
        media: media.map(({ ownerUserId: _ownerUserId, externalStorageId: _externalStorageId, externalObjectKey: _externalObjectKey, ...item }) => item),
        accountDeletionRequest,
        exclusions: ["媒体二进制与 base64 内容", "密码、会话、验证码和 API 凭据", "支付商原始回调载荷", "临时签名地址与对象存储内部路径", "平台内部规划与模型选择详情"],
    };
}

async function readBillingData(userId: string) {
    if (!isPostgresDatabaseEnabled()) return { orders: [], payments: [], planAssignments: [] };
    await ensurePostgresSchema();
    const billing = createPostgresRepositories().billing;
    const [orders, payments, planAssignments] = await Promise.all([
        collectPages((page) => billing.listOrders({ userId, page, pageSize: PAGE_SIZE })),
        collectPages((page) => billing.listPayments({ userId, page, pageSize: PAGE_SIZE })),
        collectPages((page) => billing.listPlanAssignments({ userId, page, pageSize: PAGE_SIZE })),
    ]);
    return { orders, payments, planAssignments };
}

async function readCreativeData(userId: string) {
    const conversations = await collectOffsetPages((offset) => listCreativeConversations(userId, { limit: CONVERSATION_PAGE_SIZE, offset }));
    return mapInBatches(conversations, 8, async (conversation) => ({
        conversation: {
            id: conversation.id,
            surface: conversation.surface,
            source: conversation.source,
            projectId: conversation.projectId,
            title: conversation.title,
            status: conversation.status,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            lastMessageAt: conversation.lastMessageAt,
        },
        messages: (await readAllCreativeMessages(conversation.id)).filter((message) => message.role === "user" || message.role === "assistant").map(({ metadata: _metadata, ...message }) => message),
        assets: (await listCreativeAssets(conversation.id, userId)).map(({ userId: _userId, remoteUrl: _remoteUrl, metadata: _metadata, ...asset }) => sanitizePortableData(asset)),
    }));
}

async function readAllCreativeMessages(conversationId: string) {
    let beforeSequence = 0;
    let messages: Awaited<ReturnType<typeof listCreativeMessages>> = [];
    while (true) {
        const page = await listCreativeMessages(conversationId, 0, CONVERSATION_PAGE_SIZE, beforeSequence);
        messages = [...page, ...messages];
        if (page.length < CONVERSATION_PAGE_SIZE || !page[0]?.sequence) return messages;
        beforeSequence = page[0].sequence;
    }
}

async function readDramaProjects(userId: string) {
    const summaries = await collectPages((page) => listDramaProjectSummaries(userId, { page, pageSize: PAGE_SIZE }));
    return (await mapInBatches(summaries, 8, async (summary) => getDramaProject(summary.id, userId))).filter((project) => project !== null);
}

async function collectPages<T>(load: (page: number) => Promise<{ items: T[]; total: number }>) {
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
        const result = await load(page);
        items.push(...result.items);
        if (!result.items.length || items.length >= result.total) return items;
    }
}

async function collectOffsetPages<T>(load: (offset: number) => Promise<T[]>) {
    const items: T[] = [];
    while (true) {
        const page = await load(items.length);
        items.push(...page);
        if (page.length < CONVERSATION_PAGE_SIZE) return items;
    }
}

async function mapInBatches<T, R>(items: T[], batchSize: number, mapper: (item: T) => Promise<R>) {
    const result: R[] = [];
    for (let index = 0; index < items.length; index += batchSize) result.push(...(await Promise.all(items.slice(index, index + batchSize).map(mapper))));
    return result;
}
