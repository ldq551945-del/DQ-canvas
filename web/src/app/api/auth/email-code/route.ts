import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { createEmailVerificationCode, getAuthSettings, isAuthInputError, type EmailCodePurpose } from "@/lib/auth/store";
import { sendSmtpMail } from "@/lib/mail/smtp";
import { checkRateLimit, getClientIp } from "@/lib/server/security";

export const runtime = "nodejs";

const EMAIL_CODE_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_CODE_PER_ADDRESS_LIMIT = 5;
const EMAIL_CODE_PER_IP_LIMIT = 20;

const purposeText: Record<EmailCodePurpose, string> = {
    register: "注册账号",
    "email-change": "修改邮箱",
    "password-reset": "重置密码",
};

export async function POST(request: Request) {
    try {
        const body = await readJsonBody<{ purpose?: unknown; email?: unknown }>(request);
        const purpose = body.purpose === "email-change" || body.purpose === "password-reset" ? body.purpose : body.purpose === "register" ? body.purpose : null;
        if (!purpose) return NextResponse.json({ error: "验证码用途不正确" }, { status: 400 });
        const emailKey = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const clientIp = getClientIp(request);
        if (purpose === "password-reset") {
            const ipLimit = await checkRateLimit(`email-code:${clientIp}:${purpose}`, { maxRequests: EMAIL_CODE_PER_IP_LIMIT, windowMs: EMAIL_CODE_WINDOW_MS });
            if (!ipLimit.allowed) return NextResponse.json({ error: "验证码发送过于频繁，请稍后重试", retryAfter: Math.ceil((ipLimit.resetAt - Date.now()) / 1000) }, { status: 429 });
        }
        const limit = await checkRateLimit(`email-code:${clientIp}:${purpose}:${emailKey}`, { maxRequests: EMAIL_CODE_PER_ADDRESS_LIMIT, windowMs: EMAIL_CODE_WINDOW_MS });
        if (!limit.allowed) return NextResponse.json({ error: "验证码发送过于频繁，请稍后重试", retryAfter: Math.ceil((limit.resetAt - Date.now()) / 1000) }, { status: 429 });

        const currentUser = await getCurrentUser();
        if (purpose === "email-change" && !currentUser) return NextResponse.json({ error: "请先登录" }, { status: 401 });

        let verification: { code?: string; email: string };
        try {
            verification = await createEmailVerificationCode({
                purpose,
                email: typeof body.email === "string" ? body.email : "",
                userId: purpose === "email-change" ? currentUser?.id : undefined,
                ...(purpose === "password-reset" ? { silentPasswordResetMissing: true } : {}),
            });
        } catch (error) {
            if (purpose === "password-reset" && isAuthInputError(error)) return NextResponse.json({ ok: true });
            throw error;
        }

        if (verification.code) {
            const settings = await getAuthSettings();
            try {
                await sendSmtpMail({
                    mail: settings.mail,
                    to: verification.email,
                    subject: `DQ-绘图 ${purposeText[purpose]}验证码`,
                    text: [`你的 DQ-绘图 ${purposeText[purpose]}验证码是：${verification.code}`, "", "验证码 10 分钟内有效，请勿转发给他人。"].join("\r\n"),
                });
            } catch (error) {
                if (purpose !== "password-reset") throw error;
                console.error("Password reset email delivery failed", error);
            }
        }
        return NextResponse.json({ ok: true });
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Send email code failed", error);
        return NextResponse.json({ error: "发送验证码失败，请稍后重试" }, { status: 400 });
    }
}
