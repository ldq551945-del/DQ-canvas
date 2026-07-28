import { agnesModelCatalog, agnesModelConfigs } from "@/lib/agnes-model-catalog";
import { capabilityFromHint, inferModelCapability, normalizeModelId, type ModelCatalogEntry, type ModelCatalogSource } from "@/lib/model-capability";
import type { LogicalModelCapability } from "@/lib/auth/store-types";
import type { SystemChannelModelConfig, SystemChannelProtocol } from "@/lib/auth/store-types";

type ModelsResponse = Record<string, unknown> & {
    data?: unknown;
    models?: unknown;
    result?: unknown;
    error?: unknown;
    message?: unknown;
    msg?: unknown;
};

const SOURCE_PRIORITY: Record<ModelCatalogSource, number> = { configured: 1, provider: 2, official: 3 };

export function buildModelsUrl(baseUrl: string, apiFormat: "openai" | "gemini", globalAiOpc = false) {
    const normalized = baseUrl
        .trim()
        .replace(/\/+$/, "")
        .replace(/\/(?:chat\/completions|responses|images\/(?:generations|edits)|video\/generations|videos\/(?:generations)?)$/i, "");
    if (/\/models$/i.test(normalized)) return normalized;
    if (apiFormat === "gemini" && !globalAiOpc) return `${normalized.replace(/\/(?:v1|v1beta)$/i, "")}/v1beta/models`;
    return `${normalized.toLowerCase().endsWith("/v1") ? normalized : `${normalized}/v1`}/models`;
}

export function buildModelCatalogUrls(baseUrl: string, apiFormat: "openai" | "gemini", configuredPaths: unknown) {
    if (!Array.isArray(configuredPaths) || !configuredPaths.length) return [buildModelsUrl(baseUrl, apiFormat)];
    const base = new URL(baseUrl);
    return Array.from(
        new Set(
            configuredPaths.flatMap((value) => {
                if (typeof value !== "string" || !value.trim()) return [];
                try {
                    const url = new URL(value.trim(), base.origin);
                    return url.origin === base.origin ? [url.toString()] : [];
                } catch {
                    return [];
                }
            }),
        ),
    );
}

export function parseModels(payload: ModelsResponse) {
    return parseModelCatalog(payload).map((entry) => entry.id);
}

export function parseModelCatalog(payload: unknown, source: ModelCatalogSource = "provider") {
    const values = modelValues(payload);
    return mergeModelCatalogEntries(
        ...collectModelValues(values).map(({ id, metadata }) => [
            {
                id,
                capability: capabilityFromModelMetadata(metadata) || inferModelCapability(id),
                source,
            },
        ]),
    );
}

export function parseModelConfigs(payload: unknown) {
    return Object.fromEntries(
        collectModelValues(modelValues(payload)).map(({ id, metadata }) => {
            const capability = capabilityFromModelMetadata(metadata) || inferModelCapability(id);
            return [normalizeModelId(id), { ...modelConfigFromMetadata(metadata, capability), source: "provider" as const }] as const;
        }),
    ) as Record<string, SystemChannelModelConfig>;
}

export function configuredModelCatalog(models: unknown, capabilities: unknown): ModelCatalogEntry[] {
    const capabilityMap = normalizeCapabilityMap(capabilities);
    if (!Array.isArray(models)) return [];
    return mergeModelCatalogEntries(
        models.flatMap((value) => {
            if (typeof value !== "string" || !value.trim()) return [];
            const id = value.trim().replace(/^models\//i, "");
            return [{ id, capability: capabilityMap[normalizeModelId(id)] || inferModelCapability(id), source: "configured" as const }];
        }),
    );
}

export function officialModelCatalog(baseUrl: string) {
    return agnesModelCatalog(baseUrl);
}

export function officialModelConfigs(baseUrl: string) {
    return agnesModelConfigs(baseUrl);
}

export function mergeModelCatalogEntries(...catalogs: ModelCatalogEntry[][]) {
    const merged = new Map<string, ModelCatalogEntry>();
    for (const entry of catalogs.flat()) {
        const id = entry.id.trim().replace(/^models\//i, "");
        const key = normalizeModelId(id);
        if (!key) continue;
        const current = merged.get(key);
        if (!current || SOURCE_PRIORITY[entry.source] > SOURCE_PRIORITY[current.source]) merged.set(key, { id, capability: entry.capability, source: entry.source });
    }
    return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id));
}

export function modelCapabilitiesRecord(catalog: ModelCatalogEntry[], configs?: Record<string, SystemChannelModelConfig>) {
    return Object.fromEntries(catalog.map((entry) => [normalizeModelId(entry.id), configs?.[normalizeModelId(entry.id)]?.capability || entry.capability])) as Record<string, LogicalModelCapability>;
}

export function mergeModelConfigs(catalog: ModelCatalogEntry[], ...configs: Array<Record<string, SystemChannelModelConfig> | undefined>) {
    const merged: Record<string, SystemChannelModelConfig> = {};
    for (const config of configs) {
        for (const [model, incoming] of Object.entries(config || {})) {
            const key = normalizeModelId(model);
            const current = merged[key];
            if (current?.source === "manual" && incoming.source !== "manual") continue;
            merged[key] = { ...(current || {}), ...incoming };
        }
    }
    for (const entry of catalog) {
        const key = normalizeModelId(entry.id);
        const current = merged[key];
        merged[key] = current?.source === "manual" ? current : { ...(current || {}), capability: entry.capability };
    }
    return merged;
}

export function normalizeModelConfigs(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).flatMap(([model, config]) => {
            if (!config || typeof config !== "object" || Array.isArray(config)) return [];
            const raw = config as Record<string, unknown>;
            const capability = raw.capability;
            if (capability !== "text" && capability !== "image" && capability !== "video" && capability !== "audio") return [];
            return [
                [normalizeModelId(model), { ...modelConfigFromMetadata(raw, capability), ...(["manual", "provider", "official", "health"].includes(String(raw.source || "")) ? { source: raw.source as SystemChannelModelConfig["source"] } : {}) }] as const,
            ];
        }),
    ) as Record<string, SystemChannelModelConfig>;
}

export function nextModelsPageUrl(currentUrl: string, payload: ModelsResponse, apiFormat: "openai" | "gemini", lastModelId: string) {
    const token = paginationString(payload, ["nextPageToken", "next_page_token"]);
    if (token) return withQuery(currentUrl, apiFormat === "gemini" ? "pageToken" : "page_token", token);

    const cursor = paginationString(payload, ["nextCursor", "next_cursor"]);
    if (cursor) return withQuery(currentUrl, "cursor", cursor);

    const next = paginationString(payload, ["next", "nextUrl", "next_url"]);
    if (next && (/^https?:\/\//i.test(next) || next.startsWith("/"))) {
        const candidate = new URL(next, currentUrl);
        if (candidate.origin === new URL(currentUrl).origin && candidate.toString() !== currentUrl) return candidate.toString();
    }

    const hasMore = paginationValue(payload, ["has_more", "hasMore"]);
    if (hasMore === true || hasMore === "true") {
        const after = paginationString(payload, ["last_id", "lastId"]) || lastModelId;
        if (after) return withQuery(currentUrl, "after", after);
    }
    return "";
}

export function isModelCatalogUnsupported(status: number, payload: ModelsResponse) {
    if (![404, 405, 501].includes(status)) return false;
    const message = JSON.stringify(payload).toLowerCase();
    return /\/models(?:["'\\s?]|$)/.test(message) && /no handler found|method not allowed|not implemented|route not found|endpoint not found/.test(message);
}

function collectModelValues(value: unknown, depth = 0): Array<{ id: string; metadata?: Record<string, unknown> }> {
    if (!value || depth > 5) return [];
    if (Array.isArray(value)) return value.flatMap((item) => collectModelValues(item, depth + 1));
    if (typeof value === "string") return value.trim() ? [{ id: value.trim() }] : [];
    if (typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const grouped = (["text", "image", "video", "audio"] as const).flatMap((capability) =>
        [record[capability], record[`${capability}_models`], record[`${capability}Models`]].flatMap((item) => collectModelValues(item, depth + 1).map((entry) => ({ ...entry, metadata: { capability, ...(entry.metadata || {}) } }))),
    );
    if (grouped.length) return grouped;
    const nested = [record.data, record.models, record.result, record.items, record.list, record.model_list, record.modelList, record.available_models, record.availableModels].flatMap((item) => collectModelValues(item, depth + 1));
    if (nested.length) return nested;
    const direct = [record.id, record.name, record.model, record.model_id, record.modelId, record.title].find((item) => typeof item === "string" && item.trim());
    return typeof direct === "string" ? [{ id: direct.trim(), metadata: record }] : [];
}

function capabilityFromModelMetadata(record: Record<string, unknown> | undefined) {
    if (!record) return undefined;
    const directHints = [record.capability, record.type, record.task, record.task_type, record.taskType, record.category, record.kind, record.endpoint, record.route, record.path];
    for (const hint of directHints) {
        const capability = capabilityFromHint(hint);
        if (capability) return capability;
    }
    const outputCapability = capabilityFromHint(record.output_modalities ?? record.outputModalities ?? record.output_modality ?? record.outputModality);
    if (outputCapability) return outputCapability;
    const modalities = record.modalities ?? record.modality;
    if (!Array.isArray(modalities) || modalities.length <= 1) return capabilityFromHint(modalities);
    return undefined;
}

function modelConfigFromMetadata(record: Record<string, unknown> | undefined, capability: LogicalModelCapability): SystemChannelModelConfig {
    if (!record) return { capability };
    const apiFormat = record.apiFormat ?? record.api_format;
    const protocolValue = record.protocol;
    const protocol = isChannelProtocol(protocolValue) ? protocolValue : undefined;
    const createPath = firstApiPath(record, ["createPath", "create_path", "generationEndpoint", "generation_endpoint", "endpoint"]);
    const queryPath = firstApiPath(record, ["queryPath", "query_path", "pollEndpoint", "poll_endpoint", "statusEndpoint", "status_endpoint"]);
    return {
        capability,
        ...(apiFormat === "openai" || apiFormat === "gemini" ? { apiFormat } : {}),
        ...(protocol ? { protocol } : {}),
        ...(createPath && !/\/models(?:\/|$)/i.test(createPath) ? { createPath } : {}),
        ...(queryPath ? { queryPath } : {}),
    };
}

function firstApiPath(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value !== "string" || !value.trim()) continue;
        try {
            const url = new URL(value);
            return `${url.pathname}${url.search}`;
        } catch {
            return value.trim().startsWith("/") ? value.trim() : "";
        }
    }
    return "";
}

function isChannelProtocol(value: unknown): value is SystemChannelProtocol {
    return value === "auto" || value === "openai" || value === "sub2api" || value === "qingyan" || value === "globalaiopc" || value === "seedance" || value === "compatible";
}

function modelValues(payload: unknown) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    const record = payload as ModelsResponse;
    return [record.data, record.models, record.result, record.items, record.list, record.model_list, record.modelList, record.available_models, record.availableModels];
}

function normalizeCapabilityMap(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, LogicalModelCapability>;
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).flatMap(([model, capability]) => (capability === "text" || capability === "image" || capability === "video" || capability === "audio" ? [[normalizeModelId(model), capability] as const] : [])),
    ) as Record<string, LogicalModelCapability>;
}

function paginationValue(payload: ModelsResponse, keys: string[]) {
    const wrappers = [payload, payload.meta, payload.pagination, payload.data && !Array.isArray(payload.data) ? payload.data : undefined, payload.result && !Array.isArray(payload.result) ? payload.result : undefined];
    for (const wrapper of wrappers) {
        if (!wrapper || typeof wrapper !== "object") continue;
        for (const key of keys) {
            const value = (wrapper as Record<string, unknown>)[key];
            if (value !== undefined && value !== null && value !== "") return value;
        }
    }
    return undefined;
}

function paginationString(payload: ModelsResponse, keys: string[]) {
    const value = paginationValue(payload, keys);
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function withQuery(currentUrl: string, key: string, value: string) {
    const url = new URL(currentUrl);
    url.searchParams.set(key, value);
    return url.toString();
}
