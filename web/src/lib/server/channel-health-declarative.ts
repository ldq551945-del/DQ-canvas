import type { SystemChannelAdvancedConfig, SystemChannelModelConfig, SystemChannelProtocol } from "@/lib/auth/store";
import type { ChannelHealthKind as SharedChannelHealthKind, ChannelHealthResult as SharedChannelHealthResult } from "@/lib/channel-health-result";
import { channelProtocolDefinition, protocolAuthHeaders, protocolModelConfig } from "@/lib/channel-protocol-registry";
import { normalizeModelId } from "@/lib/model-capability";
import { buildSeedanceSpecialRequest } from "@/lib/seedance-special";
import { normalizeModelConfigs } from "@/lib/server/admin-model-catalog";
import { sanitizeProviderMessage } from "@/lib/server/admin-channel-config";
import { buildProviderRequest, isProviderBusinessError, readProviderString } from "@/lib/server/provider-task-config";

export type ChannelHealthKind = SharedChannelHealthKind;
export type ChannelHealthResult = SharedChannelHealthResult;

const HEALTH_REQUEST_TIMEOUT_MS = 60_000;

export async function testDeclarativeChannelProtocol(baseUrl: string, apiKey: string, model: string, kind: ChannelHealthKind, protocol: SystemChannelProtocol, advanced: SystemChannelAdvancedConfig): Promise<ChannelHealthResult> {
    const definition = channelProtocolDefinition(protocol);
    const operation = definition.operations[kind];
    const createPath = advanced.createPath || operation?.createPath;
    const requestTemplate = advanced.requestTemplate || operation?.requestTemplate;
    const resultField = advanced.resultField || operation?.resultField;
    if (!createPath || !requestTemplate) return { ok: false, kind, model, status: 0, protocolKey: protocol, protocol: definition.label, error: `${definition.label} 缺少 ${kind} 创建路径或请求模板` };

    const prompt = kind === "text" ? "Reply exactly OK." : kind === "image" ? "A single blue circle icon on a white background." : kind === "video" ? "A calm 4 second shot of a blue circle logo on a white background." : "VOZEB PRO audio health check.";
    const values = {
        model,
        prompt,
        input: prompt,
        text: prompt,
        messages: [{ role: "user", content: prompt }],
        size: "512x512",
        width: 512,
        height: 512,
        quality: "low",
        n: 1,
        ratio: "16:9",
        aspect_ratio: "16:9",
        resolution: "720p",
        duration: 4,
        seconds: 4,
        image: "",
        images: [] as string[],
        video: "",
        videos: [] as string[],
        audio: "",
        audios: [] as string[],
        references: [] as Array<{ type: string; url: string }>,
        content: [{ type: "text", text: prompt }],
    };
    const payload = protocol === "seedance-special" ? buildSeedanceSpecialRequest({ model, prompt, ratio: "16:9", duration: 4, generateAudio: false }) : buildProviderRequest(requestTemplate, values, values);
    const response = await fetch(literalChannelHealthUrl(baseUrl, createPath), {
        method: "POST",
        headers: { ...protocolAuthHeaders(apiKey, advanced), "content-type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (kind === "audio" && response.ok && !contentType.includes("json")) {
        const bytes = (await response.arrayBuffer()).byteLength;
        if (bytes > 0) return declarativeHealthResult(protocol, definition.label, kind, model, response.status, advanced, { result: "binary" });
        return { ok: false, kind, model, status: response.status, protocolKey: protocol, protocol: definition.label, error: "音频接口没有返回内容" };
    }
    const data = await readPayload(response);
    if (!response.ok || isProviderBusinessError(data)) return { ...failed(kind, model, response.status, data, apiKey), protocolKey: protocol, protocol: definition.label };
    const result = readProviderString(data, resultField, healthResultKeys(kind));
    const taskId = readProviderString(data, undefined, ["task_id", "taskId", "id", "job_id", "jobId", "request_id", "requestId"]);
    if (!result && !taskId) return { ok: false, kind, model, status: response.status, protocolKey: protocol, protocol: definition.label, error: `接口成功，但没有按结果字段 ${resultField || "未配置"} 返回内容或任务 ID` };
    return declarativeHealthResult(protocol, definition.label, kind, model, response.status, advanced, { result, taskId, points: pointsInfo(response.headers) });
}

export function channelHealthModelConfig(value: unknown): SystemChannelModelConfig | undefined {
    return normalizeModelConfigs({ health: value })[normalizeModelId("health")];
}

export function isDeclarativeHealthProtocol(protocol: SystemChannelProtocol) {
    return protocol === "seedance" || protocol === "stable-diffusion" || protocol === "volcengine-video" || protocol === "seedance-special" || protocol === "custom";
}

export function literalChannelHealthUrl(baseUrl: string, path: string) {
    return `${baseUrl.trim().replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function applySelectedProtocolLabel(result: ChannelHealthResult, protocol: SystemChannelProtocol): ChannelHealthResult {
    if (!result.ok) return result;
    const definition = channelProtocolDefinition(protocol);
    if (!definition.strict) return result;
    const config = protocolModelConfig(protocol, result.kind);
    if (!config) return result;
    return {
        ...result,
        protocolKey: protocol,
        protocol: definition.label,
        createPath: config.createPath,
        editPath: config.editPath,
        imageToVideoPath: config.imageToVideoPath,
        queryPath: config.queryPath,
        cancelPath: config.cancelPath,
        cancelMethod: config.cancelMethod,
        requestTemplate: config.requestTemplate,
        resultField: config.resultField,
        statusField: config.statusField,
        durationRange: config.durationRange,
        referenceRule: config.referenceRule,
        supportsReferenceImage: config.supportsReferenceImage,
        supportsReferenceVideo: config.supportsReferenceVideo,
        supportsReferenceAudio: config.supportsReferenceAudio,
    };
}

function declarativeHealthResult(
    protocol: SystemChannelProtocol,
    label: string,
    kind: ChannelHealthKind,
    model: string,
    status: number,
    advanced: SystemChannelAdvancedConfig,
    output: { result?: string; taskId?: string; points?: ReturnType<typeof pointsInfo> },
): ChannelHealthResult {
    const remoteUrl = /^https?:\/\//i.test(output.result || "") ? output.result : undefined;
    return {
        ok: true,
        kind,
        model,
        status,
        protocolKey: protocol,
        protocol: label,
        createPath: advanced.createPath,
        editPath: advanced.editPath,
        imageToVideoPath: advanced.imageToVideoPath,
        queryPath: advanced.queryPath,
        cancelPath: advanced.cancelPath,
        cancelMethod: advanced.cancelMethod,
        requestTemplate: advanced.requestTemplate,
        resultField: advanced.resultField,
        statusField: advanced.statusField,
        durationRange: advanced.durationRange,
        referenceRule: advanced.referenceRule,
        supportsReferenceImage: advanced.supportsReferenceImage,
        supportsReferenceVideo: advanced.supportsReferenceVideo,
        supportsReferenceAudio: advanced.supportsReferenceAudio,
        taskId: output.taskId,
        remoteUrl,
        ...(output.points || {}),
    };
}

function healthResultKeys(kind: ChannelHealthKind) {
    if (kind === "text") return ["output_text", "text", "content", "response", "result"];
    if (kind === "image") return ["b64_json", "base64", "image_url", "imageUrl", "url"];
    if (kind === "video") return ["video_url", "videoUrl", "media_url", "mediaUrl", "url"];
    return ["audio_url", "audioUrl", "media_url", "mediaUrl", "url"];
}

function failed(kind: ChannelHealthKind, model: string, status: number, payload: unknown, apiKey: string): ChannelHealthResult {
    return { ok: false, kind, model, status, error: sanitizeProviderMessage(errorMessage(payload, `接口测试失败，状态码 ${status}`), [apiKey]) };
}

function pointsInfo(headers: Headers) {
    const pointsCost = numericHeader(headers, "x-vozeb-pro-points-cost");
    const pointsRemaining = numericHeader(headers, "x-vozeb-pro-points-remaining");
    return {
        ...(pointsCost !== undefined ? { pointsCost } : {}),
        ...(pointsRemaining !== undefined ? { pointsRemaining } : {}),
    };
}

function numericHeader(headers: Headers, key: string) {
    const value = Number(headers.get(key));
    return Number.isFinite(value) ? Number(value.toFixed(2)) : undefined;
}

async function readPayload(response: Response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { message: text.slice(0, 500) };
    }
}

function errorMessage(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== "object") return fallback;
    const record = payload as Record<string, unknown>;
    const direct = stringValue(record.message) || stringValue(record.msg) || stringValue(record.detail);
    if (direct) return direct;
    const error = record.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") return stringValue((error as Record<string, unknown>).message) || stringValue((error as Record<string, unknown>).msg) || fallback;
    return fallback;
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
