import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { CANVAS_IMAGE_UPLOAD_MAX_BYTES, CANVAS_IMAGE_UPLOAD_MAX_REQUEST_BYTES, CREATIVE_UPLOAD_MAX_BYTES } from "@/lib/creative-upload";
import { writePersistentMediaDataUrl, writeReferenceMediaDataUrl } from "@/lib/server/reference-asset-store";
import { readJsonBody } from "@/lib/auth/request";
import { createSignedReferenceAssetUrl } from "@/lib/server/reference-asset-access";
import { requestPublicOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const body = await readJsonBody<{ dataUrl?: unknown; type?: unknown; persistent?: unknown; originalName?: unknown; purpose?: unknown }>(request, CANVAS_IMAGE_UPLOAD_MAX_REQUEST_BYTES).catch(
        () => ({}) as { dataUrl?: unknown; type?: unknown; persistent?: unknown; originalName?: unknown; purpose?: unknown },
    );
    const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
    if (!dataUrl) return NextResponse.json({ error: "缺少参考素材" }, { status: 400 });
    const type = body.type === "video" || body.type === "audio" ? body.type : "image";
    const purpose = type === "image" && body.purpose === "canvas-image" ? "canvas-image" : undefined;

    try {
        const context = {
            ownerUserId: currentUser.id,
            source: "user-upload",
            originalName: typeof body.originalName === "string" ? body.originalName : undefined,
            maxBytes: purpose === "canvas-image" ? CANVAS_IMAGE_UPLOAD_MAX_BYTES : CREATIVE_UPLOAD_MAX_BYTES,
        };
        const asset = body.persistent === true ? await writePersistentMediaDataUrl(dataUrl, type, context) : await writeReferenceMediaDataUrl(dataUrl, type, context);
        const origin = requestPublicOrigin(request);
        const browserUrl = `/api/reference-assets/${asset.token
            .split("/")
            .map((part) => encodeURIComponent(part))
            .join("/")}`;
        return NextResponse.json({
            url: browserUrl,
            upstreamUrl: asset.url || createSignedReferenceAssetUrl(asset.token, origin) || undefined,
            token: asset.token,
            key: asset.token,
            storage: asset.storage,
            bytes: asset.bytes,
            mimeType: asset.mimeType,
        });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "参考图临时保存失败" }, { status: 400 });
    }
}
