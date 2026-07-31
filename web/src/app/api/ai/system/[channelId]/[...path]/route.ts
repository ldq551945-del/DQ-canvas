import { NextResponse } from "next/server";

import { consumeUserPoints, getAuthSettings, isQuotaExceededError, refundUserPoints, type ApiCallFormat, type GenerationPointMultipliers, type PointUsageKind } from "@/lib/auth/store";
import { getCurrentUser } from "@/lib/auth/session";
import { DEFAULT_CHANNEL_CONNECT_ERROR } from "@/lib/server/generation-errors";
import { limitMediaResponseBody, mediaResponseExceedsLimit } from "@/lib/server/media-response-limit";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { checkMediaProxyRateLimit, isSafeOutboundUrl, rateLimitHeaders } from "@/lib/server/security";
import { resolveLogicalBillingModel } from "@/lib/server/logical-model-router";
import { readRequestBodyBytes, RequestBodyTooLargeError } from "@/lib/server/request-body-limit";
import { resolveGlobalAiOpcPathPreset, resolveGlobalAiOpcPreset } from "@/lib/globalaiopc-catalog";
import { adaptGlobalAiOpcTextRequest, adaptGlobalAiOpcTextResponse, isGlobalAiOpcChannel } from "@/lib/server/globalaiopc-proxy";
import { SYSTEM_AI_LOGICAL_MODEL_HEADER, SYSTEM_AI_POINTS_IDEMPOTENCY_HEADER, SYSTEM_AI_UPSTREAM_MODEL_HEADER } from "@/lib/server/system-ai-billing";
import { isAgnesApiBaseUrl } from "@/lib/agnes-model-catalog";
import { channelConnectionReady, protocolAuthHeaders, resolveChannelModelConfig } from "@/lib/channel-protocol-registry";
import { authorizedMaintenanceUserId } from "@/lib/server/maintenance-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

configureServerProxyDispatcher();

type RouteContext = {
    params: Promise<{ channelId: string; path: string[] }>;
};
type PointsRequest = { model: string; amount: number; usageKind: PointUsageKind };
type ProxyRequestBody = { body?: BodyInit; pointsPayload?: ArrayBuffer | Record<string, unknown> };
const MAX_PROXY_BODY_BYTES = 4 * 1024 * 1024;
const MAX_PROXY_MULTIPART_BYTES = 25 * 1024 * 1024;
const SYSTEM_MEDIA_TIMEOUT_MS = 30 * 1000;
const MAX_SYSTEM_MEDIA_REDIRECTS = 4;

export async function GET(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

export async function HEAD(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

export async function POST(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
    return proxySystemRequest(request, context);
}

async function proxySystemRequest(request: Request, context: RouteContext) {
    const currentUser = await getCurrentUser();
    const userId = currentUser?.id || authorizedMaintenanceUserId(request);
    if (!userId) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const { channelId, path } = await context.params;
    const settings = await getAuthSettings();
    const channel = settings.systemChannels.find((item) => item.id === channelId && item.enabled);
    if (!channel || !channelConnectionReady(channel)) return NextResponse.json({ error: "默认接口未配置或已停用" }, { status: 404 });

    if (isMediaProxyPath(path)) {
        const rate = await checkMediaProxyRateLimit(userId, request);
        if (!rate.allowed) return NextResponse.json({ error: "媒体访问过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(rate) });
        return proxySystemMediaRequest(request, channel);
    }

    const contentType = request.headers.get("content-type");
    const isMultipart = Boolean(contentType?.toLowerCase().includes("multipart/form-data"));
    const accept = request.headers.get("accept");

    let requestBody: ProxyRequestBody;
    try {
        requestBody = await readProxyRequestBody(request, isMultipart);
    } catch (error) {
        if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.message }, { status: error.status });
        throw error;
    }
    const upstreamModel = requestModel(requestBody.pointsPayload) || request.headers.get(SYSTEM_AI_UPSTREAM_MODEL_HEADER)?.trim() || "";
    const modelConfig = upstreamModel ? resolveChannelModelConfig(channel.advancedConfig, upstreamModel) : undefined;
    const apiFormat = modelConfig?.apiFormat || channel.apiFormat;
    const globalChannel = isGlobalAiOpcChannel(channel.advancedConfig);
    const headers = new Headers();
    if (contentType && !isMultipart) headers.set("content-type", contentType);
    if (accept) headers.set("accept", accept);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim().slice(0, 200);
    const clientRequestId = request.headers.get("x-client-request-id")?.trim().slice(0, 200);
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    if (clientRequestId) headers.set("x-client-request-id", clientRequestId);
    Object.entries(protocolAuthHeaders(channel.apiKey, channel.advancedConfig, globalChannel ? "openai" : apiFormat)).forEach(([key, value]) => headers.set(key, value));
    const globalPreset = resolveGlobalAiOpcPreset(channel.advancedConfig, upstreamModel) || resolveGlobalAiOpcPathPreset(channel.advancedConfig, path);
    const globalAdaptation = adaptGlobalAiOpcTextRequest(channel.advancedConfig, path, requestBody.body);
    if (globalAdaptation === "responses-unsupported") return NextResponse.json({ error: "该 GlobalAiOpc 原生文本接口不支持 Responses，已切换 Chat 兼容回退。" }, { status: 404 });
    const target = targetUrl(globalPreset?.baseUrl || channel.baseUrl, globalPreset?.apiFormat || apiFormat, globalAdaptation?.path || path, new URL(request.url).search, globalChannel, modelConfig?.protocol || channel.advancedConfig?.protocol);
    if (!(await isSafeOutboundUrl(target, { allowCredentials: false }))) return NextResponse.json({ error: "接口地址不允许访问内网或保留地址" }, { status: 400 });
    const pointsRequest =
        classifyPointsRequest(request.method, apiFormat, path, contentType, requestBody.pointsPayload, settings.generationPointMultipliers) ||
        classifyConfiguredPointsRequest(
            request.method,
            path,
            contentType,
            requestBody.pointsPayload,
            channel.id,
            [globalPreset?.createPath, modelConfig?.createPath, modelConfig?.editPath, modelConfig?.imageToVideoPath, channel.advancedConfig?.createPath, channel.advancedConfig?.editPath, channel.advancedConfig?.imageToVideoPath],
            upstreamModel,
            settings.logicalModels,
            settings.generationPointMultipliers,
        );
    if (pointsRequest?.model && !channelHasModel(channel.models, pointsRequest.model)) return NextResponse.json({ error: "该模型未在后台渠道中启用" }, { status: 403 });
    const billingModel =
        pointsRequest && pointsRequest.usageKind !== "api" ? resolveLogicalBillingModel(settings.logicalModels, pointsRequest.usageKind, channel.id, pointsRequest.model, request.headers.get(SYSTEM_AI_LOGICAL_MODEL_HEADER) || "") : pointsRequest?.model;
    const pointsIdempotencyBase = normalizePointsIdempotencyKey(request.headers.get(SYSTEM_AI_POINTS_IDEMPOTENCY_HEADER));
    const pointsIdempotencyKey = pointsIdempotencyBase ? `system-ai:${pointsIdempotencyBase}:${path.join("/")}` : undefined;
    let pointsResult: Awaited<ReturnType<typeof consumeUserPoints>> | null = null;
    let refundedPointsRemaining: number | null = null;
    let pointsSettled = false;
    const refundConsumedPoints = async () => {
        if (!pointsResult || pointsSettled) return;
        pointsSettled = true;
        const refundedUser = await refundUserPoints(userId, pointsResult.model, pointsResult.cost, pointsResult.usageKind, pointsResult.units, undefined, pointsResult.recordId);
        refundedPointsRemaining = typeof refundedUser?.pointsBalance === "number" ? refundedUser.pointsBalance : null;
    };
    if (pointsRequest) {
        try {
            pointsResult = await consumeUserPoints(userId, billingModel || pointsRequest.model, pointsRequest.amount, pointsRequest.usageKind, pointsIdempotencyKey);
        } catch (error) {
            if (isQuotaExceededError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
            throw error;
        }
    }
    request.signal.addEventListener("abort", () => void refundConsumedPoints(), { once: true });

    let upstream: Response;
    try {
        upstream = await fetch(target, {
            method: request.method,
            headers,
            body: globalAdaptation?.body || requestBody.body,
            cache: "no-store",
            redirect: "manual",
            signal: request.signal,
        });
    } catch (error) {
        await refundConsumedPoints();
        console.error("System API proxy request failed", error instanceof Error ? error.message : error);
        return NextResponse.json({ error: DEFAULT_CHANNEL_CONNECT_ERROR }, { status: 502, headers: responseHeaders(new Headers(), null, refundedPointsRemaining) });
    }

    if (!upstream.ok && pointsResult) {
        await refundConsumedPoints();
        pointsResult = null;
    }
    if (isRedirectStatus(upstream.status)) {
        return NextResponse.json({ error: "上游接口不允许重定向，请检查后台渠道地址" }, { status: 502, headers: responseHeaders(new Headers(), null, refundedPointsRemaining) });
    }
    if (upstream.ok) pointsSettled = true;
    if (globalAdaptation && upstream.ok) {
        const payload = await upstream.json().catch(() => null);
        if (!payload) return NextResponse.json({ error: "上游文本接口返回了无效 JSON" }, { status: 502, headers: responseHeaders(upstream.headers, pointsResult, refundedPointsRemaining, target) });
        return NextResponse.json(adaptGlobalAiOpcTextResponse(globalAdaptation.adapter, payload), { status: upstream.status, headers: responseHeaders(upstream.headers, pointsResult, refundedPointsRemaining, target) });
    }

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders(upstream.headers, pointsResult, refundedPointsRemaining, target),
    });
}

function channelHasModel(models: string[], requested: string) {
    const target = requested
        .trim()
        .replace(/^models\//, "")
        .toLowerCase();
    return models.some(
        (model) =>
            model
                .trim()
                .replace(/^models\//, "")
                .toLowerCase() === target,
    );
}

function requestModel(payload: ArrayBuffer | Record<string, unknown> | undefined) {
    return payload && !(payload instanceof ArrayBuffer) ? readRequestModel(payload) : "";
}

function normalizePointsIdempotencyKey(value: string | null) {
    const normalized = value?.trim().slice(0, 160) || "";
    return /^[a-zA-Z0-9._:-]+$/.test(normalized) ? normalized : "";
}

type SystemMediaChannel = { baseUrl: string; apiFormat: ApiCallFormat; apiKey: string; advancedConfig?: import("@/lib/auth/store").SystemChannelAdvancedConfig };

async function proxySystemMediaRequest(request: Request, channel: SystemMediaChannel) {
    if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.json({ error: "Media proxy only supports GET and HEAD" }, { status: 405 });
    const target = mediaTargetRequest(channel.baseUrl, channel.apiFormat, new URL(request.url).searchParams.get("url") || "", isGlobalAiOpcChannel(channel.advancedConfig));
    if (!target) return NextResponse.json({ error: "Invalid media url" }, { status: 400 });
    if (!(await isSafeOutboundUrl(target.url, { allowCredentials: false }))) return NextResponse.json({ error: "媒体地址不允许访问内网或保留地址" }, { status: 400 });

    const headers = new Headers();
    const range = request.headers.get("range");
    if (range) headers.set("range", range);
    if (target.includeAuth) {
        Object.entries(protocolAuthHeaders(channel.apiKey, channel.advancedConfig, isGlobalAiOpcChannel(channel.advancedConfig) ? "openai" : channel.apiFormat)).forEach(([key, value]) => headers.set(key, value));
    }

    try {
        const upstream = await fetchSystemMedia(target, request.method, headers, request.signal);

        if (mediaResponseExceedsLimit(upstream.headers)) return NextResponse.json({ error: "Media is too large" }, { status: 413 });

        return new Response(request.method === "HEAD" ? null : limitMediaResponseBody(upstream.body), {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: mediaResponseHeaders(upstream.headers),
        });
    } catch (error) {
        console.error("System media proxy request failed", error instanceof Error ? error.message : error);
        return NextResponse.json({ error: DEFAULT_CHANNEL_CONNECT_ERROR }, { status: 502 });
    }
}

async function fetchSystemMedia(target: { url: string; includeAuth: boolean }, method: "GET" | "HEAD", baseHeaders: Headers, requestSignal: AbortSignal) {
    let currentUrl = target.url;
    let includeAuth = target.includeAuth;
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(SYSTEM_MEDIA_TIMEOUT_MS)]);
    for (let redirects = 0; redirects <= MAX_SYSTEM_MEDIA_REDIRECTS; redirects += 1) {
        if (!(await isSafeOutboundUrl(currentUrl, { allowCredentials: false }))) throw new Error("Unsafe media redirect");
        const headers = new Headers(baseHeaders);
        if (!includeAuth) headers.delete("authorization");
        const upstream = await fetch(currentUrl, { method, headers, cache: "no-store", redirect: "manual", signal });
        if (!isRedirectStatus(upstream.status)) return upstream;
        const location = upstream.headers.get("location");
        await upstream.body?.cancel().catch(() => undefined);
        if (!location || redirects === MAX_SYSTEM_MEDIA_REDIRECTS) throw new Error("Too many media redirects");
        currentUrl = new URL(location, currentUrl).toString();
        includeAuth = false;
    }
    throw new Error("Media redirect failed");
}

function isMediaProxyPath(path: string[]) {
    return path[0] === "_media" || ((path[0] === "v1" || path[0] === "v1beta") && path[1] === "_media");
}

function isRedirectStatus(status: number) {
    return [301, 302, 303, 307, 308].includes(status);
}

function mediaTargetRequest(baseUrl: string, apiFormat: ApiCallFormat, value: string, globalAiOpc = false): { url: string; includeAuth: boolean } | null {
    const mediaUrl = value.trim();
    if (!mediaUrl) return null;
    let apiBase: URL;
    try {
        apiBase = new URL(normalizeApiBaseUrl(baseUrl, apiFormat, globalAiOpc));
    } catch {
        return null;
    }
    try {
        if (mediaUrl.startsWith("/")) return { url: new URL(mediaUrl, apiBase.origin).toString(), includeAuth: true };
        const absolute = new URL(mediaUrl);
        if (!["http:", "https:"].includes(absolute.protocol)) return null;
        return { url: absolute.toString(), includeAuth: absolute.origin === apiBase.origin };
    } catch {
        return { url: new URL(mediaUrl, directoryBaseUrl(apiBase)).toString(), includeAuth: true };
    }
}

function directoryBaseUrl(url: URL) {
    const next = new URL(url.toString());
    if (!next.pathname.endsWith("/")) next.pathname = next.pathname.replace(/\/[^/]*$/, "/");
    next.search = "";
    next.hash = "";
    return next.toString();
}

function mediaResponseHeaders(headers: Headers) {
    const nextHeaders = new Headers();
    ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified", "cache-control"].forEach((key) => {
        const value = headers.get(key);
        if (value) nextHeaders.set(key, value);
    });
    nextHeaders.set("cache-control", "private, max-age=600");
    return nextHeaders;
}

async function readProxyRequestBody(request: Request, isMultipart: boolean): Promise<ProxyRequestBody> {
    if (request.method === "GET" || request.method === "HEAD") return {};
    const bytes = await readRequestBodyBytes(request, isMultipart ? MAX_PROXY_MULTIPART_BYTES : MAX_PROXY_BODY_BYTES);
    if (!isMultipart) {
        const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return { body, pointsPayload: body };
    }

    const formData = await new Request(request.url, { method: request.method, headers: { "Content-Type": request.headers.get("content-type") || "" }, body: bytes }).formData();
    return { body: await cloneFormData(formData), pointsPayload: formDataFields(formData) };
}

function formDataFields(formData: FormData): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const key of ["model", "n", "quality", "resolution_name", "resolution", "vquality", "seconds", "duration"]) {
        const value = formData.get(key);
        if (typeof value === "string" && value.trim()) fields[key] = value.trim();
    }
    return fields;
}

async function cloneFormData(formData: FormData) {
    const next = new FormData();
    for (const [key, value] of formData.entries()) {
        if (typeof value === "string") {
            next.append(key, value);
            continue;
        }
        next.append(key, new Blob([await value.arrayBuffer()], { type: value.type || "application/octet-stream" }), value.name || "file");
    }
    return next;
}

function classifyPointsRequest(method: string, apiFormat: ApiCallFormat, path: string[], contentType: string | null, body?: ArrayBuffer | Record<string, unknown>, multipliers?: GenerationPointMultipliers): PointsRequest | null {
    if (method.toUpperCase() !== "POST") return null;
    const cleanPath = path[0] === "v1" || path[0] === "v1beta" ? path.slice(1) : path;
    const routePath = `/${cleanPath.join("/")}`.toLowerCase();
    const payload = readRequestBody(contentType, body);
    const model = readRequestModel(payload) || readPathModel(cleanPath);
    if (!model) return null;

    if (routePath === "/images/generations" || routePath === "/images/edits") {
        return { model, amount: readRequestCount(payload) * imageQualityMultiplier(payload, multipliers), usageKind: "image" };
    }
    if (routePath === "/audio/speech") return { model, amount: 1, usageKind: "audio" };
    if (routePath === "/videos" || routePath === "/video/generations" || routePath === "/videos/generations" || routePath === "/videos/videos" || routePath === "/contents/generations/tasks") {
        return { model, amount: videoParameterMultiplier(payload, multipliers), usageKind: "video" };
    }
    if (routePath === "/responses") {
        const isImage = hasResponsesImageGenerationTool(payload);
        return { model, amount: isImage ? imageQualityMultiplier(payload, multipliers) : 1, usageKind: isImage ? "image" : "text" };
    }
    if (routePath === "/chat/completions") return { model, amount: 1, usageKind: "text" };
    if (apiFormat === "gemini" && routePath.includes(":streamgeneratecontent")) return { model, amount: 1, usageKind: "text" };
    if (apiFormat === "gemini" && routePath.includes(":generatecontent")) return { model, amount: 1, usageKind: hasGeminiImageResponseModality(payload) ? "image" : "text" };

    return null;
}

function classifyConfiguredPointsRequest(
    method: string,
    path: string[],
    contentType: string | null,
    body: ArrayBuffer | Record<string, unknown> | undefined,
    channelId: string,
    createPaths: Array<string | undefined>,
    modelHint: string,
    logicalModels: Awaited<ReturnType<typeof getAuthSettings>>["logicalModels"],
    multipliers?: GenerationPointMultipliers,
): PointsRequest | null {
    if (method.toUpperCase() !== "POST") return null;
    const cleanPath = `/${(path[0] === "v1" || path[0] === "v1beta" ? path.slice(1) : path).join("/")}`.replace(/\/+$/, "").toLowerCase();
    if (!createPaths.some((createPath) => createPath && cleanPath === createPath.replace(/\/+$/, "").toLowerCase())) return null;
    const payload = readRequestBody(contentType, body);
    const model = readRequestModel(payload) || modelHint;
    if (!model) return null;
    const capability = logicalModels.find((logical) => logical.enabled && logical.bindings.some((binding) => binding.enabled && binding.channelId === channelId && sameModel(binding.upstreamModel, model)))?.capability;
    if (capability === "image") return { model, amount: readRequestCount(payload) * imageQualityMultiplier(payload, multipliers), usageKind: "image" };
    if (capability === "video") return { model, amount: videoParameterMultiplier(payload, multipliers), usageKind: "video" };
    if (capability === "audio") return { model, amount: 1, usageKind: "audio" };
    return capability === "text" ? { model, amount: 1, usageKind: "text" } : null;
}

function sameModel(left: string, right: string) {
    return (
        left
            .trim()
            .replace(/^models\//i, "")
            .toLowerCase() ===
        right
            .trim()
            .replace(/^models\//i, "")
            .toLowerCase()
    );
}

function readRequestModel(payload: Record<string, unknown>) {
    if (typeof payload.model === "string") return payload.model.trim();
    const overrideSettings = payload.override_settings;
    return overrideSettings && typeof overrideSettings === "object" && !Array.isArray(overrideSettings) && typeof (overrideSettings as Record<string, unknown>).sd_model_checkpoint === "string"
        ? String((overrideSettings as Record<string, unknown>).sd_model_checkpoint).trim()
        : "";
}

function readPathModel(path: string[]) {
    const modelIndex = path.findIndex((item) => item === "models");
    if (modelIndex < 0) return "";
    return decodeURIComponent(path[modelIndex + 1] || "")
        .split(":")[0]
        .replace(/^models\//, "")
        .trim();
}

function readRequestCount(payload: Record<string, unknown>) {
    const count = Math.floor(Number(payload.n) || 1);
    return Math.max(1, Math.min(1000, count));
}

function imageQualityMultiplier(payload: Record<string, unknown>, multipliers?: GenerationPointMultipliers) {
    return multiplierValue(multipliers?.imageQuality, normalizeImageQualityKey(payload.quality));
}

function videoParameterMultiplier(payload: Record<string, unknown>, multipliers?: GenerationPointMultipliers) {
    return (
        multiplierValue(multipliers?.videoQuality, normalizeVideoQualityKey(payload.resolution_name || payload.resolution || payload.quality || payload.vquality)) *
        multiplierValue(multipliers?.videoSeconds, normalizeVideoSecondsKey(payload.duration || payload.seconds))
    );
}

function multiplierValue(values: Record<string, number> | undefined, key: string) {
    const value = values?.[key];
    return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 1;
}

function normalizeImageQualityKey(value: unknown) {
    const key = String(value || "auto")
        .trim()
        .toLowerCase();
    if (key === "hd") return "high";
    if (key === "standard") return "medium";
    return key || "auto";
}

function normalizeVideoQualityKey(value: unknown) {
    const key = String(value || "720")
        .trim()
        .toLowerCase();
    if (key === "low") return "480";
    if (key === "auto" || key === "medium" || key === "high") return "720";
    return key.replace(/p$/, "") || "720";
}

function normalizeVideoSecondsKey(value: unknown) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return "5";
    return String(Math.max(-1, Math.floor(seconds)));
}

function hasGeminiImageResponseModality(payload: Record<string, unknown>) {
    const generationConfig = payload.generationConfig && typeof payload.generationConfig === "object" && !Array.isArray(payload.generationConfig) ? (payload.generationConfig as Record<string, unknown>) : {};
    const modalityValues = [generationConfig.responseModalities, generationConfig.response_modalities, payload.responseModalities, payload.response_modalities];
    return modalityValues.some((value) => Array.isArray(value) && value.some((item) => String(item).toLowerCase() === "image"));
}

function hasResponsesImageGenerationTool(payload: Record<string, unknown>) {
    const tools = payload.tools;
    return Array.isArray(tools) && tools.some((tool) => Boolean(tool && typeof tool === "object" && String((tool as Record<string, unknown>).type || "").toLowerCase() === "image_generation"));
}

function readRequestBody(contentType: string | null, body?: ArrayBuffer | Record<string, unknown>): Record<string, unknown> {
    if (!body) return {};
    if (!(body instanceof ArrayBuffer)) return body;
    const text = new TextDecoder().decode(body);
    if (!contentType?.toLowerCase().includes("application/json")) return readMultipartFields(text);
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function readMultipartFields(text: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const key of ["model", "n", "quality", "resolution_name", "resolution", "vquality", "seconds", "duration"]) {
        const match = text.match(new RegExp(`name="${key}"\\r?\\n\\r?\\n([^\\r\\n]+)`));
        if (match?.[1]) fields[key] = match[1].trim();
    }
    return fields;
}

function targetUrl(baseUrl: string, apiFormat: "openai" | "gemini", path: string[], search: string, globalAiOpc = false, protocol?: import("@/lib/auth/store").SystemChannelProtocol) {
    const usesLiteralPath = protocol === "seedance-special" || protocol === "stable-diffusion" || protocol === "custom";
    const cleanPath = !usesLiteralPath && (path[0] === "v1" || path[0] === "v1beta") ? path.slice(1) : path;
    if (isAgnesApiBaseUrl(baseUrl) && cleanPath[0]?.toLowerCase() === "agnesapi") {
        const origin = new URL(baseUrl).origin;
        return `${origin}/${cleanPath.map((segment) => encodeTargetPathSegment(segment, apiFormat)).join("/")}${search}`;
    }
    const apiBase = usesLiteralPath ? baseUrl.trim().replace(/\/+$/, "") : normalizeApiBaseUrl(baseUrl, apiFormat, globalAiOpc);
    return `${apiBase}/${cleanPath.map((segment) => encodeTargetPathSegment(segment, apiFormat)).join("/")}${search}`;
}

function encodeTargetPathSegment(segment: string, apiFormat: "openai" | "gemini") {
    const decoded = safeDecodeURIComponent(segment);
    const encoded = encodeURIComponent(decoded);
    return apiFormat === "gemini" ? encoded.replace(/%3A/gi, ":") : encoded;
}

function safeDecodeURIComponent(value: string) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function normalizeApiBaseUrl(baseUrl: string, apiFormat: "openai" | "gemini", globalAiOpc = false) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    if (lower.endsWith("/v1") || lower.endsWith("/v1beta") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3")) return normalized;
    if (apiFormat === "gemini" && !globalAiOpc) return `${normalized}/v1beta`;
    return `${normalized}/v1`;
}

function responseHeaders(headers: Headers, pointsResult?: Awaited<ReturnType<typeof consumeUserPoints>> | null, refundedPointsRemaining?: number | null, upstreamUrl?: string) {
    const nextHeaders = new Headers();
    const passthrough = ["content-type", "cache-control", "content-disposition"];
    passthrough.forEach((key) => {
        const value = headers.get(key);
        if (value) nextHeaders.set(key, value);
    });
    if (upstreamUrl) nextHeaders.set("x-vozeb-pro-upstream-url", upstreamUrl);
    if (pointsResult) {
        nextHeaders.set("x-vozeb-pro-points-cost", String(pointsResult.cost));
        nextHeaders.set("x-vozeb-pro-points-remaining", String(pointsResult.remaining));
        nextHeaders.set("x-vozeb-pro-points-permanent", String(pointsResult.permanentRemaining));
        nextHeaders.set("x-vozeb-pro-points-daily", String(pointsResult.dailyRemaining));
        nextHeaders.set("x-vozeb-pro-points-daily-expires-at", pointsResult.dailyExpiresAt);
        if (pointsResult.recordId) nextHeaders.set("x-vozeb-pro-points-record-id", pointsResult.recordId);
    } else if (typeof refundedPointsRemaining === "number") {
        nextHeaders.set("x-vozeb-pro-points-remaining", String(refundedPointsRemaining));
    }
    return nextHeaders;
}
