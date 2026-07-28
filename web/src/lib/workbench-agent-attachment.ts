export const WORKBENCH_AGENT_ATTACHMENT_LIMIT = 20;

export type WorkbenchAgentAttachment = {
    kind: "image" | "video" | "audio";
    name: string;
    url: string;
    storageKey: string;
    mimeType: string;
    width?: number;
    height?: number;
    durationMs?: number;
};

export function normalizeWorkbenchAgentAttachments(value: unknown): WorkbenchAgentAttachment[] {
    if (!Array.isArray(value)) return [];
    const attachments: WorkbenchAgentAttachment[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const input = item as Record<string, unknown>;
        const kind = input.kind === "video" || input.kind === "audio" ? input.kind : input.kind === "image" ? "image" : null;
        const storageKey = storageKeyValue(input.storageKey);
        const url = stableMediaUrl(input.url);
        if (!kind || !storageKey || !url) continue;
        const identity = `${kind}:${storageKey}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        attachments.push({
            kind,
            name: text(input.name, 260) || mediaLabel(kind),
            url,
            storageKey,
            mimeType: text(input.mimeType, 120) || `${kind}/${kind === "image" ? "png" : kind === "video" ? "mp4" : "mpeg"}`,
            ...positiveDimensions(input),
        });
        if (attachments.length >= WORKBENCH_AGENT_ATTACHMENT_LIMIT) break;
    }
    return attachments;
}

export function workbenchAgentAttachmentSignature(attachments: WorkbenchAgentAttachment[] | undefined) {
    return (attachments || []).map((item) => `${item.kind}:${item.storageKey}`).join("|");
}

function positiveDimensions(input: Record<string, unknown>) {
    const width = positiveInteger(input.width, 100_000);
    const height = positiveInteger(input.height, 100_000);
    const durationMs = positiveInteger(input.durationMs, 24 * 60 * 60 * 1000);
    return { ...(width ? { width } : {}), ...(height ? { height } : {}), ...(durationMs ? { durationMs } : {}) };
}

function positiveInteger(value: unknown, max: number) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number > 0 ? Math.min(number, max) : undefined;
}

function storageKeyValue(value: unknown) {
    const key = text(value, 700).replaceAll("\\", "/").replace(/^\/+/, "");
    return key.startsWith("permanent/") ? key : "";
}

function stableMediaUrl(value: unknown) {
    const source = text(value, 2000);
    if (!source) return "";
    try {
        const path = new URL(source, "http://vozeb.local").pathname;
        return path.startsWith("/api/reference-assets/") || path.startsWith("/api/generation-log-assets/") ? `${path}${new URL(source, "http://vozeb.local").search}` : "";
    } catch {
        return "";
    }
}

function mediaLabel(kind: WorkbenchAgentAttachment["kind"]) {
    return kind === "image" ? "参考图" : kind === "video" ? "参考视频" : "参考音频";
}

function text(value: unknown, max: number) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}
