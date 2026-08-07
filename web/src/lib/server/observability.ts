import { createHash } from "node:crypto";

export type ObservabilityLevel = "info" | "warn" | "error";

export type HttpRouteMetric = {
    count: number;
    errors5xx: number;
    durationsMs: number[];
};

export type HttpObservabilityState = {
    startedAt: string;
    requests: number;
    errors5xx: number;
    durationsMs: number[];
    routes: Map<string, HttpRouteMetric>;
};

export type HttpObservabilitySnapshot = {
    startedAt: string;
    requests: number;
    errors5xx: number;
    errorRate: number;
    latencyMs: PercentileSnapshot;
    routes: Array<{ route: string; count: number; errors5xx: number; errorRate: number; latencyMs: PercentileSnapshot }>;
};

export type PercentileSnapshot = { p50: number; p95: number; p99: number; max: number };

const globalState = globalThis as typeof globalThis & { __dqHttpObservability?: HttpObservabilityState };
const MAX_SAMPLES = 2_000;

export function getHttpObservabilityState(): HttpObservabilityState {
    return (globalState.__dqHttpObservability ??= {
        startedAt: new Date().toISOString(),
        requests: 0,
        errors5xx: 0,
        durationsMs: [],
        routes: new Map(),
    });
}

export function recordHttpRequest(input: { method: string; route: string; status: number; durationMs: number }) {
    const state = getHttpObservabilityState();
    const durationMs = finiteDuration(input.durationMs);
    state.requests += 1;
    if (input.status >= 500) state.errors5xx += 1;
    pushSample(state.durationsMs, durationMs);
    const route = state.routes.get(input.route) ?? { count: 0, errors5xx: 0, durationsMs: [] };
    route.count += 1;
    if (input.status >= 500) route.errors5xx += 1;
    pushSample(route.durationsMs, durationMs);
    state.routes.set(input.route, route);
}

export function getHttpObservabilitySnapshot(): HttpObservabilitySnapshot {
    const state = getHttpObservabilityState();
    return {
        startedAt: state.startedAt,
        requests: state.requests,
        errors5xx: state.errors5xx,
        errorRate: ratio(state.errors5xx, state.requests),
        latencyMs: percentiles(state.durationsMs),
        routes: Array.from(state.routes, ([route, metric]) => ({
            route,
            count: metric.count,
            errors5xx: metric.errors5xx,
            errorRate: ratio(metric.errors5xx, metric.count),
            latencyMs: percentiles(metric.durationsMs),
        }))
            .sort((left, right) => right.count - left.count || left.route.localeCompare(right.route))
            .slice(0, 100),
    };
}

export function logStructured(level: ObservabilityLevel, event: string, fields: Record<string, unknown> = {}) {
    if (process.env.DQ_OBSERVABILITY_LOGS === "0") return;
    const payload = { timestamp: new Date().toISOString(), level, event, ...(sanitizeFields(fields) as Record<string, unknown>) };
    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
}

export function stableFingerprint(value: string) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function normalizeSqlForLog(sql: string) {
    return sql
        .replace(/'(?:''|[^'])*'/g, "?")
        .replace(/\b\d+(?:\.\d+)?\b/g, "?")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
}

export function redactObservabilityText(value: string) {
    return value
        .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
        .replace(/([?&](?:api[_-]?key|key|secret|signature|token)=)[^&\s]+/gi, "$1[redacted]")
        .replace(/\b(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[redacted]@")
        .slice(0, 1_000);
}

export function percentiles(samples: number[]): PercentileSnapshot {
    if (!samples.length) return { p50: 0, p95: 0, p99: 0, max: 0 };
    const sorted = [...samples].sort((left, right) => left - right);
    return {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted[sorted.length - 1] || 0,
    };
}

function percentile(sorted: number[], quantile: number) {
    return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] || 0);
}

function pushSample(samples: number[], value: number) {
    samples.push(value);
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

function finiteDuration(value: number) {
    return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

function ratio(numerator: number, denominator: number) {
    return denominator ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

function sanitizeFields(value: unknown): unknown {
    if (value instanceof Error) return { name: value.name, message: redactObservabilityText(value.message).slice(0, 500) };
    if (Array.isArray(value)) return value.map(sanitizeFields);
    if (typeof value === "string") return redactObservabilityText(value);
    if (!value || typeof value !== "object") return value;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (/authorization|cookie|secret|token|password|api[_-]?key|signature|rawpayload|raw_payload/i.test(key)) result[key] = "[redacted]";
        else result[key] = sanitizeFields(item);
    }
    return result;
}
