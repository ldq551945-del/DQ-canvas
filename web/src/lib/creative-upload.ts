export const CREATIVE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

// Canvas image nodes may be sent to the background-removal worker. Keep this
// larger limit scoped to that upload purpose; other creative uploads retain
// the 20 MiB boundary above.
export const CANVAS_IMAGE_UPLOAD_MAX_BYTES = 30 * 1024 * 1024;
export const CANVAS_IMAGE_UPLOAD_MAX_REQUEST_BYTES = Math.ceil((CANVAS_IMAGE_UPLOAD_MAX_BYTES * 4) / 3) + 256 * 1024;

export const CREATIVE_UPLOAD_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/opus",
    "audio/aac",
    "audio/flac",
] as const;

export const CREATIVE_UPLOAD_ACCEPT = CREATIVE_UPLOAD_MIME_TYPES.join(",");

export function isCreativeUploadMimeType(value: string): value is (typeof CREATIVE_UPLOAD_MIME_TYPES)[number] {
    return CREATIVE_UPLOAD_MIME_TYPES.includes(value.toLowerCase() as (typeof CREATIVE_UPLOAD_MIME_TYPES)[number]);
}
