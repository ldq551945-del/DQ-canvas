export const MAX_MEDIA_PROXY_BYTES = 300 * 1024 * 1024;

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
