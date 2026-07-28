import type { AdminGenerationChannel, AdminGenerationOperationsPayload, AdminGenerationTask } from "@/lib/admin-generation-operations";
import { findPublicUserIdsByKeyword, getAuthSettings, getPublicUsersByIds } from "@/lib/auth/store";
import type { GenerationAttempt } from "@/lib/server/generation-attempt";
import { getChannelRuntimeHealth, isChannelRuntimeCooling } from "@/lib/server/channel-runtime-health";
import { generationTaskPointsCost, listStoredGenerationTaskRecords, type GenerationTaskRecordListOptions, type StoredGenerationTaskRecord } from "@/lib/server/generation-task-store";

export async function listAdminGenerationOperations(options: GenerationTaskRecordListOptions): Promise<AdminGenerationOperationsPayload> {
    const settingsPromise = getAuthSettings();
    const searchUserIds = options.search?.trim() ? await findPublicUserIdsByKeyword(options.search) : [];
    const result = await listStoredGenerationTaskRecords({ ...options, searchUserIds, includeAll: false });
    const [settings, users] = await Promise.all([settingsPromise, getPublicUsersByIds(result.items.map((record) => record.userId))]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const items = result.items.map((record) => taskSummary(record, usersById.get(record.userId)));
    return {
        items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        summary: result.summary,
        channels: channelSummaries(settings),
    };
}

function taskSummary(record: StoredGenerationTaskRecord, user?: { accountId: string; username: string; displayName: string }): AdminGenerationTask {
    const payload = record.payload;
    const config = object(payload.config);
    const upstream = object(payload.upstream);
    const tasks = Array.isArray(payload.tasks) ? payload.tasks.map(object) : [];
    const failedTask = tasks.find((task) => task.status === "failed" && text(task.id));
    const model = firstText(payload.logicalModelId, payload.model, config.model, config.imageModel, config.videoModel, config.audioModel, upstream.model, tasks.find((task) => text(task.model))?.model);
    const pointsCost = generationTaskPointsCost(payload);
    return {
        id: record.id,
        userId: record.userId,
        accountId: user?.accountId,
        username: user?.username || "",
        displayName: user?.displayName || user?.username || "用户信息不可用",
        type: record.type,
        status: record.status,
        surface: record.surface,
        conversationId: record.conversationId,
        runId: record.runId,
        projectId: record.projectId,
        parentTaskId: record.parentTaskId,
        attemptNo: record.attemptNo,
        model,
        channelId: firstText(payload.channelId, config.channelId, upstream.channelId),
        attempts: generationAttempts(payload.attempts),
        prompt: firstText(payload.prompt, config.prompt, tasks.find((task) => text(task.prompt))?.prompt).slice(0, 500),
        error: firstText(payload.error, tasks.find((task) => text(task.error))?.error).slice(0, 1000) || undefined,
        durationMs: Math.max(0, record.updatedAt - record.createdAt),
        pointsCost: Number(pointsCost.toFixed(2)),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        canCancel: record.status === "pending" || record.status === "running" || record.status === "paused",
        retryTaskId: record.type === "agent" ? text(failedTask?.id) || undefined : undefined,
    };
}

function channelSummaries(settings: Awaited<ReturnType<typeof getAuthSettings>>): AdminGenerationChannel[] {
    const channels = new Map(settings.systemChannels.map((channel) => [channel.id, channel]));
    return settings.logicalModels.flatMap((model) =>
        model.bindings.map((binding) => {
            const channel = channels.get(binding.channelId);
            return {
                id: channel?.id || binding.channelId,
                name: channel?.name || binding.channelId,
                capability: model.capability,
                logicalModelId: model.id,
                logicalModelName: model.name,
                upstreamModel: binding.upstreamModel,
                enabled: Boolean(model.enabled && binding.enabled && channel?.enabled),
                runtimeHealth: (() => {
                    const health = getChannelRuntimeHealth(channel?.id || binding.channelId, model.capability);
                    return {
                        status: isChannelRuntimeCooling(channel?.id || binding.channelId, model.capability) ? ("cooling" as const) : ("healthy" as const),
                        consecutiveFailures: health.consecutiveFailures,
                        cooldownUntil: health.cooldownUntil,
                        lastError: health.lastError,
                    };
                })(),
            };
        }),
    );
}

function firstText(...values: unknown[]) {
    return values.map(text).find(Boolean) || "";
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function generationAttempts(value: unknown): GenerationAttempt[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
        .map((item) => ({
            attemptNo: Number(item.attemptNo) || 0,
            channelId: text(item.channelId) || undefined,
            model: text(item.model),
            status: (item.status === "succeeded" || item.status === "failed" ? item.status : "running") as GenerationAttempt["status"],
            startedAt: Number(item.startedAt) || 0,
            completedAt: Number(item.completedAt) || undefined,
            pointsCost: Number(item.pointsCost) > 0 ? Number(item.pointsCost) : undefined,
            error: text(item.error) || undefined,
        }));
}

function object(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
