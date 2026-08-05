const DEFAULT_GENERATION_ERROR_MESSAGE = "生成失败，请稍后重试。";

export function generationErrorMessage(error: unknown) {
    const raw = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : providerPayloadMessage(error);
    const providerMessage = extractStructuredProviderMessage(raw) || extractWrappedProviderMessage(raw);
    const displayMessage = providerMessage || raw;
    if (/\b(?:dial tcp|connection refused|connection reset|no such host|i\/o timeout|context deadline exceeded|network error|failed to fetch|fetch failed|socket hang up|econnrefused|econnreset|etimedout)\b/i.test(displayMessage)) return "网络异常。";
    if (!providerMessage) {
        if (/\b429\b/.test(raw)) return "服务当前繁忙，请稍后重试。";
        if (/\b(?:401|403)\b/.test(raw)) return "生成服务鉴权失败，请检查渠道配置。";
        if (/\b404\b/.test(raw)) return "生成服务地址不可用，请检查渠道配置。";
        if (/\b(?:500|502|503|504)\b/.test(raw) || containsInfrastructureDetails(raw)) return "网络异常。";
    }
    return displayMessage || DEFAULT_GENERATION_ERROR_MESSAGE;
}

function extractStructuredProviderMessage(raw: string) {
    for (let index = raw.indexOf("{"); index >= 0; index = raw.indexOf("{", index + 1)) {
        try {
            const message = providerPayloadMessage(JSON.parse(raw.slice(index).trim()));
            if (message) return message;
        } catch {
            // Providers commonly append JSON after an HTTP status line.
        }
    }
    return "";
}

function extractWrappedProviderMessage(raw: string) {
    const wrapped = raw.match(/^接口请求失败[:：]\s*(.*)$/s)?.[1] ?? raw.match(/^Request failed with status code \d{3}\s*[:：-]?\s*(.+)$/is)?.[1];
    if (!wrapped) return "";
    const message = wrapped.replace(/^\d{3}(?:\s+(?:Bad Gateway|Service Unavailable|Gateway Timeout|Internal Server Error|Not Found|Unauthorized|Forbidden|Too Many Requests))?\s*[:：-]?\s*/i, "").trim();
    return message && !containsInfrastructureDetails(message) ? message : "";
}

function providerPayloadMessage(payload: unknown): string {
    if (typeof payload === "string") return payload.trim();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
    const record = payload as Record<string, unknown>;
    if (record.error && typeof record.error === "object") {
        const nested = providerPayloadMessage(record.error);
        if (nested) return nested;
    }
    for (const key of ["message", "msg", "detail"] as const) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return typeof record.error === "string" ? record.error.trim() : "";
}

function containsInfrastructureDetails(value: string) {
    return /(?:接口请求失败|Request failed with status code|https?:\/\/|\b(?:GET|POST|PUT|PATCH|DELETE)\s+["']?|Bad Gateway|Service Unavailable|Gateway Timeout|upstream_error)/i.test(value);
}
