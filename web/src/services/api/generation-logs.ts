import type { GenerationLogRequestSnapshot } from "@/lib/generation-log-snapshot";

type GenerationLogKind = "image" | "video";
type GenerationLogSource = "image-workbench" | "video-workbench" | "canvas" | "unknown";
type GenerationLogStatus = "pending" | "success" | "failed";

type GenerationLogAssetInput = {
    type: GenerationLogKind;
    url?: string;
    remoteUrl?: string;
    serverUrl?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    bytes?: number;
};

type GenerationLogDraftInput = {
    conversationId?: string;
    id?: string;
    kind: GenerationLogKind;
    source: GenerationLogSource;
    status: "pending";
    title?: string;
    prompt?: string;
    model?: string;
    summary?: string;
    durationMs?: number;
    count?: number;
    requestSnapshot?: GenerationLogRequestSnapshot;
    createdAt?: string | number;
};

type GenerationLogRecordResponse = {
    id: string;
    assets: Array<GenerationLogAssetInput & { url: string }>;
    requestSnapshot?: GenerationLogRequestSnapshot;
};

export type StoredGenerationLogRecord = {
    id: string;
    conversationId?: string;
    kind: GenerationLogKind;
    source: GenerationLogSource;
    status: GenerationLogStatus;
    title: string;
    prompt: string;
    model: string;
    summary: string;
    durationMs: number;
    count: number;
    successCount: number;
    failCount: number;
    assets: Array<GenerationLogAssetInput & { url: string }>;
    requestSnapshot?: GenerationLogRequestSnapshot;
    taskId?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
};

export async function listGenerationLogs(params: { kind?: GenerationLogKind; source?: GenerationLogSource; page?: number; pageSize?: number } = {}) {
    const search = new URLSearchParams();
    if (params.kind) search.set("kind", params.kind);
    if (params.source) search.set("source", params.source);
    if (params.page) search.set("page", String(params.page));
    if (params.pageSize) search.set("pageSize", String(params.pageSize));
    const response = await fetch(`/api/generation-logs${search.size ? `?${search.toString()}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()) as { items: StoredGenerationLogRecord[]; total: number; page: number; pageSize: number };
}

export async function recordGenerationLog(input: GenerationLogDraftInput) {
    const response = await fetch("/api/generation-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readError(response));
    const payload = (await response.json()) as { log?: GenerationLogRecordResponse };
    if (!payload.log) throw new Error("记录生成日志失败");
    return payload.log;
}

export async function renameGenerationLog(id: string, title: string) {
    return patchGenerationLog({ action: "rename", id, title });
}

export async function deleteGenerationLogResults(id: string, slotIds: string[]) {
    return patchGenerationLog({ action: "delete-results", id, slotIds });
}

export async function deleteGenerationLogs(ids: string[]) {
    if (!ids.length) return { deleted: 0 };
    const response = await fetch("/api/generation-logs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()) as { deleted: number };
}

function readError(response: Response) {
    return response
        .json()
        .then((payload: { error?: string }) => payload.error || "记录生成日志失败")
        .catch(() => "记录生成日志失败");
}

async function patchGenerationLog(input: { action: "rename"; id: string; title: string } | { action: "delete-results"; id: string; slotIds: string[] }) {
    const response = await fetch("/api/generation-logs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readError(response));
    const payload = (await response.json()) as { log?: GenerationLogRecordResponse };
    if (!payload.log) throw new Error("更新生成记录失败");
    return payload.log;
}
