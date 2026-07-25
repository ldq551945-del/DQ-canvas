import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { configureServerProxyDispatcher } from "@/lib/server/proxy-dispatcher";
import { isSafeOutboundUrl } from "@/lib/server/security";
import { isProviderTimeoutError, resolveAdminChannelCredentials, sanitizeProviderMessage } from "@/lib/server/admin-channel-config";
import { buildModelsUrl, isModelCatalogUnsupported, parseModels } from "@/lib/server/admin-model-catalog";
import { isProviderBusinessError, readProviderError } from "@/lib/server/provider-task-config";
import { buildGlobalAiOpcSelection, isGlobalAiOpcBaseUrl, resolveGlobalAiOpcCatalogPresets } from "@/lib/globalaiopc-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

configureServerProxyDispatcher();

type ModelsPayload = {
    channelId?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    apiFormat?: unknown;
    protocol?: unknown;
    globalAiOpcPreset?: unknown;
    globalAiOpcPresets?: unknown;
    createPath?: unknown;
};

type ModelsResponse = {
    data?: unknown;
    models?: unknown;
    result?: unknown;
    error?: { message?: string };
    msg?: string;
};

const MODEL_FETCH_COOLDOWN_MS = 30_000;
const MODEL_FETCH_TIMEOUT_MS = 60_000;
const globalCooldownStore = globalThis as typeof globalThis & { __vozebProModelFetchCooldowns?: Map<string, number> };
const modelFetchCooldowns = (globalCooldownStore.__vozebProModelFetchCooldowns ??= new Map<string, number>());

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (currentUser.role !== "admin") return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

    const [body, settings] = await Promise.all([readJsonBody<ModelsPayload>(request), getAuthSettings()]);
    const { baseUrl, apiKey, apiFormat, savedChannel } = resolveAdminChannelCredentials(settings, body);
    if (!baseUrl || !apiKey) return NextResponse.json({ error: "请先填写 Base URL 和 API Key" }, { status: 400 });
    const advancedConfig = {
        ...(savedChannel?.advancedConfig || {}),
        ...(body.protocol !== undefined ? { protocol: body.protocol } : {}),
        ...(body.globalAiOpcPreset !== undefined ? { globalAiOpcPreset: body.globalAiOpcPreset } : {}),
        ...(body.globalAiOpcPresets !== undefined ? { globalAiOpcPresets: body.globalAiOpcPresets } : {}),
        ...(body.createPath !== undefined ? { createPath: body.createPath } : {}),
    };
    const globalAiOpcPresets = resolveGlobalAiOpcCatalogPresets(baseUrl, advancedConfig);
    if (globalAiOpcPresets.length) {
        const catalog = buildGlobalAiOpcSelection(globalAiOpcPresets.map((preset) => preset.id));
        return NextResponse.json({ models: catalog.models, globalAiOpcPresets: catalog.presetIds });
    }
    if (advancedConfig.protocol === "globalaiopc" || isGlobalAiOpcBaseUrl(baseUrl)) return NextResponse.json({ error: "未识别到 GlobalAiOpc 接口范围，请检查 Base URL 或重新选择接口范围" }, { status: 400 });
    const modelsUrl = buildModelsUrl(baseUrl, apiFormat);
    if (!(await isSafeOutboundUrl(modelsUrl))) return NextResponse.json({ error: "Base URL 不允许访问内网或保留地址" }, { status: 400 });

    const cooldownKey = `${currentUser.id}:${baseUrl.toLowerCase()}`;
    const waitMs = (modelFetchCooldowns.get(cooldownKey) || 0) - Date.now();
    if (waitMs > 0) return NextResponse.json({ error: `拉取模型过于频繁，请 ${Math.ceil(waitMs / 1000)} 秒后再试` }, { status: 429 });
    modelFetchCooldowns.set(cooldownKey, Date.now() + MODEL_FETCH_COOLDOWN_MS);

    try {
        const response = await fetch(modelsUrl, {
            headers: apiFormat === "gemini" ? { "x-goog-api-key": apiKey } : { authorization: `Bearer ${apiKey}` },
            cache: "no-store",
            signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
        });
        const payload = (await response.json().catch(() => ({}))) as ModelsResponse;
        if (!response.ok || isProviderBusinessError(payload)) {
            modelFetchCooldowns.delete(cooldownKey);
            if (isModelCatalogUnsupported(response.status, payload)) {
                return NextResponse.json({ error: "该上游未提供模型列表接口，请在高级设置的“模型列表”手动填写模型名称；不影响已配置的视频生成接口。" }, { status: 422 });
            }
            return NextResponse.json({ error: sanitizeProviderMessage(readProviderError(payload) || payload.msg || payload.error?.message || `拉取模型失败：${response.status}`, [apiKey]) }, { status: 502 });
        }
        const models = parseModels(payload);
        if (!models.length) {
            modelFetchCooldowns.delete(cooldownKey);
            return NextResponse.json({ error: "接口请求成功，但返回内容中没有识别到模型列表" }, { status: 502 });
        }
        return NextResponse.json({ models });
    } catch (error) {
        modelFetchCooldowns.delete(cooldownKey);
        console.error("Admin model fetch failed", sanitizeProviderMessage(error, [apiKey]));
        return NextResponse.json({ error: isProviderTimeoutError(error) ? "拉取模型超时，请稍后重试" : "拉取模型失败，请检查接口地址和网络" }, { status: 502 });
    }
}
