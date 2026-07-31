import { NextResponse } from "next/server";

import { getAuthSettings } from "@/lib/auth/store";
import { readProviderString } from "@/lib/server/provider-task-config";
import { GenerationWebhookError, isGenerationWebhookConfigured, recordGenerationWebhook, verifyGenerationWebhookSignature } from "@/lib/server/generation-task-webhook";
import { readRequestBodyText, RequestBodyTooLargeError } from "@/lib/server/request-body-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_KEYS = ["task_id", "taskId", "id", "job_id", "jobId", "generation_id", "generationId"];
const EVENT_KEYS = ["event_id", "eventId", "webhook_id", "webhookId", "event.id"];
const STATUS_KEYS = ["status", "state", "task_status", "taskStatus"];
const RESULT_KEYS = ["video_url", "videoUrl", "image_url", "imageUrl", "audio_url", "audioUrl", "media_url", "mediaUrl", "output_url", "outputUrl", "result_url", "resultUrl", "url", "uri"];
const CLIENT_REQUEST_KEYS = ["client_request_id", "clientRequestId", "metadata.client_request_id", "metadata.clientRequestId"];

export async function POST(request: Request, { params }: { params: Promise<{ channelId: string }> }) {
    if (!isGenerationWebhookConfigured()) return NextResponse.json({ code: 503, data: null, msg: "生成回调验签密钥未配置" }, { status: 503 });
    try {
        const rawBody = await readRequestBodyText(request, 1024 * 1024);
        const signature = request.headers.get("x-vozeb-pro-signature") || request.headers.get("x-signature") || "";
        if (!verifyGenerationWebhookSignature(rawBody, signature)) return NextResponse.json({ code: 401, data: null, msg: "生成回调验签失败" }, { status: 401 });
        const payload = JSON.parse(rawBody) as unknown;
        const channelId = (await params).channelId.trim();
        const channel = (await getAuthSettings()).systemChannels.find((item) => item.id === channelId && item.enabled);
        if (!channel) return NextResponse.json({ code: 404, data: null, msg: "生成回调渠道不存在" }, { status: 404 });
        const eventId = request.headers.get("x-vozeb-pro-event-id")?.trim() || readProviderString(payload, "event.id", EVENT_KEYS);
        const upstreamTaskId = readProviderString(payload, undefined, ID_KEYS);
        const result = await recordGenerationWebhook({
            channelId,
            eventId,
            upstreamTaskId,
            clientRequestId: readProviderString(payload, "metadata.client_request_id / metadata.clientRequestId", CLIENT_REQUEST_KEYS),
            upstreamStatus: readProviderString(payload, channel.advancedConfig?.statusField, STATUS_KEYS),
            resultUrl: readProviderString(payload, channel.advancedConfig?.resultField, RESULT_KEYS),
            rawBody,
        });
        return NextResponse.json({ code: 0, data: result, msg: result.duplicate ? "回调事件已处理" : result.matched ? "生成任务已更新" : "回调已登记，等待任务对账" });
    } catch (error) {
        if (error instanceof RequestBodyTooLargeError || error instanceof GenerationWebhookError) return NextResponse.json({ code: error.status, data: null, msg: error.message }, { status: error.status });
        if (error instanceof SyntaxError) return NextResponse.json({ code: 400, data: null, msg: "生成回调不是有效 JSON" }, { status: 400 });
        console.error("Generation webhook failed", error);
        return NextResponse.json({ code: 500, data: null, msg: "生成回调处理失败" }, { status: 500 });
    }
}
