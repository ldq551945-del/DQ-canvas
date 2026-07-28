import { creativeConversationSourceForSurface, isCreativeConversationSourceCompatible, normalizeCreativeConversationSource, normalizeCreativeSurface, type CreativeAssetType, type CreativeConversationStatus } from "@/lib/creative-runtime-contract";
import { CREATIVE_UPLOAD_MAX_BYTES, isCreativeUploadMimeType } from "@/lib/creative-upload";
import {
    appendCreativeConversationExchange,
    createCreativeConversation,
    getCreativeAsset,
    getCreativeConversation,
    listCreativeAssets,
    listCreativeConversations,
    listCreativeMessages,
    registerCreativeAssets,
    updateCreativeConversation,
} from "@/lib/server/creative-runtime-store";
import { writePersistentMediaDataUrl } from "@/lib/server/reference-asset-store";
import { getLocalMediaRegistrations } from "@/lib/server/local-media-registry";
import { getCreativeWorkbenchSessionDetail, listCreativeWorkbenchSessionSummaries } from "@/lib/server/creative-workbench-session-store";
import type { WorkbenchWorkspace } from "@/lib/workbench-session-contract";
import { normalizeWorkbenchAgentAttachments, type WorkbenchAgentAttachment } from "@/lib/workbench-agent-attachment";

export class CreativeRuntimeServiceError extends Error {
    constructor(
        message: string,
        public readonly status: number,
    ) {
        super(message);
    }
}

export async function createConversationForUser(userId: string, value: unknown) {
    const input = object(value);
    const surface = normalizeCreativeSurface(input.surface);
    const source = input.source === undefined ? (surface ? creativeConversationSourceForSurface(surface) : null) : normalizeCreativeConversationSource(input.source);
    const projectId = optionalText(input.projectId, 160);
    const title = optionalText(input.title, 120);
    if (!surface) throw new CreativeRuntimeServiceError("创作入口不正确", 400);
    if (!source || !isCreativeConversationSourceCompatible(surface, source)) throw new CreativeRuntimeServiceError("创作会话来源不正确", 400);
    if (surface === "chat" && projectId) throw new CreativeRuntimeServiceError("普通对话不接受项目标识", 400);
    if (surface !== "chat" && !projectId) throw new CreativeRuntimeServiceError(surface === "canvas" ? "画布标识不能为空" : "短剧项目标识不能为空", 400);
    return createCreativeConversation(userId, { surface, source, projectId, title });
}

export function listConversationsForUser(userId: string, input: { surface?: string | null; source?: string | null; status?: string | null; limit?: string | null; offset?: string | null }) {
    const surface = input.surface ? normalizeCreativeSurface(input.surface) : undefined;
    const source = input.source ? normalizeCreativeConversationSource(input.source) : undefined;
    if (input.surface && !surface) throw new CreativeRuntimeServiceError("创作入口不正确", 400);
    if (input.source && !source) throw new CreativeRuntimeServiceError("创作会话来源不正确", 400);
    const status = normalizeStatus(input.status);
    return listCreativeConversations(userId, { surface: surface || undefined, source: source || undefined, status, limit: Number(input.limit), offset: Number(input.offset) });
}

export function listWorkbenchSessionsForUser(userId: string, workspaceValue: unknown, limit: number) {
    const workspace = normalizeWorkbenchWorkspace(workspaceValue);
    if (!workspace) throw new CreativeRuntimeServiceError("工作台类型不正确", 400);
    return listCreativeWorkbenchSessionSummaries(userId, workspace, limit);
}

export async function getWorkbenchSessionForUser(userId: string, id: string, workspaceValue: unknown, beforeSequence = 0) {
    const workspace = normalizeWorkbenchWorkspace(workspaceValue);
    if (!workspace) throw new CreativeRuntimeServiceError("工作台类型不正确", 400);
    const session = await getCreativeWorkbenchSessionDetail(userId, id, workspace, Math.max(0, Math.floor(beforeSequence)));
    if (!session) throw new CreativeRuntimeServiceError("工作台会话不存在", 404);
    return session;
}

export async function getConversationForUser(userId: string, id: string) {
    const conversation = await getCreativeConversation(id);
    if (!conversation || conversation.userId !== userId) throw new CreativeRuntimeServiceError("创作会话不存在", 404);
    return conversation;
}

export async function updateConversationForUser(userId: string, id: string, value: unknown) {
    await getConversationForUser(userId, id);
    const input = object(value);
    const title = input.title === undefined ? undefined : optionalText(input.title, 120) || "新对话";
    const status = input.status === undefined ? undefined : normalizeStatus(input.status);
    if (input.status !== undefined && !status) throw new CreativeRuntimeServiceError("会话状态不正确", 400);
    return updateCreativeConversation(id, userId, { title, status });
}

export async function listMessagesForUser(userId: string, id: string, afterSequence: number, limit: number, beforeSequence = 0) {
    await getConversationForUser(userId, id);
    return listCreativeMessages(id, afterSequence, limit, beforeSequence);
}

export async function listAssetsForUser(userId: string, id: string) {
    await getConversationForUser(userId, id);
    return listCreativeAssets(id, userId);
}

export async function getAssetForUser(userId: string, id: string) {
    const asset = await getCreativeAsset(id);
    if (!asset || asset.userId !== userId || asset.status === "deleted") throw new CreativeRuntimeServiceError("创作资产不存在", 404);
    return asset;
}

export async function uploadAssetForUser(userId: string, conversationId: string, file: File) {
    const conversation = await getConversationForUser(userId, conversationId);
    if (conversation.status !== "active") throw new CreativeRuntimeServiceError("已归档会话不能上传素材", 409);
    const type = isCreativeUploadMimeType(file.type) ? creativeAssetType(file.type) : null;
    if (!type) throw new CreativeRuntimeServiceError("仅支持图片、视频和音频素材", 400);
    if (!file.size) throw new CreativeRuntimeServiceError("上传文件为空", 400);
    if (file.size > CREATIVE_UPLOAD_MAX_BYTES) throw new CreativeRuntimeServiceError("单个素材不能超过 20MB", 413);
    const dataUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
    let stored: Awaited<ReturnType<typeof writePersistentMediaDataUrl>>;
    try {
        stored = await writePersistentMediaDataUrl(dataUrl, type, { ownerUserId: userId, source: "creative-upload", originalName: file.name, conversationId, maxBytes: CREATIVE_UPLOAD_MAX_BYTES });
    } catch (error) {
        throw new CreativeRuntimeServiceError(error instanceof Error ? error.message : "素材保存失败", 400);
    }
    const url = stored.url || `/api/reference-assets/${stored.token}`;
    const [asset] = await registerCreativeAssets([
        {
            userId,
            conversationId,
            sourceRunId: "upload",
            sourceTaskId: stored.token,
            ordinal: 0,
            type,
            title: optionalText(file.name, 160) || `上传${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}`,
            storageKind: stored.storage === "object" ? "object" : "local",
            storageKey: stored.token,
            remoteUrl: /^https?:\/\//i.test(url) ? url : undefined,
            serverUrl: /^https?:\/\//i.test(url) ? undefined : url,
            mimeType: stored.mimeType,
            bytes: stored.bytes,
            metadata: { source: "upload", originalName: file.name, storageClass: "permanent" },
        },
    ]);
    return asset;
}

export async function appendWorkbenchExchangeForUser(userId: string, input: { conversationId: string; workspace: "image" | "video"; prompt: string; reply: string; attachments?: unknown }) {
    const conversation = await getConversationForUser(userId, input.conversationId);
    if (conversation.surface !== "chat" || conversation.source !== `${input.workspace}-workbench`) throw new CreativeRuntimeServiceError("工作台会话入口不正确", 409);
    const attachments = await validateWorkbenchAttachments(userId, input.attachments);
    return appendCreativeConversationExchange({
        userId,
        conversationId: conversation.id,
        userContent: input.prompt,
        assistantContent: input.reply,
        userMetadata: { workspace: input.workspace, ...(attachments.length ? { attachments } : {}) },
        assistantMetadata: { workspace: input.workspace },
    });
}

async function validateWorkbenchAttachments(userId: string, value: unknown): Promise<WorkbenchAgentAttachment[]> {
    if (value === undefined) return [];
    const input = Array.isArray(value) ? value : [];
    const requested = normalizeWorkbenchAgentAttachments(value);
    if (!input.length || requested.length !== input.length) throw new CreativeRuntimeServiceError("参考素材信息无效", 400);
    const registrations = await getLocalMediaRegistrations(requested.map((item) => item.storageKey));
    const registrationByKey = new Map(registrations.map((item) => [item.storageKey, item]));
    return requested.map((item) => {
        const registration = registrationByKey.get(item.storageKey);
        if (!registration || registration.ownerUserId !== userId || registration.storageClass !== "permanent" || registration.type !== item.kind) throw new CreativeRuntimeServiceError("参考素材不存在或无权访问", 404);
        const prefix = registration.scope === "generation" ? "/api/generation-log-assets/" : "/api/reference-assets/";
        return {
            ...item,
            name: registration.originalName || item.name,
            url: `${prefix}${registration.storageKey.split("/").map(encodeURIComponent).join("/")}`,
            mimeType: registration.mimeType,
        };
    });
}

export async function registerGenerationLogAssetsForUser(
    userId: string,
    input: {
        conversationId: string;
        logId: string;
        taskId?: string;
        source: "image-workbench" | "video-workbench";
        title: string;
        assets: Array<{ type: "image" | "video"; url: string; remoteUrl?: string; serverUrl?: string; mimeType?: string; width?: number; height?: number; bytes?: number }>;
    },
) {
    await getConversationForUser(userId, input.conversationId);
    return registerCreativeAssets(
        input.assets.map((asset, ordinal) => {
            const remoteUrl = asset.remoteUrl || (/^https?:\/\//i.test(asset.url) ? asset.url : undefined);
            const serverUrl = asset.serverUrl || (asset.url.startsWith("/") ? asset.url : undefined);
            return {
                userId,
                conversationId: input.conversationId,
                sourceRunId: `${input.source}:${input.logId}`,
                sourceTaskId: input.taskId || input.logId,
                ordinal,
                type: asset.type,
                title: `${input.title || (asset.type === "image" ? "工作台图片" : "工作台视频")} ${ordinal + 1}`,
                storageKind: serverUrl ? ("local" as const) : ("remote" as const),
                remoteUrl,
                serverUrl,
                mimeType: asset.mimeType,
                width: asset.width,
                height: asset.height,
                bytes: asset.bytes,
                metadata: { source: input.source, generationLogId: input.logId },
            };
        }),
    );
}

export async function registerGenerationTaskAssetsForUser(
    userId: string,
    input: {
        conversationId?: string;
        runId?: string;
        surface?: "chat" | "canvas" | "drama";
        projectId?: string;
        taskId: string;
        title: string;
        assets: Array<{ type: "image" | "video" | "audio"; url: string; mimeType?: string; width?: number; height?: number; durationMs?: number; bytes?: number }>;
    },
) {
    if (!input.conversationId || !input.assets.length) return [];
    await getConversationForUser(userId, input.conversationId);
    return registerCreativeAssets(
        input.assets.map((asset, ordinal) => {
            const remoteUrl = /^https?:\/\//i.test(asset.url) ? asset.url : undefined;
            const serverUrl = asset.url.startsWith("/") ? asset.url : undefined;
            return {
                userId,
                conversationId: input.conversationId!,
                sourceRunId: input.runId || `${input.surface || "task"}:${input.projectId || input.conversationId}`,
                sourceTaskId: input.taskId,
                ordinal,
                type: asset.type,
                title: input.title || `生成${asset.type === "image" ? "图片" : asset.type === "video" ? "视频" : "音频"}`,
                storageKind: serverUrl ? ("local" as const) : ("remote" as const),
                remoteUrl,
                serverUrl,
                mimeType: asset.mimeType,
                width: asset.width,
                height: asset.height,
                durationMs: asset.durationMs,
                bytes: asset.bytes,
                metadata: { surface: input.surface, projectId: input.projectId },
            };
        }),
    );
}

function normalizeStatus(value: unknown): CreativeConversationStatus | undefined {
    return value === "active" || value === "archived" ? value : undefined;
}

function normalizeWorkbenchWorkspace(value: unknown): WorkbenchWorkspace | null {
    return value === "image" || value === "video" ? value : null;
}

function creativeAssetType(mimeType: string): Exclude<CreativeAssetType, "text"> | null {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return null;
}

function object(value: unknown) {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function optionalText(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) || undefined : undefined;
}
