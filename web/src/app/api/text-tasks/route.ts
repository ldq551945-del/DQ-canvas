import { after, NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings, isAuthInputError, refundUserPoints } from "@/lib/auth/store";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { fetchInternalApi, isInternalApiBaseUrl, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { generationModelId, toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { finishGenerationAttempt, startGenerationAttempt } from "@/lib/server/generation-attempt";
import { createTextTask, getTextTask, touchTextTask, transitionTextTask, type TextTask, type TextTaskConfig } from "@/lib/server/text-task-store";
import { updateTextTask } from "@/lib/server/text-task-store";
import type { AiTextMessage } from "@/types/ai";
import { withGenerationConcurrencyLimit } from "@/lib/server/generation-task-store";
import { checkGenerationRateLimit, rateLimitHeaders } from "@/lib/server/security";
import { hasSystemAiCharge, readSystemAiBilling, systemAiBillingHeaders } from "@/lib/server/system-ai-billing";
import { resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

configureServerProxyDispatcher();

const TASK_HEARTBEAT_MS = 30 * 1000;

type CreateTextTaskBody = {
    config?: TextTaskConfig;
    messages?: AiTextMessage[];
};

type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem = { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] };
type ResponseApiPayload = {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ChatCompletionPayload = {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
};
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const rate = await checkGenerationRateLimit(currentUser.id, request, "text");
    if (!rate.allowed) return NextResponse.json({ error: "文本生成请求过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(rate) });
    const settings = await getAuthSettings();
    const response = await withGenerationConcurrencyLimit(currentUser.id, "text", 5 * 60 * 1000, settings.generationConcurrency.text, async () => {
        let body: CreateTextTaskBody;
        try {
            body = await readJsonBody(request);
        } catch (error) {
            if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
            throw error;
        }
        const configs = sanitizeConfigs(body.config, settings);
        const messages = sanitizeMessages(body.messages);
        if (!configs.length || !messages.length) return NextResponse.json({ error: "任务参数不完整" }, { status: 400 });

        const task = await createTextTask({ userId: currentUser.id, config: configs[0], candidateConfigs: configs.slice(1), messages });
        const cookie = request.headers.get("cookie") || "";
        const origin = resolveInternalOrigin(new URL(request.url).origin);
        after(() => runTextTask(task, origin, cookie));

        return NextResponse.json({ task: publicTask(task) });
    });
    return response || NextResponse.json({ error: "当前用户文本任务已达到并发上限" }, { status: 429 });
}

async function runTextTask(task: TextTask, origin: string, cookie: string) {
    const running = await transitionTextTask(task, ["pending"], { status: "running" });
    if (!running) return;
    const heartbeat = setInterval(() => {
        void touchTextTask(task.id);
    }, TASK_HEARTBEAT_MS);
    const candidates = [task.config, ...(task.candidateConfigs || [])];
    let attempts = task.attempts || [];
    let latestError: unknown;
    try {
        for (const [index, config] of candidates.entries()) {
            const attempt = startGenerationAttempt(attempts, { channelId: config.channelId, model: generationModelId(config), capability: "text" });
            attempts = attempt.attempts;
            const candidateTask = { ...task, config, candidateConfigs: candidates.slice(index + 1), attemptNo: attempt.attempt.attemptNo, attempts };
            await updateTextTask(task.id, { config, candidateConfigs: candidateTask.candidateConfigs, attemptNo: candidateTask.attemptNo, attempts: candidateTask.attempts });
            try {
                const result = config.apiFormat === "gemini" ? await runGeminiTextTask(candidateTask, origin, cookie) : await runOpenAiTextTask(candidateTask, origin, cookie);
                attempts = finishGenerationAttempt(attempts, candidateTask.attemptNo, { status: "succeeded", pointsCost: result.pointsCost, pointsRecordId: result.pointsRecordId });
                const current = await getTextTask(task.id);
                if (current?.status === "cancelled") {
                    if (hasSystemAiCharge(result)) await refundUserPoints(task.userId, generationModelId(config), result.pointsCost, "text", 1, undefined, result.pointsRecordId);
                    return;
                }
                const completed = await transitionTextTask(candidateTask, ["running"], {
                    status: "success",
                    result: { content: result.content || "没有返回内容" },
                    pointsRemaining: result.pointsRemaining,
                    messages: [],
                    config: clearSecret(config),
                });
                await updateTextTask(task.id, { config: clearSecret(config), candidateConfigs: [], attempts, attemptNo: candidateTask.attemptNo });
                if (!completed && hasSystemAiCharge(result)) await refundUserPoints(task.userId, generationModelId(config), result.pointsCost, "text", 1, undefined, result.pointsRecordId);
                return;
            } catch (error) {
                latestError = error;
                attempts = finishGenerationAttempt(attempts, candidateTask.attemptNo, { status: "failed", error: toSafeGenerationErrorMessage(error, "文本生成失败") });
                await updateTextTask(task.id, { attempts, attemptNo: candidateTask.attemptNo });
                const current = await getTextTask(task.id);
                if (current?.status === "cancelled" || current?.status === "success") return;
            }
        }
        throw latestError instanceof Error ? latestError : new Error("没有可用的文本渠道");
    } catch (error) {
        const current = await getTextTask(task.id);
        if (current?.status === "cancelled") return;
        const message = toSafeGenerationErrorMessage(error, "文本生成失败");
        await transitionTextTask(current || task, ["running"], { status: "error", error: message, messages: [], config: clearSecret(current?.config || task.config) });
        await updateTextTask(task.id, { config: clearSecret(current?.config || task.config), candidateConfigs: [], attempts });
    } finally {
        clearInterval(heartbeat);
    }
}

async function runOpenAiTextTask(task: TextTask, origin: string, cookie: string) {
    const config = task.config;
    const headers = taskHeaders(config, cookie, pointsIdempotencyKey(task));
    headers.set("content-type", "application/json");
    const response = await taskFetch(config, taskUrl(config, "/responses", origin), {
        method: "POST",
        headers,
        body: JSON.stringify({ model: config.model, input: toResponseInput(withSystemMessage(config, task.messages)) }),
        cache: "no-store",
    });
    if (!response.ok) {
        const errorMessage = await readFetchError(response, "文本生成失败");
        if (shouldFallbackToChatCompletions(response.status, errorMessage)) return runOpenAiChatCompletionTask(task, origin, cookie);
        throw new Error(errorMessage);
    }
    const payload = (await response.json()) as ResponseApiPayload;
    try {
        validateResponsePayload(payload);
    } catch (error) {
        const message = error instanceof Error ? error.message : "文本生成失败";
        await refundChargedTextResponse(task, response.headers);
        if (shouldFallbackToChatCompletions(400, message)) {
            return runOpenAiChatCompletionTask(task, origin, cookie);
        }
        throw error;
    }
    const content = parseOpenAiContent(payload);
    if (!content.trim()) {
        await refundChargedTextResponse(task, response.headers);
        return runOpenAiChatCompletionTask(task, origin, cookie);
    }
    return { content, ...readBilling(response.headers) };
}

async function runOpenAiChatCompletionTask(task: TextTask, origin: string, cookie: string) {
    const config = task.config;
    const headers = taskHeaders(config, cookie, pointsIdempotencyKey(task));
    headers.set("content-type", "application/json");
    const response = await taskFetch(config, taskUrl(config, "/chat/completions", origin), {
        method: "POST",
        headers,
        body: JSON.stringify({ model: config.model, messages: toChatMessages(withSystemMessage(config, task.messages)) }),
        cache: "no-store",
    });
    if (!response.ok) throw new Error(await readFetchError(response, "文本生成失败"));
    const payload = (await response.json()) as ChatCompletionPayload;
    try {
        validateChatCompletionPayload(payload);
    } catch (error) {
        await refundChargedTextResponse(task, response.headers);
        throw error;
    }
    const content = parseChatCompletionContent(payload);
    if (!content.trim()) {
        await refundChargedTextResponse(task, response.headers);
        throw new Error("文本模型没有返回有效内容");
    }
    return { content, ...readBilling(response.headers) };
}

async function runGeminiTextTask(task: TextTask, origin: string, cookie: string) {
    const config = task.config;
    const response = await taskFetch(config, geminiApiUrl(config, "generateContent", origin), {
        method: "POST",
        headers: geminiHeaders(config, cookie, pointsIdempotencyKey(task)),
        body: JSON.stringify(toGeminiBody(config, task.messages)),
        cache: "no-store",
    });
    if (!response.ok) throw new Error(await readFetchError(response, "文本生成失败"));
    const payload = (await response.json()) as GeminiPayload;
    try {
        validateGeminiPayload(payload);
    } catch (error) {
        await refundChargedTextResponse(task, response.headers);
        throw error;
    }
    const content = parseGeminiContent(payload);
    if (!content.trim()) {
        await refundChargedTextResponse(task, response.headers);
        throw new Error("Gemini 没有返回有效文本内容");
    }
    return { content, ...readBilling(response.headers) };
}

function publicTask(task: TextTask) {
    return {
        id: task.id,
        status: task.status,
        model: generationModelId(task.config),
        result: task.result,
        error: task.error,
    };
}

function sanitizeConfigs(config: TextTaskConfig | undefined, settings: Awaited<ReturnType<typeof getAuthSettings>>): TextTaskConfig[] {
    const requestedModel = config?.model || settings.defaultModels.textModel;
    return resolveLogicalModelCandidates(settings, "text", requestedModel).map((resolved) => ({ ...toSystemGenerationChannel(resolved), channelId: resolved.channelId, systemPrompt: "" }));
}

function sanitizeMessages(messages?: AiTextMessage[]) {
    if (!Array.isArray(messages)) return [];
    return messages
        .map((message) => ({
            role: message.role === "system" || message.role === "assistant" ? message.role : ("user" as const),
            content: sanitizeContent(message.content),
        }))
        .filter((message) => (Array.isArray(message.content) ? message.content.length > 0 : Boolean(message.content.trim())))
        .slice(0, 20);
}

function sanitizeContent(content: AiTextMessage["content"]): AiTextMessage["content"] {
    if (!Array.isArray(content)) return String(content || "").slice(0, 20000);
    return content
        .map((item) => {
            if (item.type === "text") return { type: "text" as const, text: item.text.slice(0, 20000) };
            return { type: "image_url" as const, image_url: { url: item.image_url.url } };
        })
        .filter((item) => (item.type === "text" ? Boolean(item.text.trim()) : Boolean(item.image_url.url)));
}

function clearSecret(config: TextTaskConfig): TextTaskConfig {
    return { ...config, apiKey: "" };
}

function withSystemMessage(config: TextTaskConfig, messages: AiTextMessage[]) {
    const systemPrompt = (config.systemPrompt || "").trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: AiTextMessage[]): ResponseInputItem[] {
    return messages.map((message) => ({ role: message.role, content: toResponseContent(message.content) }));
}

function toResponseContent(content: AiTextMessage["content"]): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toChatMessages(messages: AiTextMessage[]) {
    return messages.map((message) => ({ role: message.role, content: message.content }));
}

function toGeminiBody(config: TextTaskConfig, messages: AiTextMessage[]) {
    const systemText = [(config.systemPrompt || "").trim(), ...messages.flatMap((message) => (message.role === "system" ? [geminiTextContent(message.content)] : []))].filter(Boolean).join("\n\n");
    return {
        contents: messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) })),
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    };
}

function toGeminiParts(content: AiTextMessage["content"]): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: AiTextMessage["content"]) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function parseOpenAiContent(payload: ResponseApiPayload) {
    return (
        payload.output_text ||
        payload.output
            ?.flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("") ||
        ""
    );
}

function parseChatCompletionContent(payload: ChatCompletionPayload) {
    return payload.choices?.map((choice) => readChatContent(choice.message?.content)).join("") || "";
}

function readChatContent(content?: string | Array<{ type?: string; text?: string }>) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((item) => item.text || "").join("");
}

function parseGeminiContent(payload: GeminiPayload) {
    return (
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => part.text || "")
            .join("") || ""
    );
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateChatCompletionPayload(payload: ChatCompletionPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        const payload = JSON.parse(text) as { error?: { message?: string }; msg?: string; response?: { error?: { message?: string } } };
        return payload.msg || payload.error?.message || payload.response?.error?.message || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}，状态码 ${status}` : fallback;
}

function shouldFallbackToChatCompletions(status: number, message: string) {
    if (status === 404 || status === 405) return true;
    if (/convert_request_failed|not available/i.test(message)) return true;
    if (status !== 400) return false;
    return /responses|endpoint|route|path|not found|not implemented|unsupported|unknown url|cannot post|invalid url|no such/i.test(message);
}

function taskUrl(config: TextTaskConfig, path: string, origin: string) {
    const apiBase = normalizeApiBaseUrl(config.baseUrl, config.apiFormat, origin);
    return `${apiBase}${path}`;
}

function geminiApiUrl(config: TextTaskConfig, action: "generateContent", origin: string) {
    const baseUrl = normalizeApiBaseUrl(config.baseUrl, "gemini", origin);
    return `${baseUrl}/models/${encodeURIComponent(config.model.replace(/^models\//, ""))}:${action}`;
}

function normalizeApiBaseUrl(baseUrl: string, apiFormat: "openai" | "gemini", origin: string) {
    const absoluteBase = baseUrl.startsWith("/") ? `${origin}${baseUrl}` : baseUrl;
    const normalized = absoluteBase.trim().replace(/\/+$/, "");
    const lower = normalized.toLowerCase();
    if (isInternalSystemProxyBase(normalized)) return normalized;
    if (lower.endsWith("/v1") || lower.endsWith("/v1beta") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3")) return normalized;
    if (apiFormat === "gemini") return `${normalized}/v1beta`;
    return `${normalized}/v1`;
}

function isInternalSystemProxyBase(value: string) {
    try {
        return /^\/api\/ai\/system\/[^/]+$/i.test(new URL(value).pathname);
    } catch {
        return false;
    }
}

function taskHeaders(config: TextTaskConfig, cookie: string, pointsIdempotencyKey?: string) {
    const headers = new Headers();
    if (config.baseUrl.startsWith("/") && cookie) headers.set("cookie", cookie);
    if (config.baseUrl.startsWith("/")) {
        Object.entries(systemAiBillingHeaders(generationModelId(config), pointsIdempotencyKey)).forEach(([key, value]) => headers.set(key, value));
    }
    if (config.apiFormat === "gemini") headers.set("x-goog-api-key", config.apiKey);
    else headers.set("authorization", `Bearer ${config.apiKey}`);
    return headers;
}

function taskFetch(config: TextTaskConfig, url: string, init: RequestInit) {
    const nextInit = {
        ...init,
        signal: init.signal || AbortSignal.timeout(resolveModelRequestTimeoutMs(config, "text")),
    };
    return isInternalApiBaseUrl(config.baseUrl) ? fetchInternalApi(url, nextInit) : fetch(url, nextInit);
}

function geminiHeaders(config: TextTaskConfig, cookie: string, pointsIdempotencyKey?: string) {
    const headers = taskHeaders(config, cookie, pointsIdempotencyKey);
    headers.set("content-type", "application/json");
    return headers;
}

function pointsIdempotencyKey(task: TextTask) {
    return `text-task:${task.id}:attempt:${task.attemptNo || 1}`;
}

function readPointsRemaining(headers: Headers) {
    const value = Number(headers.get("x-vozeb-pro-points-remaining"));
    return Number.isFinite(value) ? value : undefined;
}

function readBilling(headers: Headers) {
    return {
        pointsRemaining: readPointsRemaining(headers),
        ...readSystemAiBilling(headers),
    };
}

async function refundChargedTextResponse(task: TextTask, headers: Headers) {
    const billing = readSystemAiBilling(headers);
    if (hasSystemAiCharge(billing)) await refundUserPoints(task.userId, generationModelId(task.config), billing.pointsCost, "text", 1, undefined, billing.pointsRecordId);
}
