export const MAX_MEDIA_PROXY_BYTES = 300 * 1024 * 1024;
export const MAX_MEDIA_PROXY_RANGE_BYTES = 32 * 1024 * 1024;

export function normalizeMediaProxyRange(value: string | null): string | "invalid" | null {
    if (!value) return null;
    const match = value.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) return "invalid";
    if (!match[1]) {
        const suffixLength = Number(match[2]);
        return Number.isSafeInteger(suffixLength) && suffixLength > 0 ? `bytes=-${Math.min(suffixLength, MAX_MEDIA_PROXY_RANGE_BYTES)}` : "invalid";
    }

    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : start + MAX_MEDIA_PROXY_RANGE_BYTES - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start) return "invalid";
    return `bytes=${start}-${Math.min(requestedEnd, start + MAX_MEDIA_PROXY_RANGE_BYTES - 1)}`;
}

export function mediaResponseExceedsLimit(headers: Headers, maxBytes = MAX_MEDIA_PROXY_BYTES) {
    const contentLength = Number(headers.get("content-length") || 0);
    return Number.isFinite(contentLength) && contentLength > maxBytes;
}

export function limitMediaResponseBody(body: ReadableStream<Uint8Array> | null, maxBytes = MAX_MEDIA_PROXY_BYTES) {
    if (!body) return null;
    const reader = body.getReader();
    let total = 0;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
                controller.close();
                return;
            }
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel("Media is too large");
                controller.error(new Error("Media is too large"));
                return;
            }
            controller.enqueue(value);
        },
        cancel(reason) {
            return reader.cancel(reason);
        },
    });
}
