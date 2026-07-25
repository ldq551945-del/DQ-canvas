import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { isProviderTimeoutError, resolveAdminChannelCredentials, sanitizeProviderMessage } from "@/lib/server/admin-channel-config";
import { isQingyanProvider } from "@/lib/provider-compatibility";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { isSafeOutboundUrl } from "@/lib/server/security";
import { isProviderBusinessError } from "@/lib/server/provider-task-config";
import { buildGlobalAiOpcImageRequest, buildGlobalAiOpcVideoRequest, resolveGlobalAiOpcCatalogPresets, resolveGlobalAiOpcPreset, type GlobalAiOpcPreset } from "@/lib/globalaiopc-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

configureServerProxyDispatcher();

type HealthKind = "text" | "image" | "video" | "audio";
type HealthProtocol = "auto" | "openai" | "sub2api" | "qingyan" | "globalaiopc" | "seedance" | "compatible";

type HealthPayload = {
    channelId?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    apiFormat?: unknown;
    model?: unknown;
    kind?: unknown;
    protocol?: unknown;
    globalAiOpcPreset?: unknown;
    globalAiOpcPresets?: unknown;
    createPath?: unknown;
};

type HealthResult = {
    ok: boolean;
    kind: HealthKind;
    model: string;
    status: number;
    protocolKey?: HealthProtocol;
    protocol?: string;
    referenceHint?: string;
    createPath?: string;
    queryPath?: string;
    requestTemplate?: string;
    resultField?: string;
    statusField?: string;
    durationRange?: string;
    referenceRule?: string;
    supportsReferenceImage?: boolean;
    supportsReferenceVideo?: boolean;
    supportsReferenceAudio?: boolean;
    pointsCost?: number;
    pointsRemaining?: number;
    taskId?: string;
    remoteUrl?: string;
    error?: string;
};

const HEALTH_COOLDOWN_MS = 20_000;
const HEALTH_REQUEST_TIMEOUT_MS = 60_000;
const VIDEO_HEALTH_REFERENCE_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const GLOBAL_AIOPC_VIDEO_CREATE_PATH = "/videos/videos";
const SEEDANCE_VIDEO_CREATE_PATH = "/contents/generations/tasks";
const VIDEO_HEALTH_PATHS = [GLOBAL_AIOPC_VIDEO_CREATE_PATH, "/videos", "/video/generations", "/videos/generations", SEEDANCE_VIDEO_CREATE_PATH];
const globalCooldownStore = globalThis as typeof globalThis & { __vozebProChannelHealthCooldowns?: Map<string, number> };
const healthCooldowns = (globalCooldownStore.__vozebProChannelHealthCooldowns ??= new Map<string, number>());

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const [body, settings] = await Promise.all([readJsonBody<HealthPayload>(request), getAuthSettings()]);
    const { baseUrl, apiKey, savedChannel } = resolveAdminChannelCredentials(settings, body);
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const kind = body.kind === "image" || body.kind === "video" || body.kind === "audio" || body.kind === "text" ? body.kind : "";
    if (!baseUrl || !apiKey || !model || !kind) return NextResponse.json({ error: "请填写 Base URL、API Key，并选择要测试的模型" }, { status: 400 });
    const advancedConfig = {
        ...(savedChannel?.advancedConfig || {}),
        ...(body.protocol !== undefined ? { protocol: body.protocol } : {}),
        ...(body.globalAiOpcPreset !== undefined ? { globalAiOpcPreset: body.globalAiOpcPreset } : {}),
        ...(body.globalAiOpcPresets !== undefined ? { globalAiOpcPresets: body.globalAiOpcPresets } : {}),
        ...(body.createPath !== undefined ? { createPath: body.createPath } : {}),
    };
    const catalogPresets = resolveGlobalAiOpcCatalogPresets(baseUrl, advancedConfig);
    const globalPreset = resolveGlobalAiOpcPreset({ protocol: "globalaiopc", globalAiOpcPresets: catalogPresets.map((preset) => preset.id) }, model);
    const providerBaseUrl = globalPreset?.baseUrl || baseUrl;
    if (!(await isSafeOutboundUrl(apiUrl(providerBaseUrl, "/models")))) return NextResponse.json({ result: { ok: false, kind, model, status: 0, error: "Base URL 不允许访问内网或保留地址" } satisfies HealthResult }, { status: 200 });

    const cooldownKey = `${currentUser.id}:${baseUrl.toLowerCase()}:${kind}`;
    const waitMs = (healthCooldowns.get(cooldownKey) || 0) - Date.now();
    if (waitMs > 0) return NextResponse.json({ error: `接口测试过于频繁，请 ${Math.ceil(waitMs / 1000)} 秒后再试` }, { status: 429 });
    healthCooldowns.set(cooldownKey, Date.now() + HEALTH_COOLDOWN_MS);

    try {
        const result =
            kind === "text"
                ? await testText(providerBaseUrl, apiKey, model, globalPreset)
                : kind === "image"
                  ? await testImage(providerBaseUrl, apiKey, model, globalPreset)
                  : kind === "audio"
                    ? await testAudio(providerBaseUrl, apiKey, model)
                    : await testVideo(providerBaseUrl, apiKey, model, globalPreset);
        return NextResponse.json({ result });
    } catch (error) {
        const message = isProviderTimeoutError(error) ? "上游接口请求超时" : sanitizeProviderMessage(error instanceof Error ? error.message : "接口测试失败", [apiKey]);
        return NextResponse.json({ result: { ok: false, kind, model, status: 0, error: message } satisfies HealthResult }, { status: 200 });
    }
}

async function testText(baseUrl: string, apiKey: string, model: string, globalPreset?: GlobalAiOpcPreset): Promise<HealthResult> {
    const nativeGemini = globalPreset?.id === "text-gemini-native";
    const nativeClaude = globalPreset?.id === "text-claude-native";
    const path = nativeGemini ? `/models/${encodeURIComponent(model)}:generateContent` : nativeClaude ? "/messages" : globalPreset?.createPath || "/chat/completions";
    const body = nativeGemini
        ? { contents: [{ role: "user", parts: [{ text: "Reply exactly OK." }] }], generationConfig: { maxOutputTokens: 8 } }
        : nativeClaude
          ? { model, max_tokens: 8, messages: [{ role: "user", content: "Reply exactly OK." }] }
          : path === "/responses"
            ? { model, input: "Reply exactly OK." }
            : { model, messages: [{ role: "user", content: "Reply exactly OK." }], max_tokens: 8 };
    const response = await fetch(apiUrl(baseUrl, path), {
        method: "POST",
        headers: jsonHeaders(apiKey),
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    });
    const payload = await readPayload(response);
    if (!response.ok || isProviderBusinessError(payload)) return failed("text", model, response.status, payload, apiKey);
    return {
        ok: true,
        kind: "text",
        model,
        status: response.status,
        protocolKey: globalPreset ? "globalaiopc" : "openai",
        protocol: globalPreset?.label || "OpenAI 文本兼容",
        createPath: path,
        requestTemplate: nativeGemini
            ? '{"contents":[{"role":"user","parts":[{"text":"{{prompt}}"}]}]}'
            : nativeClaude
              ? '{"model":"{{model}}","max_tokens":1024,"messages":[{"role":"user","content":"{{prompt}}"}]}'
              : path === "/responses"
                ? '{"model":"{{model}}","input":"{{prompt}}"}'
                : '{"model":"{{model}}","messages":[{"role":"user","content":"{{prompt}}"}]}',
        resultField: nativeGemini ? "candidates[0].content.parts[0].text" : nativeClaude ? "content[0].text" : path === "/responses" ? "output_text" : "choices[0].message.content",
        ...pointsInfo(response.headers),
    };
}

async function testImage(baseUrl: string, apiKey: string, model: string, globalPreset?: GlobalAiOpcPreset): Promise<HealthResult> {
    if (globalPreset?.capability === "image") return testGlobalAiOpcImage(baseUrl, apiKey, model, globalPreset);
    for (const responseFormat of ["url", "b64_json"] as const) {
        const response = await fetch(apiUrl(baseUrl, "/images/generations"), {
            method: "POST",
            headers: jsonHeaders(apiKey),
            body: JSON.stringify({
                model,
                prompt: "A single blue circle icon on a white background.",
                n: 1,
                size: "1024x1024",
                quality: "low",
                response_format: responseFormat,
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
        });
        const payload = await readPayload(response);
        if (response.ok && !isProviderBusinessError(payload)) {
            return {
                ok: true,
                kind: "image",
                model,
                status: response.status,
                protocolKey: "openai",
                protocol: responseFormat === "url" ? "OpenAI 图片 URL" : "OpenAI 图片 Base64",
                createPath: "/images/generations",
                requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","size":"{{size}}","response_format":"url"}',
                resultField: "data[0].url / data[0].b64_json",
                referenceRule: "图生图使用 /images/edits；VOZEB PRO 会按 multipart、image、images、image_url、input_image 等常见字段自动兼容。",
                supportsReferenceImage: true,
                ...imageHealthReferenceConfig(baseUrl),
                remoteUrl: findStringByKeys(payload, [
                    "url",
                    "image_url",
                    "imageUrl",
                    "media_url",
                    "mediaUrl",
                    "source_url",
                    "sourceUrl",
                    "output_url",
                    "outputUrl",
                    "download_url",
                    "downloadUrl",
                    "file_url",
                    "fileUrl",
                    "asset_url",
                    "assetUrl",
                    "result_url",
                    "resultUrl",
                ]),
                ...pointsInfo(response.headers),
            };
        }
        const message = errorMessage(payload, `图片测试失败，状态码 ${response.status}`);
        if (responseFormat === "url" && /response[_ -]?format|url|unsupported|not supported|invalid|not implemented/i.test(message)) continue;
        return failed("image", model, response.status, payload, apiKey);
    }
    return { ok: false, kind: "image", model, status: 0, error: "图片测试失败" };
}

async function testAudio(baseUrl: string, apiKey: string, model: string): Promise<HealthResult> {
    const response = await fetch(apiUrl(baseUrl, "/audio/speech"), {
        method: "POST",
        headers: jsonHeaders(apiKey),
        body: JSON.stringify({ model, input: "VOZEB PRO audio health check.", voice: "alloy", response_format: "mp3" }),
        cache: "no-store",
        signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return failed("audio", model, response.status, await readPayload(response), apiKey);

    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    let payload: unknown = {};
    let hasAudioBytes = false;
    if (contentType.includes("json")) payload = await readPayload(response);
    else hasAudioBytes = (await response.arrayBuffer()).byteLength > 0;
    const taskId = findStringByKeys(payload, ["task_id", "taskId", "id", "job_id", "jobId", "request_id", "requestId", "uuid", "task_uuid", "taskUuid"]);
    const remoteUrl = findStringByKeys(payload, ["audio_url", "audioUrl", "media_url", "mediaUrl", "output_url", "outputUrl", "result_url", "resultUrl", "url", "uri"]);
    if (isProviderBusinessError(payload) || (!hasAudioBytes && !taskId && !remoteUrl)) return { ok: false, kind: "audio", model, status: response.status, error: errorMessage(payload, "音频接口未返回音频、结果地址或任务 ID") };
    return {
        ok: true,
        kind: "audio",
        model,
        status: response.status,
        protocolKey: "openai",
        protocol: taskId ? "OpenAI 音频异步任务" : "OpenAI 音频兼容",
        createPath: "/audio/speech",
        ...(taskId ? { queryPath: "/audio/speech/:task_id" } : {}),
        requestTemplate: '{"model":"{{model}}","input":"{{prompt}}","voice":"alloy","response_format":"mp3"}',
        resultField: taskId ? "audio_url / result_url / task_id" : "binary audio / audio_url / result_url",
        taskId,
        remoteUrl,
        ...pointsInfo(response.headers),
    };
}

function imageHealthReferenceConfig(baseUrl: string): Partial<HealthResult> {
    if (isQingyanHealthTarget(baseUrl)) {
        return {
            protocolKey: "qingyan",
            protocol: "青衍图片任务",
            requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","size":"{{size}}","response_format":"url"}',
            resultField: "result.data[0].url / data[0].url / url",
            referenceRule: "图生图使用 JSON 与公网图片 URL；单图字段 image，多图字段 images，避免提交 base64。",
            supportsReferenceImage: true,
        };
    }
    if (isSub2ApiHealthTarget(baseUrl)) {
        return {
            protocolKey: "sub2api",
            protocol: "sub2api 图片兼容",
            requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","size":"{{size}}","image_urls":["https://..."]}',
            referenceRule: "图生图使用 JSON 请求体；参考图字段为 image_urls 字符串数组，站内素材通过服务器媒体地址提供。",
            supportsReferenceImage: true,
        };
    }
    return {};
}

async function testVideo(baseUrl: string, apiKey: string, model: string, globalPreset?: GlobalAiOpcPreset): Promise<HealthResult> {
    if (globalPreset?.capability === "video") return testGlobalAiOpcVideo(baseUrl, apiKey, model, globalPreset);
    const basePayload = {
        model,
        prompt: "A calm 5 second shot of a blue circle logo on a white background.",
        n: 1,
        size: "1280x720",
        width: 1280,
        height: 720,
        response_format: "url",
        ratio: "16:9",
        aspect_ratio: "16:9",
        resolution: "480p",
        quality: "480p",
        async: true,
        generate_audio: false,
        watermark: false,
    };
    return testVideoPayloads(baseUrl, apiKey, model, buildVideoHealthPayloads(basePayload), false);
}

async function testGlobalAiOpcImage(baseUrl: string, apiKey: string, model: string, preset: GlobalAiOpcPreset): Promise<HealthResult> {
    const response = await fetch(apiUrl(baseUrl, preset.createPath), {
        method: "POST",
        headers: jsonHeaders(apiKey),
        body: JSON.stringify(buildGlobalAiOpcImageRequest(preset, { model, prompt: "A single blue circle icon on a white background.", quality: "low", ratio: "1:1", resolution: "1k", imageUrls: [] })),
        cache: "no-store",
        signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    });
    const payload = await readPayload(response);
    if (!response.ok || isProviderBusinessError(payload)) return failed("image", model, response.status, payload, apiKey);
    return {
        ok: true,
        kind: "image",
        model,
        status: response.status,
        protocolKey: "globalaiopc",
        protocol: preset.label,
        createPath: preset.createPath,
        queryPath: preset.queryPath,
        requestTemplate:
            preset.id === "image-gpt-image-2"
                ? '{"model":"{{model}}","prompt":"{{prompt}}","quality":"{{quality}}","ratio":"{{ratio}}","resolution":"2k","image_urls":"{{images}}"}'
                : '{"model":"{{model}}","prompt":"{{prompt}}","resolution":"2k","size":"{{ratio}}","image_urls":"{{images}}"}',
        resultField: "data[0].url / url / image_url",
        statusField: "status",
        referenceRule: "参考图使用 image_urls 公网 URL 数组。",
        supportsReferenceImage: true,
        taskId: findStringByKeys(payload, ["task_id", "taskId", "id", "job_id", "jobId"]),
        remoteUrl: findStringByKeys(payload, ["url", "image_url", "imageUrl", "result_url", "resultUrl"]),
        ...pointsInfo(response.headers),
    };
}

async function testGlobalAiOpcVideo(baseUrl: string, apiKey: string, model: string, preset: GlobalAiOpcPreset): Promise<HealthResult> {
    const response = await fetch(apiUrl(baseUrl, preset.createPath), {
        method: "POST",
        headers: jsonHeaders(apiKey),
        body: JSON.stringify(
            buildGlobalAiOpcVideoRequest(preset, { model, prompt: "A calm 5 second shot of a blue circle logo on a white background.", duration: 5, ratio: "16:9", resolution: "480p", images: [], videos: [], audios: [], generateAudio: false }),
        ),
        cache: "no-store",
        signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    });
    const payload = await readPayload(response);
    if (!response.ok || isProviderBusinessError(payload)) return failed("video", model, response.status, payload, apiKey);
    return {
        ok: true,
        kind: "video",
        model,
        status: response.status,
        protocolKey: "globalaiopc",
        protocol: preset.label,
        createPath: preset.createPath,
        queryPath: preset.queryPath,
        resultField: "video_url / media_url / result_url / url",
        statusField: "status / state",
        durationRange: preset.durationRange,
        referenceRule: "参考素材使用可被上游访问的公网 URL。",
        supportsReferenceImage: preset.supportsReferenceImage,
        supportsReferenceVideo: preset.supportsReferenceVideo,
        supportsReferenceAudio: preset.supportsReferenceAudio,
        taskId: findStringByKeys(payload, ["task_id", "taskId", "id", "job_id", "jobId"]),
        remoteUrl: findStringByKeys(payload, ["video_url", "videoUrl", "media_url", "mediaUrl", "result_url", "resultUrl", "url"]),
        ...pointsInfo(response.headers),
    };
}

async function testVideoPayloads(baseUrl: string, apiKey: string, model: string, payloads: Array<Record<string, unknown>>, allowReferenceRetry: boolean): Promise<HealthResult> {
    for (const path of videoHealthPaths(baseUrl, model)) {
        for (const payload of videoHealthPayloadsForPath(path, payloads)) {
            const response = await fetch(apiUrl(baseUrl, path), {
                method: "POST",
                headers: jsonHeaders(apiKey),
                body: JSON.stringify(payload),
                cache: "no-store",
                signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
            });
            const data = await readPayload(response);
            if (response.ok && !isProviderBusinessError(data)) {
                const config = videoHealthConfig(baseUrl, model, path);
                return {
                    ok: true,
                    kind: "video",
                    model,
                    status: response.status,
                    ...config,
                    referenceHint: config.referenceRule,
                    ...pointsInfo(response.headers),
                    taskId: findStringByKeys(data, ["task_id", "taskId", "id", "job_id", "jobId", "request_id", "requestId", "uuid", "task_uuid", "taskUuid"]),
                    remoteUrl: findStringByKeys(data, [
                        "video_url",
                        "videoUrl",
                        "media_url",
                        "mediaUrl",
                        "play_url",
                        "playUrl",
                        "stream_url",
                        "streamUrl",
                        "source_url",
                        "sourceUrl",
                        "content_url",
                        "contentUrl",
                        "url",
                        "output_url",
                        "outputUrl",
                        "download_url",
                        "downloadUrl",
                        "file_url",
                        "fileUrl",
                        "asset_url",
                        "assetUrl",
                        "result_url",
                        "resultUrl",
                    ]),
                };
            }
            const message = errorMessage(data, `视频测试失败，状态码 ${response.status}`);
            if (/not found|not implemented|route|endpoint|unsupported|no such|cannot post|invalid url|404/i.test(message)) break;
            if (shouldRetryVideoHealthPayload(response.status, message)) continue;
            if (path !== GLOBAL_AIOPC_VIDEO_CREATE_PATH && path !== SEEDANCE_VIDEO_CREATE_PATH && !allowReferenceRetry && shouldRetryVideoHealthWithReference(message)) {
                return testVideoPayloads(baseUrl, apiKey, model, buildVideoHealthPayloads(payload, true), true);
            }
            return failed("video", model, response.status, data, apiKey);
        }
    }
    return { ok: false, kind: "video", model, status: 0, error: "视频测试失败：所有兼容路径都不可用" };
}

function videoHealthPaths(baseUrl: string, model: string) {
    if (isSeedanceVideoHealthTarget(baseUrl, model)) return uniquePaths([SEEDANCE_VIDEO_CREATE_PATH, "/video/generations", "/videos/generations", "/videos", GLOBAL_AIOPC_VIDEO_CREATE_PATH]);
    if (isGlobalAiOpcVideoHealthTarget(baseUrl, model)) return uniquePaths([GLOBAL_AIOPC_VIDEO_CREATE_PATH, "/videos", "/video/generations", "/videos/generations", SEEDANCE_VIDEO_CREATE_PATH]);
    if (isQingyanVideoHealthTarget(baseUrl, model)) return uniquePaths(["/video/generations", "/videos/generations", "/videos", GLOBAL_AIOPC_VIDEO_CREATE_PATH, SEEDANCE_VIDEO_CREATE_PATH]);
    return VIDEO_HEALTH_PATHS;
}

function videoHealthPayloadsForPath(path: string, payloads: Array<Record<string, unknown>>) {
    if (path === GLOBAL_AIOPC_VIDEO_CREATE_PATH) {
        return payloads.map((payload) => ({
            model: String(payload.model || ""),
            prompt: String(payload.prompt || "A calm 5 second shot of a blue circle logo on a white background."),
            duration: normalizeGlobalAiOpcHealthDuration(payload.duration || payload.seconds),
            ratio: "16:9",
            resolution: "480p",
            autoFace: false,
        }));
    }
    if (path === SEEDANCE_VIDEO_CREATE_PATH) {
        return payloads.map((payload) => ({
            model: String(payload.model || ""),
            content: [{ type: "text", text: String(payload.prompt || "A calm 5 second shot of a blue circle logo on a white background.") }],
            duration: normalizeSeedanceHealthDuration(payload.duration || payload.seconds),
            ratio: "16:9",
            resolution: "480p",
            generate_audio: false,
            watermark: false,
        }));
    }
    return payloads;
}

function videoHealthConfig(baseUrl: string, model: string, path: string): Partial<HealthResult> {
    if (path === GLOBAL_AIOPC_VIDEO_CREATE_PATH) {
        return {
            protocolKey: "globalaiopc",
            protocol: "GlobalAiOpc Videos",
            createPath: GLOBAL_AIOPC_VIDEO_CREATE_PATH,
            queryPath: "/result/:task_id",
            requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","duration":"{{duration}}","ratio":"{{ratio}}","resolution":"{{resolution}}","referenceImages":"{{images}}","referenceVideos":"{{videos}}","referenceAudios":"{{audios}}"}',
            resultField: "video_url / media_url / result_url / url",
            statusField: "status / state",
            durationRange: "4-15 秒",
            referenceRule: "参考图、参考视频和参考音频由服务器生成可访问地址后提交，上游必须能够访问当前站点。",
            supportsReferenceImage: true,
            supportsReferenceVideo: true,
            supportsReferenceAudio: true,
        };
    }
    if (path === SEEDANCE_VIDEO_CREATE_PATH) {
        return {
            protocolKey: "seedance",
            protocol: "Seedance / Ark Plan",
            createPath: SEEDANCE_VIDEO_CREATE_PATH,
            queryPath: "/contents/generations/tasks/:task_id",
            requestTemplate: '{"model":"{{model}}","content":[{"type":"text","text":"{{prompt}}"}],"duration":"{{duration}}","ratio":"{{ratio}}","resolution":"{{resolution}}"}',
            resultField: "content.video_url",
            statusField: "status",
            durationRange: "按模型限制，常用 5/10 秒",
            referenceRule: "支持图片、视频、音频参考素材；参考视频和音频有大小与时长限制，建议使用公网 URL。",
            supportsReferenceImage: true,
            supportsReferenceVideo: true,
            supportsReferenceAudio: true,
        };
    }
    if (path === "/videos") {
        return {
            protocolKey: "openai",
            protocol: "OpenAI Videos",
            createPath: "/videos",
            queryPath: "/videos/:task_id",
            requestTemplate: "multipart/form-data: model、prompt、seconds、size、input_reference[]",
            resultField: "/videos/:task_id/content",
            statusField: "status",
            durationRange: "按上游模型限制",
            referenceRule: "参考图使用 multipart 文件上传，由 VOZEB PRO 自动组装。",
            supportsReferenceImage: true,
            supportsReferenceVideo: false,
            supportsReferenceAudio: false,
        };
    }
    if (isQingyanVideoHealthTarget(baseUrl, model) || path === "/video/generations") {
        return {
            protocolKey: isQingyanVideoHealthTarget(baseUrl, model) ? "qingyan" : "compatible",
            protocol: isQingyanVideoHealthTarget(baseUrl, model) ? "青衍视频任务" : "兼容视频任务",
            createPath: path,
            queryPath: `${path}/:task_id`,
            requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","duration":"{{duration}}","ratio":"{{ratio}}","image":"{{image}}","images":"{{images}}"}',
            resultField: "result.data[0].url / video_url / media_url / output_url / url",
            statusField: "status / state / task_status",
            durationRange: isQingyanVideoHealthTarget(baseUrl, model) ? "上游可能重写参数；实测 5 秒/480p 返回 10 秒/1080p" : "5、10、15 秒或按上游限制",
            referenceRule: isQingyanVideoHealthTarget(baseUrl, model) ? "图生视频按文档使用公网图片 URL；单图字段 image，多图字段 images，避免提交 base64。" : "参考图会按 base64、URL 和常见兼容字段自动尝试。",
            supportsReferenceImage: true,
            supportsReferenceVideo: false,
            supportsReferenceAudio: false,
        };
    }
    return {
        protocolKey: "compatible",
        protocol: "兼容视频任务",
        createPath: path,
        queryPath: `${path}/:task_id`,
        requestTemplate: '{"model":"{{model}}","prompt":"{{prompt}}","duration":"{{duration}}","ratio":"{{ratio}}"}',
        resultField: "video_url / media_url / output_url / url",
        statusField: "status / state / task_status",
        durationRange: "5、10、15 秒或按上游限制",
        referenceRule: "参考图会按 base64、URL 和常见兼容字段自动尝试。",
        supportsReferenceImage: true,
        supportsReferenceVideo: false,
        supportsReferenceAudio: false,
    };
}

function isGlobalAiOpcVideoHealthTarget(baseUrl: string, model: string) {
    const url = baseUrl.toLowerCase();
    const modelName = model.trim().toLowerCase();
    return url.includes("globalaiopc.com") || url.includes("aizfw.cn") || url.includes("kyyreactapiserver") || ["videos", "videos_stable", "videos_stable_fast"].includes(modelName);
}

function isSeedanceVideoHealthTarget(baseUrl: string, model: string) {
    const url = baseUrl.toLowerCase();
    const modelName = model.trim().toLowerCase();
    return url.includes("volces.com") || url.includes("/api/plan/v3") || modelName.includes("seedance") || modelName.includes("doubao-seedance");
}

function isQingyanVideoHealthTarget(baseUrl: string, model: string) {
    return isQingyanProvider({ baseUrl, model });
}

function isQingyanHealthTarget(baseUrl: string) {
    return isQingyanProvider({ baseUrl });
}

function isSub2ApiHealthTarget(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const host = url.hostname.toLowerCase();
        const source = `${host}${url.pathname}`.toLowerCase();
        return host === "code2alita.com" || host.endsWith(".code2alita.com") || source.includes("sub2api");
    } catch {
        const source = baseUrl.toLowerCase();
        return source.includes("code2alita.com") || source.includes("sub2api");
    }
}

function normalizeGlobalAiOpcHealthDuration(value: unknown) {
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(4, Math.min(15, seconds));
}

function normalizeSeedanceHealthDuration(value: unknown) {
    const seconds = Math.floor(Number(value) || 5);
    return seconds <= 5 ? 5 : 10;
}

function uniquePaths(paths: string[]) {
    return Array.from(new Set(paths));
}

function buildVideoHealthPayloads(basePayload: Record<string, unknown>, withReference = false) {
    const { seconds: _seconds, duration: _duration, ...cleanBasePayload } = basePayload;
    const mediaPayloads: Array<Record<string, unknown>> = withReference
        ? [
              { input_image: { url: VIDEO_HEALTH_REFERENCE_IMAGE } },
              { image_url: { url: VIDEO_HEALTH_REFERENCE_IMAGE } },
              { image: VIDEO_HEALTH_REFERENCE_IMAGE },
              { image: VIDEO_HEALTH_REFERENCE_IMAGE, images: [VIDEO_HEALTH_REFERENCE_IMAGE], ref_assets: [VIDEO_HEALTH_REFERENCE_IMAGE] },
              { image: { url: VIDEO_HEALTH_REFERENCE_IMAGE }, images: [{ url: VIDEO_HEALTH_REFERENCE_IMAGE }], ref_assets: [{ url: VIDEO_HEALTH_REFERENCE_IMAGE }] },
          ]
        : [{}];
    return mediaPayloads.flatMap((mediaPayload) => [
        { ...cleanBasePayload, ...mediaPayload, seconds: "5" },
        { ...cleanBasePayload, ...mediaPayload, duration: 5 },
        { ...cleanBasePayload, ...mediaPayload, seconds: "5", duration: 5 },
    ]);
}

function shouldRetryVideoHealthPayload(status: number, message: string) {
    if (status !== 400 && status !== 422) return false;
    return /duration|seconds|duplicate field|unmarshal|invalid type|resolution|quality|size|field|image|images|input_image|ref_assets/i.test(message);
}

function shouldRetryVideoHealthWithReference(message: string) {
    return /text-to-video|image-to-video|input image|reference image|image is required|requires image|not supported for this model/i.test(message);
}

function failed(kind: HealthKind, model: string, status: number, payload: unknown, apiKey: string): HealthResult {
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

function jsonHeaders(apiKey: string) {
    return { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
}

function apiUrl(baseUrl: string, path: string) {
    const normalized = normalizeHealthBaseUrl(baseUrl.trim().replace(/\/+$/, ""));
    const lower = normalized.toLowerCase();
    const apiBase = lower.endsWith("/v1") || lower.endsWith("/api/v3") || lower.endsWith("/api/plan/v3") ? normalized : `${normalized}/v1`;
    return `${apiBase}${path}`;
}

function normalizeHealthBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
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

function findStringByKeys(value: unknown, keys: string[], depth = 0): string {
    if (!value || depth > 5) return "";
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findStringByKeys(item, keys, depth + 1);
            if (found) return found;
        }
        return "";
    }
    if (typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    for (const key of keys) {
        const found = stringValue(record[key]);
        if (found) return found;
    }
    for (const item of Object.values(record)) {
        const found = findStringByKeys(item, keys, depth + 1);
        if (found) return found;
    }
    return "";
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
