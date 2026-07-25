import { NextResponse } from "next/server";

import { authenticateUser, createSession, isAuthInputError } from "@/lib/auth/store";
import { readJsonBody } from "@/lib/auth/request";
import { serializeCurrentUser, setSessionCookie } from "@/lib/auth/session";
import { auditActorFromRequest, safeRecordAuditLog } from "@/lib/server/audit-log-store";
import { checkRateLimit, getClientIp } from "@/lib/server/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
    let username = "";

    try {
        const body = await readJsonBody<{ username?: string; password?: string }>(request);
        username = body.username || "";
        const limit = await checkRateLimit(`login:${getClientIp(request)}:${username.toLowerCase()}`, { maxRequests: 8, windowMs: 15 * 60 * 1000 });
        if (!limit.allowed) {
            const retryAfter = Math.ceil((limit.resetAt - Date.now()) / 1000);
            await safeRecordAuditLog({
                action: "auth.login",
                status: "failure",
                actor: auditActorFromRequest(request, { username, role: "user" }),
                target: { type: "user", label: username },
                metadata: { reason: "rate_limited", retryAfter },
            });
            return NextResponse.json({ error: "登录请求过于频繁，请稍后重试", retryAfter }, { status: 429 });
        }

        const user = await authenticateUser({ username, password: body.password || "" });
        const sessionValue = await createSession(user.id);
        const response = NextResponse.json({ user: serializeCurrentUser(user) });
        setSessionCookie(response, sessionValue, request);
        await safeRecordAuditLog({
            action: "auth.login",
            actor: auditActorFromRequest(request, user),
            target: { type: "user", id: user.id, label: user.username },
        });
        return response;
    } catch (error) {
        await safeRecordAuditLog({
            action: "auth.login",
            status: "failure",
            actor: auditActorFromRequest(request, { username, role: "user" }),
            target: { type: "user", label: username },
            metadata: { error: error instanceof Error ? error.message : "unknown" },
        });
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Login failed", error);
        return NextResponse.json({ error: "登录失败，请稍后重试" }, { status: 500 });
    }
}
