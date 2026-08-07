import { randomUUID } from "node:crypto";
import { Server } from "node:http";

const PATCH_KEY = Symbol.for("dq.http-observability.patched");
const STATE_KEY = "__dqHttpObservability";
const MAX_SAMPLES = 2_000;
const MAX_ROUTES = 500;
const DYNAMIC_RESOURCE_SEGMENTS = new Set([
    "account-deletion-requests",
    "announcements",
    "assets",
    "cdk",
    "channels",
    "conversations",
    "coupon-templates",
    "generation-webhooks",
    "image-tasks",
    "interactions",
    "library-assets",
    "my-prompts",
    "orders",
    "products",
    "projects",
    "promotions",
    "prompt-images",
    "render",
    "runs",
    "tasks",
    "users",
    "versions",
    "video-tasks",
    "work-cases",
    "works",
]);
const CATCH_ALL_SEGMENTS = new Set(["generation-log-assets", "reference-assets", "system"]);
const KNOWN_WEBHOOK_PROVIDERS = new Set(["alipay", "custom", "payply", "stripe", "wechat"]);

export function installHttpObservability() {
    if (globalThis[PATCH_KEY] || process.env.DQ_OBSERVABILITY_ENABLED === "0") return;
    globalThis[PATCH_KEY] = true;
    const originalEmit = Server.prototype.emit;
    Server.prototype.emit = function observedEmit(event, ...args) {
        if (event === "request") observeRequest(args[0], args[1]);
        return originalEmit.call(this, event, ...args);
    };
}

export function normalizeObservedRoute(rawUrl) {
    let pathname = "/";
    try {
        pathname = new URL(rawUrl || "/", "http://internal").pathname;
    } catch {
        pathname = "/invalid-url";
    }
    const segments = pathname.split("/");
    const normalized = [];
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const previous = segments[index - 1] || "";
        if (CATCH_ALL_SEGMENTS.has(previous)) {
            normalized.push(":path");
            break;
        }
        const providerWebhook = previous === "webhooks" && KNOWN_WEBHOOK_PROVIDERS.has(segment);
        if (!providerWebhook && (DYNAMIC_RESOURCE_SEGMENTS.has(previous) || /^\d+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) || /^[a-zA-Z0-9_-]{24,}$/.test(segment))) normalized.push(":id");
        else normalized.push(segment);
    }
    return normalized.join("/");
}

function observeRequest(request, response) {
    if (!request || !response) return;
    const route = normalizeObservedRoute(request.url);
    if (!route.startsWith("/api/")) return;
    const requestId = normalizedRequestId(request.headers?.["x-request-id"]) || randomUUID();
    request.headers["x-request-id"] = requestId;
    if (!response.headersSent && !response.hasHeader("x-request-id")) response.setHeader("x-request-id", requestId);
    const startedAt = performance.now();
    let recorded = false;
    const record = (aborted = false) => {
        if (recorded) return;
        recorded = true;
        const status = aborted && !response.writableFinished ? 499 : response.statusCode || 500;
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
        recordMetric({ method: request.method || "GET", route, status, durationMs });
        maybeLogRequest({ requestId, method: request.method || "GET", route, status, durationMs, aborted });
    };
    response.once("finish", () => record(false));
    response.once("close", () => record(true));
}

function recordMetric(input) {
    const state = getState();
    state.requests += 1;
    if (input.status >= 500) state.errors5xx += 1;
    pushSample(state.durationsMs, input.durationMs);
    const key = `${input.method} ${input.route}`;
    const routeKey = state.routes.has(key) || state.routes.size < MAX_ROUTES ? key : "OTHER";
    const metric = state.routes.get(routeKey) || { count: 0, errors5xx: 0, durationsMs: [] };
    metric.count += 1;
    if (input.status >= 500) metric.errors5xx += 1;
    pushSample(metric.durationsMs, input.durationMs);
    state.routes.set(routeKey, metric);
}

function maybeLogRequest(input) {
    const mode = process.env.DQ_HTTP_ACCESS_LOG?.trim().toLowerCase() || "errors";
    if (mode === "off" || mode === "0") return;
    const slowThresholdMs = boundedNumber(process.env.DQ_HTTP_SLOW_REQUEST_MS, 1_000, 50, 600_000);
    if (mode !== "all" && input.status < 500 && input.durationMs < slowThresholdMs) return;
    const level = input.status >= 500 ? "error" : "warn";
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event: "http.request", ...input });
    if (level === "error") console.error(line);
    else console.warn(line);
}

function getState() {
    return (globalThis[STATE_KEY] ??= { startedAt: new Date().toISOString(), requests: 0, errors5xx: 0, durationsMs: [], routes: new Map() });
}

function pushSample(samples, value) {
    samples.push(value);
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

function normalizedRequestId(value) {
    const candidate = Array.isArray(value) ? value[0] : value;
    return typeof candidate === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(candidate) ? candidate : "";
}

function boundedNumber(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
}

installHttpObservability();
