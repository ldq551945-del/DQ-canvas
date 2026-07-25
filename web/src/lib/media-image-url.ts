const LOCAL_IMAGE_ROUTES = ["/api/reference-assets/", "/api/generation-log-assets/"];

export function imagePreviewUrl(url: string, width = 1600) {
    return withLocalImageParams(url, (params) => {
        params.delete("download");
        params.set("format", "webp");
        params.set("width", String(Math.max(64, Math.min(2048, Math.round(width)))));
    });
}

export function originalImageDownloadUrl(url: string) {
    return withLocalImageParams(url, (params) => {
        params.delete("format");
        params.delete("width");
        params.set("download", "original");
    });
}

export function originalImageExtension(url: string) {
    const dataMime = url.match(/^data:image\/(png|jpe?g|webp|gif|avif|bmp)(?:;|,)/i)?.[1];
    if (dataMime) return dataMime.toLowerCase() === "jpeg" ? "jpg" : dataMime.toLowerCase();
    try {
        const extension = new URL(url, "http://vozeb.local").pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
        if (extension && ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"].includes(extension)) return extension;
    } catch {
        // Use the safe fallback for malformed or opaque URLs.
    }
    return "png";
}

function withLocalImageParams(value: string, update: (params: URLSearchParams) => void) {
    const url = value.trim();
    if (!url) return url;
    try {
        const absolute = /^[a-z][a-z\d+.-]*:/i.test(url);
        const parsed = new URL(url, "http://vozeb.local");
        if (!LOCAL_IMAGE_ROUTES.some((route) => parsed.pathname.startsWith(route))) return url;
        update(parsed.searchParams);
        return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
        return url;
    }
}
