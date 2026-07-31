import { randomUUID } from "node:crypto";

import { generationTaskNextPollAt, claimDueGenerationTasks, releaseGenerationTaskLease, renewGenerationTaskLeases, scheduleGenerationTask, type GenerationTaskLease } from "@/lib/server/generation-task-scheduler";
import { failVideoTaskFromWorker, persistVideoTaskResult, queryVideoTaskUpstream } from "@/lib/server/video-task-runtime";
import { getVideoTask, type VideoTask } from "@/lib/server/video-task-store";
import { createAudioTaskUpstreamStep, markAudioTaskFailed, persistAudioTaskResult, queryAudioTaskUpstreamStep } from "@/lib/server/audio-task-runtime";
import { getAudioTask, type AudioTask } from "@/lib/server/audio-task-store";
import { createImageTaskUpstreamStep, markImageTaskFailed, persistImageTaskResult, queryImageTaskUpstreamStep } from "@/lib/server/image-task-runtime";
import { getImageTask, type ImageTask } from "@/lib/server/image-task-store";
import { getTextTask } from "@/lib/server/text-task-store";
import { runTextTaskStep } from "@/lib/server/text-task-runtime";
import { maintenanceWorkerContext } from "@/lib/server/maintenance-auth";
import { executeAgentRun } from "@/lib/server/agent-run-executor";
import { processAgentRunReview } from "@/lib/server/agent-run-execution";
import { getAgentRun, type AgentRun } from "@/lib/server/agent-run-store";

type RecoveryResult = "pending" | "result_ready" | "completed" | "failed" | "needs_review" | "deferred";

export async function runGenerationTaskRecoveryBatch(input: { origin: string; publicOrigin?: string; cookie?: string; limit?: number; taskIds?: string[]; workerId?: string }) {
    const workerId = input.workerId?.trim().slice(0, 160) || `generation-worker:${process.pid}:${randomUUID()}`;
    const leases = await claimDueGenerationTasks({ workerId, limit: input.limit, taskIds: input.taskIds, leaseMs: 90_000 });
    if (!leases.length) return { claimed: 0, pending: 0, resultReady: 0, completed: 0, failed: 0, needsReview: 0, deferred: 0 };

    const taskIds = leases.map((lease) => lease.id);
    const heartbeat = setInterval(() => {
        void renewGenerationTaskLeases(workerId, taskIds, 90_000).catch((error) => console.error("Generation worker lease heartbeat failed", { workerId, error }));
    }, 25_000);
    try {
        const persistence = leases.filter(needsPersistence);
        const queries = leases.filter((lease) => !needsPersistence(lease));
        const results = [
            ...(await runWithConcurrency(queries, 20, (lease) => processGenerationTaskLease(lease, workerId, input.origin, input.publicOrigin || input.origin, input.cookie || ""))),
            ...(await runWithConcurrency(persistence, 4, (lease) => processGenerationTaskLease(lease, workerId, input.origin, input.publicOrigin || input.origin, input.cookie || ""))),
        ];
        return summarize(results);
    } finally {
        clearInterval(heartbeat);
    }
}

async function processGenerationTaskLease(lease: GenerationTaskLease, workerId: string, origin: string, publicOrigin: string, cookie: string): Promise<RecoveryResult> {
    if (lease.type === "text") return processTextLease(lease, workerId, origin, cookie);
    if (lease.type === "image") return processImageLease(lease, workerId, origin, publicOrigin, cookie);
    if (lease.type === "audio") return processAudioLease(lease, workerId, origin, cookie);
    if (lease.type === "agent") return processAgentLease(lease, workerId, origin, cookie);
    if (lease.type !== "video") {
        await releaseGenerationTaskLease(lease.type, lease.id, workerId, { executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "worker_handler_missing" });
        return "needs_review";
    }
    return processVideoLease(lease, workerId, origin, cookie);
}

async function processAgentLease(lease: GenerationTaskLease, workerId: string, origin: string, cookie: string): Promise<RecoveryResult> {
    const run = await getAgentRun(lease.id);
    if (run?.status === "completed" && !run.reviewed && (lease.executionPhase === "review_pending" || lease.executionPhase === "reviewing")) {
        const result = await processAgentRunReview(run, origin, cookie || maintenanceWorkerContext(run.userId));
        if (result.status === "retry") {
            await releaseGenerationTaskLease("agent", run.id, workerId, {
                executionPhase: "review_pending",
                nextPollAt: generationTaskNextPollAt({ consecutiveErrors: result.attempts }),
                lastPollAt: Date.now(),
                lastUpstreamStatus: `review_error:${result.attempts}`,
            });
            return "deferred";
        }
        await releaseGenerationTaskLease("agent", run.id, workerId, {
            executionPhase: result.status === "unavailable" ? "review_unavailable" : "completed",
            nextPollAt: undefined,
            lastUpstreamStatus: result.status === "unavailable" ? "review_unavailable" : "review_completed",
        });
        return "completed";
    }
    if (!run || run.status === "completed" || run.status === "failed" || run.status === "cancelled" || run.status === "paused") {
        await releaseGenerationTaskLease("agent", lease.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: run?.status || "missing" });
        return run?.status === "completed" ? "completed" : "failed";
    }
    try {
        const childTaskIds = pendingAgentChildTaskIds(run);
        if (childTaskIds.length) {
            await runGenerationTaskRecoveryBatch({
                origin,
                cookie: cookie || maintenanceWorkerContext(run.userId),
                limit: childTaskIds.length,
                taskIds: childTaskIds,
                workerId: `${workerId}:children`.slice(0, 160),
            });
        }
        await executeAgentRun(run, origin, cookie || maintenanceWorkerContext(run.userId));
        const latest = await getAgentRun(run.id);
        if (!latest || latest.status === "completed" || latest.status === "failed" || latest.status === "cancelled" || latest.status === "paused") {
            await releaseGenerationTaskLease("agent", run.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: latest?.status || "missing" });
            return latest?.status === "completed" ? "completed" : "failed";
        }
        await releaseGenerationTaskLease("agent", run.id, workerId, {
            executionPhase: "polling",
            nextPollAt: generationTaskNextPollAt({ submittedAt: lease.submittedAt || run.createdAt }),
            lastPollAt: Date.now(),
            lastUpstreamStatus: latest.status,
        });
        return "pending";
    } catch (error) {
        const latest = await getAgentRun(run.id);
        if (latest?.status === "failed") {
            await releaseGenerationTaskLease("agent", run.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "failed" });
            return "failed";
        }
        const count = errorCount(lease.lastUpstreamStatus) + 1;
        await releaseGenerationTaskLease("agent", run.id, workerId, {
            executionPhase: "polling",
            nextPollAt: generationTaskNextPollAt({ consecutiveErrors: count }),
            lastPollAt: Date.now(),
            lastUpstreamStatus: `query_error:${count}`,
        });
        console.warn("Agent task recovery deferred", { runId: run.id, error: safeError(error) });
        return "deferred";
    }
}

export function pendingAgentChildTaskIds(run: Pick<AgentRun, "tasks">) {
    return Array.from(
        new Set(
            run.tasks.flatMap((task) => {
                if (task.status !== "running") return [];
                if (task.childTasks?.length) return task.childTasks.filter((child) => child.status === "pending").map((child) => child.id);
                return task.taskIds?.length ? task.taskIds : task.taskId ? [task.taskId] : [];
            }),
        ),
    ).slice(0, 50);
}

async function processTextLease(lease: GenerationTaskLease, workerId: string, origin: string, cookie: string): Promise<RecoveryResult> {
    const task = await getTextTask(lease.id);
    if (!task || task.status === "success" || task.status === "error" || task.status === "cancelled") {
        await releaseGenerationTaskLease("text", lease.id, workerId, { executionPhase: "completed", nextPollAt: undefined });
        return task?.status === "success" ? "completed" : "failed";
    }
    if (lease.executionPhase === "submitting" && task.status === "running" && !task.upstream?.id) {
        await releaseGenerationTaskLease("text", lease.id, workerId, { executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "submission_outcome_unknown" });
        return "needs_review";
    }
    if (!task.upstream?.id) await scheduleGenerationTask("text", task.id, { executionPhase: "submitting", nextPollAt: lease.nextPollAt, lastUpstreamStatus: "submitting" });
    try {
        const step = await runTextTaskStep(task, origin, cookie || maintenanceWorkerContext(task.userId));
        if (step.state === "completed") {
            await releaseGenerationTaskLease("text", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "completed" });
            return "completed";
        }
        if (step.state === "failed") {
            await releaseGenerationTaskLease("text", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "failed" });
            return "failed";
        }
        if (step.state === "needs_review") {
            await releaseGenerationTaskLease("text", task.id, workerId, { executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "submission_outcome_unknown" });
            return "needs_review";
        }
        const submittedAt = lease.submittedAt || Date.now();
        await releaseGenerationTaskLease("text", task.id, workerId, {
            executionPhase: lease.submittedAt ? "polling" : "submitted",
            upstreamTaskId: step.upstreamTaskId,
            queryPath: task.config.advancedConfig?.queryPath,
            submittedAt,
            nextPollAt: generationTaskNextPollAt({ submittedAt }),
            lastPollAt: Date.now(),
            lastUpstreamStatus: step.status,
        });
        return "pending";
    } catch (error) {
        const latest = await getTextTask(task.id);
        const upstreamTaskId = latest?.upstream?.id || lease.upstreamTaskId;
        const count = errorCount(lease.lastUpstreamStatus) + 1;
        await releaseGenerationTaskLease("text", task.id, workerId, {
            executionPhase: upstreamTaskId ? "polling" : "needs_review",
            upstreamTaskId,
            nextPollAt: upstreamTaskId ? generationTaskNextPollAt({ submittedAt: lease.submittedAt, consecutiveErrors: count }) : undefined,
            lastPollAt: Date.now(),
            lastUpstreamStatus: upstreamTaskId ? `query_error:${count}` : "submission_outcome_unknown",
        });
        console.warn(upstreamTaskId ? "Text task recovery deferred" : "Text task execution needs review", { taskId: task.id, error: safeError(error) });
        return upstreamTaskId ? "deferred" : "needs_review";
    }
}

async function processImageLease(lease: GenerationTaskLease, workerId: string, origin: string, publicOrigin: string, cookie: string): Promise<RecoveryResult> {
    const task = await getImageTask(lease.id);
    if (!task || task.status === "success" || task.status === "cancelled") {
        await releaseGenerationTaskLease("image", lease.id, workerId, { executionPhase: "completed", nextPollAt: undefined });
        return "completed";
    }
    if (lease.executionPhase === "submitting" && !lease.upstreamTaskId && task.status === "running") {
        await releaseGenerationTaskLease("image", lease.id, workerId, { executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "submission_outcome_unknown" });
        return "needs_review";
    }
    if (needsPersistence(lease)) return persistImageLease(task, lease, workerId, origin, cookie);
    try {
        const step = task.upstream?.id ? await queryImageTaskUpstreamStep(task, origin, cookie, cookie ? "" : task.userId) : await createImageTaskUpstreamStep(task, origin, publicOrigin, cookie, cookie ? "" : task.userId);
        const now = Date.now();
        if (step.state === "failed") {
            await markImageTaskFailed(task, step.error);
            await releaseGenerationTaskLease("image", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastPollAt: now, lastUpstreamStatus: step.status });
            return "failed";
        }
        if (step.state === "completed") {
            await releaseGenerationTaskLease("image", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "persisted" });
            return "completed";
        }
        if (step.state === "result_ready") {
            await releaseGenerationTaskLease("image", task.id, workerId, { executionPhase: "result_ready", nextPollAt: now, lastPollAt: now, lastUpstreamStatus: step.status, resultPayload: { url: step.resultUrl } });
            return "result_ready";
        }
        const latest = (await getImageTask(task.id)) || task;
        await releaseGenerationTaskLease("image", task.id, workerId, {
            executionPhase: latest.upstream?.id ? "polling" : "submitted",
            upstreamTaskId: step.upstream.id,
            channelId: latest.config.channelId,
            provider: latest.config.advancedConfig?.protocol || latest.config.apiFormat,
            queryPath: latest.config.advancedConfig?.queryPath,
            submittedAt: lease.submittedAt || now,
            nextPollAt: generationTaskNextPollAt({ submittedAt: lease.submittedAt || now, now }),
            lastPollAt: latest.upstream?.id ? now : undefined,
            lastUpstreamStatus: step.status,
        });
        return "pending";
    } catch (error) {
        const latest = await getImageTask(task.id);
        const count = errorCount(lease.lastUpstreamStatus) + 1;
        const submitted = Boolean(latest?.upstream?.id || lease.upstreamTaskId);
        await releaseGenerationTaskLease("image", task.id, workerId, {
            executionPhase: submitted ? "polling" : "needs_review",
            nextPollAt: submitted ? generationTaskNextPollAt({ consecutiveErrors: count }) : undefined,
            lastPollAt: Date.now(),
            lastUpstreamStatus: submitted ? `query_error:${count}` : "submission_outcome_unknown",
        });
        console.warn("Image task step deferred", { taskId: task.id, error: safeError(error) });
        return submitted ? "deferred" : "needs_review";
    }
}

async function persistImageLease(task: ImageTask, lease: GenerationTaskLease, workerId: string, origin: string, cookie: string): Promise<RecoveryResult> {
    const resultUrl = typeof lease.resultPayload?.url === "string" ? lease.resultPayload.url.trim() : "";
    if (!resultUrl) {
        await markImageTaskFailed(task, "图片任务已完成但没有返回图片地址");
        await releaseGenerationTaskLease("image", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "result_url_missing" });
        return "failed";
    }
    await scheduleGenerationTask("image", task.id, { executionPhase: "persisting", nextPollAt: lease.nextPollAt });
    try {
        const completed = await persistImageTaskResult(task, origin, resultUrl, cookie, cookie ? "" : task.userId);
        if (!completed || completed.status !== "success") throw new Error("图片结果保存后未进入成功状态");
        await releaseGenerationTaskLease("image", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "persisted" });
        return "completed";
    } catch (error) {
        const count = errorCount(lease.lastUpstreamStatus) + 1;
        await releaseGenerationTaskLease("image", task.id, workerId, { executionPhase: "persisting", nextPollAt: generationTaskNextPollAt({ consecutiveErrors: count }), lastUpstreamStatus: `persist_error:${count}` });
        console.warn("Image result persistence deferred", { taskId: task.id, error: safeError(error) });
        return "deferred";
    }
}

async function processAudioLease(lease: GenerationTaskLease, workerId: string, origin: string, cookie: string): Promise<RecoveryResult> {
    const task = await getAudioTask(lease.id);
    if (!task || task.status === "success" || task.status === "cancelled") {
        await releaseGenerationTaskLease("audio", lease.id, workerId, { executionPhase: "completed", nextPollAt: undefined });
        return "completed";
    }
    if (lease.executionPhase === "submitting" && !lease.upstreamTaskId && task.status === "running") {
        await releaseGenerationTaskLease("audio", lease.id, workerId, { executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "submission_outcome_unknown" });
        return "needs_review";
    }
    if (needsPersistence(lease)) return persistAudioLease(task, lease, workerId, origin, cookie);
    try {
        const step = task.upstream?.id ? await queryAudioTaskUpstreamStep(task, origin, cookie, cookie ? "" : task.userId) : await createAudioTaskUpstreamStep(task, origin, cookie, cookie ? "" : task.userId);
        const now = Date.now();
        if (step.state === "failed") {
            await markAudioTaskFailed(task, step.error);
            await releaseGenerationTaskLease("audio", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastPollAt: now, lastUpstreamStatus: step.status });
            return "failed";
        }
        if (step.state === "completed") {
            await releaseGenerationTaskLease("audio", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "persisted" });
            return "completed";
        }
        if (step.state === "result_ready") {
            await releaseGenerationTaskLease("audio", task.id, workerId, { executionPhase: "result_ready", nextPollAt: now, lastPollAt: now, lastUpstreamStatus: step.status, resultPayload: { url: step.resultUrl } });
            return "result_ready";
        }
        const latest = (await getAudioTask(task.id)) || task;
        await releaseGenerationTaskLease("audio", task.id, workerId, {
            executionPhase: latest.upstream?.id ? "polling" : "submitted",
            upstreamTaskId: step.upstreamTaskId,
            channelId: latest.config.channelId,
            provider: latest.config.advancedConfig?.protocol || latest.config.apiFormat,
            queryPath: latest.config.advancedConfig?.queryPath || step.createPath,
            submittedAt: lease.submittedAt || now,
            nextPollAt: generationTaskNextPollAt({ submittedAt: lease.submittedAt || now, now }),
            lastPollAt: latest.upstream?.id ? now : undefined,
            lastUpstreamStatus: step.status,
        });
        return "pending";
    } catch (error) {
        const count = errorCount(lease.lastUpstreamStatus) + 1;
        await releaseGenerationTaskLease("audio", task.id, workerId, {
            executionPhase: task.upstream?.id ? "polling" : "needs_review",
            nextPollAt: task.upstream?.id ? generationTaskNextPollAt({ consecutiveErrors: count }) : undefined,
            lastPollAt: Date.now(),
            lastUpstreamStatus: task.upstream?.id ? `query_error:${count}` : "submission_outcome_unknown",
        });
        return task.upstream?.id ? "deferred" : "needs_review";
    }
}

async function persistAudioLease(task: AudioTask, lease: GenerationTaskLease, workerId: string, origin: string, cookie: string): Promise<RecoveryResult> {
    const resultUrl = typeof lease.resultPayload?.url === "string" ? lease.resultPayload.url.trim() : "";
    if (!resultUrl) {
        await markAudioTaskFailed(task, "音频任务已完成但没有返回音频地址");
        await releaseGenerationTaskLease("audio", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "result_url_missing" });
        return "failed";
    }
    await scheduleGenerationTask("audio", task.id, { executionPhase: "persisting", nextPollAt: lease.nextPollAt });
    try {
        const completed = await persistAudioTaskResult(task, origin, resultUrl, cookie, cookie ? "" : task.userId);
        if (!completed || completed.status !== "success") throw new Error("音频结果保存后未进入成功状态");
        await releaseGenerationTaskLease("audio", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "persisted" });
        return "completed";
    } catch (error) {
        const count = errorCount(lease.lastUpstreamStatus) + 1;
        await releaseGenerationTaskLease("audio", task.id, workerId, { executionPhase: "persisting", nextPollAt: generationTaskNextPollAt({ consecutiveErrors: count }), lastUpstreamStatus: `persist_error:${count}` });
        console.warn("Audio result persistence deferred", { taskId: task.id, error: safeError(error) });
        return "deferred";
    }
}

async function processVideoLease(lease: GenerationTaskLease, workerId: string, origin: string, cookie: string): Promise<RecoveryResult> {
    const task = await getVideoTask(lease.id);
    if (!task || task.status === "success" || task.status === "cancelled") {
        await releaseGenerationTaskLease("video", lease.id, workerId, { executionPhase: "completed", nextPollAt: undefined });
        return "completed";
    }
    if (lease.executionPhase === "submitting" && !lease.upstreamTaskId) {
        await releaseGenerationTaskLease("video", lease.id, workerId, { executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "submission_outcome_unknown" });
        return "needs_review";
    }
    if (needsPersistence(lease)) return persistVideoLease(task, lease, workerId, origin, cookie);

    try {
        const step = await queryVideoTaskUpstream(task, origin, cookie, cookie ? "" : task.userId);
        const now = Date.now();
        if (step.state === "failed") {
            await failVideoTaskFromWorker(task, step.error);
            await releaseGenerationTaskLease("video", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastPollAt: now, lastUpstreamStatus: step.status });
            return "failed";
        }
        if (step.state === "result_ready") {
            await releaseGenerationTaskLease("video", task.id, workerId, {
                executionPhase: "result_ready",
                nextPollAt: now,
                lastPollAt: now,
                lastUpstreamStatus: step.status,
                resultPayload: { url: step.resultUrl },
            });
            return "result_ready";
        }
        await releaseGenerationTaskLease("video", task.id, workerId, {
            executionPhase: "polling",
            nextPollAt: generationTaskNextPollAt({ submittedAt: lease.submittedAt, now }),
            lastPollAt: now,
            lastUpstreamStatus: step.status,
        });
        return "pending";
    } catch (error) {
        const count = errorCount(lease.lastUpstreamStatus) + 1;
        await releaseGenerationTaskLease("video", task.id, workerId, {
            executionPhase: "polling",
            nextPollAt: generationTaskNextPollAt({ submittedAt: lease.submittedAt, consecutiveErrors: count }),
            lastPollAt: Date.now(),
            lastUpstreamStatus: `query_error:${count}`,
        });
        console.warn("Video task query deferred", { taskId: task.id, error: safeError(error) });
        return "deferred";
    }
}

async function persistVideoLease(task: VideoTask, lease: GenerationTaskLease, workerId: string, origin: string, cookie: string): Promise<RecoveryResult> {
    const resultUrl = typeof lease.resultPayload?.url === "string" ? lease.resultPayload.url.trim() : "";
    if (!resultUrl) {
        await failVideoTaskFromWorker(task, "视频任务已完成但没有返回视频地址");
        await releaseGenerationTaskLease("video", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "result_url_missing" });
        return "failed";
    }
    await scheduleGenerationTask("video", task.id, { executionPhase: "persisting", nextPollAt: lease.nextPollAt });
    try {
        const completed = await persistVideoTaskResult(task, resultUrl, origin, cookie, cookie ? "" : task.userId);
        if (!completed || completed.status !== "success") throw new Error("视频结果保存后未进入成功状态");
        await releaseGenerationTaskLease("video", task.id, workerId, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "persisted" });
        return "completed";
    } catch (error) {
        const count = errorCount(lease.lastUpstreamStatus) + 1;
        await releaseGenerationTaskLease("video", task.id, workerId, {
            executionPhase: "persisting",
            nextPollAt: generationTaskNextPollAt({ consecutiveErrors: count }),
            lastUpstreamStatus: `persist_error:${count}`,
        });
        console.warn("Video result persistence deferred", { taskId: task.id, error: safeError(error) });
        return "deferred";
    }
}

function needsPersistence(lease: GenerationTaskLease) {
    return lease.executionPhase === "result_ready" || lease.executionPhase === "persisting";
}

async function runWithConcurrency<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>) {
    const results: R[] = [];
    let cursor = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (cursor < items.length) {
                const index = cursor++;
                results[index] = await run(items[index]);
            }
        }),
    );
    return results;
}

function summarize(results: RecoveryResult[]) {
    return {
        claimed: results.length,
        pending: results.filter((item) => item === "pending").length,
        resultReady: results.filter((item) => item === "result_ready").length,
        completed: results.filter((item) => item === "completed").length,
        failed: results.filter((item) => item === "failed").length,
        needsReview: results.filter((item) => item === "needs_review").length,
        deferred: results.filter((item) => item === "deferred").length,
    };
}

function errorCount(status?: string) {
    const count = Number(status?.match(/(?:query|persist)_error:(\d+)/)?.[1] || 0);
    return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function safeError(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 300) : "unknown";
}
