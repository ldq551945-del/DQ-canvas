import type { LogicalModelCapability } from "@/lib/auth/store";
import { getStoredGenerationTaskByUpstream } from "@/lib/server/generation-task-store";

export async function userOwnsGenerationUpstreamTask(input: { userId: string; capability: LogicalModelCapability; channelId: string; upstreamModel: string; upstreamTaskId: string; operation: "query" | "cancel" }) {
    const record = await getStoredGenerationTaskByUpstream(input.capability, input.userId, input.channelId, input.upstreamTaskId);
    if (!record || (record.status === "cancelled" && input.operation !== "cancel")) return false;
    const config = objectValue(record.payload.config);
    return sameModel(String(config.model || ""), input.upstreamModel);
}

function objectValue(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function sameModel(left: string, right: string) {
    return normalizeModel(left) === normalizeModel(right);
}

function normalizeModel(value: string) {
    return value
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
}
