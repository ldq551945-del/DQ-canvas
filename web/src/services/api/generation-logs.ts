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
    bytes?: number;
};

type GenerationLogRecordInput = {
    conversationId?: string;
    id?: string;
    taskId?: string;
    kind: GenerationLogKind;
    source: GenerationLogSource;
    status: GenerationLogStatus;
    title?: string;
    prompt?: string;
    model?: string;
    summary?: string;
    durationMs?: number;
    count?: number;
    successCount?: number;
    failCount?: number;
    assets?: GenerationLogAssetInput[];
    error?: string;
    createdAt?: string | number;
    completedAt?: string | number;
};

type GenerationLogRecordResponse = {
    id: string;
    assets: Array<GenerationLogAssetInput & { url: string }>;
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
    taskId?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
};

export async function listGenerationLogs(params: { kind?: GenerationLogKind; source?: GenerationLogSource; pageSize?: number } = {}) {
    const search = new URLSearchParams();
    if (params.kind) search.set("kind", params.kind);
    if (params.source) search.set("source", params.source);
    if (params.pageSize) search.set("pageSize", String(params.pageSize));
    const response = await fetch(`/api/generation-logs${search.size ? `?${search.toString()}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()) as { items: StoredGenerationLogRecord[]; total: number; page: number; pageSize: number };
}

export async function recordGenerationLog(input: GenerationLogRecordInput) {
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
