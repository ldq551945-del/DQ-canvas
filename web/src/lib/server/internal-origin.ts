import { Agent, fetch as undiciFetch } from "undici";

import { toUndiciRequestBody } from "@/lib/server/undici-request-body";

const internalDispatcher = new Agent({});

export function resolveInternalOrigin(publicOrigin: string) {
    const configured = normalizeOrigin(process.env.DQ_INTERNAL_ORIGIN || "");
    if (configured) return configured;

    const publicUrl = parseOrigin(publicOrigin);
    if (publicUrl && isLoopbackHost(publicUrl.hostname)) return publicUrl.origin;
    if (process.env.VERCEL === "1") return publicUrl?.origin || publicOrigin;

    const port = process.env.PORT?.trim();
    if (port) return `http://127.0.0.1:${port}`;
    return publicUrl?.origin || "http://127.0.0.1:3000";
}

export function isInternalApiBaseUrl(baseUrl: string) {
    return baseUrl.trim().startsWith("/");
}

export async function fetchInternalApi(input: string | URL, init: RequestInit = {}): Promise<Response> {
    const requestBody = await toUndiciRequestBody(init.body);
    const headers = new Headers(init.headers);
    if (requestBody.contentType && !headers.has("content-type")) headers.set("content-type", requestBody.contentType);
    return (await undiciFetch(input, { ...init, body: requestBody.body, headers, dispatcher: internalDispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
}

function normalizeOrigin(value: string) {
    const parsed = parseOrigin(value.trim().replace(/\/+$/, ""));
    return parsed && (parsed.protocol === "http:" || parsed.protocol === "https:") ? parsed.origin : "";
}

function parseOrigin(value: string) {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

function isLoopbackHost(hostname: string) {
    const host = hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
