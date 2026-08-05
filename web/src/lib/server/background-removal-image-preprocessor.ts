import sharp from "sharp";

import { BACKGROUND_REMOVAL_MAX_BYTES } from "@/lib/server/registered-media-reader";

export const BACKGROUND_REMOVAL_MODEL_MAX_EDGE = 2048;
export const BACKGROUND_REMOVAL_MODEL_MAX_PIXELS = 64_000_000;

export type PreparedBackgroundRemovalImage = {
    bytes: Buffer;
    mimeType: "image/png";
    width: number;
    height: number;
    resized: boolean;
};

export function backgroundRemovalTargetSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("Background removal image dimensions are invalid");
    const scale = Math.min(1, BACKGROUND_REMOVAL_MODEL_MAX_EDGE / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function prepareBackgroundRemovalImage(bytes: Buffer): Promise<PreparedBackgroundRemovalImage> {
    if (!bytes.length) throw new Error("Background removal image is empty");
    if (bytes.length > BACKGROUND_REMOVAL_MAX_BYTES) throw new Error("Background removal image exceeds the 30MB limit");

    const source = sharp(bytes, { failOn: "error", limitInputPixels: false }).rotate();
    const metadata = await source.metadata();
    const rawWidth = Number(metadata.width || 0);
    const rawHeight = Number(metadata.height || 0);
    const orientation = Number(metadata.orientation || 1);
    const width = orientation >= 5 && orientation <= 8 ? rawHeight : rawWidth;
    const height = orientation >= 5 && orientation <= 8 ? rawWidth : rawHeight;
    const target = backgroundRemovalTargetSize(width, height);

    const resized = target.width !== width || target.height !== height || width * height > BACKGROUND_REMOVAL_MODEL_MAX_PIXELS;
    const result = await source.resize(target.width, target.height, { fit: "fill", withoutEnlargement: true }).ensureAlpha().png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true });
    if (result.data.length > BACKGROUND_REMOVAL_MAX_BYTES) throw new Error("Background removal image exceeds the 30MB limit after preprocessing");

    return {
        bytes: result.data,
        mimeType: "image/png",
        width: result.info.width,
        height: result.info.height,
        resized,
    };
}
