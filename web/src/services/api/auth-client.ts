"use client";

type AuthErrorPayload = { error?: unknown; message?: unknown; msg?: unknown };

export async function readAuthPayload<T>(response: Response, fallback: string) {
    const payload = (await response.json().catch(() => null)) as (T & AuthErrorPayload) | null;
    if (!response.ok) throw new Error(authErrorText(payload) || `${fallback}${response.status ? `（${response.status}）` : ""}`);
    return payload as T;
}

function authErrorText(payload: AuthErrorPayload | null) {
    if (!payload) return "";
    for (const value of [payload.error, payload.message, payload.msg]) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}
