import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { commerceError, commerceOk } from "@/app/api/billing/commerce-response";
import { getReferralCenter } from "@/lib/server/referral-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ code: 401, data: null, msg: "请先登录" }, { status: 401 });
    try {
        const origin = process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(request.url).origin;
        return commerceOk(await getReferralCenter(user.id, origin));
    } catch (error) {
        return commerceError(error, "加载邀请中心失败", "Load referral center failed");
    }
}
