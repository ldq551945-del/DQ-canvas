import { Agent, buildConnector, fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";

import { isPublicIpAddress, resolveSafeOutboundTarget, type SafeOutboundOptions, type SafeOutboundTarget } from "@/lib/server/outbound-url-security";
import { getOutboundProxyUrl } from "@/lib/server/proxy-dispatcher";
import { toUndiciRequestBody } from "@/lib/server/undici-request-body";

type CachedDispatcher = { dispatcher: Dispatcher; lastUsedAt: number };

const MAX_DISPATCHERS = 64;
const DISPATCHER_TTL_MS = 5 * 60_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_REDIRECT_HEADERS = new Set(["accept", "accept-encoding", "accept-language", "content-language", "content-type", "range"]);
const globalCache = globalThis as typeof globalThis & { __dqSafeOutboundDispatchers?: Map<string, CachedDispatcher> };
const dispatchers = (globalCache.__dqSafeOutboundDispatchers ??= new Map<string, CachedDispatcher>());

export class UnsafeOutboundUrlError extends Error {
    constructor(message = "出站地址不允许访问") {
        super(message);
        this.name = "UnsafeOutboundUrlError";
    }
}

export async function fetchSafeOutboundUrl(input: string | URL, init: RequestInit = {}, options?: SafeOutboundOptions): Promise<Response> {
    let currentUrl: URL;
    try {
        currentUrl = input instanceof URL ? new URL(input) : new URL(input);
    } catch {
        throw new UnsafeOutboundUrlError();
    }

    let currentInit = { ...init };
    const redirectMode = init.redirect || "follow";
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const response = await fetchPinned(currentUrl, { ...currentInit, redirect: "manual" }, options);
        if (!REDIRECT_STATUSES.has(response.status)) return response;
        if (redirectMode === "manual") return response;
        await response.body?.cancel().catch(() => undefined);
        if (redirectMode === "error") throw new UnsafeOutboundUrlError("上游地址不允许重定向");
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) throw new UnsafeOutboundUrlError("上游重定向地址无效或次数过多");
        let nextUrl: URL;
        try {
            nextUrl = new URL(location, currentUrl);
        } catch {
            throw new UnsafeOutboundUrlError("上游重定向地址无效");
        }
        currentInit = redirectedRequestInit(currentUrl, nextUrl, response.status, currentInit);
        currentUrl = nextUrl;
    }
    throw new UnsafeOutboundUrlError("上游重定向次数过多");
}

async function fetchPinned(input: URL, init: RequestInit, options?: SafeOutboundOptions) {
    const target = await resolveSafeOutboundTarget(input, options);
    if (!target) throw new UnsafeOutboundUrlError();

    const headers = new Headers(init.headers);
    const proxyUrl = isPublicIpAddress(target.address) ? getOutboundProxyUrl() : "";
    const requestUrl = proxyUrl ? pinnedProxyUrl(target) : target.url;
    if (proxyUrl) headers.set("host", target.url.host);
    const dispatcher = dispatcherFor(target, proxyUrl);
    const requestBody = await toUndiciRequestBody(init.body);
    if (requestBody.contentType && !headers.has("content-type")) headers.set("content-type", requestBody.contentType);
    return (await undiciFetch(requestUrl, { ...init, body: requestBody.body, headers, dispatcher } as import("undici").RequestInit & { dispatcher: Dispatcher })) as unknown as Response;
}

function redirectedRequestInit(currentUrl: URL, nextUrl: URL, status: number, init: RequestInit): RequestInit {
    const headers = new Headers(init.headers);
    if (currentUrl.origin !== nextUrl.origin) {
        [...headers.keys()].forEach((name) => {
            if (!CROSS_ORIGIN_REDIRECT_HEADERS.has(name.toLowerCase())) headers.delete(name);
        });
    }
    const switchToGet = status === 303 ? init.method?.toUpperCase() !== "HEAD" : (status === 301 || status === 302) && init.method?.toUpperCase() === "POST";
    if (switchToGet) {
        headers.delete("content-length");
        headers.delete("content-type");
        return { ...init, method: "GET", body: undefined, headers };
    }
    return { ...init, headers };
}

function pinnedProxyUrl(target: SafeOutboundTarget) {
    const pinned = new URL(target.url);
    pinned.hostname = target.address;
    return pinned;
}

function dispatcherFor(target: SafeOutboundTarget, proxyUrl: string) {
    const key = [proxyUrl, target.url.protocol, target.url.host, target.address, target.family].join("|");
    const now = Date.now();
    cleanupDispatchers(now);
    const cached = dispatchers.get(key);
    if (cached) {
        cached.lastUsedAt = now;
        return cached.dispatcher;
    }

    const servername = /^[\d.]+$/.test(target.hostname) || target.hostname.includes(":") ? undefined : target.hostname;
    const connector = buildConnector({});
    const dispatcher: Dispatcher = proxyUrl
        ? new ProxyAgent({ uri: proxyUrl, requestTls: servername ? { servername } : undefined })
        : new Agent({ connect: (connection, callback) => connector({ ...connection, hostname: target.address, servername }, callback) });
    dispatchers.set(key, { dispatcher, lastUsedAt: now });
    cleanupDispatchers(now);
    return dispatcher;
}

function cleanupDispatchers(now: number) {
    for (const [key, cached] of dispatchers) {
        if (now - cached.lastUsedAt <= DISPATCHER_TTL_MS && dispatchers.size <= MAX_DISPATCHERS) continue;
        dispatchers.delete(key);
        void cached.dispatcher.destroy().catch(() => undefined);
    }
}
