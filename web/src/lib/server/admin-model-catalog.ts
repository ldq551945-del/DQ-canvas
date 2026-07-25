type ModelsResponse = {
    data?: unknown;
    models?: unknown;
    result?: unknown;
    error?: unknown;
    message?: unknown;
    msg?: unknown;
};

export function buildModelsUrl(baseUrl: string, apiFormat: "openai" | "gemini", globalAiOpc = false) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    if (/\/models$/i.test(normalized)) return normalized;
    if (apiFormat === "gemini" && !globalAiOpc) return `${normalized.replace(/\/(?:v1|v1beta)$/i, "")}/v1beta/models`;
    return `${normalized.toLowerCase().endsWith("/v1") ? normalized : `${normalized}/v1`}/models`;
}

export function parseModels(payload: ModelsResponse) {
    return Array.from(
        new Set(
            collectModels([payload.data, payload.models, payload.result])
                .map((value) => value.replace(/^models\//, ""))
                .filter(Boolean),
        ),
    ).sort((a, b) => a.localeCompare(b));
}

export function isModelCatalogUnsupported(status: number, payload: ModelsResponse) {
    if (![404, 405, 501].includes(status)) return false;
    const message = JSON.stringify(payload).toLowerCase();
    return /\/models(?:["'\\s?]|$)/.test(message) && /no handler found|method not allowed|not implemented|route not found|endpoint not found/.test(message);
}

function collectModels(value: unknown, depth = 0): string[] {
    if (!value || depth > 3) return [];
    if (Array.isArray(value)) return value.flatMap((item) => collectModels(item, depth + 1));
    if (typeof value === "string") return [value.trim()].filter(Boolean);
    if (typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const nested = [record.data, record.models, record.result, record.items].flatMap((item) => collectModels(item, depth + 1));
    if (nested.length) return nested;
    const direct = [record.id, record.name, record.model].find((item) => typeof item === "string" && item.trim());
    if (typeof direct === "string") return [direct.trim()];
    return [];
}
