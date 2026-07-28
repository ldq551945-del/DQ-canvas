import type { CSSProperties } from "react";

import type { CreativeAsset } from "@/lib/creative-runtime-contract";

const MEDIA_MAX_WIDTH = 240;
const MEDIA_MAX_HEIGHT = 320;

export function creativeAssetCardLayout(asset: Pick<CreativeAsset, "width" | "height">) {
    const width = Number(asset.width);
    const height = Number(asset.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

    const cardWidth = Math.min(MEDIA_MAX_WIDTH, Math.round((MEDIA_MAX_HEIGHT * width) / height));
    return {
        card: { width: `min(100%, ${cardWidth}px)` } satisfies CSSProperties,
        media: { aspectRatio: `${width} / ${height}` } satisfies CSSProperties,
    };
}
