import { NextResponse } from "next/server";

import { getCurrentUser, serializeCurrentUser } from "@/lib/auth/session";
import { isAuthInputError } from "@/lib/auth/store";
import { ProfileAvatarServiceError, replaceProfileAvatar } from "@/lib/server/profile-avatar-service";
import { checkRateLimit, rateLimitHeaders } from "@/lib/server/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return response(401, null, "请先登录");
    const limit = await checkRateLimit(`profile-avatar:${currentUser.id}`, { maxRequests: 10, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) return NextResponse.json({ code: 429, data: null, msg: "操作过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(limit) });

    try {
        const body = await request.formData();
        const file = body.get("avatar");
        if (!(file instanceof File)) return response(400, null, "请选择头像图片");
        const user = await replaceProfileAvatar(currentUser.id, {
            bytes: new Uint8Array(await file.arrayBuffer()),
            mimeType: file.type,
            originalName: file.name,
        });
        return response(200, { user: serializeCurrentUser(user) }, "头像已更新");
    } catch (error) {
        if (error instanceof ProfileAvatarServiceError || isAuthInputError(error)) return response(error.status, null, error.message);
        console.error("Profile avatar update failed", error);
        return response(500, null, "头像更新失败");
    }
}

function response(status: number, data: unknown, msg: string) {
    return NextResponse.json({ code: status === 200 ? 0 : status, data, msg }, { status });
}
