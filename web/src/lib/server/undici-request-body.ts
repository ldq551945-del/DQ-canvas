export async function toUndiciRequestBody(body: BodyInit | null | undefined) {
    if (!isFormDataBody(body)) return { body: body as import("undici").RequestInit["body"] };

    // Native FormData and the separately bundled Undici fetch are not always
    // from the same realm in a standalone build. Serialize with the native
    // Request implementation so the bytes and multipart boundary stay paired.
    const request = new Request("http://localhost", { method: "POST", body });
    const bytes = new Uint8Array(await request.arrayBuffer());
    return {
        body: bytes as import("undici").RequestInit["body"],
        contentType: request.headers.get("content-type") || undefined,
    };
}

function isFormDataBody(body: BodyInit | null | undefined): body is FormData {
    if (!body || typeof body !== "object") return false;
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return false;
    if (typeof Headers !== "undefined" && body instanceof Headers) return false;
    const tag = Object.prototype.toString.call(body);
    if (tag === "[object URLSearchParams]" || tag === "[object Headers]") return false;
    return "entries" in body && typeof body.entries === "function";
}
