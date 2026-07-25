import type { DramaCostSummary } from "@/lib/drama-project-contract";
import { getDramaProjectForUser } from "@/lib/server/drama-project-service";
import { listStoredGenerationTaskRecords } from "@/lib/server/generation-task-store";

export async function getDramaProjectCostSummary(userId: string, projectId: string): Promise<DramaCostSummary> {
    await getDramaProjectForUser(userId, projectId);
    const records = (await listStoredGenerationTaskRecords({ userId, projectId, pageSize: 100 })).all.filter((item) => item.projectId === projectId && (item.type === "image" || item.type === "video" || item.type === "audio"));
    const byType: DramaCostSummary["byType"] = {};
    let estimatedPoints = 0;
    let actualPoints = 0;
    for (const record of records) {
        const type = record.type as "image" | "video" | "audio";
        const estimated = positive(record.estimatedPoints) || positive(record.payload.estimatedPoints);
        const actual = record.status === "success" ? taskPoints(record.payload) : 0;
        estimatedPoints += estimated;
        actualPoints += actual;
        const current = byType[type] || { tasks: 0, estimatedPoints: 0, actualPoints: 0 };
        byType[type] = { tasks: current.tasks + 1, estimatedPoints: round(current.estimatedPoints + estimated), actualPoints: round(current.actualPoints + actual) };
    }
    return {
        estimatedPoints: round(estimatedPoints),
        actualPoints: round(actualPoints),
        taskCount: records.length,
        successCount: records.filter((item) => item.status === "success").length,
        failedCount: records.filter((item) => item.status === "error" || item.status === "cancelled").length,
        byType,
    };
}

function taskPoints(payload: Record<string, unknown>) {
    const billing = object(payload.billing);
    const upstream = object(payload.upstream);
    const attempts = Array.isArray(payload.attempts) ? payload.attempts.map(object) : [];
    return positive(payload.pointsCost) || positive(billing.pointsCost) || positive(upstream.pointsCost) || attempts.filter((item) => item.status === "succeeded").reduce((total, item) => total + positive(item.pointsCost), 0);
}

function object(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function positive(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function round(value: number) {
    return Number(value.toFixed(2));
}
